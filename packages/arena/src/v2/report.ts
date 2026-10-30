import type { FireInfo } from './combat';
import { typeOf } from './roster';
import { other } from './sight';
import { H, type Battle, type BattleEvent, type Effect, type Facing, type Side, type UnitStatus, type UnitType, type WeaponKind } from './types';

// What the player saw of the dice: the shot card's outcome bar, the battle log and the after-action
// report. Everything here reads blue's picture only: events blue did not see are left out, and an
// enemy that fired is named only once blue has spotted it that turn.

// --- One shot's outcomes ---------------------------------------------------------------------------

/**
 * How a shot can end. `intercepted`: air defence downs the drone on its way in. `stopped`: the
 * target's APS defeats the missile. `knock_out`: penetrates and destroys, knocks out the gun or
 * immobilises it (the card's kill chance). `hit`: troops, or a drone (any hit brings it down).
 */
export type Outcome = 'intercepted' | 'miss' | 'stopped' | 'bounce' | 'penetrate' | 'knock_out' | 'hit';

/**
 * The chance (0..1) of each outcome, from the card's own numbers, in the order the rules roll them
 * (`shoot` in combat.ts): an air-defence roll for a drone on its way in, then the hit roll at
 * `chance` (so miss = 1 - hit); on a hit, the APS against a missile, then the armour at `pen`.
 * `kill` already counts the penetration and the APS, so knock out = hit x kill, and penetrate
 * without it = hit x (1 - aps) x pen - knock out. Troops and drones: a hit. They add up to 1.
 */
export function outcomeShares(info: FireInfo, target: UnitType): { outcome: Outcome; p: number }[] {
  const through = 1 - (info.intercept ?? 0) / 100;
  const hit = info.chance / 100;
  const out: { outcome: Outcome; p: number }[] = [
    { outcome: 'intercepted', p: 1 - through },
    { outcome: 'miss', p: through * (1 - hit) },
  ];
  if (info.pen !== undefined && target.armour) {
    const aps = (info.aps ?? 0) / 100;
    const pen = info.pen / 100;
    const kill = Math.min((1 - aps) * pen, (info.kill ?? 0) / 100);
    out.push(
      { outcome: 'stopped', p: through * hit * aps },
      { outcome: 'bounce', p: through * hit * (1 - aps) * (1 - pen) },
      { outcome: 'penetrate', p: through * hit * ((1 - aps) * pen - kill) },
      { outcome: 'knock_out', p: through * hit * kill },
    );
  } else out.push({ outcome: 'hit', p: through * hit });
  return out;
}

/**
 * The same as whole shares of 100 for the bar: they add up to 100 (largest remainders rounded up),
 * and outcomes that cannot happen are left out. With no drone in it, miss stays 100 - chance.
 */
export function outcomes(info: FireInfo, target: UnitType): { outcome: Outcome; pct: number }[] {
  const raw = outcomeShares(info, target);
  const pct = raw.map((x) => Math.max(0, x.p) * 100);
  const out = pct.map((v) => Math.floor(v + 1e-9));
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = pct.map((v, i) => ({ i, r: v - out[i]! })).sort((p, q) => q.r - p.r || p.i - q.i);
  for (const { i, r } of order) {
    if (left <= 0 || r <= 1e-9) break;
    out[i]!++;
    left--;
  }
  return raw.map((x, i) => ({ outcome: x.outcome, pct: out[i]! })).filter((x) => x.pct > 0);
}

// --- The battle log ----------------------------------------------------------------------------------

export type LogResult =
  /** `by`: the gun that downed a drone, when blue has seen it; the target itself for APS. */
  | { type: 'intercept'; unit: string; by: string | null; aps: boolean }
  | { type: 'impact'; unit: string; pen: boolean; effect: Effect; facing: Facing }
  | { type: 'casualties'; unit: string; killed: number; wounded: number }
  | { type: 'suppressed'; unit: string; level: 'suppressed' | 'pinned' | 'broken' }
  | { type: 'destroyed'; unit: string; how: UnitStatus };

export interface LogEntry {
  /** Index of its first event in `b.events` (a stable key). */
  at: number;
  round: number;
  /** The side that rolled: the one that fired, laid the mine or called the strike. */
  side: Side;
  /** A direct shot, called fire on a cell (smoke too), a mine going off, or an air strike. */
  kind: 'shot' | 'called' | 'smoke' | 'mine' | 'airstrike';
  /** Who fired, when blue saw who it was; null for an enemy unseen. Off-map rockets: 'support:himars'. */
  shooter: string | null;
  /** What it fired, when blue saw who fired (an unseen enemy's shot is fire from out of sight, nothing more). */
  weapon: string | null;
  weaponKind: WeaponKind | null;
  /** The unit fired at (a shot), or the one that ran onto the mine. */
  target: string | null;
  /** The chance rolled, percent; null where the card shows none (mines, air strikes). */
  chance: number | null;
  hit: boolean;
  overwatch: boolean;
  results: LogResult[];
}

/** Events that close a shot's window: whatever follows them is not its doing. */
const CLOSES: Partial<Record<BattleEvent['type'], true>> = { fire: true, move: true, face: true, turn: true, embark: true, split: true, merge: true, treat: true, repair: true, ability: true, capture: true, end: true };

/**
 * Every roll the player saw, oldest first: who fired at whom, the chance, hit or miss, and what it
 * did to each unit blue saw it do it to. `upTo`: read only the events before this index (the film
 * has not shown the rest yet).
 */
export function rollLog(b: Battle, upTo = b.events.length): LogEntry[] {
  const events = b.events.slice(0, upTo);
  // Where each side-turn ends, and when blue spotted each enemy: one that fired is named only if
  // blue had it in sight by the end of that turn (firing shows where it is, and the film shows it).
  const spotted = new Map<string, number[]>();
  const turnEnd: number[] = new Array<number>(events.length).fill(events.length);
  let next = events.length;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'turn') next = i;
    turnEnd[i] = next;
    if (e.type === 'spotted' && e.side === 'blue') spotted.set(e.unit, [i, ...(spotted.get(e.unit) ?? [])]);
  }
  const side = (id: string) => b.units.find((u) => u.id === id)?.side;
  const named = (id: string, i: number) => side(id) === 'blue' || (spotted.get(id) ?? []).some((s) => s < turnEnd[i]!);
  const out: LogEntry[] = [];
  let round = 1;
  let turn: Side = 'blue';
  let cur: LogEntry | null = null;
  let mineSide: Side | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (CLOSES[e.type]) cur = null;
    switch (e.type) {
      case 'turn':
        round = e.round;
        turn = e.side;
        break;
      case 'fire': {
        if (!e.seen) break;
        const support = e.unit.startsWith('support:');
        // A squad merged away is no longer listed: its side is the other one from its target's.
        const target = e.target ? side(e.target) : undefined;
        const by: Side = support ? (e.from.y > H / 2 ? 'blue' : 'red') : (side(e.unit) ?? (target ? other(target) : turn));
        const called = e.target === null;
        const smoke = called && events[i + 1]?.type === 'smoke';
        // Who fired, and with what, only when blue saw who it was.
        const shown = support ? by === 'blue' : named(e.unit, i);
        cur = {
          at: i,
          round,
          side: by,
          kind: smoke ? 'smoke' : called ? 'called' : 'shot',
          shooter: shown ? e.unit : null,
          weapon: shown ? e.weapon : null,
          weaponKind: shown ? e.kind : null,
          target: e.target,
          chance: e.chance,
          hit: e.hit,
          overwatch: e.overwatch,
          results: [],
        };
        out.push(cur);
        break;
      }
      case 'mine':
        mineSide = e.laid ? null : e.side;
        break;
      case 'boom':
        if (e.kind === 'mine' && mineSide) {
          cur = null;
          if (e.seen) {
            cur = { at: i, round, side: mineSide, kind: 'mine', shooter: null, weapon: 'mine', weaponKind: null, target: null, chance: null, hit: true, overwatch: false, results: [] };
            out.push(cur);
          }
          mineSide = null;
        }
        break;
      case 'ability':
        if (e.id === 'airstrike') {
          cur = { at: i, round, side: 'blue', kind: 'airstrike', shooter: null, weapon: 'airstrike', weaponKind: null, target: null, chance: null, hit: true, overwatch: false, results: [] };
          out.push(cur);
        }
        break;
      case 'intercept':
      case 'impact':
      case 'casualties':
      case 'suppressed':
      case 'destroyed': {
        const c = cur;
        if (!c || !e.seen) break;
        if (c.kind === 'mine' && c.target === null) c.target = e.type === 'intercept' ? e.by : e.unit;
        if (e.type === 'intercept') c.results.push({ type: 'intercept', unit: e.unit, by: e.by === c.target || named(e.by, i) ? e.by : null, aps: e.by === c.target });
        else if (e.type === 'impact') c.results.push({ type: 'impact', unit: e.unit, pen: e.pen, effect: e.effect, facing: e.facing });
        else if (e.type === 'casualties') c.results.push({ type: 'casualties', unit: e.unit, killed: e.killed, wounded: e.wounded });
        else if (e.type === 'suppressed') {
          if (e.level !== 'steady') c.results.push({ type: 'suppressed', unit: e.unit, level: e.level });
        } else c.results.push({ type: 'destroyed', unit: e.unit, how: e.how });
        break;
      }
    }
  }
  return out;
}

// --- Strength lost, round by round -----------------------------------------------------------------

export interface RoundLoss {
  round: number;
  /** Share of its starting strength each side lost this round (red: as far as blue saw). */
  blue: number;
  red: number;
  /** Units knocked out: yours lost, theirs seen going. */
  lost: number;
  killed: number;
}

/**
 * What each round cost each side, from the events: casualties, damage and losses, valued as the
 * unit values do (a soldier is his share of the squad, a damaged vehicle keeps part of its worth).
 * Red's side counts only what blue saw happen.
 */
export function roundLosses(b: Battle): RoundLoss[] {
  const start: Record<Side, number> = { blue: 0, red: 0 };
  const value = new Map<string, number>();
  const types = new Map<string, UnitType>();
  for (const u of b.units) {
    start[u.side] += u.startValue;
    value.set(u.id, u.startValue);
    types.set(u.id, typeOf(u.type));
  }
  const rounds: RoundLoss[] = [];
  let round = 1;
  const row = () => {
    let r = rounds.find((x) => x.round === round);
    if (!r) rounds.push((r = { round, blue: 0, red: 0, lost: 0, killed: 0 }));
    return r;
  };
  const lose = (id: string, by: number) => {
    const u = b.units.find((x) => x.id === id);
    const now = value.get(id);
    if (!u || now === undefined || by <= 0) return;
    const take = Math.min(now, by);
    value.set(id, now - take);
    row()[u.side] += take / Math.max(1, start[u.side]);
  };
  const shown = (id: string, seen: boolean) => seen || b.units.find((x) => x.id === id)?.side === 'blue';
  for (const e of b.events) {
    if (e.type === 'turn') round = e.round;
    else if (e.type === 'casualties' && shown(e.unit, e.seen)) {
      const t = types.get(e.unit);
      if (t) lose(e.unit, ((e.killed + 0.5 * e.wounded) * t.value) / Math.max(1, t.men?.length ?? 1));
    } else if (e.type === 'impact' && e.pen && shown(e.unit, e.seen)) {
      const t = types.get(e.unit);
      if (!t) continue;
      if (e.effect === 'mobility' || e.effect === 'firepower') lose(e.unit, (value.get(e.unit) ?? 0) - Math.min(value.get(e.unit) ?? 0, 0.6 * t.value));
      else if (e.effect === 'crew') lose(e.unit, 0.15 * t.value);
    } else if (e.type === 'destroyed' && shown(e.unit, e.seen)) {
      const u = b.units.find((x) => x.id === e.unit);
      // Troops are worth their soldiers, counted as they fell (the wounded still count half).
      if (types.get(e.unit)?.mobility !== 'foot') lose(e.unit, value.get(e.unit) ?? 0);
      if (u) row()[u.side === 'blue' ? 'lost' : 'killed']++;
    }
  }
  return rounds.sort((p, q) => p.round - q.round);
}

/** The round that swung the battle most, either way: the largest gap between the two sides' losses. */
export function turningPoint(b: Battle): RoundLoss | null {
  let best: RoundLoss | null = null;
  for (const r of roundLosses(b)) if (Math.abs(r.red - r.blue) > 0.005 && (!best || Math.abs(r.red - r.blue) > Math.abs(best.red - best.blue) + 1e-9)) best = r;
  return best;
}
