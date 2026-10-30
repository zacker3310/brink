import { ARENA_RULES_VERSION } from './rules';
import type { Battle, BattleEvent, Side } from './types';

// Battle snapshots: a battle saved so a page the phone closed picks it up where it was. A snapshot
// holds the authoritative battle (its random stream's state included, so what follows rolls the
// same), the rules version, whose turn and which round, the request it was fought for, and the
// events committed but not yet shown when it was saved (never replayed: the battle is already past
// them). It is written as a header line (format, version, length, FNV-1a hash) over a JSON body, to
// a fresh slot that is read back and checked before a pointer key is swapped to it; a page closed
// half way through a save leaves the last good snapshot in place. A damaged snapshot, an unknown
// version or other rules give nothing back, never an error.

export const SNAPSHOT_FORMAT = 'brink-arena-snapshot';
export const SNAPSHOT_VERSION = 1;

/** Where snapshots are kept: localStorage, or a stand-in for tests. */
export interface SnapshotStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BattleSnapshot<R> {
  version: number;
  /** ARENA_RULES_VERSION when it was saved. */
  rules: number;
  savedAt: string;
  round: number;
  turnIndex: number;
  turn: Side;
  /** What the battle was fought for (the screen's request), plain JSON. */
  request: R;
  /** The battle as it stood, all of it: its event log too, so the battle log reads on and the battle
   *  hashes (hashBattle) and replays from its command log as the one that never stopped. */
  battle: Battle;
  /** Committed but not yet shown when saved (the rest of an enemy turn's film): told, never replayed. */
  unplayed: BattleEvent[];
}

/** Bring an older snapshot body up to this version, by the version it was written at. */
export type SnapshotMigration = (body: Record<string, unknown>) => Record<string, unknown> | null;

/** None yet: version 1 is the first. A new version adds the step from the one before it here. */
export const SNAPSHOT_MIGRATIONS: Readonly<Record<number, SnapshotMigration>> = {};

/** The most unplayed events a snapshot keeps (an enemy turn logs a few hundred at most). */
const UNPLAYED_MAX = 600;

/** FNV-1a over the text's UTF-16 units, as 8 hex digits. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A battle's snapshot: the battle as it stands; `played` is how much of the log the screen has shown. */
export function snapshotOf<R>(battle: Battle, request: R, played = battle.events.length, savedAt = new Date().toISOString()): BattleSnapshot<R> {
  const unplayed = battle.events.slice(Math.max(0, Math.min(played, battle.events.length))).slice(-UNPLAYED_MAX);
  return {
    version: SNAPSHOT_VERSION,
    rules: ARENA_RULES_VERSION,
    savedAt,
    round: battle.round,
    turnIndex: battle.turnIndex,
    turn: battle.turn,
    request,
    battle,
    unplayed,
  };
}

/** The text stored: a header line, then the body. */
export function encodeSnapshot<R>(snap: BattleSnapshot<R>): string {
  const body = JSON.stringify(snap);
  return `${SNAPSHOT_FORMAT} ${snap.version} ${body.length} ${hashText(body)}\n${body}`;
}

/**
 * The snapshot in a stored text, or null when it is damaged, of an unknown version or other rules.
 * An older version is brought up through `migrations`; `current` is this version (a test sets it).
 */
export function decodeSnapshot<R>(text: string | null, migrations: Readonly<Record<number, SnapshotMigration>> = SNAPSHOT_MIGRATIONS, current = SNAPSHOT_VERSION): BattleSnapshot<R> | null {
  if (!text) return null;
  const nl = text.indexOf('\n');
  if (nl < 0) return null;
  const [format, version, length, hash] = text.slice(0, nl).split(' ');
  const body = text.slice(nl + 1);
  const v = Number(version);
  if (format !== SNAPSHOT_FORMAT || !Number.isInteger(v) || v < 1 || v > current) return null;
  if (Number(length) !== body.length || hashText(body) !== hash) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  for (let at = v; at < current; at++) {
    const step = migrations[at];
    let next: Record<string, unknown> | null = null;
    try {
      next = step ? step(data) : null;
    } catch {
      next = null;
    }
    if (!next) return null;
    data = next;
  }
  const s = data as unknown as BattleSnapshot<R>;
  const b = s.battle as Partial<Battle> | undefined;
  if (s.rules !== ARENA_RULES_VERSION || !b || b.version !== 2 || !Array.isArray(b.units) || !Array.isArray(b.events) || !b.map || typeof b.stream !== 'number' || b.ended) return null;
  if (!Array.isArray(s.unplayed)) s.unplayed = [];
  return { ...s, version: current };
}

/** The slot keys a pointer key writes to, in turn. */
const slots = (key: string): [string, string] => [`${key}.a`, `${key}.b`];

/**
 * Save atomically: write the snapshot to the slot not in use, read it back and check it, then point
 * the key at it and drop the other. False when storage is missing, full or does not read back.
 */
export function writeSnapshot<R>(store: SnapshotStore, key: string, snap: BattleSnapshot<R>): boolean {
  const text = encodeSnapshot(snap);
  const [a, b] = slots(key);
  try {
    const next = store.getItem(key) === a ? b : a;
    store.setItem(next, text);
    if (store.getItem(next) !== text) return false;
    store.setItem(key, next);
    store.removeItem(next === a ? b : a);
    return true;
  } catch {
    return false;
  }
}

/** The snapshot the key points at, or null (none, damaged, unknown version, other rules, no storage). */
export function readSnapshot<R>(store: SnapshotStore, key: string, migrations?: Readonly<Record<number, SnapshotMigration>>): BattleSnapshot<R> | null {
  try {
    const slot = store.getItem(key);
    if (!slot || !slots(key).includes(slot)) return null;
    return decodeSnapshot<R>(store.getItem(slot), migrations);
  } catch {
    return null;
  }
}

export function clearSnapshot(store: SnapshotStore, key: string): void {
  try {
    store.removeItem(key);
    for (const s of slots(key)) store.removeItem(s);
  } catch {
    // Nothing stored to clear.
  }
}
