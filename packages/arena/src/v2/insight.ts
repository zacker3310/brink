import { bestFire, coverAgainst, fireInfo, interceptors, INTERCEPT_RANGE, shotValue, suppLevel, usableWeapons, type CoverKind } from './combat';
import { mainThreat, pathTo, reachable, suppRecovery } from './engine';
import { typeOf } from './roster';
import { cheb, dist, heightOf, isFlying, lineOfSight, observation, sightRange, visibleTo } from './sight';
import { at, BUILDING, PROFILE, RUBBLE, TREES, type Battle, type BattleEvent, type Point, type Side, type Unit, type UnitType, type Weapon } from './types';

// What the player can read off the field: where the enemies they see could fire next turn, whom
// each would most likely shoot, what overwatch and air defence cover, which armour a move shows to
// whom, and what the scouts' expected area still hides. Every answer reads only `observeBlue`, the
// player's sanitized observation of the battle, so nothing hidden can change one (the tests mutate
// hidden enemies, mines and the stream over many generated battles and check). Every chance shown
// comes from the engine's own rules (fireInfo, interceptors, suppRecovery). Answers are cached per
// battle state: the overlay asks on every render and pays only when something changed.

/** Shading steps of the Danger Area: one, two, three or more enemies could fire on a cell. */
export const DANGER_STEPS = 3;
/** A seen enemy's reach is sampled from its own cell and this many cells in all. */
const ORIGINS = 5;
/** What a line has to clear to count: a tank's turret top (the tallest ground target). */
const TARGET_TOP = PROFILE.mbt.top;
/** Ghosts older than this many turns are too stale to draw an air-defence ring for. */
const STALE = 6;

const isDrone = (w: Weapon) => w.kind === 'fpv' || w.kind === 'loiter';
const isAirDefence = (t: UnitType) => t.role === 'spaa' || t.role === 'aa_team';
const onField = (u: Unit) => u.alive && u.carrier === null;

// --- The player's observation ------------------------------------------------------------------------

/** The least suppression that shows as each badge state. */
const LEVEL_FLOOR = new Map<ReturnType<typeof suppLevel>, number>();
for (let s = 100; s >= 0; s--) LEVEL_FLOOR.set(suppLevel(s), s);

/** A seen enemy as far as it can be seen: no passengers, a full load, suppression as its badge shows it. */
function asSeen(u: Unit): Unit {
  const t = typeOf(u.type);
  const ammo: Record<string, number> = {};
  for (const w of t.weapons) if (w.ammo !== null) ammo[w.id] = w.ammo;
  return { ...u, passengers: [], ammo, aps: t.aps?.charges ?? 0, supp: LEVEL_FLOOR.get(suppLevel(u.supp)) ?? 0 };
}

/**
 * The battle as the player (blue) can know it, the only input of everything below. Kept: their own
 * units, mines, support, abilities and last known positions; the field as it stands; the enemies
 * they see now, as far as they can be seen (where, which way, damage and strength, on watch or
 * hunkered as their badges show, suppression only as the badge shows it); the kills they saw.
 * Gone: every enemy they cannot see, enemy mines, support, tallies and last known positions, the
 * rest of the film, the wrecks of kills they did not see, what is aboard enemy vehicles, how much
 * ammunition enemies have left (assumed full), and the random stream. Pure: a new object; the map
 * is shared, never written.
 */
export function observeBlue(b: Battle): Battle {
  const seen = visibleTo(b, 'blue');
  const blue = new Set(b.units.filter((u) => u.side === 'blue').map((u) => u.id));
  const witnessed = b.events.filter((e): e is Extract<BattleEvent, { type: 'destroyed' }> => e.type === 'destroyed' && e.seen);
  const kills = new Set(witnessed.map((e) => e.unit));
  return {
    ...b,
    units: b.units.filter((u) => u.side === 'blue' || seen.has(u.id)).map((u) => (u.side === 'blue' ? u : asSeen(u))),
    mines: b.mines.filter((m) => m.side === 'blue'),
    support: b.support.filter((s) => s.side === 'blue'),
    wrecks: b.wrecks.filter((w) => blue.has(w.unit) || kills.has(w.unit)),
    intel: { blue: b.intel.blue, red: {} },
    stats: { blue: b.stats.blue, red: { shots: 0, hits: 0, kills: 0, lost: 0 } },
    // Only the kills it saw: they say which wrecks it knows of.
    events: witnessed,
    skill: 0,
    stream: 0,
  };
}

// --- Cached per state --------------------------------------------------------------------------------

interface Memo {
  key: string;
  /** observeBlue of the battle: all an answer may read. */
  obs: Battle;
  /** Enemies blue sees now. */
  seen: Set<string>;
  terrain: string;
  out: Map<string, unknown>;
}

const memos = new WeakMap<Battle, Memo>();

/** Changes whenever anything an answer reads may have: every rule that changes the field logs an event; overwatch and hunker do not. */
function stateKey(b: Battle): string {
  let s = `${b.turnIndex}|${b.turn}|${b.events.length}|${b.difficulty}`;
  for (const u of b.units) s += `|${u.id}:${u.x},${u.y}${u.alive ? 'a' : 'd'}${u.carrier ? 'c' : ''}${u.overwatch ? 'o' : ''}${u.hunker ? 'h' : ''}${u.moved ? 'm' : ''}${u.acted ? 'x' : ''}${u.supp}`;
  return s;
}

/** What blocks a line: the ground, the cells and storeys as they stand, and the smoke. */
function terrainKey(b: Battle): string {
  let h = 0;
  for (let i = 0; i < b.map.cells.length; i++) h = (Math.imul(h, 31) + b.map.cells[i]! * 7 + b.map.storeys[i]! * 3 + b.map.elev[i]! * 101) | 0;
  return `${b.seed}|${h}|${b.smoke.map((s) => `${s.x},${s.y}`).join(';')}`;
}

function memo(b: Battle): Memo {
  const key = stateKey(b);
  let m = memos.get(b);
  if (!m || m.key !== key) {
    const obs = observeBlue(b);
    const seen = new Set(obs.units.filter((u) => u.side === 'red').map((u) => u.id));
    m = { key, obs, seen, terrain: terrainKey(obs), out: new Map() };
    memos.set(b, m);
  }
  return m;
}

/** An answer for this state, worked out once. */
function keep<T>(m: Memo, name: string, fn: () => T): T {
  if (m.out.has(name)) return m.out.get(name) as T;
  const v = fn();
  m.out.set(name, v);
  return v;
}

function cached<T>(b: Battle, name: string, fn: (m: Memo) => T): T {
  const m = memo(b);
  return keep(m, name, () => fn(m));
}

const enemiesSeen = (m: Memo): Unit[] => m.obs.units.filter((u) => u.side === 'red' && onField(u)).sort((p, q) => (p.id < q.id ? -1 : 1));

/**
 * A seen enemy as it would start its next turn: its orders cleared and its suppression shaken off as
 * far as the rules allow (beginTurn in engine.ts). Overstating what it can do is the safe error.
 */
function nextTurn(u: Unit): Unit {
  const most = typeOf(u.type).mobility === 'foot' ? 60 : 30;
  return { ...u, moved: false, acted: false, dashed: false, overwatch: false, hunker: false, smoked: false, supp: Math.max(0, u.supp - most) };
}

// --- Lines of sight, cached across states ---------------------------------------------------------

const sheds = new Map<string, Uint8Array>();

/** Cells within `range` of `from` (an eye at height `eye`) where a turret top would show. */
function viewshed(m: Memo, from: Point, eye: number, range: number, down: boolean): Uint8Array {
  const key = `${m.terrain}|${from.x},${from.y}|${eye.toFixed(2)}|${range.toFixed(1)}|${down ? 1 : 0}`;
  const hit = sheds.get(key);
  if (hit) return hit;
  const map = m.obs.map;
  const out = new Uint8Array(map.w * map.h);
  const r = Math.ceil(range);
  for (let y = Math.max(0, from.y - r); y <= Math.min(map.h - 1, from.y + r); y++)
    for (let x = Math.max(0, from.x - r); x <= Math.min(map.w - 1, from.x + r); x++) {
      if (Math.hypot(x - from.x, y - from.y) > range + 0.01) continue;
      const i = at(map, x, y);
      if (lineOfSight(m.obs, from, eye, { x, y }, map.elev[i]! + TARGET_TOP, down).clear) out[i] = 1;
    }
  if (sheds.size > 600) sheds.clear();
  sheds.set(key, out);
  return out;
}

const eyeAt = (b: Battle, u: Unit, p: Point) => heightOf(b, { ...u, x: p.x, y: p.y }, 'eye', p);

/** Ground cells some seen enemy can see now: where its drone teams could strike. */
function enemySight(m: Memo): Uint8Array {
  return keep(m, 'sight', () => {
    const map = m.obs.map;
    const out = new Uint8Array(map.w * map.h);
    for (const e of enemiesSeen(m)) {
      const t = typeOf(e.type);
      const down = t.profile === 'drone';
      const shed = viewshed(m, e, eyeAt(m.obs, e, e), down ? 14 : sightRange(m.obs, t), down);
      for (let i = 0; i < out.length; i++) out[i]! |= shed[i]!;
    }
    return out;
  });
}

// --- Danger Area (report item 5) -------------------------------------------------------------------

/**
 * Where an enemy would fire from next turn: where it stands, and a handful of cells it could drive
 * to that lie furthest toward the attackers' edge, spread out along the front of its move.
 */
function originsOf(m: Memo, u: Unit): Point[] {
  const b = m.obs;
  const out: Point[] = [{ x: u.x, y: u.y }];
  const ours = new Set(b.units.filter((f) => f.side !== u.side && onField(f)).map((f) => f.id));
  const reach = reachable(b, u, false, ours);
  const fwd = u.side === 'red' ? 1 : -1;
  const home = at(b.map, u.x, u.y);
  const cells = [...reach.cost.keys()].filter((i) => i !== home).map((i) => ({ x: i % b.map.w, y: Math.floor(i / b.map.w) }));
  cells.sort((p, q) => (q.y - p.y) * fwd || Math.abs(p.x - u.x) - Math.abs(q.x - u.x) || p.x - q.x);
  for (const p of cells) {
    if (out.length >= ORIGINS) break;
    if (!out.some((o) => cheb(o, p) < 3)) out.push(p);
  }
  return out;
}

/** One seen enemy's reach next turn, as a mask over the cells. */
function reachMask(m: Memo, id: string): Uint8Array {
  return keep(m, `reach:${id}`, () => {
    const b = m.obs;
    const out = new Uint8Array(b.map.w * b.map.h);
    const u0 = b.units.find((u) => u.id === id && u.side === 'red' && onField(u));
    if (!u0) return out;
    const u = nextTurn(u0);
    const t = typeOf(u.type);
    // Still broken: it falls back and cannot fire.
    if (suppLevel(u.supp) === 'broken') return out;
    const sight = sightRange(b, t);
    originsOf(m, u).forEach((o, k) => {
      // Mortars, ATGM tripods and snipers cannot fire after moving.
      const ws = usableWeapons(u).filter((w) => !w.indirect && w.air !== 'only' && !(k > 0 && w.setup));
      const line = Math.min(sight, Math.max(0, ...ws.filter((w) => !isDrone(w)).map((w) => w.range)));
      if (line > 0) {
        const shed = viewshed(m, o, eyeAt(b, u, o), line, false);
        for (let i = 0; i < out.length; i++) out[i]! |= shed[i]!;
      }
      // A drone flies to anything its side can see in range, with no line from the team.
      const drone = Math.max(0, ...ws.filter(isDrone).map((w) => w.range));
      if (drone > 0) {
        const seen = enemySight(m);
        for (let i = 0; i < out.length; i++) if (seen[i] && Math.hypot((i % b.map.w) - o.x, Math.floor(i / b.map.w) - o.y) <= drone + 0.01) out[i] = 1;
      }
    });
    return out;
  });
}

/**
 * The cells a seen enemy could fire on next turn (index `y * w + x`): from where it stands or after
 * a short move toward the attackers, within its direct-fire weapons' range and its sight, along a
 * line to a tank's turret top; its drones reach any cell its side can see in range. Called fire is
 * left out (it can land anywhere in range). Sampled, so a guide rather than a promise.
 */
export function enemyReach(b: Battle, id: string): number[] {
  return cached(b, `reach-list:${id}`, (m) => {
    const mask = reachMask(m, id);
    const out: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
    return out;
  });
}

/**
 * Danger Area: per cell, how many seen enemies could fire on it next turn (see `enemyReach`), up to
 * DANGER_STEPS. Hidden enemies add nothing: the shading is what you know, not what is there.
 */
export function dangerArea(b: Battle): number[] {
  return cached(b, 'danger', (m) => {
    const level = new Array<number>(m.obs.map.w * m.obs.map.h).fill(0);
    for (const e of enemiesSeen(m)) {
      const mask = reachMask(m, e.id);
      for (let i = 0; i < level.length; i++) if (mask[i]) level[i] = Math.min(DANGER_STEPS, level[i]! + 1);
    }
    return level;
  });
}

// --- Likely targets (report item 17) ---------------------------------------------------------------

export interface LikelyShot {
  from: string;
  to: string;
  /** Where the shooter and its target stand. */
  fromAt: Point;
  toAt: Point;
  /** Percent, as the shot card would show it to them. */
  chance: number;
  weapon: string;
}

/**
 * For each seen enemy, the unit of yours it would most likely shoot from where it stands: its best
 * expected shot by the engine's own fireInfo and shotValue (air defence goes for aircraft first, as
 * the AI does), at units of yours the enemies you see can see. None on Hard.
 */
export function likelyTargets(b: Battle): LikelyShot[] {
  if (b.difficulty === 'hard') return [];
  return cached(b, 'likely', (m) => {
    const obs = m.obs;
    const known = visibleTo(obs, 'red');
    const out: LikelyShot[] = [];
    for (const e0 of enemiesSeen(m)) {
      const e = nextTurn(e0);
      const ad = isAirDefence(typeOf(e.type));
      let best: LikelyShot | null = null;
      let bestValue = 0.04;
      for (const u of obs.units) {
        if (u.side !== 'blue' || !known.has(u.id)) continue;
        const info = bestFire(obs, e, u, e, false, known);
        if (!info) continue;
        const value = shotValue(obs, info, u) * (ad && isFlying(typeOf(u.type)) ? 3 : 1);
        if (value > bestValue) {
          bestValue = value;
          best = { from: e.id, to: u.id, fromAt: { x: e.x, y: e.y }, toAt: { x: u.x, y: u.y }, chance: info.chance, weapon: info.weapon.id };
        }
      }
      if (best) out.push(best);
    }
    return out;
  });
}

// --- Overwatch footprints (report item 15) ---------------------------------------------------------

export interface WatchArea {
  unit: string;
  side: Side;
  x: number;
  y: number;
  /** Ground cells it would fire into when something moves there (index `y * w + x`). */
  cells: number[];
  /** Air defence on watch looks at the sky only: its anti-air range in cells, else 0. */
  sky: number;
}

/**
 * Units on overwatch, theirs that you see and all of yours: the ground each would fire into (within
 * its weapons' range and its sight, along a clear line), or for air defence the sky it watches.
 */
export function overwatchAreas(b: Battle): WatchArea[] {
  return cached(b, 'watch', (m) => {
    const obs = m.obs;
    const out: WatchArea[] = [];
    for (const u of [...obs.units].sort((p, q) => (p.id < q.id ? -1 : 1))) {
      if (!u.overwatch || !onField(u)) continue;
      const t = typeOf(u.type);
      const ws = usableWeapons(u).filter((w) => !w.indirect && !isDrone(w));
      if (isAirDefence(t)) {
        const sky = Math.max(0, ...ws.filter((w) => w.air !== 'no').map((w) => w.range));
        if (sky > 0) out.push({ unit: u.id, side: u.side, x: u.x, y: u.y, cells: [], sky });
        continue;
      }
      const range = Math.min(sightRange(obs, t), Math.max(0, ...ws.filter((w) => w.air !== 'only').map((w) => w.range)));
      if (range <= 0) continue;
      const shed = viewshed(m, u, eyeAt(obs, u, u), range, t.profile === 'drone');
      const cells: number[] = [];
      for (let i = 0; i < shed.length; i++) if (shed[i] && i !== at(obs.map, u.x, u.y)) cells.push(i);
      out.push({ unit: u.id, side: u.side, x: u.x, y: u.y, cells, sky: 0 });
    }
    return out;
  });
}

// --- Air defence (report item 16) -----------------------------------------------------------------

export interface AirRing {
  /** The unit, or the ghost's unit id when suspected. */
  unit: string;
  x: number;
  y: number;
  /** Radius in cells: a circle against aircraft; a square (Chebyshev) for drone interception. */
  r: number;
  square: boolean;
  /** Percent: the best hit chance inside the ring against your aircraft, or the interception chance; null when only suspected. */
  chance: number | null;
  /** Dedicated air defence (self-propelled guns and missile teams). */
  dedicated: boolean;
  /** On overwatch: radar-cued, watching the sky. */
  watch: boolean;
  /** Seen there before, not now. */
  suspected: boolean;
  /** Turns since it was seen (0 for one seen now). */
  age: number;
}

/**
 * What threatens one of your aircraft, or the drones of one of your drone teams: for a helicopter or
 * a recon drone, a ring at the anti-air range of every seen enemy that can shoot at it, labelled
 * with its best hit chance (the aircraft at half that range, along the line to where it is now);
 * for a drone team, a square at the 4 cells within which the rules let a gun knock a drone down,
 * labelled with that chance. Air defence seen before but not now is a suspected ring with no
 * chance. `dedicatedOnly` keeps the air-defence units alone (the Danger Area's view).
 */
export function airThreats(b: Battle, unitId: string, dedicatedOnly = false): AirRing[] {
  return cached(b, `air:${unitId}:${dedicatedOnly ? 1 : 0}`, (m) => {
    const obs = m.obs;
    const me = obs.units.find((u) => u.id === unitId && u.side === 'blue' && onField(u));
    if (!me) return [];
    const mt = typeOf(me.type);
    const aircraft = isFlying(mt);
    const drones = !aircraft && mt.weapons.some(isDrone);
    if (!aircraft && !drones) return [];
    const out: AirRing[] = [];
    for (const e0 of enemiesSeen(m)) {
      const e = nextTurn(e0);
      const t = typeOf(e.type);
      const dedicated = isAirDefence(t);
      if (dedicatedOnly && !dedicated) continue;
      const watch = e0.overwatch;
      if (drones) {
        // The rules' own chance this gun alone knocks a drone down near it, as it stands now.
        const chance = Math.round(interceptors(obs, { ...e0, id: '' }, new Set([e0.id])) * 100);
        if (chance) out.push({ unit: e.id, x: e.x, y: e.y, r: INTERCEPT_RANGE, square: true, chance, dedicated, watch, suspected: false, age: 0 });
        continue;
      }
      const ws = usableWeapons(e).filter((w) => !w.indirect && !isDrone(w) && w.air !== 'no');
      if (!ws.length) continue;
      let chance = 0;
      const d = dist(e, me);
      for (const w of ws) {
        const k = d > 0 ? Math.min(d, w.range / 2) / d : 0;
        const p = { x: Math.round(e.x + (me.x - e.x) * k), y: Math.round(e.y + (me.y - e.y) * k) };
        const info = fireInfo(obs, e, { ...me, x: p.x, y: p.y }, w, e, false, new Set([me.id]));
        if (info) chance = Math.max(chance, info.chance);
      }
      out.push({ unit: e.id, x: e.x, y: e.y, r: Math.max(...ws.map((w) => w.range)), square: false, chance: chance || null, dedicated, watch, suspected: false, age: 0 });
    }
    // Air defence seen before and not since: where it was, and how far it would reach.
    for (const id of Object.keys(obs.intel.blue).sort()) {
      const g = obs.intel.blue[id]!;
      const age = obs.turnIndex - g.turn;
      if (g.now || age > STALE) continue;
      const t = typeOf(g.type);
      if (!isAirDefence(t) || (drones && t.role !== 'spaa')) continue;
      const r = drones ? INTERCEPT_RANGE : Math.max(0, ...t.weapons.filter((w) => !w.indirect && w.air !== 'no').map((w) => w.range));
      if (r > 0) out.push({ unit: id, x: g.x, y: g.y, r, square: drones, chance: null, dedicated: true, watch: false, suspected: true, age });
    }
    return out;
  });
}

// --- A move's exposure (report item 6) -------------------------------------------------------------

export type HullFace = 'front' | 'left' | 'right' | 'rear' | 'top';

export interface Threat {
  unit: string;
  /** Percent to hit it there. */
  chance: number;
  /** Percent to knock it out there (vehicles). */
  kill: number;
  /** Vehicles: the armour the shot would strike. */
  face: HullFace | null;
  /** Troops: the cover it would have against the shot. */
  cover: CoverKind;
  /** Troops: in cover, but not from this side. */
  flanking: boolean;
}

export interface Exposure {
  /** Heading after the move, radians: a vehicle turns to the main known threat, else keeps the way it drove. */
  facing: number;
  /** An armoured ground vehicle (the glyph is a hull); otherwise troops or aircraft. */
  vehicle: boolean;
  /** Seen enemies that could hit it there (assuming they see it), most likely first. */
  threats: Threat[];
  /** Troops: the cover there against those threats (the worst of them), or toward the enemy when none. */
  shield: 'full' | 'half' | 'none';
  /** A known enemy would hit a vehicle's side or rear, or catch troops out of their cover. */
  flanked: boolean;
}

const RANK: Record<CoverKind, number> = { none: 0, trees: 1, half: 1, full: 2, building: 2 };
const SHIELD = ['none', 'half', 'full'] as const;

/** The heading a move leaves a unit with (moveUnit and faceThreat in engine.ts). */
function facingAfter(b: Battle, u: Unit, to: Point, path: Point[]): number {
  const t = typeOf(u.type);
  if (t.mobility === 'foot' || u.mobilityKill) return u.facing;
  const prev = path.length > 1 ? path[path.length - 2]! : null;
  const heading = prev ? Math.atan2(to.y - prev.y, to.x - prev.x) : u.facing;
  const threat = mainThreat(b, { ...u, x: to.x, y: to.y });
  return threat ? Math.atan2(threat.y - to.y, threat.x - to.x) : heading;
}

/** Which side of a unit at `p` heading `facing` a shot from `from` strikes (y runs down the field). */
function sideOf(facing: number, from: Point, p: Point): 'left' | 'right' {
  return Math.sin(Math.atan2(from.y - p.y, from.x - p.x) - facing) > 0 ? 'right' : 'left';
}

/**
 * How a unit would stand at `to` after moving there: its heading, and which armour (vehicles) or how
 * much cover (troops) it would show to each seen enemy that could hit it there. Null if it cannot
 * get there.
 */
export function moveExposure(b: Battle, unitId: string, to: Point, dash = false): Exposure | null {
  return cached(b, `move:${unitId}:${to.x},${to.y}:${dash ? 1 : 0}`, (m) => {
    const obs = m.obs;
    const u = obs.units.find((x) => x.id === unitId && x.side === 'blue' && onField(x));
    if (!u) return null;
    const t = typeOf(u.type);
    const reach = reachable(obs, u, dash, m.seen);
    const i = at(obs.map, to.x, to.y);
    if (!reach.cost.has(i)) return null;
    const facing = facingAfter(obs, u, to, pathTo(reach, i));
    const there: Unit = { ...u, x: to.x, y: to.y, facing, aim: facing, moved: true, dashed: dash, hunker: false };
    const vehicle = t.armour !== null && !isFlying(t);
    const threats: Threat[] = [];
    for (const e0 of enemiesSeen(m)) {
      const e = nextTurn(e0);
      const info = bestFire(obs, e, there, e, false, new Set([u.id]));
      if (!info) continue;
      const face: HullFace | null = !vehicle ? null : info.facing === 'top' ? 'top' : info.facing === 'side' ? sideOf(facing, e, to) : info.facing === 'rear' ? 'rear' : 'front';
      threats.push({ unit: e.id, chance: info.chance, kill: info.kill ?? 0, face, cover: info.cover, flanking: info.parts.some(([n]) => n === 'Flanked') });
    }
    threats.sort((p, q) => q.chance - p.chance || (p.unit < q.unit ? -1 : 1));
    let shield: Exposure['shield'] = 'none';
    if (!vehicle && !isFlying(t)) {
      if (threats.length) shield = SHIELD[Math.min(...threats.map((x) => RANK[x.cover]))]!;
      else {
        // Nobody known could hit it there: the cover it would have toward the nearest enemy known of, else up the field.
        const ghosts = Object.values(obs.intel.blue);
        const near = ghosts.sort((p, q) => dist(p, to) - dist(q, to))[0];
        shield = SHIELD[RANK[coverAgainst(obs, there, near ?? { x: to.x, y: to.y - 6 }, false, false).cover]]!;
      }
    }
    const flanked = vehicle ? threats.some((x) => x.face === 'left' || x.face === 'right' || x.face === 'rear') : threats.some((x) => x.flanking);
    return { facing, vehicle, threats, shield, flanked };
  });
}

// --- Fog (report item 18) --------------------------------------------------------------------------

export interface ExpectedArea {
  /** Centre in field units (cell corners at whole numbers). */
  x: number;
  y: number;
  r: number;
  /** Cells whose centres lie within it. */
  cells: number[];
}

/** Where the scouts expect the defenders: round the ground they deploy on (which the war map tells the attacker). */
export function expectedArea(b: Battle): ExpectedArea | null {
  return cached(b, 'expected', (m) => {
    const map = m.obs.map;
    const spawn = map.redSpawn;
    if (!spawn.length) return null;
    const x = spawn.reduce((s, p) => s + p.x + 0.5, 0) / spawn.length;
    const y = spawn.reduce((s, p) => s + p.y + 0.5, 0) / spawn.length;
    const r = Math.max(3, Math.min(9, Math.max(...spawn.map((p) => Math.hypot(p.x + 0.5 - x, p.y + 0.5 - y))) * 0.8));
    const cells: number[] = [];
    for (let cy = 0; cy < map.h; cy++) for (let cx = 0; cx < map.w; cx++) if (Math.hypot(cx + 0.5 - x, cy + 0.5 - y) <= r) cells.push(at(map, cx, cy));
    return { x, y, r, cells };
  });
}

/**
 * Cells of the expected area that blue sees empty now: watched, and no enemy seen there. Woods,
 * buildings, rubble and craters count only when watched from close enough to pick out troops.
 */
export function scoutedEmpty(b: Battle): number[] {
  return cached(b, 'scouted', (m) => {
    const area = expectedArea(b);
    if (!area) return [];
    const obs = m.obs;
    const taken = new Set(enemiesSeen(m).map((u) => at(obs.map, u.x, u.y)));
    const out: number[] = [];
    for (const i of area.cells) {
      if (taken.has(i)) continue;
      const c = obs.map.cells[i];
      const hides = c === TREES || c === BUILDING || c === RUBBLE || obs.map.crater[i] === 1;
      if (observation(obs, 'blue', { x: i % obs.map.w, y: Math.floor(i / obs.map.w) }, hides)) out.push(i);
    }
    return out;
  });
}

// --- Suppression (report item 24) ------------------------------------------------------------------

/**
 * For your own units: the suppression it shakes off when your next turn begins (suppRecovery, as
 * beginTurn does it) and the state that leaves it in, if nothing hits it before then.
 */
export function recovery(b: Battle, unitId: string): { points: number; next: ReturnType<typeof suppLevel> } | null {
  return cached(b, `recovery:${unitId}`, (m) => {
    const u = m.obs.units.find((x) => x.id === unitId && x.side === 'blue' && x.alive);
    if (!u) return null;
    const points = suppRecovery(m.obs, u);
    return { points, next: suppLevel(Math.max(0, u.supp - points)) };
  });
}
