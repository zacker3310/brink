import { bestFire, facingFrom, fitMen, penChance, shotValue, suppLevel, usableWeapons, woundedMen } from './combat';
import { act, canAct, reachable, pathTo, safestCell, strikeInfo, supportChance, unitAt, unitById, whyNot } from './engine';
import { passable } from './map';
import { typeOf } from './roster';
import { cheb, crestAhead, dist, isFlying, lineOfSight, sightRange, visibleTo } from './sight';
import { at, BUILDING, H, inside, PROFILE, ROAD, RUBBLE, TREES, W, WALL, type Action, type Battle, type Ghost, type Point, type Side, type Unit, type UnitType, type Weapon } from './types';

// The enemy (and your crews on autopilot) fighting combined arms (docs/arena-v2.md, section 6).
// It plays from its own side's view: the units it sees now, ghosts of those it saw, the map. It
// never reads a hidden unit, the random stream, or a roll before it is made: its tie-breaks come
// from a hash of the seed, the turn and the unit. `decide` names the next action from the state
// alone, so a test can ask it what it would do and get the same answer whatever it cannot see.

// --- Its picture of the field ----------------------------------------------------------------------

interface Known extends Ghost {
  /** The unit itself, only when seen now (its facing and state are visible). */
  seen: Unit | null;
  t: UnitType;
}

interface Grids {
  /** Cells this enemy can see a hull (lo), a turret top (hi), or a low aircraft (air) in. */
  lo: Uint8Array;
  hi: Uint8Array;
  air: Uint8Array;
}

interface View {
  b: Battle;
  side: Side;
  skill: number;
  visible: Set<string>;
  enemies: Known[];
  grids: Map<string, Grids>;
  friends: Unit[];
}

/** Cached sight grids per enemy position, smoke and terrain, so a turn does not redo them per action. */
const gridCache = new WeakMap<Battle, Map<string, Grids>>();

function signature(b: Battle): string {
  // Terrain changes knock down what blocked sight: count them from the map itself.
  let open = 0;
  for (let i = 0; i < b.map.cells.length; i++) open += b.map.cells[i] === BUILDING || b.map.cells[i] === TREES ? 1 : 0;
  return b.smoke.map((p) => `${p.x},${p.y}`).join(';') + '|' + open;
}

function gridsFor(b: Battle, e: Known, sig: string): Grids {
  let cache = gridCache.get(b);
  if (!cache) {
    cache = new Map();
    gridCache.set(b, cache);
  }
  const key = `${e.unit}@${e.x},${e.y}|${sig}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = W * H;
  const g: Grids = { lo: new Uint8Array(n), hi: new Uint8Array(n), air: new Uint8Array(n) };
  const reach = Math.max(10, ...e.t.weapons.map((w) => (w.indirect ? 0 : w.range)), Math.min(30, sightRange(b, e.t)));
  const eye = b.map.elev[at(b.map, e.x, e.y)]! + (isFlying(e.t) ? 2.5 : PROFILE[e.t.profile].eye);
  const airWeapon = e.t.weapons.some((w) => w.air !== 'no');
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - e.x, y - e.y);
      if (d > reach + 0.01) continue;
      const i = at(b.map, x, y);
      // A vehicle there would face this enemy: a crest toward it puts it on the reverse slope.
      const base = b.map.elev[i]! + (crestAhead(b, { x, y }, Math.atan2(e.y - y, e.x - x)) ? 0.45 : 0);
      if (lineOfSight(b, e, eye, { x, y }, base + 0.3).clear) {
        g.lo[i] = 1;
        g.hi[i] = 1;
      } else if (lineOfSight(b, e, eye, { x, y }, base + 0.75).clear) g.hi[i] = 1;
      if (airWeapon && lineOfSight(b, e, eye, { x, y }, base + 2.5, true).clear) g.air[i] = 1;
    }
  if (cache.size > 400) cache.clear();
  cache.set(key, g);
  return g;
}

function viewOf(b: Battle, side: Side): View {
  const visible = visibleTo(b, side);
  const sig = signature(b);
  const enemies: Known[] = [];
  for (const id of Object.keys(b.intel[side]).sort()) {
    const g = b.intel[side][id]!;
    // Ghosts older than three turns are too stale to plan around.
    if (!g.now && g.turn < b.turnIndex - 3) continue;
    const seen = visible.has(id) ? unitById(b, id) ?? null : null;
    enemies.push({ ...g, seen, t: typeOf(g.type) });
  }
  const v: View = { b, side, skill: side === 'red' ? b.skill : 0.75, visible, enemies, grids: new Map(), friends: b.units.filter((u) => u.side === side && u.alive && !u.carrier) };
  for (const e of enemies) v.grids.set(e.unit, gridsFor(b, e, sig));
  return v;
}

/** A tie-break in 0..1 from the seed, the turn and the unit: never the dice. */
export function noise(b: Battle, id: string, salt: string): number {
  let h = (b.seed ^ Math.imul(b.turnIndex + 1, 0x9e3779b1)) >>> 0;
  const s = id + '|' + salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// --- How dangerous one type is to another --------------------------------------------------------

const dangerCache = new Map<string, { value: number; range: number }>();

/** Expected value an `a` costs a `b` per turn in the open at a fair range, and its reach. */
function danger(a: UnitType, b: UnitType): { value: number; range: number } {
  const key = `${a.id}>${b.id}`;
  const hit = dangerCache.get(key);
  if (hit) return hit;
  let best = { value: 0, range: 0 };
  const flying = isFlying(b);
  for (const w of a.weapons) {
    if (w.indirect) continue;
    if (flying ? w.air === 'no' : w.air === 'only') continue;
    if ((w.kind === 'fpv' || w.kind === 'loiter') && flying) continue;
    let v: number;
    const hitP = (w.aim / 100) * 0.8;
    if (b.armour) {
      const arm = w.top ? b.armour.top : b.armour.hf;
      const side = b.armour.side;
      const pick = (x: [number, number]) => (w.round === 'ce' ? x[1] : x[0]);
      const pen = w.top ? penChance(w.pen, pick(arm)) : 0.65 * penChance(w.pen, pick(arm)) + 0.35 * penChance(w.pen, pick(side));
      v = hitP * pen * 0.65 * b.value;
    } else {
      const men = b.men?.length ?? 1;
      v = hitP * Math.min(1, w.lethality / men) * b.value + (w.supp / 100) * 0.3 * b.value;
    }
    if (v > best.value) best = { value: v, range: w.range };
  }
  dangerCache.set(key, best);
  return best;
}

// --- Scoring cells -------------------------------------------------------------------------------

/** Known enemy fire a unit would draw standing at `p`. */
function threatAt(v: View, u: Unit, t: UnitType, p: Point): number {
  const i = at(v.b.map, p.x, p.y);
  const flying = isFlying(t);
  let sum = 0;
  for (const e of v.enemies) {
    const d = danger(e.t, t);
    if (d.value <= 0 || Math.hypot(p.x - e.x, p.y - e.y) > d.range + 0.5) continue;
    const g = v.grids.get(e.unit)!;
    const seesHull = flying ? g.air[i] : g.lo[i];
    const seesTop = flying ? g.air[i] : g.hi[i];
    if (!seesTop) continue;
    let k = seesHull ? 1 : 0.45;
    if (!e.now) k *= 0.6;
    if (e.seen && suppLevel(e.seen.supp) !== 'steady') k *= 0.6;
    sum += d.value * k;
  }
  if (t.mobility === 'foot') {
    const c = v.b.map.cells[i];
    if (c === BUILDING) sum *= 0.4;
    else if (c === TREES || c === RUBBLE || c === WALL || v.b.map.crater[i] === 1) sum *= 0.65;
  }
  return sum;
}

/** What it could hit from `p`, cheaply: the best known target in range and in sight. */
function potentialAt(v: View, t: UnitType, p: Point): number {
  const i = at(v.b.map, p.x, p.y);
  let best = 0;
  for (const e of v.enemies) {
    const d = danger(t, e.t);
    if (d.value <= 0 || Math.hypot(p.x - e.x, p.y - e.y) > d.range + 0.5) continue;
    const g = v.grids.get(e.unit)!;
    if (!(isFlying(e.t) || isFlying(t) ? g.air[i] || g.hi[i] : g.hi[i])) continue;
    best = Math.max(best, d.value * (e.now ? 1 : 0.4));
  }
  return best;
}

/** Side or rear on a known enemy vehicle it could hit from `p`. */
function flankAt(v: View, t: UnitType, p: Point): number {
  let bonus = 0;
  for (const e of v.enemies) {
    if (!e.seen || !e.t.armour || isFlying(e.t)) continue;
    const d = danger(t, e.t);
    if (d.value <= 0 || Math.hypot(p.x - e.x, p.y - e.y) > d.range) continue;
    const face = facingFrom(e.seen, p, false);
    if (face === 'front') continue;
    const fixed = suppLevel(e.seen.supp) !== 'steady' ? 1.5 : 1;
    bonus = Math.max(bonus, (face === 'rear' ? 0.45 : 0.3) * e.t.value * fixed);
  }
  return bonus;
}

function coverAt(v: View, u: Unit, t: UnitType, p: Point, threat: number): number {
  if (threat <= 0) return 0;
  const i = at(v.b.map, p.x, p.y);
  if (t.mobility === 'foot') {
    const c = v.b.map.cells[i];
    return c === BUILDING ? 1.2 : c === TREES || c === RUBBLE || c === WALL || v.b.map.crater[i] === 1 ? 0.7 : 0;
  }
  if (isFlying(t)) return 0;
  // Hull-down against the enemies that can see it.
  let hd = 0;
  for (const e of v.enemies) {
    const g = v.grids.get(e.unit)!;
    if (g.hi[i] && !g.lo[i]) hd = 1;
  }
  return hd * 1.2;
}

/** Where the side wants to be: the zone, or the enemy, or (defending) its own ground. */
function objectiveAt(v: View, u: Unit, t: UnitType, p: Point): number {
  const b = v.b;
  const z = b.map.zone;
  const role = t.role;
  if (role === 'spg' || role === 'mortar' || role === 'arv' || role === 'medic' || role === 'fpv_team' || role === 'loiter_team') return 0;
  if (v.side === 'blue') {
    // The clock presses the attacker: the pull toward the objective grows every round.
    const urgency = 1 + b.round / 6;
    if (z) {
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      const clear = !v.enemies.some((e) => e.now && Math.hypot(e.x - z.x, e.y - z.y) <= z.r);
      return -d * 0.3 * urgency + (d <= z.r && !isFlying(t) ? (clear ? 2.5 : 1.2) * urgency : 0);
    }
    const near = v.enemies.length ? Math.min(...v.enemies.map((e) => dist(e, p))) : p.y;
    return -Math.max(0, near - 6) * 0.22 * urgency;
  }
  if (z) return -Math.max(0, Math.hypot(p.x - z.x, p.y - z.y) - (z.r + 5)) * 0.35;
  return -Math.max(0, p.y - 26) * 0.2;
}

/** Keep the company together: no one charges far ahead of its friends. */
function cohesionAt(v: View, u: Unit, p: Point): number {
  // Measured against the fighting line, not the guns, medics and snipers behind it.
  const ys = v.friends
    .filter((f) => f !== u && !isFlying(typeOf(f.type)) && jobOf(f) === 'fight' || (f !== u && jobOf(f) === 'transport'))
    .map((f) => f.y)
    .sort((a, c) => a - c);
  if (ys.length < 2) return 0;
  const mid = ys[Math.floor(ys.length / 2)]!;
  const ahead = v.side === 'blue' ? mid - p.y : p.y - mid;
  return -Math.max(0, ahead - 8) * 0.3;
}

interface Plan {
  to: Point;
  score: number;
  shot: number;
}

function caution(v: View, t: UnitType): number {
  const base = 0.35 + 0.55 * v.skill;
  return t.mobility === 'heli' ? base * 1.6 : base;
}

function planMove(v: View, u: Unit, dash: boolean): Plan {
  const b = v.b;
  const t = typeOf(u.type);
  const reach = reachable(b, u, dash, v.visible);
  const quick: { p: Point; s: number; threat: number }[] = [];
  for (const i of reach.cost.keys()) {
    const p = { x: i % W, y: Math.floor(i / W) };
    const threat = threatAt(v, u, t, p);
    let s = -threat * caution(v, t);
    if (!dash) s += potentialAt(v, t, p) * 0.8 + flankAt(v, t, p) * v.skill;
    s += objectiveAt(v, u, t, p) + coverAt(v, u, t, p, threat) + cohesionAt(v, u, p);
    s -= (reach.cost.get(i)! / 10) * 0.02;
    s += (noise(b, u.id, `q${i}`) - 0.5) * (1 - v.skill) * 2.5;
    quick.push({ p, s, threat });
  }
  quick.sort((m, n) => n.s - m.s || m.p.y - n.p.y || m.p.x - n.p.x);
  let best: Plan = { to: { x: u.x, y: u.y }, score: -Infinity, shot: 0 };
  const top = quick.slice(0, dash ? 1 : 7);
  for (const q of top) {
    let shot = 0;
    if (!dash) {
      const mover = q.p.x === u.x && q.p.y === u.y ? u : { ...u, moved: true };
      for (const e of v.enemies) {
        if (!e.seen) continue;
        const info = bestFire(b, mover, e.seen, q.p, false, v.visible);
        if (info) shot = Math.max(shot, shotValue(b, info, e.seen) + flankBonusExact(e.seen, q.p, v.skill));
      }
    }
    const s = q.s - potentialAt(v, t, q.p) * 0.8 + shot * 1.2;
    if (s > best.score) best = { to: q.p, score: s, shot };
  }
  return best;
}

function flankBonusExact(target: Unit, from: Point, skill: number): number {
  const t = typeOf(target.type);
  if (!t.armour || isFlying(t)) return 0;
  return facingFrom(target, from, false) === 'front' ? 0 : 0.3 * skill;
}

// --- Choosing the next action ------------------------------------------------------------------

type Job = 'indirect' | 'recon' | 'ad' | 'drones' | 'medic' | 'repair' | 'engineer' | 'transport' | 'fight';

function jobOf(u: Unit): Job {
  const t = typeOf(u.type);
  if (t.weapons.some((w) => w.indirect)) return 'indirect';
  if (t.role === 'recon_drone') return 'recon';
  if (t.role === 'spaa' || t.role === 'aa_team') return 'ad';
  if (t.role === 'fpv_team' || t.role === 'loiter_team') return 'drones';
  if (t.treat) return 'medic';
  if (t.repair) return 'repair';
  if (t.engineer) return 'engineer';
  if (u.passengers.length) return 'transport';
  return 'fight';
}

const JOB_ORDER: Record<Job, number> = { recon: 0, indirect: 1, drones: 2, ad: 3, fight: 4, transport: 5, engineer: 6, repair: 7, medic: 8 };

function damaged(u: Unit): boolean {
  const t = typeOf(u.type);
  if (t.mobility === 'foot') return fitMen(u) * 2 < (t.men?.length ?? 2) || suppLevel(u.supp) === 'pinned';
  return u.firepowerKill || u.optics || u.crew < t.crew;
}

/** Best HE target cell for an indirect weapon, by expected value against known enemies, never near friends. */
function bestBarrage(v: View, u: Unit, w: Weapon): { at: Point; value: number } | null {
  const b = v.b;
  let best: { at: Point; value: number } | null = null;
  const cells = new Map<number, Point>();
  for (const e of v.enemies) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(e.x + dx, e.y + dy)) cells.set(at(b.map, e.x + dx, e.y + dy), { x: e.x + dx, y: e.y + dy });
  for (const p of [...cells.values()].sort((m, n) => m.y - n.y || m.x - n.x)) {
    const info = strikeInfo(b, u, p, w);
    if (!info) continue;
    const r = w.blast + 1;
    if (v.friends.some((f) => cheb(f, p) <= r && !isFlying(typeOf(f.type)))) continue;
    let value = 0;
    for (const e of v.enemies) {
      const d = Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y));
      if (d > w.blast || isFlying(e.t)) continue;
      const f = (d === 0 ? 1 : 0.5) * (e.now ? 1 : 0.5);
      if (e.t.armour) value += f * penChance(w.pen * f, e.t.armour.top[0]) * 0.5 * e.t.value + f * 0.15;
      else value += f * Math.min(1, (w.lethality * 0.6) / Math.max(1, e.t.men?.length ?? 1)) * e.t.value + f * (w.supp / 100) * e.t.value * 0.3;
    }
    value *= info.chance / 100;
    if (!best || value > best.value) best = { at: p, value };
  }
  return best;
}

/** Where a crossing would be seen: smoke between the enemy and the route, if it hides most of it. */
function smokeFor(v: View, route: Point[]): Point | null {
  const b = v.b;
  const exposed = (path: Point[]) => {
    let n = 0;
    for (const p of path) {
      const i = at(b.map, p.x, p.y);
      if (v.enemies.some((e) => e.now && v.grids.get(e.unit)!.hi[i] && danger(e.t, typeOf('m1a2')).value > 0 && Math.hypot(p.x - e.x, p.y - e.y) <= 24)) n++;
    }
    return n;
  };
  const before = exposed(route);
  if (before < 3) return null;
  const mid = route[Math.floor(route.length / 2)]!;
  const threat = v.enemies.filter((e) => e.now).sort((m, n) => dist(m, mid) - dist(n, mid))[0];
  if (!threat) return null;
  const d = dist(threat, mid) || 1;
  const cell = { x: Math.round(mid.x + ((threat.x - mid.x) / d) * 2), y: Math.round(mid.y + ((threat.y - mid.y) / d) * 2) };
  if (!inside(cell.x, cell.y)) return null;
  // Would it work? Count again through the smoke, from the threat only (cheap and honest).
  const saved = b.smoke;
  b.smoke = [...saved, ...[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: cell.x + dx, y: cell.y + dy, side: v.side, until: b.turnIndex + 2 })))];
  const eye = b.map.elev[at(b.map, threat.x, threat.y)]! + PROFILE[threat.t.profile].eye;
  let after = 0;
  for (const p of route) if (lineOfSight(b, threat, eye, p, b.map.elev[at(b.map, p.x, p.y)]! + 0.75).clear) after++;
  b.smoke = saved;
  let beforeOne = 0;
  for (const p of route) if (lineOfSight(b, threat, eye, p, b.map.elev[at(b.map, p.x, p.y)]! + 0.75).clear) beforeOne++;
  return beforeOne >= 3 && after * 2 <= beforeOne ? cell : null;
}

function tryAct(b: Battle, a: Action, side: Side): Action | null {
  return canAct(b, a, side) ? a : null;
}

/** After moving (or not), the unit's action: the best shot, else overwatch, else hunker. */
function finish(v: View, u: Unit): Action | null {
  const b = v.b;
  const t = typeOf(u.type);
  const side = v.side;
  if (u.acted) return null;
  const visible = visibleTo(b, side);
  let best: { a: Action; value: number; chance: number } | null = null;
  for (const e of b.units) {
    if (!visible.has(e.id)) continue;
    const info = bestFire(b, u, e, u, false, visible);
    if (!info) continue;
    const air = isFlying(typeOf(e.type));
    // Air defence goes for aircraft first.
    const value = shotValue(b, info, e) * ((t.role === 'spaa' || t.role === 'aa_team') && air ? 3 : 1) + (noise(b, u.id, `f${e.id}`) - 0.5) * (1 - v.skill) * 0.6;
    if (!best || value > best.value) best = { a: { type: 'fire', unit: u.id, target: e.id, weapon: info.weapon.id }, value, chance: info.chance };
  }
  const minChance = 8 + 15 * v.skill;
  if (best && best.chance >= minChance && best.value > 0.04) return tryAct(b, best.a, side);
  if (t.mobility === 'foot' && (threatAt(v, u, t, u) > 0.3 || damaged(u))) return tryAct(b, { type: 'hunker', unit: u.id }, side);
  if (usableWeapons(u).some((w) => !w.indirect && w.kind !== 'fpv' && w.kind !== 'loiter')) return tryAct(b, { type: 'overwatch', unit: u.id }, side);
  if (t.mobility === 'foot') return tryAct(b, { type: 'hunker', unit: u.id }, side);
  return null;
}

function moveAction(u: Unit, to: Point, dash = false): Action | null {
  return to.x === u.x && to.y === u.y ? null : { type: 'move', unit: u.id, to, ...(dash ? { dash: true } : {}) };
}

/** The next thing `u` should do, or null when it is done. */
function decideUnit(v: View, u: Unit): Action | null {
  const b = v.b;
  const t = typeOf(u.type);
  const side = v.side;
  if (u.acted && !u.smoked) return null;
  if (u.acted && u.smoked) {
    if (u.moved) return null;
    const plan = planMove(v, u, false);
    return moveAction(u, plan.to);
  }
  const job = jobOf(u);
  const canMove = !u.moved && !u.mobilityKill && suppLevel(u.supp) !== 'broken';

  // Pull back: damaged and under fire.
  if (canMove && damaged(u) && threatAt(v, u, t, u) > 0.2 && job !== 'indirect') {
    const safe = safestCell(b, u);
    const m = safe ? moveAction(u, safe) : null;
    if (m && canAct(b, m, side)) return m;
  }

  if (job === 'indirect') {
    const w = t.weapons.find((x) => x.indirect)!;
    // Smoke for a crossing first, when the side is moving up and a route is exposed.
    if ((u.smoke[w.id] ?? 0) > 0 && noise(b, u.id, 'smoke') < v.skill) {
      for (const f of v.friends) {
        if (f === u || f.moved || f.acted || jobOf(f) === 'indirect' || isFlying(typeOf(f.type))) continue;
        const plan = planMove(v, f, false);
        if (plan.to.x === f.x && plan.to.y === f.y) continue;
        const route = pathTo(reachable(b, f, false, v.visible), at(b.map, plan.to.x, plan.to.y));
        const cell = smokeFor(v, route);
        if (cell && strikeInfo(b, u, cell, w, true)) return tryAct(b, { type: 'strike', unit: u.id, at: cell, weapon: w.id, smoke: true }, side);
      }
    }
    const target = bestBarrage(v, u, w);
    if (target && target.value > 0.25) return tryAct(b, { type: 'strike', unit: u.id, at: target.at, weapon: w.id }, side);
    // Nothing worth a shell: get somewhere safer if threatened, else keep the rounds.
    if (canMove && threatAt(v, u, t, u) > 0.2 && !w.setup) {
      const safe = safestCell(b, u);
      const m = safe ? moveAction(u, safe) : null;
      if (m && canAct(b, m, side)) return m;
    }
    return finish(v, u);
  }

  if (job === 'drones') {
    const w = usableWeapons(u).find((x) => x.kind === 'fpv' || x.kind === 'loiter');
    if (w) {
      let best: { id: string; value: number } | null = null;
      for (const e of v.enemies) {
        if (!e.seen) continue;
        const info = bestFire(b, u, e.seen, u, false, v.visible);
        if (!info || info.weapon.id !== w.id) continue;
        const value = shotValue(b, info, e.seen) * (1 - (info.intercept ?? 0) / 100);
        if (!best || value > best.value) best = { id: e.unit, value };
      }
      if (best && best.value > 0.3) return tryAct(b, { type: 'fire', unit: u.id, target: best.id, weapon: w.id }, side);
    }
    if (canMove) {
      // Get within drone range of the enemy, from cover, out of its fire.
      const range = w?.range ?? 20;
      const reach = reachable(b, u, false, v.visible);
      const front = v.enemies.length ? v.enemies : [{ x: W / 2, y: side === 'blue' ? 6 : 38 }];
      let best: Point | null = null;
      let score = -Infinity;
      for (const i of reach.cost.keys()) {
        const p = { x: i % W, y: Math.floor(i / W) };
        const near = Math.min(...front.map((e) => dist(e, p)));
        const s = -Math.max(0, near - (range - 4)) * 0.5 - threatAt(v, u, t, p) * 3 + coverAt(v, u, t, p, 1) + (noise(b, u.id, `v${i}`) - 0.5) * 0.3;
        if (s > score) {
          score = s;
          best = p;
        }
      }
      const m = best ? moveAction(u, best) : null;
      if (m && canAct(b, m, side)) return m;
    }
    return tryAct(b, { type: 'hunker', unit: u.id }, side);
  }

  if (job === 'recon' && canMove) {
    // Look ahead from where the guns cannot reach it.
    const reach = reachable(b, u, false, v.visible);
    const goal = v.side === 'blue' ? (b.map.zone ? { x: b.map.zone.x, y: b.map.zone.y + 8 } : { x: W / 2, y: 14 }) : { x: W / 2, y: 30 };
    let best: Point = u;
    let score = -Infinity;
    for (const i of reach.cost.keys()) {
      const p = { x: i % W, y: Math.floor(i / W) };
      const s = -dist(p, goal) * 0.3 - threatAt(v, u, t, p) * 3 + (noise(b, u.id, `r${i}`) - 0.5) * 0.5;
      if (s > score) {
        score = s;
        best = p;
      }
    }
    const m = moveAction(u, best);
    if (m) return tryAct(b, m, side);
    return null;
  }

  if (job === 'medic') {
    const hurt = v.friends.filter((f) => typeOf(f.type).mobility === 'foot' && woundedMen(f) > 0).sort((p, q) => dist(p, u) - dist(q, u));
    const next = hurt.find((f) => cheb(f, u) <= 1);
    if (next) return tryAct(b, { type: 'treat', unit: u.id, target: next.id }, side);
    if (canMove && hurt[0]) {
      const goal = hurt[0];
      const reach = reachable(b, u, false, v.visible);
      let best: Point | null = null;
      let s = Infinity;
      for (const i of reach.cost.keys()) {
        const p = { x: i % W, y: Math.floor(i / W) };
        const d = cheb(p, goal) + threatAt(v, u, t, p) * 2;
        if (d < s) {
          s = d;
          best = p;
        }
      }
      const m = best ? moveAction(u, best) : null;
      if (m) return tryAct(b, m, side);
      const now = v.friends.find((f) => typeOf(f.type).mobility === 'foot' && woundedMen(f) > 0 && cheb(f, u) <= 1);
      if (now) return tryAct(b, { type: 'treat', unit: u.id, target: now.id }, side);
    }
    return tryAct(b, { type: 'hunker', unit: u.id }, side);
  }

  if (job === 'repair') {
    const broke = v.friends.filter((f) => f.mobilityKill || f.firepowerKill).sort((p, q) => dist(p, u) - dist(q, u));
    const next = broke.find((f) => cheb(f, u) <= 1 && f !== u);
    if (next) return tryAct(b, { type: 'repair', unit: u.id, target: next.id }, side);
    if (canMove && broke[0]) {
      const goal = broke[0];
      const reach = reachable(b, u, false, v.visible);
      let best: Point | null = null;
      let s = Infinity;
      for (const i of reach.cost.keys()) {
        const p = { x: i % W, y: Math.floor(i / W) };
        const d = cheb(p, goal) + threatAt(v, u, t, p);
        if (d < s) {
          s = d;
          best = p;
        }
      }
      const m = best ? moveAction(u, best) : null;
      if (m) return tryAct(b, m, side);
      const now = v.friends.find((f) => (f.mobilityKill || f.firepowerKill) && f !== u && cheb(f, u) <= 1);
      if (now) return tryAct(b, { type: 'repair', unit: u.id, target: now.id }, side);
    }
    return finish(v, u);
  }

  if (job === 'engineer') {
    // Blow in a building with the enemy inside, next to it; defending, mine the approaches.
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const p = { x: u.x + dx, y: u.y + dy };
        if (!inside(p.x, p.y) || (!dx && !dy)) continue;
        const there = unitAt(b, p.x, p.y);
        if (there && there.side !== side && v.visible.has(there.id) && b.map.cells[at(b.map, p.x, p.y)] === BUILDING) return tryAct(b, { type: 'breach', unit: u.id, at: p }, side);
      }
    if (side === 'red' && (u.ammo.mines ?? 0) > 0) {
      const toward = { x: u.x, y: u.y + 1 };
      for (const p of [toward, { x: u.x - 1, y: u.y + 1 }, { x: u.x + 1, y: u.y + 1 }]) {
        if (!inside(p.x, p.y)) continue;
        const c = b.map.cells[at(b.map, p.x, p.y)];
        if (c !== ROAD && noise(b, u.id, `m${p.x}`) > 0.4) continue;
        const a = tryAct(b, { type: 'mine', unit: u.id, at: p }, side);
        if (a) return a;
      }
    }
  }

  if (job === 'transport' && typeOf(u.type).mobility === 'heli') {
    // Air assault: put the troops down near the objective, out of known air defence.
    const goal = b.map.zone ? { x: b.map.zone.x, y: b.map.zone.y + (side === 'blue' ? 5 : -5) } : { x: W / 2, y: side === 'blue' ? 20 : 25 };
    if (dist(u, goal) <= 7 || threatAt(v, u, t, u) > 1) {
      const a = tryAct(b, { type: 'dismount', unit: u.id }, side);
      if (a) return a;
    }
    if (canMove) {
      const reach = reachable(b, u, false, v.visible);
      let best: Point | null = null;
      let s = -Infinity;
      for (const i of reach.cost.keys()) {
        const p = { x: i % W, y: Math.floor(i / W) };
        const c = b.map.cells[i];
        const sc = -dist(p, goal) * 0.4 - threatAt(v, u, t, p) * 3 + (c === 0 || c === ROAD ? 1 : 0);
        if (sc > s) {
          s = sc;
          best = p;
        }
      }
      const m = best ? moveAction(u, best) : null;
      if (m) return tryAct(b, m, side);
    }
    return tryAct(b, { type: 'dismount', unit: u.id }, side) ?? finish(v, u);
  }

  if (job === 'transport') {
    // A carrier drops its squad near the fight, in cover from what it knows, then fights itself.
    const near = v.enemies.length ? Math.min(...v.enemies.map((e) => dist(e, u))) : 99;
    const z = b.map.zone;
    const dz = z ? Math.hypot(u.x - z.x, u.y - z.y) : 99;
    if (near <= 9 || dz <= 8 || damaged(u) || side === 'red' || threatAt(v, u, t, u) > 1.5) {
      const a = tryAct(b, { type: 'dismount', unit: u.id }, side);
      if (a) return a;
    }
  }

  // Air defence hunts helicopters: get a line on the last known ones.
  if (job === 'ad' && canMove) {
    const air = v.enemies.filter((e) => isFlying(e.t) && e.t.mobility === 'heli');
    if (air.length && !air.some((e) => e.seen && bestFire(b, u, e.seen, u, false, v.visible))) {
      const reach = reachable(b, u, false, v.visible);
      let best: Point | null = null;
      let s = -Infinity;
      for (const i of reach.cost.keys()) {
        const p = { x: i % W, y: Math.floor(i / W) };
        let sc = -threatAt(v, u, t, p) * 2 + cohesionAt(v, u, p);
        for (const e of air) {
          const g = v.grids.get(e.unit)!;
          if (g.air[i] && Math.hypot(p.x - e.x, p.y - e.y) <= 24) sc += 3;
        }
        if (sc > s) {
          s = sc;
          best = p;
        }
      }
      const m = best ? moveAction(u, best) : null;
      if (m) return tryAct(b, m, side);
    }
    return finish(v, u);
  }

  // Everyone else fights: shoot from here if it is as good as anywhere, or move and then shoot.
  if (canMove) {
    const plan = planMove(v, u, false);
    if (plan.shot <= 0.05 && suppLevel(u.supp) === 'steady' && t.mobility !== 'heli') {
      const run = planMove(v, u, true);
      if (run.score > plan.score + 1.2 && run.to.y !== u.y) {
        const route = pathTo(reachable(b, u, true, v.visible), at(b.map, run.to.x, run.to.y));
        // Smoke before crossing open ground under their guns, when it has its own.
        if ((u.smoke.grenades ?? 0) > 0 && noise(b, u.id, 'pop') < v.skill && smokeFor(v, route)) return tryAct(b, { type: 'smoke', unit: u.id }, side) ?? moveAction(u, run.to, true);
        const m = moveAction(u, run.to, true);
        if (m && canAct(b, m, side)) return m;
      }
    }
    const m = moveAction(u, plan.to);
    if (m && canAct(b, m, side)) return m;
  }
  return finish(v, u);
}

/** The next action for `side`, or null when its turn is done. Pure: reads the state, changes nothing. */
export function decide(b: Battle, side: Side, skip: ReadonlySet<string> = new Set()): Action | null {
  if (b.ended || b.turn !== side) return null;
  const v = viewOf(b, side);
  // Off-map rockets on a cluster worth them.
  for (const s of b.support) {
    if (s.side !== side || s.missions <= 0 || skip.has(`support:${s.id}`)) continue;
    let best: { at: Point; value: number } | null = null;
    for (const e of v.enemies) {
      if (!e.now || isFlying(e.t)) continue;
      let value = 0;
      for (const o of v.enemies) if (!isFlying(o.t) && Math.max(Math.abs(o.x - e.x), Math.abs(o.y - e.y)) <= (s.id === 'himars' ? 1 : 2)) value += o.t.value * (o.now ? 1 : 0.5);
      if (v.friends.some((f) => cheb(f, e) <= 3)) continue;
      value *= supportChance(b, side, s.id, e) / 100;
      if (!best || value > best.value) best = { at: { x: e.x, y: e.y }, value };
    }
    if (best && best.value >= (s.id === 'himars' ? 8 : 10)) return { type: 'support', asset: s.id, at: best.at };
  }
  const order = b.units
    .filter((u) => u.side === side && u.alive && !u.carrier && !skip.has(u.id))
    .sort((p, q) => JOB_ORDER[jobOf(p)] - JOB_ORDER[jobOf(q)] || (p.id < q.id ? -1 : 1));
  // Fire support first: whoever has a good shot from where it stands and is not badly exposed
  // there shoots before the others move, so the maneuver goes in against suppressed targets.
  const ready = order.filter((u) => !u.moved && !u.acted && jobOf(u) === 'fight' && !damaged(u));
  for (const u of ready) {
    const shot = finish(v, u);
    if (shot?.type !== 'fire') continue;
    const target = unitById(b, shot.target)!;
    const info = bestFire(b, u, target, u, false, v.visible);
    const t = typeOf(u.type);
    if (info && shotValue(b, info, target) >= 0.5 && threatAt(v, u, t, u) * caution(v, t) < shotValue(b, info, target) * 1.5) return shot;
  }
  for (const u of order) {
    const a = decideUnit(v, u);
    if (a) return a;
  }
  return null;
}

/** Actions the AI chose that the rules refused, per battle (the soak expects none). */
const refused = new WeakMap<Battle, string[]>();
export function rejectedActions(b: Battle): readonly string[] {
  return refused.get(b) ?? [];
}

/** Play one whole side's turn with the AI (the enemy, or your own side on autopilot). */
export function playSide(b: Battle, side: Side): void {
  const skip = new Set<string>();
  for (let guard = 0; guard < 400 && !b.ended && b.turn === side; guard++) {
    const a = decide(b, side, skip);
    if (!a) break;
    const id = a.type === 'support' ? `support:${a.asset}` : a.type === 'ability' ? `ability:${a.id}` : a.unit;
    if (!act(b, a, side)) {
      // Never expected: the AI only picks what canAct allows. Count it and move on.
      refused.set(b, [...rejectedActions(b), `${a.type} ${id}: ${whyNot(b, a, side)}`]);
      skip.add(id);
      continue;
    }
    // A unit that has done all it can is not asked again.
    if (a.type === 'support') skip.add(id);
    else if (a.type !== 'ability') {
      const u = unitById(b, a.unit);
      if (!u || !u.alive || (u.acted && !u.smoked) || (u.acted && u.moved)) skip.add(id);
    }
  }
}

// --- Deployment ------------------------------------------------------------------------------------

/** The defender takes up positions before the battle: hull-down and in buildings covering the approach. */
export function deploy(b: Battle, side: Side): void {
  const mine = b.units.filter((u) => u.side === side);
  // Defenders start dismounted, in their positions.
  for (const u of mine) if (u.carrier) {
    const c = mine.find((x) => x.id === u.carrier);
    if (c) c.passengers = c.passengers.filter((id) => id !== u.id);
    u.carrier = null;
  }
  const approach: Point[] = [];
  for (let y = H - 14; y < H - 2; y += 3) for (let x = 2; x < W - 2; x += 4) approach.push({ x, y });
  const taken = new Set<string>();
  const z = b.map.zone;
  const centre = z ? { x: z.x, y: z.y } : { x: W / 2, y: 12 };
  const score = (u: Unit, p: Point): number => {
    const t = typeOf(u.type);
    const i = at(b.map, p.x, p.y);
    const c = b.map.cells[i];
    const flying = isFlying(t);
    if (!flying && !passable(b.map, p.x, p.y, t.mobility, t.amphibious)) return -Infinity;
    if (!flying && t.mobility !== 'foot' && (c === BUILDING || c === TREES)) return -Infinity;
    let s = 0;
    const back = t.role === 'spg' || t.role === 'mortar' || t.role === 'arv' || flying || t.role === 'fpv_team' || t.role === 'loiter_team' || t.role === 'medic';
    if (back) s -= Math.abs(p.y - 3) * 1.5 + Math.abs(p.x - W / 2) * 0.1;
    else s -= Math.max(0, dist(p, centre) - (z ? z.r + 3 : 6)) * 0.6;
    if (t.role === 'spaa' || t.role === 'aa_team') s -= Math.abs(dist(p, centre) - 4) * 0.5;
    if (t.mobility === 'foot' && !back) s += c === BUILDING ? 6 : c === TREES ? 4 : c === RUBBLE || c === WALL ? 3 : 0;
    if (!back && !flying) {
      // How much of the approach it overlooks, and whether a crest hides its hull from it.
      let sees = 0;
      let hull = 0;
      for (const q of approach) {
        const top = lineOfSight(b, q, b.map.elev[at(b.map, q.x, q.y)]! + 0.7, p, b.map.elev[i]! + 0.75);
        if (!top.clear) continue;
        sees++;
        const lo = lineOfSight(b, q, b.map.elev[at(b.map, q.x, q.y)]! + 0.7, p, b.map.elev[i]! + 0.3);
        if (!lo.clear) hull++;
      }
      const atgm = t.weapons.some((w) => w.kind === 'atgm' || w.kind === 'cannon');
      s += sees * (atgm ? 0.5 : 0.25) + (t.armour && !flying ? hull * 0.6 : 0);
      if (t.role === 'sniper') s += b.map.elev[i]! * 1.5;
    }
    return s + noise(b, u.id, `d${i}`) * 0.5;
  };
  const order = mine.slice().sort((p, q) => typeOf(q.type).value - typeOf(p.type).value || (p.id < q.id ? -1 : 1));
  for (const u of order) {
    const t = typeOf(u.type);
    const air = isFlying(t);
    let best: Point | null = null;
    let s = -Infinity;
    for (const p of b.map.redSpawn) {
      const key = `${air ? 'a' : 'g'}${p.x},${p.y}`;
      if (taken.has(key)) continue;
      const v = score(u, p);
      if (v > s) {
        s = v;
        best = p;
      }
    }
    if (!best) best = b.map.redSpawn.find((p) => !taken.has(`${air ? 'a' : 'g'}${p.x},${p.y}`)) ?? { x: Math.floor(W / 2), y: 2 };
    taken.add(`${air ? 'a' : 'g'}${best.x},${best.y}`);
    u.x = best.x;
    u.y = best.y;
    u.facing = Math.PI / 2;
    u.aim = Math.PI / 2;
  }
}
