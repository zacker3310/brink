import { act, autoTurn, createBattle, endTurn, retreat } from './engine';
import { wellFormed } from './orders';
import { type Action, type ArenaSetup, type Battle } from './types';

// The player's command log (docs/architecture.md, Battles). A battle is a pure function of its
// setup and the commands the player gave that were accepted: the enemy's turns and Let Crews Play
// are the AI's, which chooses from the state alone (hash noise, never the stream or the clock), so
// replaying the log through the same engine rebuilds the battle exactly. `hashBattle` tells two
// battles apart; E's snapshots and any replay check can compare them by it.

/** What the player can do: an order to a unit or the side, End Turn, Let Crews Play, or Retreat. */
export type PlayerCommand = { type: 'act'; action: Action } | { type: 'end' } | { type: 'auto' } | { type: 'retreat' };

export { wellFormed } from './orders';

/**
 * Apply one player command through the engine (`act` for blue, `endTurn`, `autoTurn`, `retreat`)
 * and log a copy of it in `b.commands` when it was accepted. A refused command changes nothing and
 * is not logged; nor is a malformed one, which the engine is never shown. Returns whether it was
 * accepted. End Turn and Let Crews Play are accepted on blue's turn of a battle still going; Retreat
 * while it is going.
 */
export function submit(b: Battle, cmd: PlayerCommand): boolean {
  if (typeof cmd !== 'object' || cmd === null) return false;
  const going = !b.ended;
  let ok = false;
  switch (cmd.type) {
    case 'act':
      ok = wellFormed(cmd.action) && act(b, cmd.action, 'blue');
      break;
    case 'end':
      ok = going && b.turn === 'blue';
      if (ok) endTurn(b);
      break;
    case 'auto':
      ok = going && b.turn === 'blue';
      if (ok) autoTurn(b);
      break;
    case 'retreat':
      ok = going;
      if (ok) retreat(b);
      break;
  }
  if (ok) (b.commands ??= []).push(JSON.parse(JSON.stringify(cmd)) as PlayerCommand);
  return ok;
}

/**
 * Rebuild a battle from the setup it was created from (the battle does not keep it) and its
 * command log. Throws at the first command the rebuilt battle refuses: the log does not belong to
 * this setup, or the rules have changed since it was written.
 */
export function replay(setup: ArenaSetup, commands: readonly PlayerCommand[]): Battle {
  const b = createBattle(setup);
  commands.forEach((c, i) => {
    if (!submit(b, c)) throw new Error(`replay: command ${i} (${c.type === 'act' ? c.action.type : c.type}) was refused`);
  });
  return b;
}

/** JSON with object keys sorted at every level and undefined left out, as a JSON round trip leaves it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`non-finite number in battle state: ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A stable hash of a battle: 16 hex characters, two FNV-1a lanes over its canonical JSON (the war
 * engine's scheme in `simulation/src/hash.ts`). It covers everything the battle holds (map, units,
 * conditions, turn and round, intel, smoke, mines, wrecks, support, abilities, stats, the event log
 * and the stream's state) except the command log, which is how it got there, not what it is. Equal
 * hashes: the same battle. A save and its JSON round trip hash the same; a non-finite number throws.
 */
export function hashBattle(b: Battle): string {
  const state: Partial<Battle> = { ...b };
  delete state.commands;
  const text = canonicalJson(state);
  const a = fnv1a(text, 0x811c9dc5);
  const c = fnv1a(text, 0x01000193 ^ 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + c.toString(16).padStart(8, '0');
}
