import { clearSnapshot, readSnapshot, snapshotOf, writeSnapshot, type Battle, type BattleEvent, type BattleSnapshot, type SnapshotStore } from '@brink/arena';
import type { NationView } from '@brink/contracts';
import type { BattleRequest } from './battle';

// The battle in progress, saved so a phone that drops the page (iOS closes it when memory runs
// short) picks it up where it was. Saved when it starts, after every order that is committed, when
// a turn ends (the enemy's turn is already resolved by then), when the page goes to the background
// and when the GPU context is lost; written atomically as a checked snapshot (@brink/arena
// snapshot.ts), about 45 KB for the largest battle. Skirmishes resume from the Skirmish menu. A
// war-map battle resumes when the same attack is ordered again on the same turn: the war map's
// draft orders are not saved mid-turn, so it cannot reopen the battle by itself.

export type ResumeKind = 'skirmish' | 'war';
export type SavedBattle = BattleSnapshot<BattleRequest>;

const KEY = (kind: ResumeKind) => `brink.arena.snapshot.v1.${kind}`;
const kindOf = (req: BattleRequest): ResumeKind => (req.skirmish ? 'skirmish' : 'war');

/** localStorage, or null where the browser refuses it (a private window, blocked site data). */
function store(): SnapshotStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Save the battle as it stands; `played` is how much of its log the screen has shown (the rest is
 * kept as told-not-replayed). An ended battle clears the save. False when storage is missing or full.
 */
export function saveBattle(req: BattleRequest, battle: Battle, played = battle.events.length): boolean {
  const s = store();
  if (!s) return false;
  if (battle.ended) {
    clearSnapshot(s, KEY(kindOf(req)));
    return true;
  }
  const { resume: _resume, ...rest } = req;
  return writeSnapshot(s, KEY(kindOf(req)), snapshotOf<BattleRequest>(battle, rest, played));
}

export function readResume(kind: ResumeKind): SavedBattle | null {
  const s = store();
  return s ? readSnapshot<BattleRequest>(s, KEY(kind)) : null;
}

export function clearResume(kind: ResumeKind): void {
  const s = store();
  if (s) clearSnapshot(s, KEY(kind));
}

/** The request for a saved battle, carrying the battle to pick up. */
export function resumeRequest(s: SavedBattle): BattleRequest {
  return { ...s.request, resume: { battle: s.battle, unplayed: s.unplayed } };
}

/** What a resumed battle tells you about the turn you did not see (kills and losses in its unplayed tail). */
export function unplayedReport(events: readonly BattleEvent[], sideOf: (unit: string) => 'blue' | 'red' | undefined): string | null {
  let killed = 0;
  let lost = 0;
  for (const e of events) {
    if (e.type !== 'destroyed') continue;
    if (sideOf(e.unit) === 'blue') lost++;
    else if (e.seen) killed++;
  }
  if (!events.some((e) => e.type === 'turn')) return null;
  return killed || lost ? [killed ? `${killed} knocked out` : '', lost ? `${lost} lost` : ''].filter(Boolean).join(' · ') : 'No losses either side';
}

/** Keys in a fixed order, so two setups built the same way compare equal. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * A war-map attack, stamped with the turn and nation it was ordered on. When the battle saved last
 * is this very battle (the same turn, nation, hex and setup: the same units against the same
 * enemies), it carries that battle to pick up instead of starting again.
 */
export function warRequest(req: BattleRequest, turn: number, nation: string): BattleRequest {
  const stamped: BattleRequest = { ...req, campaign: { turn, nation } };
  const s = readResume('war');
  const was = s?.request;
  if (!s || !was || was.target !== req.target || was.campaign?.turn !== turn || was.campaign.nation !== nation) return stamped;
  return canon(was.setup) === canon(req.setup) ? { ...stamped, resume: { battle: s.battle, unplayed: s.unplayed } } : stamped;
}

/**
 * On a campaign loaded or a turn resolved: the war-map battle saved on this turn, if its units are
 * still yours to order (for a word to the player). A save from a turn now past is dropped.
 */
export function warSaveFor(view: NationView): SavedBattle | null {
  const s = readResume('war');
  const c = s?.request.campaign;
  if (!s || !c || c.nation !== view.self.id) return null;
  if (c.turn < view.turn) {
    clearResume('war');
    return null;
  }
  return c.turn === view.turn && s.request.setup.attackers.every((a) => !!view.formations[a.id]) ? s : null;
}
