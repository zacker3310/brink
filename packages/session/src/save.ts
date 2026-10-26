import type { SaveFile } from '@brink/contracts';
import { SAVE_FORMAT, SAVE_VERSION } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { SCENARIOS } from '@brink/scenarios';
import { hashState } from '@brink/simulation';

export class SaveError extends Error {}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

/**
 * Parse and check a save. Refuses anything this build cannot faithfully resume: another
 * format, a newer save version, a different ruleset, an unknown scenario, or a world whose
 * hash no longer matches (edited or corrupted).
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
  if (s.saveVersion < SAVE_VERSION) throw new SaveError(`save version ${s.saveVersion} is no longer supported`);
  if (s.rulesetVersion !== RULESET_VERSION) throw new SaveError(`save uses ruleset ${s.rulesetVersion}; this build runs ${RULESET_VERSION}`);
  if (!SCENARIOS.some((sc) => sc.id === s.scenarioId)) throw new SaveError(`unknown scenario ${s.scenarioId}`);
  if (!s.world || s.world.rulesetVersion !== RULESET_VERSION || s.world.scenarioId !== s.scenarioId) throw new SaveError('save world does not match its header');
  if (!s.playerNation || !s.world.nations[s.playerNation]) throw new SaveError('save names a player nation that does not exist');
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
  return s as SaveFile;
}
