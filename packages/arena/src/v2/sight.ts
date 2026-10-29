import { typeOf } from './roster';
import { at, BUILDING, FEATURE_HEIGHT, inside, PROFILE, ROCK, RUBBLE, SMOKE_HEIGHT, TREES, WALL, type Battle, type BattleMap, type Point, type Side, type Unit, type UnitType } from './types';

// Who can see what (docs/arena-v2.md, 3.2 and 3.3). A line of sight runs from the viewer's eye to
// the target over the heightfield, sampled every 0.2 cells, and is blocked where the ground, a
// building, a rock or smoke rises above it; one tree cell on the line conceals, two block it.
// Each side sees only what its own units see: the AI and the player get the same view.

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const cheb = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/** Ground level at a point in cells, smoothed between cell centres like the rendered terrain. */
export function groundAt(map: BattleMap, px: number, py: number): number {
  const fx = px - 0.5;
  const fy = py - 0.5;
  const x0 = Math.max(0, Math.min(map.w - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(map.h - 1, Math.floor(fy)));
  const x1 = Math.min(map.w - 1, x0 + 1);
  const y1 = Math.min(map.h - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const e = (x: number, y: number) => map.elev[at(map, x, y)]!;
  const top = e(x0, y0) + (e(x1, y0) - e(x0, y0)) * tx;
  const bottom = e(x0, y1) + (e(x1, y1) - e(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

export function isFlying(t: UnitType): boolean {
  return t.mobility === 'heli' || t.mobility === 'drone';
}

/** Height of a unit's eye, centre or top above level 0, in levels. */
export function heightOf(b: Battle, u: Unit, part: 'eye' | 'centre' | 'top', cell: Point = u): number {
  const t = typeOf(u.type);
  const i = at(b.map, cell.x, cell.y);
  const ground = b.map.elev[i]!;
  const p = PROFILE[t.profile];
  if (isFlying(t)) {
    // Aircraft hold their height over the ground and clear roofs and treetops.
    const clear = Math.max(b.map.storeys[i]!, b.map.cells[i] === TREES ? FEATURE_HEIGHT[TREES] : 0) + 1;
    return ground + Math.max(p[part], t.mobility === 'heli' ? clear : 0);
  }
  if (b.map.cells[i] === BUILDING) return ground + Math.max(0.5, b.map.storeys[i]! - 0.5);
  if (part === 'eye' && u.hunker) return ground + 0.15;
  return ground + p[part];
}

export function smokeAt(b: Battle, x: number, y: number): boolean {
  return b.smoke.some((s) => s.x === x && s.y === y);
}

export interface Line {
  clear: boolean;
  /** Tree cells the line passes through below the canopy (0 or 1 when clear). */
  trees: number;
  /** The ground hid the lower part of the target close to it (for hull-down). */
  groundNearTarget: boolean;
}

/**
 * A line between two heights over the field. `ignoreFeatures`: a recon drone looking down, which
 * trees and buildings never hide from. Cells at both ends never block (a unit sees out of its own
 * wood or window).
 */
export function lineOfSight(b: Battle, from: Point, h0: number, to: Point, h1: number, ignoreFeatures = false): Line {
  const map = b.map;
  const x0 = from.x + 0.5;
  const y0 = from.y + 0.5;
  const x1 = to.x + 0.5;
  const y1 = to.y + 0.5;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 0.2));
  const trees = new Set<number>();
  const start = at(map, from.x, from.y);
  const end = at(map, to.x, to.y);
  let groundNear = false;
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    const h = h0 + (h1 - h0) * t;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (!inside(cx, cy)) continue;
    const ground = groundAt(map, px, py);
    if (h < ground - 0.02) {
      // Close to the target the ground hides its lower half: maybe hull-down.
      if ((1 - t) * d <= 2) groundNear = true;
      else return { clear: false, trees: 0, groundNearTarget: false };
      continue;
    }
    const i = at(map, cx, cy);
    if (i === start || i === end) continue;
    const base = map.elev[i]!;
    if (smokeAt(b, cx, cy) && h < base + SMOKE_HEIGHT) return { clear: false, trees: 0, groundNearTarget: false };
    if (ignoreFeatures) continue;
    const c = map.cells[i]!;
    if (c === BUILDING) {
      if (h < base + map.storeys[i]!) return { clear: false, trees: 0, groundNearTarget: false };
    } else if (c === TREES) {
      if (h < base + FEATURE_HEIGHT[TREES]) trees.add(i);
      if (trees.size >= 2) return { clear: false, trees: 0, groundNearTarget: false };
    } else if (c === ROCK || c === RUBBLE || c === WALL) {
      if (h < base + FEATURE_HEIGHT[c]) return { clear: false, trees: 0, groundNearTarget: false };
    }
  }
  return { clear: !groundNear, trees: trees.size, groundNearTarget: groundNear };
}

/** Sight in cells for this viewer in these conditions (before concealment). */
export function sightRange(b: Battle, t: UnitType): number {
  const { time, weather } = b.conditions;
  const eyes = time === 'day' ? 30 : time === 'night' ? 6 : 18;
  const thermal = time === 'night' ? 22 : 30;
  const nvg = time === 'day' ? 30 : time === 'night' ? 10 : 22;
  let r = t.thermal ? thermal : t.nvg ? nvg : eyes;
  if (weather === 'fog') r = Math.min(r, t.thermal ? 10 : t.nvg ? 8 : 7);
  else if (weather === 'rain') r *= t.thermal ? 0.85 : 0.7;
  else if (weather === 'snow') r *= t.thermal ? 0.9 : 0.8;
  return Math.min(t.sight, r);
}

/** Infantry in woods, a building, rubble or a crater, or hunkered: harder to pick out. */
export function concealed(b: Battle, u: Unit): boolean {
  const t = typeOf(u.type);
  if (t.mobility !== 'foot') return false;
  const i = at(b.map, u.x, u.y);
  const c = b.map.cells[i];
  return u.hunker || c === TREES || c === BUILDING || c === RUBBLE || b.map.crater[i] === 1;
}

const onField = (u: Unit) => u.alive && u.carrier === null;

/** Can `viewer` see `target` now? */
export function canSee(b: Battle, viewer: Unit, target: Unit): boolean {
  if (!onField(viewer) || !onField(target) || viewer.side === target.side) return false;
  const vt = typeOf(viewer.type);
  const tt = typeOf(target.type);
  const d = dist(viewer, target);
  const down = vt.profile === 'drone';
  const h0 = heightOf(b, viewer, 'eye');
  const h1 = heightOf(b, target, 'top');
  // Search radar finds aircraft along a clear line whatever the light.
  if (vt.radar && isFlying(tt) && d <= vt.radar && lineOfSight(b, viewer, h0, target, h1, true).clear) return true;
  // SIGINT, or the flash of a unit that fired: picked out wherever there is a line to it.
  const revealed = target.revealed >= b.turnIndex || (target.side === 'red' && b.sweepUntil >= b.turnIndex);
  let range = down ? 14 : sightRange(b, vt);
  if (!revealed && !down && concealed(b, target)) range = Math.max(3, range / 3);
  if (!revealed && d > range + 0.01) return false;
  const line = lineOfSight(b, viewer, h0, target, h1, down);
  return line.clear || line.groundNearTarget;
}

/** Every enemy unit `side` can see now. */
export function visibleTo(b: Battle, side: Side): Set<string> {
  const out = new Set<string>();
  const mine = b.units.filter((u) => u.side === side && onField(u));
  for (const e of b.units) {
    if (e.side === side || !onField(e)) continue;
    if (mine.some((m) => canSee(b, m, e))) out.add(e.id);
  }
  return out;
}

/**
 * Is this cell seen by any unit of `side` (for called fire)? Returns the best observer quality.
 * `close`: only from near enough that concealed infantry there would be picked out.
 */
export function observation(b: Battle, side: Side, cell: Point, close = false): 'laser' | 'spotter' | 'observed' | null {
  let best: 'laser' | 'spotter' | 'observed' | null = null;
  const rank = { laser: 3, spotter: 2, observed: 1 } as const;
  for (const u of b.units) {
    if (u.side !== side || !onField(u)) continue;
    const t = typeOf(u.type);
    const down = t.profile === 'drone';
    const full = down ? 14 : sightRange(b, t);
    const range = close && !down ? Math.max(3, full / 3) : full;
    if (dist(u, cell) > range + 0.01) continue;
    const ground = b.map.elev[at(b.map, cell.x, cell.y)]! + 0.25;
    const line = lineOfSight(b, u, heightOf(b, u, 'eye'), cell, ground, down);
    if (!line.clear && !line.groundNearTarget) continue;
    const q = t.spotter ?? 'observed';
    if (!best || rank[q] > rank[best]) best = q;
  }
  return best;
}

/**
 * Record what each side sees as last known positions, and log sightings and losses. A ghost goes
 * when its cell is seen empty (or the unit is seen dead there), never because of hidden knowledge.
 */
export function updateIntel(b: Battle): void {
  for (const side of ['blue', 'red'] as const) {
    const seen = visibleTo(b, side);
    const intel = b.intel[side];
    for (const id of [...seen].sort()) {
      const e = b.units.find((u) => u.id === id)!;
      const was = intel[id];
      intel[id] = { unit: id, type: e.type, x: e.x, y: e.y, turn: b.turnIndex, now: true };
      if (was?.now) continue;
      b.events.push({ type: 'spotted', side, unit: id, x: e.x, y: e.y });
      if (side === 'blue' && (!was || was.turn < b.turnIndex - 2)) b.events.push({ type: 'radio', side, call: isFlying(typeOf(e.type)) ? 'air_threat' : 'contact', unit: id });
    }
    for (const id of Object.keys(intel).sort()) {
      if (seen.has(id)) continue;
      const g = intel[id]!;
      if (g.now) {
        intel[id] = { ...g, now: false };
        b.events.push({ type: 'lost', side, unit: id });
      }
      const u = b.units.find((x) => x.id === id);
      const there = u && u.alive && u.carrier === null && u.x === g.x && u.y === g.y;
      // Gone from a cell watched closely enough that it would be seen there.
      if (!there && observation(b, side, g, typeOf(g.type).mobility === 'foot')) delete intel[id];
    }
  }
}
