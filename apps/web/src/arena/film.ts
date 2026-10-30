import type { BattleEvent, Effect, WeaponKind } from '@brink/arena';

// How the battle's event log is cut into beats for the film. A beat is one action and what came of it
// (a move and the overwatch shots it drew, a shot and its hits), played in order. Beats that touch
// different units can share time on screen; small-arms fire from several units at one target plays as
// one volley. Pure: it reads events, never the battle, and copies what it merges (the log is the
// battle's). Playing it can change nothing the battle depends on.

export type FireEvent = Extract<BattleEvent, { type: 'fire' }>;
type SuppLevel = Extract<BattleEvent, { type: 'suppressed' }>['level'];

export interface Beat {
  events: BattleEvent[];
  /** Units it touches. */
  keys: string[];
  /** A turn changing hands, a split or merge, a capture, the end: nothing shares time with it. */
  alone: boolean;
  /** Small-arms fire at one target from more than one shot, played as one volley. */
  volley?: Volley;
}

export interface Volley {
  fires: FireEvent[];
  target: string;
  /** What the shots did to the target, merged: casualties summed, the last suppression level. */
  hits: BattleEvent[];
  /** Everything else, in order (the target's end among it). */
  rest: BattleEvent[];
}

/** Events that start a beat of their own (moves, shots and the rest are decided case by case). */
const STARTS = new Set<BattleEvent['type']>(['face', 'smoke', 'embark', 'split', 'merge', 'treat', 'repair', 'ability']);
const ALONE = new Set<BattleEvent['type']>(['turn', 'end', 'split', 'merge', 'capture']);
const SMALL = new Set<WeaponKind>(['small_arms', 'mg']);
/** How far back a shot looks for a volley at the same target to join. */
const VOLLEY_REACH = 6;

/** The units an event touches. */
export function keysOf(e: BattleEvent): string[] {
  switch (e.type) {
    case 'fire':
      return e.target ? [e.unit, e.target] : [e.unit];
    case 'intercept':
      return [e.unit, e.by];
    case 'embark':
      return [e.unit, e.carrier];
    case 'dismount':
      return [e.carrier, ...e.units.map((u) => u.id)];
    case 'split':
      return [e.unit, ...e.into];
    case 'merge':
      return [e.unit, e.with];
    case 'treat':
    case 'repair':
      return [e.unit, e.target];
    default:
      return 'unit' in e ? [e.unit] : [];
  }
}

/** Cut a batch of events into beats, in order. */
export function beatsOf(events: readonly BattleEvent[]): Beat[] {
  const out: Beat[] = [];
  let cur: Beat | null = null;
  for (const e of events) {
    const head: BattleEvent | undefined = cur?.events[0];
    let fresh: boolean;
    switch (e.type) {
      case 'turn':
      case 'end':
      case 'capture':
        fresh = true;
        break;
      case 'move':
        // A move broken by an overwatch shot or a mine goes on in the same beat.
        fresh = !(head?.type === 'move' && head.unit === e.unit);
        break;
      case 'fire':
        // Overwatch answers the move in progress.
        fresh = !e.overwatch || !cur || cur.alone;
        break;
      case 'dismount':
        // Passengers bailing out of a knocked-out carrier belong to the kill.
        fresh = !cur?.events.some((x) => x.type === 'destroyed' && x.unit === e.carrier);
        break;
      case 'mine':
        fresh = e.laid;
        break;
      default:
        fresh = STARTS.has(e.type);
    }
    if (fresh || !cur) {
      cur = { events: [], keys: [], alone: ALONE.has(e.type) };
      out.push(cur);
    }
    cur.events.push(e);
    for (const k of keysOf(e)) if (!cur.keys.includes(k)) cur.keys.push(k);
  }
  return volleys(out);
}

/** A beat that is one small-arms or machine-gun shot at a unit (and what it did), or null. */
function shotOf(b: Beat): FireEvent | null {
  const f = b.events[0];
  if (b.volley || f?.type !== 'fire' || f.overwatch || !f.target || !SMALL.has(f.kind)) return null;
  return b.events.every((e, i) => i === 0 || e.type !== 'fire') ? f : null;
}

const shares = (a: Beat, b: Beat) => a.keys.some((k) => b.keys.includes(k));

/**
 * Small-arms and machine-gun fire at one target becomes one volley: a shot joins an earlier one at
 * the same target while the target still stands and nothing between them touches it. What its own
 * shooter did in between (usually the move it fired from) plays first, before the volley, when that
 * touches nothing of the volley's and nothing it would jump over.
 */
function volleys(beats: Beat[]): Beat[] {
  const out: (Beat & { shots?: Beat[] })[] = [];
  next: for (const b of beats) {
    const f = shotOf(b);
    if (f) {
      const first: number[] = [];
      for (let i = out.length - 1; i >= Math.max(0, out.length - VOLLEY_REACH); i--) {
        const o = out[i]!;
        if (o.alone || o.keys.includes(f.target!)) {
          const g = o.shots ? shotOf(o.shots[0]!) : shotOf(o);
          if (!g || g.target !== f.target || o.events.some((e) => e.type === 'destroyed' && e.unit === f.target)) break;
          const stay = out.slice(i + 1).filter((_, k) => !first.includes(i + 1 + k));
          if (stay.some((s) => shares(s, b)) || first.some((j) => shares(out[j]!, o) || stay.some((s) => out.indexOf(s) < j && shares(out[j]!, s)))) break;
          const ahead = first.sort((p, q) => p - q).map((j) => out[j]!);
          out.splice(i, out.length - i, ...ahead, o, ...stay);
          o.shots = [...(o.shots ?? [o]), b];
          o.events = [...o.events, ...b.events];
          for (const k of b.keys) if (!o.keys.includes(k)) o.keys.push(k);
          continue next;
        }
        if (o.keys.includes(f.unit)) first.push(i);
      }
    }
    out.push(b);
  }
  return out.map(({ shots, ...b }) => (shots && shots.length > 1 ? { ...b, volley: volleyOf(b.events) } : b));
}

/** Merge a volley's results on its target: casualties summed into one, the last suppression level. */
function volleyOf(events: BattleEvent[]): Volley {
  const fires = events.filter((e): e is FireEvent => e.type === 'fire');
  const target = fires[0]!.target!;
  const hits: BattleEvent[] = [];
  const rest: BattleEvent[] = [];
  let cas: Extract<BattleEvent, { type: 'casualties' }> | null = null;
  let supp: Extract<BattleEvent, { type: 'suppressed' }> | null = null;
  for (const e of events) {
    if (e.type === 'fire') continue;
    if (e.type === 'casualties' && e.unit === target) {
      if (!cas) hits.push((cas = { ...e }));
      else cas = Object.assign(cas, { killed: cas.killed + e.killed, wounded: cas.wounded + e.wounded, seen: cas.seen || e.seen });
    } else if (e.type === 'suppressed' && e.unit === target) {
      if (!supp) hits.push((supp = { ...e }));
      else Object.assign(supp, { level: e.level, seen: supp.seen || e.seen });
    } else if (e.type === 'impact' && e.unit === target) hits.push(e);
    else if (e.type === 'radio' && rest.some((r) => r.type === 'radio' && r.call === e.call && r.unit === e.unit)) continue;
    else rest.push(e);
  }
  return { fires, target, hits, rest };
}

/** The kill that closes each turn in a batch (the batch shows the turn change or the end after it). */
export function lastKills(events: readonly BattleEvent[]): Set<BattleEvent> {
  const out = new Set<BattleEvent>();
  let last: BattleEvent | null = null;
  for (const e of events) {
    if (e.type === 'destroyed' && e.how !== 'expended') last = e;
    else if ((e.type === 'turn' || e.type === 'end') && last) {
      out.add(last);
      last = null;
    }
  }
  return out;
}

/**
 * Bounces that shook the crew: the engine adds suppression before it logs the bounce, so a level change
 * just before a bounce on the same unit is that bounce's. The bounce says it ("Shaken"); the level
 * change says nothing of its own.
 */
export function shakes(events: readonly BattleEvent[]): Map<BattleEvent, SuppLevel> {
  const out = new Map<BattleEvent, SuppLevel>();
  for (let i = 1; i < events.length; i++) {
    const e = events[i]!;
    const p = events[i - 1]!;
    if (e.type === 'impact' && !e.pen && p.type === 'suppressed' && p.unit === e.unit && p.level !== 'steady') {
      out.set(e, p.level);
      out.set(p, p.level);
    }
  }
  return out;
}

/** A word for a suppression level, and the one a bounce that shook a crew gets. */
export function levelWord(level: SuppLevel, bounce = false): string {
  return level === 'broken' ? 'Broken' : level === 'pinned' ? 'Pinned' : bounce ? 'Shaken' : 'Suppressed';
}

/**
 * The severity ladder: 0 a bounce, 1 a crew or suppression hit, 2 a mobility or firepower kill, 3 a
 * kill. Each rung has its hit stop (seconds the film holds still) and its camera trauma.
 */
export type Rung = 0 | 1 | 2 | 3;
export const HIT_STOP: Record<Rung, number> = { 0: 0, 1: 0.04, 2: 0.07, 3: 0.1 };
export const TRAUMA: Record<Rung, number> = { 0: 0, 1: 0.15, 2: 0.3, 3: 0.5 };
/** A brew-up holds a little longer than a crew knocked out. */
export const BREW_UP_STOP = 0.12;

export function rungOf(effect: Effect, pen: boolean): Rung {
  switch (effect) {
    case 'catastrophic':
    case 'shot_down':
    case 'knocked_out':
    case 'forced_landing':
      return 3;
    case 'mobility':
    case 'firepower':
    case 'tracks':
      return 2;
    case 'crew':
    case 'optics':
      return 1;
    default:
      // A penetration that did nothing still shakes the crew; a bounce is a spark and a ping.
      return pen ? 1 : 0;
  }
}
