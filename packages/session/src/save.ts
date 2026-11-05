import type { SaveFile, WorldState } from '@brink/contracts';
import { SAVE_FORMAT, SAVE_VERSION } from '@brink/contracts';
import { RULESET_VERSION, VICTORY } from '@brink/game-data';
import { theatreOf } from '@brink/scenarios';
import { clone, hashState, initDoctrine, initProgression, seedCommanders } from '@brink/simulation';

/** Theatres the game no longer has (ruleset 2.0.0 replaced them with the Pacific). */
const RETIRED: readonly string[] = ['meridian-crisis', 'highland-front', 'varn-delta'];

export class SaveError extends Error {}

/** The oldest save version this build can migrate forward. */
export const MIN_SAVE_VERSION = 1;

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

/** Compare dotted version strings numerically: -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Save migrations, one per save version: each takes a save at version `v` to `v + 1`. They only
 * add or reshape state; they never invent history. Pure.
 */
const MIGRATIONS: Record<number, (save: SaveFile) => SaveFile> = {
  // 1 -> 2: treaties, facilities and construction queues (world schema 2).
  1: (save) => {
    const w = save.world as unknown as Omit<WorldState, 'schema'> & { schema: number };
    w.schema = 2;
    w.treaties ??= [];
    for (const s of Object.values(w.sites)) s.facilities ??= [];
    for (const n of Object.values(w.nations)) n.construction ??= [];
    return { ...save, world: w as WorldState, saveVersion: 2 };
  },
};

/** Bring a hash-checked save of any supported version up to this build's save and ruleset. */
export function migrateSave(save: SaveFile): SaveFile {
  let s = save;
  while (s.saveVersion < SAVE_VERSION) {
    const step = MIGRATIONS[s.saveVersion];
    if (!step) throw new SaveError(`save version ${s.saveVersion} cannot be migrated`);
    s = step(s);
  }
  if (s.rulesetVersion === RULESET_VERSION && s === save) return s;
  // An older ruleset resumes under this build's rules: the campaign carries on, balance changes apply.
  const from = save.rulesetVersion;
  // Ruleset 2.3: a campaign begun before commanders gains each power's starting generals, and
  // before doctrine cards every power is dealt its deck and a first hand.
  // Ruleset 2.6: cities made before development start it at nothing.
  const world = seedCommanders({ ...s.world, rulesetVersion: RULESET_VERSION, nations: clone(s.world.nations), sites: clone(s.world.sites) });
  initDoctrine(world);
  initProgression(world);
  // Ruleset 2.6: leaders remember. A campaign begun before them starts with clean slates.
  world.memories ??= {};
  // Ruleset 2.9 and 2.10 (airborne, passage) and 2.11 (diplomacy: publicRelations is the view's, the
  // new deal kinds simply absent) add no world state: nothing to fill.
  // Ruleset 2.12 (the Black Files lane's 2.10): a campaign without them stays without them; one with
  // them gains any part of their state a younger build did not keep.
  // Ruleset 2.13 (the theatres): the victory bars scale with the powers on the map, fixed at build as
  // `barPowers`; a campaign begun before carries the count its map has.
  // Every step is keyed on a field being absent, so a migrated world comes out of it again unchanged.
  normalizeBlackFiles(world);
  fillBarPowers(world);
  return { ...s, world, rulesetVersion: RULESET_VERSION, hash: hashState(world), ...(from !== RULESET_VERSION ? { migratedFrom: from } : {}) };
}

/**
 * Ruleset 2.13: a world built before the bars scaled with the powers on its map gains its map's count,
 * as a world of 2.13 is built with it (`buildScenario`): only where it has more powers than the bars
 * were measured with (First Contact's five). A Pacific world, of four, is left exactly as it was.
 * Idempotent: a world that has the field keeps it.
 */
export function fillBarPowers(world: WorldState): void {
  if (world.barPowers !== undefined) return;
  const powers = theatreOf(world.scenarioId)?.powers.length ?? 0;
  if (powers > VICTORY.measuredPowers) world.barPowers = powers;
}

/**
 * Ruleset 2.12 (the Black Files lane's 2.10): fill what an older Black Files world lacks. Idempotent: a world it
 * has seen comes out the same. A world without the Black Files is left alone.
 */
export function normalizeBlackFiles(world: WorldState): void {
  const bf = world.blackFiles;
  if (!bf) return;
  bf.artefacts ??= {};
  bf.digs ??= {};
  bf.leaked ??= [];
  bf.accord ??= [];
  bf.betrayers ??= [];
  bf.held ??= {};
  bf.splits ??= 0;
  bf.incursions ??= [];
  bf.wakeTurn ??= null;
  bf.awake ??= null;
}

/**
 * Parse, check and migrate a save. Refuses anything this build cannot resume: another format, a
 * save or ruleset newer than this build, an unknown scenario, or a world whose hash no longer
 * matches (edited or corrupted). The hash is checked on the save as written, before migration.
 * Older saves and rulesets are migrated forward; `migratedFrom` names the ruleset it came from.
 */
export function parseSave(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('not a save file (invalid JSON)');
  }
  const s = raw as Partial<SaveFile>;
  if (!s || typeof s !== 'object' || s.format !== SAVE_FORMAT) throw new SaveError('not a brink save file');
  if (typeof s.saveVersion !== 'number' || s.saveVersion > SAVE_VERSION) throw new SaveError(`save version ${s.saveVersion} is newer than this build supports (${SAVE_VERSION})`);
  if (s.saveVersion < MIN_SAVE_VERSION) throw new SaveError(`save version ${s.saveVersion} is no longer supported`);
  if (typeof s.rulesetVersion !== 'string' || compareVersions(s.rulesetVersion, RULESET_VERSION) > 0) {
    throw new SaveError(`save uses ruleset ${s.rulesetVersion}, newer than this build (${RULESET_VERSION}); update the game`);
  }
  const known = theatreOf(s.scenarioId) !== undefined;
  if (!known && RETIRED.includes(s.scenarioId as string)) throw new SaveError('this campaign was fought in the Meridian, which the Pacific has replaced; start a new campaign');
  if (!known) throw new SaveError(`unknown scenario ${s.scenarioId}`);
  if (!s.world || typeof s.world !== 'object' || s.world.rulesetVersion !== s.rulesetVersion || s.world.scenarioId !== s.scenarioId) throw new SaveError('save world does not match its header');
  if (!s.world.nations || !s.playerNation || !s.world.nations[s.playerNation]) throw new SaveError('save names a player nation that does not exist');
  if (s.humans !== undefined) {
    if (!Array.isArray(s.humans) || s.humans[0] !== s.playerNation) throw new SaveError('save lists human seats that do not start with the player');
    if (new Set(s.humans).size !== s.humans.length || s.humans.some((n) => !s.world!.nations[n])) throw new SaveError('save lists an unknown or repeated human seat');
  }
  if (s.callsigns !== undefined) {
    const c = s.callsigns;
    if (!c || typeof c !== 'object' || Object.entries(c).some(([n, name]) => !s.world!.nations[n] || typeof name !== 'string' || !name.trim()))
      throw new SaveError('save lists a callsign for an unknown seat');
    if (!c[s.playerNation] || (s.humans ?? []).some((n) => !c[n])) throw new SaveError('save is missing a callsign for a human seat');
  }
  if (hashState(s.world) !== s.hash) throw new SaveError('save is corrupted: world hash does not match');
  return migrateSave(s as SaveFile);
}
