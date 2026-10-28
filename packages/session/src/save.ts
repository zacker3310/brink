import type { SaveFile, WorldState } from '@brink/contracts';
import { SAVE_FORMAT, SAVE_VERSION } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { SCENARIOS, THEATRES } from '@brink/scenarios';
import { hashState } from '@brink/simulation';

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
  const world = { ...s.world, rulesetVersion: RULESET_VERSION };
  return { ...s, world, rulesetVersion: RULESET_VERSION, hash: hashState(world), ...(from !== RULESET_VERSION ? { migratedFrom: from } : {}) };
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
  const known = SCENARIOS.some((sc) => sc.id === s.scenarioId) || THEATRES.some((t) => t.id === s.scenarioId);
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
