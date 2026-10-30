import { pickConditions } from './conditions';
import { wellFormed } from './orders';
import { blast, blueSees, bestFire, difficultyPart, fireInfo, fitMen, freeCellNear, kill, rankAim, roll, shoot, suppLevel, suppress, usableWeapons, woundedMen, type FireInfo } from './combat';
import { buildForce, type UnitSeed } from './forces';
import { canStep, passable, buildMap } from './map';
import { startingLoad, typeOf } from './roster';
import { ABILITIES, battleSkill, DIFFICULTY, difficultyAim } from './rules';
import { canSee, cheb, dist, isFlying, observation, other, updateIntel, visibleTo } from './sight';
import {
  at,
  BUILDING,
  BRIDGE,
  CAPTURE_ROUNDS,
  H,
  inside,
  OPEN,
  ROAD,
  ROCK,
  ROUND_LIMIT,
  RUBBLE,
  TREES,
  W,
  WALL,
  WATER,
  BREAK_AT,
  WITHDRAW_AT,
  type Action,
  type ArenaResult,
  type ArenaSetup,
  type Battle,
  type BattleEvent,
  type Difficulty,
  type Point,
  type Side,
  type Soldier,
  type Unit,
  type UnitType,
  type Weapon,
} from './types';
import { deploy, playSide } from './ai';

// A battle in turns (docs/arena-v2.md, section 3). Everything is a pure function of the setup and
// the actions taken: the state is plain JSON with its random stream inside, so a battle replays
// exactly, saves mid-fight and runs headless in tests. The web app plays `events` back as a film.

// --- Setup -----------------------------------------------------------------------------------------

const ROLE_ORDER: Record<string, number> = { leader: 0, team_leader: 1, gunner: 2, auto_rifleman: 2, at: 3, sniper: 3, spotter: 4, medic: 4, sapper: 4, operator: 4, marksman: 5, grenadier: 6, assistant: 7, rifleman: 8 };

/** A soldier list thinned to `fit` men: riflemen and assistants go first, the leader last. */
function thin(roles: readonly Soldier['role'][], fit: number): Soldier[] {
  const keep = roles.map((r, i) => ({ r, i })).sort((p, q) => (ROLE_ORDER[p.r] ?? 9) - (ROLE_ORDER[q.r] ?? 9) || p.i - q.i).slice(0, Math.max(0, fit)).sort((p, q) => p.i - q.i);
  return keep.map(({ r }) => ({ role: r, state: 'fit' }));
}

/** Points a unit is worth now (see the spec's unit values). `won`: its side won (knocked-out hulks are recovered). */
export function unitValue(u: Unit, won = false): number {
  const t = typeOf(u.type);
  if (t.mobility === 'foot') {
    const full = t.men?.length ?? 1;
    return (t.value * (fitMen(u) + 0.5 * woundedMen(u))) / full;
  }
  if (!u.alive) return u.status === 'knocked_out' && won ? t.value * 0.2 : u.status === 'landed' ? t.value * 0.3 : 0;
  let c = 1 - 0.15 * Math.max(0, t.crew - u.crew);
  if (u.mobilityKill && u.firepowerKill) c = Math.min(c, 0.35);
  else if (u.mobilityKill || u.firepowerKill) c = Math.min(c, 0.6);
  return t.value * Math.max(0, c);
}

function makeUnit(seed: UnitSeed, side: Side): Unit {
  const t = typeOf(seed.type);
  const { ammo, smoke } = startingLoad(t);
  const men = t.mobility === 'foot' && t.men ? thin(t.men, seed.men ?? t.men.length) : [];
  const facing = side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  const u: Unit = {
    id: seed.id,
    type: seed.type,
    side,
    formation: seed.formation,
    name: seed.name,
    rank: seed.rank,
    x: 0,
    y: 0,
    facing,
    aim: facing,
    alive: true,
    status: 'ok',
    crew: t.crew,
    mobilityKill: false,
    firepowerKill: false,
    optics: false,
    men,
    supp: 0,
    moved: false,
    acted: false,
    dashed: false,
    overwatch: false,
    hunker: false,
    smoked: false,
    ammo,
    smoke,
    aps: t.aps?.charges ?? 0,
    carrier: seed.carrier ?? null,
    passengers: [],
    parent: null,
    revealed: -1,
    startValue: 0,
  };
  u.startValue = unitValue(u);
  return u;
}

export function createBattle(setup: ArenaSetup): Battle {
  const conditions = pickConditions(setup);
  const map = buildMap({ seed: setup.seed, terrain: setup.terrain, river: setup.river, site: setup.site, biome: conditions.biome });
  const blue = buildForce(setup, 'blue');
  const red = buildForce(setup, 'red');
  const units = [...blue.units.map((s) => makeUnit(s, 'blue')), ...red.units.map((s) => makeUnit(s, 'red'))];
  for (const u of units) if (u.carrier) units.find((c) => c.id === u.carrier)?.passengers.push(u.id);
  const abilities: Battle['abilities'] = {};
  for (const a of [...setup.abilities].sort()) abilities[a] = 'ready';
  const difficulty: Difficulty = setup.difficulty && Object.hasOwn(DIFFICULTY, setup.difficulty) ? setup.difficulty : 'normal';
  const b: Battle = {
    version: 2,
    seed: setup.seed,
    map,
    units,
    conditions,
    round: 1,
    turn: 'blue',
    turnIndex: 0,
    ended: null,
    endReason: null,
    skill: battleSkill(setup.skill, difficulty),
    difficulty,
    abilities,
    support: [...blue.support.map((s) => ({ ...s, side: 'blue' as const })), ...red.support.map((s) => ({ ...s, side: 'red' as const }))],
    precision: 0,
    sweepUntil: -1,
    smoke: [],
    mines: [],
    wrecks: [],
    capture: 0,
    intel: { blue: {}, red: {} },
    events: [],
    stats: { blue: { shots: 0, hits: 0, kills: 0, lost: 0 }, red: { shots: 0, hits: 0, kills: 0, lost: 0 } },
    stream: setup.seed >>> 0,
  };
  deployBlue(b);
  deploy(b, 'red');
  for (const u of b.units) if (u.carrier) {
    const c = b.units.find((x) => x.id === u.carrier)!;
    u.x = c.x;
    u.y = c.y;
  }
  b.events.push({ type: 'turn', side: 'blue', round: 1 });
  updateIntel(b);
  return b;
}

/** The attackers form up on their edge: armour in front, guns and support at the back. */
function deployBlue(b: Battle): void {
  const band = (t: UnitType) => (t.role === 'spg' || t.role === 'arv' || t.role === 'mortar' || t.role === 'medic' || t.role === 'spaa' || t.mobility === 'heli' ? 2 : t.role === 'mbt' || t.role === 'ifv' || t.role === 'apc' || t.role === 'light_tank' ? 0 : 1);
  const taken = new Set<string>();
  const order = b.units.filter((u) => u.side === 'blue' && !u.carrier).sort((p, q) => band(typeOf(p.type)) - band(typeOf(q.type)) || (p.id < q.id ? -1 : 1));
  for (const u of order) {
    const t = typeOf(u.type);
    const air = isFlying(t);
    const want = H - 4 + band(t) + (air ? 1 : 0);
    const cells = b.map.blueSpawn.filter((p) => !taken.has(`${air ? 'a' : 'g'}${p.x},${p.y}`) && (air || passable(b.map, p.x, p.y, t.mobility, t.amphibious)));
    cells.sort((p, q) => Math.abs(p.y - want) - Math.abs(q.y - want) || Math.abs(p.x - W / 2) - Math.abs(q.x - W / 2) || p.x - q.x);
    const p = cells[0] ?? { x: Math.floor(W / 2), y: H - 1 };
    taken.add(`${air ? 'a' : 'g'}${p.x},${p.y}`);
    u.x = p.x;
    u.y = p.y;
  }
}

// --- Lookups ---------------------------------------------------------------------------------------

export const unitById = (b: Battle, id: string) => b.units.find((u) => u.id === id);
const onField = (u: Unit) => u.alive && u.carrier === null;

/** The unit standing in a cell on the ground (or in the air, `air`). */
export function unitAt(b: Battle, x: number, y: number, air = false): Unit | undefined {
  return b.units.find((u) => onField(u) && u.x === x && u.y === y && isFlying(typeOf(u.type)) === air);
}

// --- Movement ------------------------------------------------------------------------------------

export interface Reach {
  /** Cell index to movement spent, in tenths of a cell. */
  cost: Map<number, number>;
  prev: Map<number, number>;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Movement points in tenths: pinned units move half as far and cannot dash. */
export function budget(u: Unit, dash: boolean): number {
  const t = typeOf(u.type);
  const pinned = suppLevel(u.supp) === 'pinned';
  return t.move * 10 * (dash && !pinned ? 2 : 1) * (pinned ? 0.5 : 1);
}

function stepCost(b: Battle, t: UnitType, from: number, to: number, diag: boolean): number | null {
  const fx = from % W;
  const fy = Math.floor(from / W);
  const tx = to % W;
  const ty = Math.floor(to / W);
  if (!passable(b.map, tx, ty, t.mobility, t.amphibious)) return null;
  if (isFlying(t)) return diag ? 14 : 10;
  const vehicle = t.mobility !== 'foot';
  if (vehicle && b.wrecks.some((w) => w.x === tx && w.y === ty)) return null;
  if (!canStep(b.map, { x: fx, y: fy }, { x: tx, y: ty }, t.mobility)) return null;
  const c = b.map.cells[to];
  let cost = diag ? 14 : 10;
  const road = (c === ROAD || c === BRIDGE) && (b.map.cells[from] === ROAD || b.map.cells[from] === BRIDGE);
  if (road && t.mobility === 'wheeled') cost = diag ? 10 : 7;
  else if (road && t.mobility === 'tracked') cost = diag ? 12 : 9;
  if (t.mobility === 'foot' && c === TREES) cost *= 1.3;
  if (t.mobility === 'foot' && c === BUILDING) cost += 4;
  if (t.mobility === 'foot' && c === ROCK) cost *= 1.5;
  if (c === RUBBLE) cost *= 2;
  if (c === WALL) cost += t.mobility === 'tracked' ? 8 : 4;
  if (c === WATER) cost *= 3;
  const climb = b.map.elev[to]! - b.map.elev[from]!;
  if (climb > 0) cost += 4 * climb;
  return Math.round(cost);
}

/**
 * Every cell the unit can move to this turn (its own included), from what its side knows: hidden
 * enemies do not block the plan (it bumps into them when it moves), known ones block their layer.
 */
export function reachable(b: Battle, u: Unit, dash = false, known?: Set<string>): Reach {
  const t = typeOf(u.type);
  const start = at(b.map, u.x, u.y);
  const cost = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  if (u.moved || (u.acted && !u.smoked) || !onField(u) || u.mobilityKill || suppLevel(u.supp) === 'broken') return { cost, prev };
  const max = budget(u, dash);
  const air = isFlying(t);
  const seen = known ?? visibleTo(b, u.side);
  const blocked = new Set<number>();
  for (const o of b.units) if (onField(o) && o.side !== u.side && seen.has(o.id) && isFlying(typeOf(o.type)) === air) blocked.add(at(b.map, o.x, o.y));
  if (!air && t.mobility !== 'foot') for (const m of b.mines) if (m.side === u.side) blocked.add(at(b.map, m.x, m.y));
  const buckets: number[][] = [[start]];
  for (let c = 0; c <= max; c++) {
    const list = buckets[c];
    if (!list) continue;
    for (const cur of list) {
      if (cost.get(cur) !== c) continue;
      const cx = cur % W;
      const cy = Math.floor(cur / W);
      for (const [dx, dy] of DIRS) {
        const x = cx + dx;
        const y = cy + dy;
        if (!inside(x, y)) continue;
        const diag = dx !== 0 && dy !== 0;
        const i = at(b.map, x, y);
        if (blocked.has(i)) continue;
        // Vehicles and troops do not cut corners round what they cannot cross.
        if (diag && !air && (stepCost(b, t, cur, at(b.map, cx + dx, cy), false) === null || stepCost(b, t, cur, at(b.map, cx, cy + dy), false) === null)) continue;
        const s = stepCost(b, t, cur, i, diag);
        if (s === null) continue;
        const nc = c + s;
        if (nc > max || nc >= (cost.get(i) ?? Infinity)) continue;
        cost.set(i, nc);
        prev.set(i, cur);
        (buckets[nc] ??= []).push(i);
      }
    }
  }
  // Only cells it can stop in count: not where a friend or a known enemy stands on its layer. A
  // hidden enemy's cell stays lit: the move stops short when it bumps into it.
  for (const i of [...cost.keys()]) {
    if (i === start) continue;
    const there = unitAt(b, i % W, Math.floor(i / W), air);
    if (there && (there.side === u.side || seen.has(there.id))) cost.delete(i);
  }
  return { cost, prev };
}

export function pathTo(reach: Reach, to: number): Point[] {
  const out: Point[] = [];
  for (let i: number | undefined = to; i !== undefined; i = reach.prev.get(i)) out.unshift({ x: i % W, y: Math.floor(i / W) });
  return out;
}

/** The known enemy most worth keeping the front armour toward (a vehicle turns to it after a move). */
export function mainThreat(b: Battle, u: Unit): Point | null {
  let best: Point | null = null;
  let score = 0;
  for (const g of Object.values(b.intel[u.side])) {
    const t = typeOf(g.type);
    const pen = Math.max(0, ...t.weapons.filter((w) => w.air !== 'only').map((w) => (w.range + 1 >= dist(g, u) ? w.pen : 0)));
    const s = pen / (1 + dist(g, u)) / (g.now ? 1 : 2);
    if (s > score) {
      score = s;
      best = g;
    }
  }
  return best;
}

function faceThreat(b: Battle, u: Unit, fallback: number): void {
  const t = typeOf(u.type);
  if (t.mobility === 'foot') return;
  const threat = mainThreat(b, u);
  const dir = threat ? Math.atan2(threat.y - u.y, threat.x - u.x) : fallback;
  if (!u.mobilityKill) u.facing = dir;
  u.aim = dir;
}

/** Enemies on overwatch take their shot at a unit that just moved in front of them. */
function reactTo(b: Battle, mover: Unit, flush: () => void): void {
  const air = isFlying(typeOf(mover.type));
  for (const w of [...b.units].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    if (!mover.alive || mover.mobilityKill) return;
    if (!onField(w) || !w.overwatch || w.side === mover.side) continue;
    const role = typeOf(w.type).role;
    // Air-defence crews on watch look at the sky only.
    if ((role === 'spaa' || role === 'aa_team') && !air) continue;
    if (!canSee(b, w, mover)) continue;
    const info = bestFire(b, w, mover, w, true, new Set([mover.id]));
    if (!info) continue;
    flush();
    w.overwatch = false;
    shoot(b, w, mover, info, true);
  }
}

function moveUnit(b: Battle, u: Unit, to: Point, dash: boolean): void {
  const t = typeOf(u.type);
  const air = isFlying(t);
  const reach = reachable(b, u, dash);
  const path = pathTo(reach, at(b.map, to.x, to.y));
  u.moved = true;
  u.hunker = false;
  if (dash) {
    u.dashed = true;
    u.acted = true;
  }
  let walked: Point[] = [path[0]!];
  let seen: boolean[] = [blueSees(b, u)];
  const flush = () => {
    if (walked.length > 1) b.events.push({ type: 'move', unit: u.id, path: walked, seen, dash });
    walked = [walked.at(-1)!];
    seen = [seen.at(-1)!];
  };
  let heading = u.facing;
  for (const p of path.slice(1)) {
    // Someone hidden is already there: stop short, in contact.
    const blocker = unitAt(b, p.x, p.y, air);
    if (blocker && blocker.side !== u.side) {
      blocker.revealed = Math.max(blocker.revealed, b.turnIndex);
      break;
    }
    const last = walked.at(-1)!;
    heading = Math.atan2(p.y - last.y, p.x - last.x);
    if (t.mobility !== 'foot') {
      u.facing = heading;
      u.aim = heading;
    }
    u.x = p.x;
    u.y = p.y;
    for (const id of u.passengers) {
      const q = unitById(b, id);
      if (q) {
        q.x = p.x;
        q.y = p.y;
      }
    }
    walked.push(p);
    seen.push(blueSees(b, u));
    const i = at(b.map, p.x, p.y);
    if (t.mobility === 'tracked' && b.map.cells[i] === WALL) {
      b.map.cells[i] = OPEN;
      b.map.hp[i] = 0;
      b.events.push({ type: 'terrain', x: p.x, y: p.y, cell: OPEN });
    }
    const mine = !air && t.mobility !== 'foot' ? b.mines.findIndex((m) => m.x === p.x && m.y === p.y && m.side !== u.side) : -1;
    if (mine >= 0) {
      flush();
      const m = b.mines.splice(mine, 1)[0]!;
      b.events.push({ type: 'mine', x: p.x, y: p.y, side: m.side, laid: false }, { type: 'boom', x: p.x, y: p.y, size: 1, kind: 'mine', seen: blueSees(b, u) });
      if ((t.stowage === 'light' || (t.armour?.hf[0] ?? 0) < 100) && roll(b) < 0.4) kill(b, u, 'destroyed', m.side);
      else {
        u.mobilityKill = true;
        if (roll(b) < 0.3) u.crew = Math.max(1, u.crew - 1);
        b.events.push({ type: 'impact', unit: u.id, facing: 'side', pen: true, effect: 'mobility', x: u.x, y: u.y, seen: blueSees(b, u) });
        suppress(b, u, 30);
      }
      break;
    }
    reactTo(b, u, flush);
    if (!u.alive || u.mobilityKill) break;
  }
  flush();
  if (u.alive) faceThreat(b, u, heading);
  updateIntel(b);
}

// --- Indirect fire -------------------------------------------------------------------------------

export interface StrikeInfo {
  weapon: Weapon;
  chance: number;
  parts: [string, number][];
  observed: 'laser' | 'spotter' | 'observed' | 'blind';
}

const OBSERVED: Record<StrikeInfo['observed'], number> = { laser: 90, spotter: 80, observed: 65, blind: 35 };

/** Called fire from `u` with `weapon` on a cell: the chance it lands on it, and why. */
export function strikeInfo(b: Battle, u: Unit, cell: Point, weapon: Weapon, smoke = false): StrikeInfo | null {
  if (!weapon.indirect || !onField(u) || u.acted || !inside(cell.x, cell.y)) return null;
  if (!usableWeapons(u).includes(weapon)) return null;
  if (smoke ? (u.smoke[weapon.id] ?? 0) <= 0 : weapon.ammo !== null && (u.ammo[weapon.id] ?? 0) <= 0) return null;
  const d = dist(u, cell);
  if (d > weapon.range + 0.01 || d < weapon.minRange) return null;
  if (u.moved && weapon.setup) return null;
  if (suppLevel(u.supp) === 'broken') return null;
  const observed = observation(b, u.side, cell) ?? 'blind';
  const base = observed === 'observed' && weapon.kind === 'mortar' ? 70 : OBSERVED[observed];
  const parts: [string, number][] = [[observed === 'blind' ? 'Unobserved' : observed === 'laser' ? 'Lasered' : observed === 'spotter' ? 'Spotter' : 'Observed', base]];
  const r = rankAim(u);
  if (r) parts.push(['Crew', r]);
  const lvl = suppLevel(u.supp);
  if (lvl === 'pinned') parts.push(['Pinned', -30]);
  else if (lvl === 'suppressed') parts.push(['Suppressed', -15]);
  if (u.side === 'blue' && b.precision > 0) parts.push(['Precision rounds', 30]);
  difficultyPart(b, u.side, parts);
  const chance = Math.max(5, Math.min(95, Math.round(parts.reduce((s, [, v]) => s + v, 0))));
  return { weapon, chance, parts, observed };
}

function scatter(b: Battle, p: Point, by: number): Point {
  const [dx, dy] = DIRS[Math.floor(roll(b) * 8)]!;
  return { x: Math.max(0, Math.min(W - 1, p.x + dx * by)), y: Math.max(0, Math.min(H - 1, p.y + dy * by)) };
}

function smokeCells(b: Battle, cells: Point[], side: Side): void {
  const ok = cells.filter((p) => inside(p.x, p.y));
  for (const p of ok) {
    b.smoke = b.smoke.filter((s) => s.x !== p.x || s.y !== p.y);
    // It hangs through the enemy's reply and thins away when the side that laid it moves again.
    b.smoke.push({ x: p.x, y: p.y, side, until: b.turnIndex + 2 });
  }
  b.events.push({ type: 'smoke', cells: ok, side });
}

const around = (p: Point, r: number): Point[] => {
  const out: Point[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
};

function strike(b: Battle, u: Unit, cell: Point, w: Weapon, smoke: boolean): void {
  const info = strikeInfo(b, u, cell, w, smoke)!;
  const hit = roll(b) * 100 < info.chance;
  const land = hit ? cell : scatter(b, cell, info.observed === 'blind' ? 2 : 1);
  if (smoke) u.smoke[w.id] = (u.smoke[w.id] ?? 1) - 1;
  else if (w.ammo !== null) u.ammo[w.id] = (u.ammo[w.id] ?? 1) - 1;
  if (u.side === 'blue' && b.precision > 0) b.precision--;
  u.aim = Math.atan2(cell.y - u.y, cell.x - u.x);
  u.acted = true;
  const sawBefore = blueSees(b, u);
  u.revealed = b.turnIndex + 1;
  b.stats[u.side].shots++;
  if (hit) b.stats[u.side].hits++;
  const shot = { type: 'fire' as const, unit: u.id, weapon: w.id, kind: w.kind, calibre: w.calibre, from: { x: u.x, y: u.y }, to: land, target: null, hit, chance: info.chance, overwatch: false, seen: true, shooterSeen: sawBefore };
  b.events.push(shot);
  if (smoke) smokeCells(b, around(land, 1), u.side);
  else blast(b, land, { lethality: w.lethality, pen: w.pen, supp: w.supp, demo: w.demo, radius: w.blast, crater: w.kind === 'howitzer', kind: 'shell' }, u.side);
  // Shown firing only if blue saw it before, or sees it now the rounds have landed (as its picture will).
  shot.shooterSeen = sawBefore || blueSees(b, u);
  if (u.side === 'blue') b.events.push({ type: 'radio', side: 'blue', call: smoke ? 'smoke' : 'splash', unit: u.id });
}

/** Off-map rockets: HIMARS lands where it is told when the cell is watched; Tornado-G drenches the area. */
export function supportChance(b: Battle, side: Side, id: 'himars' | 'tornado', cell: Point): number {
  const obs = observation(b, side, cell);
  const base = id === 'himars' ? (obs ? 95 : 50) : obs ? 60 : 40;
  return Math.max(5, Math.min(95, base + difficultyAim(b.difficulty, side)));
}

function callSupport(b: Battle, side: Side, id: 'himars' | 'tornado', cell: Point): void {
  const asset = b.support.find((s) => s.side === side && s.id === id)!;
  asset.missions--;
  const chance = supportChance(b, side, id, cell);
  const hit = roll(b) * 100 < chance;
  const land = hit ? cell : scatter(b, cell, 1);
  const from = { x: Math.floor(W / 2), y: side === 'blue' ? H - 1 : 0 };
  b.events.push({ type: 'fire', unit: `support:${id}`, weapon: id, kind: 'rocket', calibre: id === 'himars' ? '227' : '122', from, to: land, target: null, hit, chance, overwatch: false, seen: true, shooterSeen: side === 'blue' });
  if (id === 'himars') blast(b, land, { lethality: 4, pen: 300, supp: 50, demo: 80, radius: 1, crater: true, kind: 'rockets' }, side);
  else {
    // A 40-rocket salvo spreads over five by five cells.
    for (const p of [land, scatter(b, land, 1), scatter(b, land, 2), scatter(b, land, 1)]) blast(b, p, { lethality: 1.6, pen: 40, supp: 45, demo: 15, radius: 1, crater: true, kind: 'rockets' }, side);
  }
  if (side === 'blue') b.events.push({ type: 'radio', side: 'blue', call: 'splash', unit: `support:${id}` });
}

// --- Actions -------------------------------------------------------------------------------------

function weaponOf(u: Unit, id: string): Weapon | undefined {
  return typeOf(u.type).weapons.find((w) => w.id === id);
}

const isVehicle = (t: UnitType) => t.mobility === 'tracked' || t.mobility === 'wheeled';
const seatsUsed = (b: Battle, c: Unit) => c.passengers.reduce((s, id) => s + (unitById(b, id)?.men.filter((m) => m.state !== 'dead').length ?? 0), 0);
const landable = (b: Battle, p: Point) => {
  const c = b.map.cells[at(b.map, p.x, p.y)];
  return c === OPEN || c === ROAD;
};

/** Cells ahead of a vehicle for its smoke grenades. */
function screenCells(u: Unit): Point[] {
  const ox = Math.round(Math.cos(u.facing));
  const oy = Math.round(Math.sin(u.facing));
  const ahead = { x: u.x + ox, y: u.y + oy };
  const side = { x: -oy, y: ox };
  return [{ x: u.x, y: u.y }, ahead, { x: ahead.x + side.x, y: ahead.y + side.y }, { x: ahead.x - side.x, y: ahead.y - side.y }];
}

/** Why an action cannot be taken now, or null when it can. The UI greys out what it cannot do. */
export function whyNot(b: Battle, a: Action, side: Side = b.turn): string | null {
  if (!wellFormed(a)) return 'Not an order';
  if (b.ended) return 'The battle is over';
  if (b.turn !== side) return 'Not your turn';
  if (a.type === 'ability') {
    if (side !== 'blue' || b.abilities[a.id] !== 'ready' || ABILITIES[a.id].passive) return 'Not available';
    const def = ABILITIES[a.id];
    if (def.targeted && (!a.at || !inside(a.at.x, a.at.y))) return 'Pick a cell';
    if (def.needsUnit) {
      const u = a.unit ? unitById(b, a.unit) : undefined;
      if (!u || !onField(u) || u.side !== side) return 'Pick a unit';
      const t = typeOf(u.type);
      if (t.mobility === 'foot' ? woundedMen(u) === 0 : !(u.mobilityKill || u.firepowerKill || u.optics)) return 'Nothing to repair';
    }
    return null;
  }
  if (a.type === 'support') {
    const s = b.support.find((x) => x.side === side && x.id === a.asset);
    if (!s || s.missions <= 0) return 'No missions left';
    return inside(a.at.x, a.at.y) ? null : 'Pick a cell';
  }
  const u = unitById(b, a.unit);
  if (!u || !u.alive || u.side !== side) return 'Not your unit';
  const t = typeOf(u.type);
  if (a.type === 'dismount') {
    if (!onField(u) || !u.passengers.length) return 'No one aboard';
    if (t.mobility === 'heli' && (u.acted || !landable(b, u))) return 'Needs open ground to land';
    return null;
  }
  if (u.carrier) return 'Aboard a carrier';
  if (u.acted && !(a.type === 'move' && u.smoked && !a.dash)) return 'Done this turn';
  const broken = suppLevel(u.supp) === 'broken';
  switch (a.type) {
    case 'move': {
      if (u.moved) return 'Already moved';
      if (broken) return 'Broken';
      if (u.mobilityKill) return 'Immobilised';
      if (a.to.x === u.x && a.to.y === u.y) return 'Already there';
      return reachable(b, u, !!a.dash).cost.has(at(b.map, a.to.x, a.to.y)) ? null : 'Out of reach';
    }
    case 'face':
      return t.mobility === 'foot' || isFlying(t) ? 'Not needed' : u.moved ? 'Already moved' : u.mobilityKill ? 'Immobilised' : null;
    case 'fire': {
      const w = weaponOf(u, a.weapon);
      if (!w) return 'No such weapon';
      if (!usableWeapons(u).includes(w)) return 'Weapon unavailable';
      // The same answer for a unit out of sight as for one that is not there: no telling them apart.
      const target = unitById(b, a.target);
      return target && fireInfo(b, u, target, w) ? null : 'No shot';
    }
    case 'strike': {
      const w = weaponOf(u, a.weapon);
      return w && strikeInfo(b, u, a.at, w, !!a.smoke) ? null : 'Cannot fire there';
    }
    case 'overwatch':
      return broken ? 'Broken' : usableWeapons(u).some((w) => !w.indirect) ? null : 'Nothing to watch with';
    case 'hunker':
      return t.mobility === 'foot' ? null : 'Infantry only';
    case 'hold':
      return null;
    case 'smoke':
      if (t.engineer) return (u.smoke.pots ?? 0) > 0 && fitMen(u) > 0 ? null : 'No smoke pots';
      return (u.smoke.grenades ?? 0) > 0 && isVehicle(t) ? null : 'No smoke';
    case 'embark': {
      const c = unitById(b, a.carrier);
      if (!c || !onField(c) || c.side !== side) return 'No carrier';
      const ct = typeOf(c.type);
      if (t.mobility !== 'foot' || ct.seats <= 0) return 'Cannot board';
      if (broken) return 'Broken';
      if (seatsUsed(b, c) + u.men.filter((m) => m.state !== 'dead').length > ct.seats) return 'No room';
      if (ct.mobility === 'heli' && (c.acted || !landable(b, c))) return 'Needs open ground to land';
      if (cheb(u, c) <= 1) return null;
      if (u.moved) return 'Too far';
      // It walks to the carrier: the carrier's cell must be in reach but for the carrier itself.
      return reachToCarrier(b, u, c) ? null : 'Too far';
    }
    case 'split':
      return (u.type === 'squad_w' || u.type === 'squad_e') && !u.moved && fitMen(u) >= 4 ? null : 'Cannot split';
    case 'merge': {
      const o = unitById(b, a.with);
      if (!o || !onField(o) || o.side !== side || o.acted || o.id === u.id) return 'No team to join';
      const pair = o.parent === u.id || u.parent === o.id || (!!u.parent && u.parent === o.parent);
      return pair && cheb(u, o) <= 1 ? null : 'Must be its other half, next to it';
    }
    case 'treat': {
      const o = unitById(b, a.target);
      return t.treat && fitMen(u) > 0 && o && onField(o) && o.side === side && cheb(u, o) <= 1 && woundedMen(o) > 0 ? null : 'No wounded next to it';
    }
    case 'repair': {
      const o = unitById(b, a.target);
      return t.repair && o && onField(o) && o.side === side && o.id !== u.id && cheb(u, o) <= 1 && (o.mobilityKill || o.firepowerKill) ? null : 'Nothing to repair next to it';
    }
    case 'breach':
      // Any cell next to it: a wall, rock or building is blown; open ground is swept for mines. (It
      // was allowed on open ground only where a mine lay, which told the player where hidden mines were.)
      return t.engineer && fitMen(u) >= 2 && cheb(u, a.at) === 1 && inside(a.at.x, a.at.y) ? null : 'Next to it, with engineers';
    case 'mine': {
      if (!t.engineer || (u.ammo.mines ?? 0) <= 0 || cheb(u, a.at) !== 1 || !inside(a.at.x, a.at.y)) return 'Next to it, with engineers';
      // Refused only for what this side knows is there; what it cannot see is found in the doing.
      const known = visibleTo(b, side);
      const there = unitAt(b, a.at.x, a.at.y);
      if (!passable(b.map, a.at.x, a.at.y, 'tracked') || (there && (there.side === side || known.has(there.id))) || b.mines.some((m) => m.side === side && m.x === a.at.x && m.y === a.at.y)) return 'Cannot mine there';
      return null;
    }
  }
  return null;
}

function reachToCarrier(b: Battle, u: Unit, c: Unit): boolean {
  const reach = reachable(b, u);
  for (const [dx, dy] of DIRS) if (reach.cost.has(at(b.map, c.x + dx, c.y + dy)) || (u.x === c.x + dx && u.y === c.y + dy)) return true;
  return false;
}

export function canAct(b: Battle, a: Action, side: Side = b.turn): boolean {
  return whyNot(b, a, side) === null;
}

/** Take one action. Returns false (and changes nothing) if it is not allowed. */
export function act(b: Battle, a: Action, side: Side = b.turn): boolean {
  if (!canAct(b, a, side)) return false;
  if (a.type === 'ability') useAbility(b, a);
  else if (a.type === 'support') callSupport(b, side, a.asset, a.at);
  else {
    const u = unitById(b, a.unit)!;
    const t = typeOf(u.type);
    switch (a.type) {
      case 'move':
        moveUnit(b, u, a.to, !!a.dash);
        break;
      case 'face':
        u.facing = a.facing;
        u.aim = a.facing;
        u.moved = true;
        b.events.push({ type: 'face', unit: u.id, facing: a.facing, seen: blueSees(b, u) });
        break;
      case 'fire': {
        const target = unitById(b, a.target)!;
        const info = fireInfo(b, u, target, weaponOf(u, a.weapon)!)!;
        shoot(b, u, target, info, false);
        u.acted = true;
        updateIntel(b);
        break;
      }
      case 'strike':
        strike(b, u, a.at, weaponOf(u, a.weapon)!, !!a.smoke);
        updateIntel(b);
        break;
      case 'overwatch':
        u.overwatch = true;
        u.acted = true;
        break;
      case 'hunker':
        u.hunker = true;
        u.acted = true;
        break;
      case 'hold':
        u.acted = true;
        break;
      case 'smoke':
        if (t.engineer) {
          u.smoke.pots = (u.smoke.pots ?? 1) - 1;
          smokeCells(b, [{ x: u.x, y: u.y }, a.at ?? screenCells(u)[1]!], u.side);
        } else {
          u.smoke.grenades = (u.smoke.grenades ?? 1) - 1;
          smokeCells(b, screenCells(u), u.side);
        }
        // Popping smoke is quick: it may still drive out behind it, but do nothing else.
        u.acted = true;
        u.smoked = true;
        if (u.side === 'blue') b.events.push({ type: 'radio', side: 'blue', call: 'smoke', unit: u.id });
        updateIntel(b);
        break;
      case 'embark': {
        const c = unitById(b, a.carrier)!;
        if (cheb(u, c) > 1) {
          // Walk to the nearest cell next to the carrier first.
          const reach = reachable(b, u);
          let best = -1;
          for (const [dx, dy] of DIRS) {
            const i = at(b.map, c.x + dx, c.y + dy);
            if (inside(c.x + dx, c.y + dy) && reach.cost.has(i) && (best < 0 || reach.cost.get(i)! < reach.cost.get(best)!)) best = i;
          }
          if (best >= 0) moveUnit(b, u, { x: best % W, y: Math.floor(best / W) }, false);
          if (!u.alive || suppLevel(u.supp) === 'broken') break;
        }
        u.carrier = c.id;
        u.x = c.x;
        u.y = c.y;
        u.moved = true;
        u.acted = true;
        u.overwatch = false;
        u.hunker = false;
        c.passengers.push(u.id);
        if (typeOf(c.type).mobility === 'heli') c.acted = true;
        b.events.push({ type: 'embark', unit: u.id, carrier: c.id, seen: blueSees(b, c) });
        updateIntel(b);
        break;
      }
      case 'dismount':
        dismount(b, u);
        break;
      case 'split':
        split(b, u);
        break;
      case 'merge':
        merge(b, u, unitById(b, a.with)!);
        break;
      case 'treat': {
        const o = unitById(b, a.target)!;
        let restored = 0;
        for (const m of o.men) if (m.state === 'wounded' && restored < 2) {
          m.state = 'fit';
          restored++;
        }
        u.acted = true;
        b.events.push({ type: 'treat', unit: u.id, target: o.id, restored });
        break;
      }
      case 'repair': {
        const o = unitById(b, a.target)!;
        const fixed = o.mobilityKill ? 'mobility' : 'firepower';
        if (fixed === 'mobility') o.mobilityKill = false;
        else o.firepowerKill = false;
        u.acted = true;
        b.events.push({ type: 'repair', unit: u.id, target: o.id, fixed });
        break;
      }
      case 'breach': {
        const i = at(b.map, a.at.x, a.at.y);
        const c = b.map.cells[i];
        const mine = b.mines.findIndex((m) => m.x === a.at.x && m.y === a.at.y);
        if (mine >= 0) {
          b.mines.splice(mine, 1);
          b.events.push({ type: 'mine', x: a.at.x, y: a.at.y, side: other(u.side), laid: false });
        } else if (c === BUILDING) {
          b.map.hp[i] = 0;
          b.map.cells[i] = RUBBLE;
          b.map.storeys[i] = 0;
          b.events.push({ type: 'boom', x: a.at.x, y: a.at.y, size: 1, kind: 'he', seen: blueSees(b, u) }, { type: 'terrain', x: a.at.x, y: a.at.y, cell: RUBBLE });
          const inside_ = unitAt(b, a.at.x, a.at.y);
          if (inside_) {
            blast(b, a.at, { lethality: 3, pen: 0, supp: 70, demo: 0, radius: 0, crater: false, kind: 'he' }, u.side);
          }
        } else if (c === WALL || c === ROCK) {
          b.map.cells[i] = c === ROCK ? RUBBLE : OPEN;
          b.map.hp[i] = 0;
          b.events.push({ type: 'boom', x: a.at.x, y: a.at.y, size: 1, kind: 'he', seen: blueSees(b, u) }, { type: 'terrain', x: a.at.x, y: a.at.y, cell: b.map.cells[i]! });
        }
        // Anything else: swept, and nothing found.
        u.acted = true;
        updateIntel(b);
        break;
      }
      case 'mine': {
        u.acted = true;
        const there = unitAt(b, a.at.x, a.at.y);
        if (there && there.side !== u.side) {
          // An enemy unseen in that cell: the engineers find it there and lay nothing.
          there.revealed = Math.max(there.revealed, b.turnIndex);
          updateIntel(b);
          break;
        }
        // An enemy mine there is lifted first, as a breach would.
        const found = b.mines.findIndex((m) => m.side !== u.side && m.x === a.at.x && m.y === a.at.y);
        if (found >= 0) {
          b.mines.splice(found, 1);
          b.events.push({ type: 'mine', x: a.at.x, y: a.at.y, side: other(u.side), laid: false });
        }
        u.ammo.mines = (u.ammo.mines ?? 1) - 1;
        b.mines.push({ x: a.at.x, y: a.at.y, side: u.side });
        if (u.side === 'blue') b.events.push({ type: 'mine', x: a.at.x, y: a.at.y, side: u.side, laid: true });
        break;
      }
    }
  }
  checkEnd(b);
  return true;
}

function dismount(b: Battle, c: Unit): void {
  const ct = typeOf(c.type);
  const out: { id: string; x: number; y: number }[] = [];
  // Out of the back: the cells behind the vehicle first.
  const behind = { x: c.x - Math.round(Math.cos(c.facing) * 2), y: c.y - Math.round(Math.sin(c.facing) * 2) };
  for (const id of [...c.passengers]) {
    const p = unitById(b, id);
    if (!p) continue;
    const cell = freeCellNear(b, c, 'foot', behind);
    p.carrier = null;
    p.x = cell.x;
    p.y = cell.y;
    p.moved = true;
    p.acted = false;
    p.overwatch = false;
    out.push({ id, x: cell.x, y: cell.y });
  }
  c.passengers = [];
  if (ct.mobility === 'heli') c.acted = true;
  b.events.push({ type: 'dismount', carrier: c.id, units: out, seen: blueSees(b, c) });
  if (c.side === 'blue') b.events.push({ type: 'radio', side: 'blue', call: 'dismount', unit: c.id });
  updateIntel(b);
}

function split(b: Battle, u: Unit): void {
  const teamType = u.type === 'squad_w' ? 'team_w' : 'team_e';
  const half = Math.ceil(u.men.length / 2);
  const a = u.men.slice(0, half);
  const rest = u.men.slice(half);
  const total = Math.max(1, u.startValue);
  const share = a.length / Math.max(1, u.men.length);
  const twin: Unit = { ...u, id: `${u.id}b`, name: `${u.name} (B)`, type: teamType, men: rest.map((m) => ({ ...m })), ammo: { ...u.ammo }, smoke: { ...u.smoke }, passengers: [], parent: u.id, startValue: total * (1 - share) };
  u.type = teamType;
  u.name = `${u.name} (A)`;
  u.men = a;
  u.startValue = total * share;
  const cell = freeCellNear(b, u, 'foot');
  twin.x = cell.x;
  twin.y = cell.y;
  b.units.push(twin);
  b.events.push({ type: 'split', unit: u.id, into: [u.id, twin.id] });
}

function merge(b: Battle, u: Unit, o: Unit): void {
  const squad = u.type === 'team_w' ? 'squad_w' : 'squad_e';
  const keep = u.parent === o.id ? o : u;
  const gone = keep === u ? o : u;
  keep.type = squad;
  keep.men = [...keep.men, ...gone.men];
  keep.startValue += gone.startValue;
  keep.name = keep.name.replace(/ \((A|B)\)$/, '');
  keep.moved = true;
  keep.acted = true;
  keep.parent = null;
  b.units = b.units.filter((x) => x !== gone);
  b.events.push({ type: 'merge', unit: keep.id, with: gone.id });
}

function useAbility(b: Battle, a: Extract<Action, { type: 'ability' }>): void {
  b.abilities[a.id] = 'used';
  const u = a.unit ? unitById(b, a.unit) : undefined;
  const p = a.at ?? (u ? { x: u.x, y: u.y } : { x: Math.floor(W / 2), y: Math.floor(H / 2) });
  b.events.push({ type: 'ability', id: a.id, x: p.x, y: p.y });
  if (a.id === 'repair' && u) {
    if (typeOf(u.type).mobility === 'foot') {
      let n = 0;
      for (const m of u.men) if (m.state === 'wounded' && n < 2) {
        m.state = 'fit';
        n++;
      }
    } else {
      u.mobilityKill = false;
      u.firepowerKill = false;
      u.optics = false;
    }
  } else if (a.id === 'sweep') b.sweepUntil = b.turnIndex + 2;
  else if (a.id === 'missiles') b.precision = 3;
  else if (a.id === 'mines' && a.at) {
    for (const q of [a.at, { x: a.at.x + 1, y: a.at.y }, { x: a.at.x - 1, y: a.at.y }, { x: a.at.x, y: a.at.y + 1 }, { x: a.at.x, y: a.at.y - 1 }])
      if (inside(q.x, q.y) && passable(b.map, q.x, q.y, 'tracked') && !b.mines.some((m) => m.x === q.x && m.y === q.y)) b.mines.push({ x: q.x, y: q.y, side: 'blue' });
  } else if (a.id === 'airstrike' && a.at) blast(b, a.at, { lethality: 4, pen: 150, supp: 60, demo: 80, radius: 1, crater: true, kind: 'bombs' }, 'blue');
  updateIntel(b);
}

// --- Turns ---------------------------------------------------------------------------------------

function inCover(b: Battle, u: Unit): boolean {
  const i = at(b.map, u.x, u.y);
  const c = b.map.cells[i];
  if (c === TREES || c === BUILDING || c === RUBBLE || c === WALL || b.map.crater[i] === 1) return true;
  for (const [dx, dy] of DIRS) {
    const x = u.x + dx;
    const y = u.y + dy;
    if (!inside(x, y)) continue;
    const n = b.map.cells[at(b.map, x, y)];
    if (n === BUILDING || n === ROCK || n === WALL) return true;
  }
  return false;
}

/**
 * Suppression a unit shakes off when its side's turn begins: 20, 10 more in cover, 10 more with its
 * leader fit, 10 more if it hunkered, 5 per friend next to it (at most 10); vehicles 30.
 */
export function suppRecovery(b: Battle, u: Unit): number {
  if (typeOf(u.type).mobility !== 'foot') return 30;
  const rec = 20 + (inCover(b, u) ? 10 : 0) + (u.men[0]?.role === 'leader' && u.men[0].state === 'fit' ? 10 : 0) + (u.hunker ? 10 : 0);
  const friends = b.units.filter((o) => o !== u && o.side === u.side && o.alive && !o.carrier && cheb(o, u) <= 1).length;
  return rec + Math.min(10, friends * 5);
}

function beginTurn(b: Battle, side: Side): void {
  b.turn = side;
  b.smoke = b.smoke.filter((s) => s.until > b.turnIndex);
  if (side === 'blue') for (const w of b.wrecks) w.burning = Math.max(0, w.burning - 1);
  b.events.push({ type: 'turn', side, round: b.round });
  for (const u of b.units) {
    if (u.side !== side || !u.alive) continue;
    // Read before the orders clear: a unit that hunkered recovers faster.
    const rec = suppRecovery(b, u);
    u.moved = false;
    u.acted = false;
    u.dashed = false;
    u.overwatch = false;
    u.hunker = false;
    u.smoked = false;
    if (u.supp <= 0) continue;
    const before = suppLevel(u.supp);
    u.supp = Math.max(0, u.supp - rec);
    const after = suppLevel(u.supp);
    if (after !== before) b.events.push({ type: 'suppressed', unit: u.id, level: after, seen: blueSees(b, u) });
  }
  updateIntel(b);
  // Broken units fall back to cover, away from what they know of the enemy, on their own.
  for (const u of b.units.filter((x) => x.side === side && onField(x) && suppLevel(x.supp) === 'broken').sort((p, q) => (p.id < q.id ? -1 : 1))) {
    const safe = safestCell(b, u);
    if (safe && (safe.x !== u.x || safe.y !== u.y)) {
      // A broken unit runs: no one can stop it but it cannot fight.
      const supp = u.supp;
      u.supp = 79;
      moveUnit(b, u, safe, false);
      u.supp = supp;
    }
    u.acted = true;
    u.moved = true;
  }
}

/** The reachable cell with the most cover and the least known enemy fire, toward its own edge. */
export function safestCell(b: Battle, u: Unit): Point | null {
  const supp = u.supp;
  u.supp = Math.min(supp, 79);
  const reach = reachable(b, u);
  u.supp = supp;
  const home = u.side === 'blue' ? H - 1 : 0;
  const threats = Object.values(b.intel[u.side]);
  let best: Point | null = null;
  let score = -Infinity;
  for (const i of reach.cost.keys()) {
    const p = { x: i % W, y: Math.floor(i / W) };
    let s = 0;
    for (const g of threats) s += Math.min(12, dist(g, p)) * (g.now ? 1 : 0.5);
    s += inCover(b, { ...u, x: p.x, y: p.y }) ? 25 : 0;
    s -= Math.abs(p.y - home) * 0.4;
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return best;
}

export function sideValue(b: Battle, side: Side): number {
  return b.units.filter((u) => u.side === side).reduce((s, u) => s + unitValue(u), 0);
}

export function startValue(b: Battle, side: Side): number {
  return b.units.filter((u) => u.side === side).reduce((s, u) => s + u.startValue, 0);
}

function end(b: Battle, won: boolean, reason: NonNullable<Battle['endReason']>): void {
  if (b.ended) return;
  b.ended = won ? 'won' : 'lost';
  b.endReason = reason;
  b.events.push({ type: 'end', won, reason });
}

function checkEnd(b: Battle): void {
  if (b.ended) return;
  const alive = (s: Side) => b.units.some((u) => u.side === s && u.alive && unitValue(u) > 0);
  if (!alive('red')) end(b, true, 'destroyed');
  else if (!alive('blue')) end(b, false, 'wiped');
}

/** In capture fights: the attackers are in the zone and no defender is. */
export function holdingZone(b: Battle): boolean {
  const z = b.map.zone;
  if (!z) return false;
  const inZone = (u: Unit) => onField(u) && !isFlying(typeOf(u.type)) && Math.hypot(u.x - z.x, u.y - z.y) <= z.r;
  return b.units.some((u) => u.side === 'blue' && inZone(u)) && !b.units.some((u) => u.side === 'red' && inZone(u));
}

/** A defender bled under a third of its strength pulls out; an attacker under a quarter breaks. */
function withdrawCheck(b: Battle): void {
  if (b.ended) return;
  if (sideValue(b, 'red') < WITHDRAW_AT * startValue(b, 'red')) end(b, true, 'withdrew');
  else if (sideValue(b, 'blue') < BREAK_AT * startValue(b, 'blue')) end(b, false, 'withdrew');
}

/**
 * End your turn: the enemy takes theirs (played by the AI), then the round closes (capture, the
 * defender's withdrawal and the round limit are checked there) and your next turn starts.
 */
export function endTurn(b: Battle): void {
  if (b.ended || b.turn !== 'blue') return;
  withdrawCheck(b);
  if (b.ended) return;
  b.turnIndex++;
  beginTurn(b, 'red');
  playSide(b, 'red');
  checkEnd(b);
  if (b.ended) return;
  if (b.map.mode === 'capture') {
    b.capture = holdingZone(b) ? b.capture + 1 : 0;
    if (b.capture > 0) b.events.push({ type: 'capture', rounds: b.capture });
    if (b.capture >= CAPTURE_ROUNDS) return end(b, true, 'captured');
  }
  withdrawCheck(b);
  if (b.ended) return;
  if (b.round >= ROUND_LIMIT) return end(b, false, 'time');
  b.round++;
  b.turnIndex++;
  beginTurn(b, 'blue');
  checkEnd(b);
}

/** Let the AI play your turn for you, then end it. */
export function autoTurn(b: Battle): void {
  if (b.ended || b.turn !== 'blue') return;
  playSide(b, 'blue');
  endTurn(b);
}

/** Fight the whole battle on autopilot (tests, the soak, and quick resolve's honest alternative). */
export function autoBattle(b: Battle, limit = ROUND_LIMIT + 1): Battle {
  for (let i = 0; i < limit && !b.ended; i++) autoTurn(b);
  return b;
}

// --- Undo ------------------------------------------------------------------------------------------

/**
 * Which events leave a step safe to take back. Safe: a unit moving (and the walls its tracks flatten),
 * turning, embarking or dismounting, and their radio calls; overwatch, hunker and hold log nothing. Unsafe:
 * anything that rolled or showed the player something (fire, intercept, impact, casualties,
 * suppressed, destroyed, boom, mine, crater, and the player's own spotted and lost), or that did
 * more than move a unit (smoke, split, merge, treat, repair, ability, turn, capture, end). The
 * enemy's spotted and lost are let through in `undoable`: the player never sees them.
 */
export const UNDO_SAFE: Record<BattleEvent['type'], boolean> = {
  move: true,
  face: true,
  embark: true,
  dismount: true,
  terrain: true,
  radio: true,
  turn: false,
  fire: false,
  intercept: false,
  impact: false,
  casualties: false,
  suppressed: false,
  destroyed: false,
  boom: false,
  smoke: false,
  crater: false,
  split: false,
  merge: false,
  treat: false,
  repair: false,
  mine: false,
  spotted: false,
  lost: false,
  ability: false,
  capture: false,
  end: false,
};

const ghostsOf = (b: Battle) =>
  Object.keys(b.intel.blue)
    .sort()
    .map((id) => {
      const g = b.intel.blue[id]!;
      return `${id}:${g.type}@${g.x},${g.y}:${g.turn}:${g.now ? 1 : 0}`;
    })
    .join(';');

/**
 * Can the player take back the step from `before` to `after` (a snapshot taken before one action)?
 * Only when it drew no dice (the stream is unchanged), showed nothing (blue sees the same enemies,
 * its last known positions are as they were, no enemy was bumped into, no unsafe event was logged:
 * see UNDO_SAFE), and was a move, face, overwatch, hunker, hold, embark or dismount in the same turn.
 */
export function undoable(before: Battle, after: Battle): boolean {
  if (before.ended || after.ended || before.turn !== 'blue' || after.turn !== 'blue' || before.turnIndex !== after.turnIndex) return false;
  if (after.stream !== before.stream || after.events.length < before.events.length) return false;
  // The enemy spotting or losing one of ours shows nothing to the player (the film never plays red's
  // sightings) and the snapshot puts red's picture back too, so it does not block the undo: if it did,
  // a greyed Undo would tell the player that someone unseen had seen the move.
  const hiddenSighting = (e: BattleEvent) => (e.type === 'spotted' || e.type === 'lost') && e.side === 'red';
  if (after.events.slice(before.events.length).some((e) => !UNDO_SAFE[e.type] && !hiddenSighting(e))) return false;
  const seen = (b: Battle) => [...visibleTo(b, 'blue')].sort().join();
  if (seen(after) !== seen(before) || ghostsOf(after) !== ghostsOf(before)) return false;
  // A hidden enemy walked into is revealed (the move stops short), even out of sight.
  const revealed = (b: Battle) => b.units.filter((u) => u.side === 'red').map((u) => `${u.id}:${u.revealed}`).join();
  return revealed(after) === revealed(before);
}

/** Pull back: the battle is lost, the units keep what they have left. */
export function retreat(b: Battle): void {
  end(b, false, 'retreat');
}

export function arenaResult(b: Battle): ArenaResult {
  const won = b.ended === 'won';
  const kept: Record<string, number> = {};
  const formations = [...new Set(b.units.map((u) => u.formation))].sort();
  for (const f of formations) {
    const units = b.units.filter((u) => u.formation === f);
    const sideWon = units[0]!.side === 'blue' ? won : !won;
    const start = units.reduce((s, u) => s + u.startValue, 0);
    const now = units.reduce((s, u) => s + unitValue(u, sideWon), 0);
    const anyLeft = units.some((u) => u.alive && unitValue(u) > 0);
    kept[f] = start > 0 ? Math.max(anyLeft ? 1 : 0, Math.min(1000, Math.round((now / start) * 1000))) : 0;
  }
  const lostShare = 1 - sideValue(b, 'blue') / Math.max(1, startValue(b, 'blue'));
  const stars = (won ? 1 + (lostShare < 0.1 ? 1 : 0) + (b.round <= 9 || lostShare < 0.2 ? 1 : 0) : 0) as ArenaResult['stars'];
  return { won, kept, rounds: b.round, stars, stats: { blue: { ...b.stats.blue }, red: { ...b.stats.red } } };
}

export type { FireInfo };
