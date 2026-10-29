import { draw } from '../rng';
import { typeOf } from './roster';
import { RANKS } from './rules';
import { canSee, cheb, dist, groundAt, heightOf, isFlying, lineOfSight, other, visibleTo } from './sight';
import {
  at,
  BUILDING,
  inside,
  OPEN,
  ROAD,
  ROCK,
  RUBBLE,
  TREES,
  WALL,
  WATER,
  type ArmourValue,
  type Battle,
  type Effect,
  type Facing,
  type Point,
  type Side,
  type Unit,
  type UnitStatus,
  type UnitType,
  type Weapon,
  type WeaponKind,
} from './types';

// Shots and what they do (docs/arena-v2.md, 3.4 to 3.7). The chance on the card is the chance
// rolled; penetration compares the round against the armour on the facing it strikes; a
// penetration rolls the component table; a hit on a squad rolls each fit soldier.

export type CoverKind = 'none' | 'trees' | 'half' | 'full' | 'building';
export const COVER_POINTS: Record<CoverKind, number> = { none: 0, trees: 22, half: 22, full: 40, building: 40 };
const COVER_RANK: Record<CoverKind, number> = { none: 0, trees: 1, half: 2, full: 3, building: 3 };
/** Casualty multiplier by cover for troops. */
const COVER_CASUALTIES: Record<CoverKind, number> = { none: 1, trees: 0.7, half: 0.6, full: 0.4, building: 0.35 };

/** Points off per cell beyond half range. */
export const FALLOFF: Record<WeaponKind, number> = { cannon: 1.5, autocannon: 2.5, mg: 5, small_arms: 5, sniper: 2, grenade: 10, rocket: 10, atgm: 0, manpads: 1, mortar: 0, howitzer: 0, fpv: 0, loiter: 0 };
export const SNAP = -12;
const clampChance = (n: number) => Math.max(5, Math.min(95, Math.round(n)));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const fitMen = (u: Unit) => u.men.filter((m) => m.state === 'fit').length;
export const woundedMen = (u: Unit) => u.men.filter((m) => m.state === 'wounded').length;

export function suppLevel(supp: number): 'steady' | 'suppressed' | 'pinned' | 'broken' {
  return supp >= 80 ? 'broken' : supp >= 50 ? 'pinned' : supp >= 25 ? 'suppressed' : 'steady';
}

/** Whether the player (blue) sees this unit now: the film only shows what they saw. */
export function blueSees(b: Battle, u: Unit): boolean {
  if (u.side === 'blue') return true;
  return b.units.some((m) => m.side === 'blue' && canSee(b, m, u));
}

// --- Weapons -------------------------------------------------------------------------------------

/** Weapons the unit can fire now: ammunition left, crew to work them, guns not knocked out. */
export function usableWeapons(u: Unit): Weapon[] {
  const t = typeOf(u.type);
  if (!u.alive || u.carrier) return [];
  const fit = u.men.filter((m) => m.state === 'fit');
  return t.weapons.filter((w) => {
    if (w.ammo !== null && (u.ammo[w.id] ?? 0) <= 0 && !(w.indirect && (u.smoke[w.id] ?? 0) > 0)) return false;
    if (u.firepowerKill && w.kind !== 'mg' && w.kind !== 'small_arms') return false;
    if (t.mobility === 'foot') {
      if (fit.length === 0) return false;
      // A squad's rocket needs someone fit to carry it.
      if (w.kind === 'rocket' && (u.type === 'squad_e' || u.type === 'team_e')) return fit.some((m) => m.role === 'at');
      if (w.kind === 'rocket' && (u.type === 'squad_w' || u.type === 'team_w')) return fit.some((m) => m.role === 'rifleman');
      if (w.kind === 'mortar') return fit.length >= 2;
    }
    return true;
  });
}

/** Squad fire scales with the fit soldiers; team weapons do not. */
function scale(u: Unit, w: Weapon): { lethality: number; supp: number } {
  const t = typeOf(u.type);
  if (t.mobility !== 'foot' || (w.kind !== 'small_arms' && w.kind !== 'grenade') || !t.men) return { lethality: w.lethality, supp: w.supp };
  const share = fitMen(u) / t.men.length;
  return { lethality: w.lethality * share, supp: w.supp * (0.5 + 0.5 * share) };
}

// --- Cover and facing -------------------------------------------------------------------------------

/** The first cell next to `to` on the line from it toward `from`. */
function cellToward(to: Point, from: Point): Point | null {
  const d = dist(to, from);
  if (d < 1.01) return null;
  for (let s = 0.3; s < 1.6; s += 0.1) {
    const x = Math.floor(to.x + 0.5 + ((from.x - to.x) / d) * s);
    const y = Math.floor(to.y + 0.5 + ((from.y - to.y) / d) * s);
    if ((x !== to.x || y !== to.y) && inside(x, y)) return { x, y };
  }
  return null;
}

function coverOfCell(b: Battle, x: number, y: number, foot: boolean): CoverKind {
  if (!inside(x, y)) return 'none';
  const i = at(b.map, x, y);
  const c = b.map.cells[i];
  const wreck = b.wrecks.some((w) => w.x === x && w.y === y);
  if (!foot) return c === BUILDING || c === ROCK || wreck ? 'half' : 'none';
  if (c === BUILDING || c === ROCK || wreck) return 'full';
  if (c === WALL) return (b.map.variant[i]! & 3) === 3 ? 'full' : 'half';
  if (c === RUBBLE) return 'half';
  if (c === TREES) return 'trees';
  return 'none';
}

export interface CoverInfo {
  cover: CoverKind;
  flanked: boolean;
}

/** Cover `target` has against a shot from `from`. */
export function coverAgainst(b: Battle, target: Unit, from: Point, shooterFlies: boolean, higher: boolean): CoverInfo {
  const t = typeOf(target.type);
  if (isFlying(t)) return { cover: 'none', flanked: false };
  const foot = t.mobility === 'foot';
  const i = at(b.map, target.x, target.y);
  let cover: CoverKind = 'none';
  const better = (c: CoverKind) => {
    if (COVER_RANK[c] > COVER_RANK[cover]) cover = c;
  };
  if (foot) {
    const c = b.map.cells[i];
    if (c === BUILDING) better('building');
    else if (c === TREES) better('trees');
    else if (c === RUBBLE || c === WALL || b.map.crater[i] === 1) better('half');
  }
  const n = cellToward(target, from);
  if (n) better(coverOfCell(b, n.x, n.y, foot));
  // From above, cover counts a step less.
  const step = (c: CoverKind): CoverKind => (c === 'full' ? 'half' : c === 'half' ? 'trees' : c === 'building' ? 'building' : 'none');
  if (shooterFlies || higher) cover = step(cover);
  let flanked = false;
  if (cover === 'none') {
    for (let dy = -1; dy <= 1 && !flanked; dy++)
      for (let dx = -1; dx <= 1 && !flanked; dx++) if ((dx || dy) && coverOfCell(b, target.x + dx, target.y + dy, foot) !== 'none' && coverOfCell(b, target.x + dx, target.y + dy, foot) !== 'trees') flanked = true;
  }
  return { cover, flanked };
}

/** Which way a hit on `target` from `from` strikes: by the hull, or by the turret's aim. */
export function facingFrom(target: Unit, from: Point, turret: boolean): Exclude<Facing, 'top'> {
  const bearing = Math.atan2(from.y - target.y, from.x - target.x);
  const rel = Math.abs(wrap(bearing - (turret ? target.aim : target.facing)));
  return rel <= Math.PI / 4 + 1e-6 ? 'front' : rel >= (3 * Math.PI) / 4 - 1e-6 ? 'rear' : 'side';
}

function armourOn(b: Battle, target: Unit, facing: Facing, turret: boolean): ArmourValue {
  const t = typeOf(target.type);
  const a = t.armour!;
  let v: ArmourValue = facing === 'top' ? a.top : facing === 'rear' ? a.rear : facing === 'side' ? a.side : turret ? a.tf : a.hf;
  // Composite armour from research: thicker fronts on the player's tanks and IFVs.
  if (target.side === 'blue' && facing === 'front' && b.abilities.armor !== undefined && (t.role === 'mbt' || t.role === 'ifv')) v = [v[0] + 100, v[1] + 150];
  return v;
}

/** Chance (0..1) that a round with penetration `p` defeats armour `a`: +/-15% spread. */
export function penChance(p: number, a: number): number {
  if (p <= 0) return 0;
  return Math.max(0, Math.min(1, (1.15 - a / p) / 0.3));
}

/** Kinetic rounds meet the KE figure; shaped charges and blast meet the CE figure. */
function penOf(w: Weapon, v: ArmourValue): number {
  return w.round === 'ke' ? v[0] : v[1];
}

/** [catastrophic, firepower, mobility, crew, none] percent on a penetration. */
export function outcomeTable(t: UnitType, turret: boolean, overmatch: boolean, top: boolean): [number, number, number, number, number] {
  let row: [number, number, number, number, number];
  if (t.mobility === 'heli') row = [40, 15, 25, 20, 0];
  else if (t.stowage === 'light' || (t.armour?.hf[0] ?? 0) < 100) row = [45, 15, 25, 15, 0];
  else if (turret) row = t.stowage === 'carousel' || t.stowage === 'basket' ? [30, 35, 0, 25, 10] : t.stowage === 'bustle' ? [8, 40, 0, 37, 15] : [15, 40, 0, 30, 15];
  else row = t.stowage === 'carousel' || t.stowage === 'basket' ? [35, 0, 35, 20, 10] : [15, 0, 45, 25, 15];
  const shift = (overmatch ? 20 : 0) + (top ? 15 : 0);
  if (shift) {
    let left = shift;
    const fromNone = Math.min(row[4], left);
    row[4] -= fromNone;
    left -= fromNone;
    const fromCrew = Math.min(row[3], left);
    row[3] -= fromCrew;
    left -= fromCrew;
    row[0] += shift - left;
  }
  return row;
}

// --- The shot card -----------------------------------------------------------------------------------

export interface FireInfo {
  weapon: Weapon;
  /** Percent, 5..95: rolled exactly. */
  chance: number;
  parts: [string, number][];
  cover: CoverKind;
  hullDown: boolean;
  /** Vehicles and aircraft: the armour it strikes, chance to penetrate, to stop it with APS, and to kill. */
  facing?: Facing;
  pen?: number;
  aps?: number;
  kill?: number;
  /** Drones: chance (percent) the air defence around the target shoots it down first. */
  intercept?: number;
  /** Troops: expected casualties on a hit. */
  casualties?: number;
  /** Suppression a hit adds. */
  supp: number;
}

export function rankAim(u: Unit): number {
  return RANKS[Math.max(0, Math.min(3, u.rank))]!.aim;
}

/** Shooter-side penalties shared by direct and indirect fire. */
function shooterParts(b: Battle, u: Unit, w: Weapon, parts: [string, number][], overwatch: boolean): boolean {
  const t = typeOf(u.type);
  const r = rankAim(u);
  if (r) parts.push([RANKS[u.rank]!.name, r]);
  const lvl = suppLevel(u.supp);
  if (lvl === 'broken') return false;
  if (lvl === 'pinned') parts.push(['Pinned', -30]);
  else if (lvl === 'suppressed') parts.push(['Suppressed', -15]);
  if (t.crew > 0 && u.crew < t.crew) parts.push(['Crew lost', -15 * (t.crew - u.crew)]);
  if (u.optics) parts.push(['Optics damaged', -10]);
  if (u.moved && !overwatch) {
    if (w.setup) return false;
    parts.push(['Moved', t.stabilised ? -5 : -10]);
  }
  if (u.side === 'blue' && b.precision > 0) parts.push(['Precision rounds', 30]);
  return true;
}

/**
 * Chance and effect of a direct shot from `shooter` standing at `from` at `target` with `weapon`,
 * or null when it cannot fire (range, sight, weapon, target unknown to its side). Shared by the
 * rules, the AI and the shot card.
 */
export function fireInfo(b: Battle, shooter: Unit, target: Unit, weapon: Weapon, from: Point = shooter, overwatch = false, known?: Set<string>): FireInfo | null {
  const st = typeOf(shooter.type);
  const tt = typeOf(target.type);
  if (!target.alive || target.carrier || target.side === shooter.side || weapon.indirect) return null;
  const flying = isFlying(tt);
  if (flying && weapon.air === 'no') return null;
  if (!flying && weapon.air === 'only') return null;
  if (weapon.kind === 'fpv' || weapon.kind === 'loiter') return droneInfo(b, shooter, target, weapon, from, known);
  const d = dist(from, target);
  if (d > weapon.range + 0.01 || d < weapon.minRange) return null;
  // Its side must know the target is there, and the shooter must have its own line.
  if (!(known ?? visibleTo(b, shooter.side)).has(target.id)) return null;
  const ghost = { ...shooter, x: from.x, y: from.y };
  const eye = heightOf(b, ghost, 'eye', from);
  const topLine = lineOfSight(b, from, eye, target, heightOf(b, target, 'top'));
  if (!topLine.clear) return null;
  const centreLine = lineOfSight(b, from, eye, target, heightOf(b, target, 'centre'));
  const vehicle = tt.armour !== null && !flying;
  const hullDown = vehicle && !centreLine.clear && centreLine.groundNearTarget;
  const higher = !flying && !isFlying(st) && b.map.elev[at(b.map, from.x, from.y)]! >= b.map.elev[at(b.map, target.x, target.y)]! + 1;
  const cov = coverAgainst(b, target, from, isFlying(st), higher);
  if (!vehicle && !flying && !centreLine.clear && cov.cover === 'none') cov.cover = 'half';

  const parts: [string, number][] = [['Base', weapon.aim]];
  if (!shooterParts(b, ghost, weapon, parts, overwatch)) return null;
  const far = Math.round(Math.max(0, d - weapon.range / 2) * FALLOFF[weapon.kind]);
  if (far) parts.push(['Range', -far]);
  if (cov.cover !== 'none') parts.push([cov.cover === 'building' ? 'In a building' : cov.cover === 'full' ? 'Full cover' : cov.cover === 'half' ? 'Half cover' : 'Trees', -COVER_POINTS[cov.cover]]);
  else if (cov.flanked) parts.push(['Flanked', 10]);
  if (topLine.trees) parts.push(['Through trees', -10]);
  if (target.hunker) parts.push(['Hunkered', -15]);
  if (hullDown) parts.push(['Hull-down', -20]);
  if (tt.profile === 'drone') parts.push(['Small target', -20]);
  else if (tt.role === 'scout_heli') parts.push(['Small target', -10]);
  if (higher) parts.push(['Height', 10]);
  const dark = b.conditions.time === 'night' || b.conditions.weather === 'fog';
  if (dark && !st.thermal) parts.push([b.conditions.weather === 'fog' ? 'Fog' : 'Night', st.nvg && b.conditions.weather !== 'fog' ? -10 : -20]);
  if (flying && (weapon.kind === 'autocannon' || weapon.kind === 'mg') && weapon.air === 'yes') parts.push(['Anti-air', 10]);
  if (flying && weapon.kind === 'manpads' && weapon.guidance === 'fnf' && tt.flares) parts.push(['Flares', -15]);
  if (weapon.guidance === 'saclos' && shooter.supp >= 25) parts.push(['Guiding under fire', -10]);
  if (overwatch && !(weapon.air !== 'no' && flying && st.radar)) parts.push(['Snap shot', SNAP]);
  const chance = clampChance(parts.reduce((s, [, v]) => s + v, 0));

  const sc = scale(shooter, weapon);
  const info: FireInfo = { weapon, chance, parts, cover: cov.cover, hullDown, supp: Math.round(sc.supp) };
  if (tt.armour) {
    const top = !!weapon.top;
    const hullFacing: Facing = top ? 'top' : facingFrom(target, from, false);
    const turretFacing: Facing = top ? 'top' : facingFrom(target, from, true);
    const turretShare = hullDown ? 1 : top ? 0.5 : 0.4;
    const armT = penOf(weapon, armourOn(b, target, turretFacing, true));
    const armH = penOf(weapon, armourOn(b, target, hullFacing, false));
    const pt = penChance(weapon.pen, armT);
    const ph = penChance(weapon.pen, armH);
    const killOf = (turret: boolean, p: number, a: number) => {
      const row = outcomeTable(tt, turret, weapon.pen >= 1.4 * a, top);
      return (p * (row[0] + row[1] + row[2])) / 100;
    };
    const pen = turretShare * pt + (1 - turretShare) * ph;
    const kill = turretShare * killOf(true, pt, armT) + (1 - turretShare) * killOf(false, ph, armH);
    const aps = target.aps > 0 && isGuidedOrRocket(weapon) && (weapon.salvo ?? 1) < 2 ? tt.aps?.chance ?? 0 : 0;
    Object.assign(info, { facing: hullDown ? turretFacing : hullFacing, pen: Math.round(pen * 100), aps, kill: Math.round(kill * (1 - aps / 100) * 100) });
  } else {
    const fit = Math.max(1, fitMen(target));
    const mult = COVER_CASUALTIES[cov.cover] * (target.hunker ? 0.7 : 1);
    const p = weapon.precise ? 1 : fit * Math.max(0.05, Math.min(0.9, (sc.lethality * mult) / fit));
    info.casualties = Math.round(p * 10) / 10;
  }
  return info;
}

const isGuidedOrRocket = (w: Weapon) => w.kind === 'atgm' || w.kind === 'rocket' || w.kind === 'fpv' || w.kind === 'loiter';

/** FPV and loitering munitions: any enemy the side can see within range, top or rear attack. */
function droneInfo(b: Battle, shooter: Unit, target: Unit, w: Weapon, from: Point, known?: Set<string>): FireInfo | null {
  const tt = typeOf(target.type);
  if (isFlying(tt)) return null;
  if (dist(from, target) > w.range + 0.01) return null;
  const seen = known ?? visibleTo(b, shooter.side);
  if (!seen.has(target.id)) return null;
  const parts: [string, number][] = [['Base', w.aim]];
  if (!shooterParts(b, { ...shooter, x: from.x, y: from.y }, w, parts, false)) return null;
  const chance = clampChance(parts.reduce((s, [, v]) => s + v, 0));
  const info: FireInfo = { weapon: w, chance, parts, cover: 'none', hullDown: false, supp: w.supp, intercept: Math.round(interceptors(b, target, seen) * 100) };
  if (tt.armour) {
    const facing: Facing = w.top || tt.armour.top[1] <= tt.armour.rear[1] ? 'top' : 'rear';
    const v = facing === 'top' ? tt.armour.top : tt.armour.rear;
    const pen = penChance(w.pen, v[1]);
    const row = outcomeTable(tt, false, w.pen >= 1.4 * v[1], facing === 'top');
    const aps = target.aps > 0 ? tt.aps?.chance ?? 0 : 0;
    Object.assign(info, { facing, pen: Math.round(pen * 100), aps, kill: Math.round(pen * ((row[0] + row[1] + row[2]) / 100) * (1 - aps / 100) * 100) });
  } else info.casualties = Math.round(Math.min(fitMen(target), w.lethality) * 10) / 10;
  return info;
}

/**
 * Chance (0..1) the air defence around a target knocks a drone down on its way in. `known`: count
 * only the guns the attacking side knows about (the card and the AI); the roll counts them all.
 */
export function interceptors(b: Battle, target: Unit, known?: Set<string>): number {
  let miss = 1;
  for (const u of b.units) {
    if (known && !known.has(u.id)) continue;
    if (u.side === target.side && u.alive && !u.carrier && cheb(u, target) <= 4) {
      const t = typeOf(u.type);
      if (u.firepowerKill || suppLevel(u.supp) === 'broken') continue;
      if (t.role === 'spaa') miss *= 0.4;
      else if (t.weapons.some((w) => w.kind === 'autocannon' && w.air === 'yes')) miss *= 0.75;
    }
  }
  return 1 - miss;
}

/** The best weapon this unit has against `target` from `from`, by expected effect. */
export function bestFire(b: Battle, shooter: Unit, target: Unit, from: Point = shooter, overwatch = false, known?: Set<string>): FireInfo | null {
  let best: FireInfo | null = null;
  let bestValue = 0;
  for (const w of usableWeapons(shooter)) {
    const info = fireInfo(b, shooter, target, w, from, overwatch, known);
    if (!info) continue;
    const v = shotValue(b, info, target);
    if (v > bestValue || (best === null && v === 0)) {
      best = info;
      bestValue = v;
    }
  }
  return best;
}

/** Expected value of a shot, in target unit-value points, plus suppression. */
export function shotValue(b: Battle, info: FireInfo, target: Unit): number {
  const t = typeOf(target.type);
  const hit = info.chance / 100;
  if (t.armour) {
    const kill = (info.kill ?? 0) / 100;
    // Saving ammunition: a missile is worth spending on armour, not on a jeep.
    return hit * (kill * t.value + 0.05 * info.supp / 10);
  }
  const fit = Math.max(1, fitMen(target));
  const share = Math.min(1, (info.casualties ?? 0) / fit);
  return hit * (share * t.value + (info.supp / 100) * t.value * 0.4);
}

// --- Effects ---------------------------------------------------------------------------------------

export function roll(b: Battle): number {
  return draw(b);
}

export function suppress(b: Battle, u: Unit, amount: number): void {
  if (!u.alive || amount <= 0) return;
  const t = typeOf(u.type);
  const add = t.mobility === 'foot' ? amount : amount / 3;
  const before = suppLevel(u.supp);
  u.supp = Math.min(100, Math.round(u.supp + add));
  const after = suppLevel(u.supp);
  if (after !== before) b.events.push({ type: 'suppressed', unit: u.id, level: after, seen: blueSees(b, u) });
}

/** A unit is out of the fight. Passengers suffer as the spec says; wrecks persist. */
export function kill(b: Battle, u: Unit, how: UnitStatus, by: Side | null): void {
  if (!u.alive) return;
  const seen = blueSees(b, u);
  u.alive = false;
  u.status = how;
  u.overwatch = false;
  b.events.push({ type: 'destroyed', unit: u.id, how, x: u.x, y: u.y, seen });
  if (by && by !== u.side) b.stats[by].kills++;
  b.stats[u.side].lost++;
  if (by === 'blue' && seen) b.events.push({ type: 'radio', side: 'blue', call: 'destroyed', unit: u.id });
  const t = typeOf(u.type);
  // Hulks stay where they stopped: cover for infantry, a block for vehicles; brewed-up ones burn.
  if (t.mobility !== 'foot' && t.mobility !== 'drone') b.wrecks.push({ x: u.x, y: u.y, unit: u.id, type: u.type, burning: how === 'destroyed' ? 3 : how === 'shot_down' ? 2 : 0 });
  if (u.passengers.length) bailOut(b, u, how === 'destroyed' || how === 'shot_down');
}

/** Passengers leave a stricken carrier: badly hurt if it brewed up or fell, shaken otherwise. */
function bailOut(b: Battle, carrier: Unit, deadly: boolean): void {
  const out: { id: string; x: number; y: number }[] = [];
  for (const id of carrier.passengers) {
    const p = b.units.find((x) => x.id === id);
    if (!p || !p.alive) continue;
    let killed = 0;
    let wounded = 0;
    for (const m of p.men) {
      if (m.state !== 'fit') continue;
      const r = roll(b);
      if (deadly ? r < 0.5 : false) {
        m.state = 'dead';
        killed++;
      } else if (deadly ? r < 0.8 : r < 0.15) {
        m.state = 'wounded';
        wounded++;
      }
    }
    p.carrier = null;
    const cell = freeCellNear(b, carrier, 'foot');
    p.x = cell.x;
    p.y = cell.y;
    p.moved = true;
    p.acted = true;
    out.push({ id: p.id, x: p.x, y: p.y });
    if (killed || wounded) b.events.push({ type: 'casualties', unit: p.id, killed, wounded, x: p.x, y: p.y, seen: blueSees(b, p) });
    if (fitMen(p) === 0) kill(b, p, 'wiped', null);
    else suppress(b, p, 60);
  }
  carrier.passengers = [];
  if (out.length) b.events.push({ type: 'dismount', carrier: carrier.id, units: out, seen: blueSees(b, carrier) || out.some((o) => b.units.find((u) => u.id === o.id)?.side === 'blue') });
}

/** Nearest free cell a foot unit can stand on around a point (rings outward). */
export function freeCellNear(b: Battle, p: Point, mobility: 'foot', prefer?: Point): Point {
  for (let r = 1; r <= 4; r++) {
    const ring: Point[] = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (!inside(x, y)) continue;
        const c = b.map.cells[at(b.map, x, y)];
        if (c === WATER || (mobility === 'foot' && c === ROCK)) continue;
        if (b.units.some((u) => u.alive && !u.carrier && u.x === x && u.y === y && !isFlying(typeOf(u.type)))) continue;
        ring.push({ x, y });
      }
    if (ring.length) {
      const q = prefer ?? p;
      ring.sort((m, n) => dist(m, q) - dist(n, q) || m.y - n.y || m.x - n.x);
      return ring[0]!;
    }
  }
  return { x: p.x, y: p.y };
}

/** A penetrating or non-penetrating hit on a vehicle or aircraft. */
export function hitArmour(b: Battle, target: Unit, w: Weapon, from: Point, by: Side, forced?: { facing: Facing; turret: boolean }): void {
  const t = typeOf(target.type);
  if (!t.armour || !target.alive) return;
  const flying = isFlying(t);
  if (t.mobility === 'drone') return kill(b, target, 'shot_down', by);
  let turret: boolean;
  let facing: Facing;
  if (forced) ({ turret, facing } = forced);
  else if (w.top) {
    turret = roll(b) < 0.5;
    facing = 'top';
  } else {
    const hullDown = hullDownAgainst(b, target, from);
    turret = hullDown || roll(b) < 0.4;
    facing = facingFrom(target, from, turret);
  }
  const armour = penOf(w, armourOn(b, target, facing, turret));
  const pen = roll(b) < penChance(w.pen, armour);
  const seen = blueSees(b, target);
  if (!pen) {
    suppress(b, target, 15);
    let effect: Effect = 'bounce';
    if (!flying && (facing === 'side' || facing === 'rear') && w.round === 'ke' && roll(b) < 0.12 && !target.mobilityKill) {
      target.mobilityKill = true;
      effect = 'tracks';
    } else if (roll(b) < 0.08 && !target.optics) {
      target.optics = true;
      effect = 'optics';
    }
    b.events.push({ type: 'impact', unit: target.id, facing, pen: false, effect, x: target.x, y: target.y, seen });
    return;
  }
  const row = outcomeTable(t, turret, w.pen >= 1.4 * armour, facing === 'top');
  let r = roll(b) * 100;
  let k = 0;
  while (k < 4 && r >= row[k]!) r -= row[k++]!;
  let effect: Effect = (['catastrophic', 'firepower', 'mobility', 'crew', 'none'] as const)[k]!;
  if (effect === 'firepower' && target.firepowerKill) effect = 'crew';
  if (effect === 'mobility' && target.mobilityKill && !flying) effect = 'crew';
  suppress(b, target, 30);
  if (effect === 'catastrophic') {
    b.events.push({ type: 'impact', unit: target.id, facing, pen: true, effect: flying ? 'shot_down' : 'catastrophic', x: target.x, y: target.y, seen });
    return kill(b, target, flying ? 'shot_down' : 'destroyed', by);
  }
  if (effect === 'mobility' && flying) {
    b.events.push({ type: 'impact', unit: target.id, facing, pen: true, effect: 'forced_landing', x: target.x, y: target.y, seen });
    return kill(b, target, 'landed', by);
  }
  if (effect === 'firepower') target.firepowerKill = true;
  if (effect === 'mobility') target.mobilityKill = true;
  if (effect === 'crew') {
    target.crew = Math.max(0, target.crew - 1);
    if (target.crew <= 1 && t.crew >= 2) {
      b.events.push({ type: 'impact', unit: target.id, facing, pen: true, effect: flying ? 'forced_landing' : 'knocked_out', x: target.x, y: target.y, seen });
      return kill(b, target, flying ? 'landed' : 'knocked_out', by);
    }
  }
  b.events.push({ type: 'impact', unit: target.id, facing, pen: true, effect, x: target.x, y: target.y, seen });
  if (target.side === 'blue' && effect !== 'none') b.events.push({ type: 'radio', side: 'blue', call: 'vehicle_hit', unit: target.id });
}

function hullDownAgainst(b: Battle, target: Unit, from: Point): boolean {
  const shooter = b.units.find((u) => u.alive && u.x === from.x && u.y === from.y);
  const eye = shooter ? heightOf(b, shooter, 'eye') : b.map.elev[at(b.map, from.x, from.y)]! + 0.7;
  const centre = lineOfSight(b, from, eye, target, heightOf(b, target, 'centre'));
  return !centre.clear && centre.groundNearTarget;
}

/** Casualties on a foot unit: each fit soldier rolls; a casualty is wounded or killed. */
export function hitTroops(b: Battle, target: Unit, lethality: number, mult: number, precise: boolean, by: Side | null): void {
  if (!target.alive) return;
  const fit = target.men.filter((m) => m.state === 'fit');
  if (!fit.length) return;
  let killed = 0;
  let wounded = 0;
  const hurt = (m: { state: 'fit' | 'wounded' | 'dead' }) => {
    if (roll(b) < 0.55) {
      m.state = 'wounded';
      wounded++;
    } else {
      m.state = 'dead';
      killed++;
    }
  };
  if (precise) hurt(fit[Math.floor(roll(b) * fit.length)]!);
  else {
    const p = Math.max(0.05, Math.min(0.9, (lethality * mult) / fit.length));
    for (const m of fit) if (roll(b) < p) hurt(m);
  }
  const seen = blueSees(b, target);
  if (killed || wounded) {
    b.events.push({ type: 'casualties', unit: target.id, killed, wounded, x: target.x, y: target.y, seen });
    if (target.side === 'blue') b.events.push({ type: 'radio', side: 'blue', call: 'man_down', unit: target.id });
  }
  if (fitMen(target) === 0) kill(b, target, 'wiped', by);
}

export function troopMultiplier(b: Battle, u: Unit): number {
  const i = at(b.map, u.x, u.y);
  const c = b.map.cells[i];
  const m = c === BUILDING ? 0.35 : c === TREES ? 0.7 : c === RUBBLE || b.map.crater[i] === 1 || c === WALL ? 0.6 : 1;
  return m * (u.hunker ? 0.7 : 1);
}

/** Resolve a direct shot already judged possible: the roll, then what it does. */
export function shoot(b: Battle, shooter: Unit, target: Unit, info: FireInfo, overwatch: boolean): void {
  const w = info.weapon;
  shooter.aim = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  if (w.ammo !== null) shooter.ammo[w.id] = Math.max(0, (shooter.ammo[w.id] ?? 0) - (w.salvo ?? 1));
  if (shooter.side === 'blue' && b.precision > 0) b.precision--;
  shooter.revealed = b.turnIndex + 1;
  b.stats[shooter.side].shots++;
  const drone = w.kind === 'fpv' || w.kind === 'loiter';
  // Drones can be shot down on the way in; APS can stop a missile, a rocket or a drone.
  if (drone && roll(b) < interceptors(b, target)) {
    const gun = b.units.find((u) => u.side === target.side && u.alive && !u.carrier && cheb(u, target) <= 4 && (typeOf(u.type).role === 'spaa' || typeOf(u.type).weapons.some((x) => x.kind === 'autocannon' && x.air === 'yes')));
    b.events.push({ type: 'fire', unit: shooter.id, weapon: w.id, kind: w.kind, calibre: w.calibre, from: { x: shooter.x, y: shooter.y }, to: { x: target.x, y: target.y }, target: target.id, hit: false, chance: info.chance, overwatch, seen: blueSees(b, shooter) || blueSees(b, target) });
    b.events.push({ type: 'intercept', unit: shooter.id, by: gun?.id ?? target.id, x: target.x, y: target.y, seen: blueSees(b, target) });
    return;
  }
  const hit = roll(b) * 100 < info.chance;
  if (hit) b.stats[shooter.side].hits++;
  b.events.push({ type: 'fire', unit: shooter.id, weapon: w.id, kind: w.kind, calibre: w.calibre, from: { x: shooter.x, y: shooter.y }, to: { x: target.x, y: target.y }, target: target.id, hit, chance: info.chance, overwatch, seen: blueSees(b, shooter) || blueSees(b, target) });
  if (target.side === 'blue') b.events.push({ type: 'radio', side: 'blue', call: 'taking_fire', unit: target.id });
  const tt = typeOf(target.type);
  const sc = scale(shooter, w);
  if (!hit) {
    if (w.blast > 0 && !isFlying(tt)) {
      // A miss with an explosive round still lands near it.
      const p = { x: Math.max(0, Math.min(b.map.w - 1, target.x + (roll(b) < 0.5 ? -1 : 1))), y: target.y };
      blast(b, p, { lethality: sc.lethality * 0.5, pen: 0, supp: sc.supp, demo: w.demo * 0.5, radius: 0, crater: false, kind: 'he' }, shooter.side);
    } else suppress(b, target, sc.supp / 2);
    return;
  }
  if (target.aps > 0 && isGuidedOrRocket(w) && tt.aps) {
    target.aps--;
    if ((w.salvo ?? 1) < 2 && roll(b) * 100 < tt.aps.chance) {
      b.events.push({ type: 'intercept', unit: shooter.id, by: target.id, x: target.x, y: target.y, seen: blueSees(b, target) });
      suppress(b, target, 10);
      return;
    }
  }
  if (tt.armour) {
    const forced: { facing: Facing; turret: boolean } | undefined = drone ? { facing: info.facing ?? 'top', turret: false } : undefined;
    hitArmour(b, target, w, shooter, shooter.side, forced);
  } else {
    hitTroops(b, target, sc.lethality, troopMultiplier(b, target), !!w.precise, shooter.side);
    suppress(b, target, sc.supp);
  }
  if (w.blast > 0) {
    // Explosive rounds also hurt the cells around the target, and knock buildings about.
    for (const u of b.units)
      if (u !== target && u.alive && !u.carrier && cheb(u, target) <= w.blast && !isFlying(typeOf(u.type))) {
        if (typeOf(u.type).mobility === 'foot') hitTroops(b, u, sc.lethality * 0.5, troopMultiplier(b, u), false, shooter.side);
        suppress(b, u, sc.supp / 2);
      }
    if (w.demo > 0) damageCell(b, target.x, target.y, w.demo);
  }
}

export interface BlastSpec {
  lethality: number;
  /** Penetration against top armour (KE). */
  pen: number;
  supp: number;
  demo: number;
  radius: number;
  crater: boolean;
  kind: 'he' | 'shell' | 'rockets' | 'bombs' | 'mine';
}

/** Area damage around a cell: full in it, half around it. Aircraft are above it. */
export function blast(b: Battle, p: Point, s: BlastSpec, by: Side | null): void {
  b.events.push({ type: 'boom', x: p.x, y: p.y, size: s.radius + 1, kind: s.kind === 'shell' ? 'he' : s.kind, seen: true });
  const shell: Weapon = { id: 'blast', name: 'Blast', kind: 'howitzer', calibre: '155', range: 0, minRange: 0, aim: 0, pen: 0, round: 'he', lethality: 0, supp: 0, blast: 0, demo: 0, ammo: null, air: 'no', guidance: 'none', burst: 1 };
  for (const u of [...b.units].sort((m, n) => (m.id < n.id ? -1 : 1))) {
    if (!u.alive || u.carrier) continue;
    const t = typeOf(u.type);
    if (isFlying(t)) continue;
    const d = cheb(u, p);
    if (d > s.radius) continue;
    const f = d === 0 ? 1 : 0.5;
    if (t.mobility === 'foot') {
      const m = troopMultiplier(b, u) * (b.map.cells[at(b.map, u.x, u.y)] === TREES ? 1.3 : 1);
      hitTroops(b, u, s.lethality * f, m, false, by);
    } else if (s.pen > 0) {
      hitArmour(b, u, { ...shell, pen: s.pen * f }, p, by ?? other(u.side), { facing: 'top', turret: roll(b) < 0.5 });
    }
    suppress(b, u, s.supp * f);
  }
  for (let y = p.y - s.radius; y <= p.y + s.radius; y++)
    for (let x = p.x - s.radius; x <= p.x + s.radius; x++) if (inside(x, y) && s.demo > 0) damageCell(b, x, y, x === p.x && y === p.y ? s.demo : s.demo / 2);
  if (s.crater && inside(p.x, p.y)) {
    const i = at(b.map, p.x, p.y);
    const c = b.map.cells[i];
    if ((c === OPEN || c === ROAD || c === RUBBLE) && b.map.crater[i] === 0) {
      b.map.crater[i] = 1;
      b.events.push({ type: 'crater', x: p.x, y: p.y });
    }
  }
}

/** Knock a cell about: buildings lose HP and fall to rubble, trees and walls go down. */
export function damageCell(b: Battle, x: number, y: number, amount: number): void {
  const i = at(b.map, x, y);
  const c = b.map.cells[i];
  if (c === BUILDING) {
    b.map.hp[i] = Math.max(0, b.map.hp[i]! - Math.round(amount));
    if (b.map.hp[i]! > 0) return;
    b.map.cells[i] = RUBBLE;
    b.map.storeys[i] = 0;
    b.events.push({ type: 'terrain', x, y, cell: RUBBLE });
    // Whoever was inside is under it.
    for (const u of b.units)
      if (u.alive && !u.carrier && u.x === x && u.y === y && typeOf(u.type).mobility === 'foot') {
        hitTroops(b, u, 2.5, 1, false, null);
        suppress(b, u, 60);
      }
  } else if (c === TREES) {
    b.map.hp[i] = Math.max(0, b.map.hp[i]! - (amount >= 40 ? 2 : 1));
    if (b.map.hp[i]! > 0) return;
    b.map.cells[i] = OPEN;
    b.events.push({ type: 'terrain', x, y, cell: OPEN });
  } else if (c === WALL && amount >= 20) {
    b.map.cells[i] = OPEN;
    b.map.hp[i] = 0;
    b.events.push({ type: 'terrain', x, y, cell: OPEN });
  }
}

/** Ground height under a point, for the film (re-exported for the renderer's convenience). */
export { groundAt };
