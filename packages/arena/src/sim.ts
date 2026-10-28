import type { UnitClass } from '@brink/contracts';
import { buildLevel, CRATE, idx, inside, isSolid, OPEN, TREE, walkable, WALL, type Level, type LevelSetup, type Point } from './level';
import { mulberry32 } from './rng';
import { ABILITIES, ARENA_H, ARENA_W, CAPTURE_TIME, CLASSES, damageFactor, RANKS, TIME_LIMIT, type AbilityId, type ClassStats, type WeaponKind } from './rules';

// The arena: a real-time fight on one hex. Deterministic for a seed and a sequence of inputs, so
// it can be tested headless; the web app draws it and feeds it touches.

export type Side = 'blue' | 'red';

export interface UnitSpec {
  id: string;
  cls: UnitClass;
  /** 0..1000, as on the war map. */
  strength: number;
  name: string;
  color: string;
  /** 0 Recruit .. 3 Ace. */
  rank: number;
}

export interface ArenaSetup extends LevelSetup {
  /** The player's side: they fight their way in from the bottom edge. */
  attackers: UnitSpec[];
  defenders: UnitSpec[];
  /** Enemy skill, 0 (raw) to 1 (sharp). */
  skill: number;
  abilities: AbilityId[];
}

export interface Unit {
  id: string;
  side: Side;
  cls: UnitClass;
  name: string;
  color: string;
  rank: number;
  x: number;
  y: number;
  /** Hull heading, radians; 0 faces +x, the attackers start facing up (-y). */
  angle: number;
  /** Turret or weapon heading. */
  aim: number;
  hp: number;
  maxHp: number;
  startHp: number;
  cooldown: number;
  /** Seconds between shots for this unit (rank-adjusted). */
  reload: number;
  /** Shots left in the current burst, and the time to the next one. */
  burst: number;
  burstT: number;
  alive: boolean;
  /** Drone dives left. */
  ammo: number;
  /** Guided shots left (ability). */
  homing: number;
  /** Seconds since last hit, for the flash. */
  hitT: number;
  /** AI bookkeeping. */
  thinkT: number;
  targetId: string | null;
  goal: Point | null;
  seenT: number;
  moving: boolean;
}

export interface Shot {
  id: number;
  kind: WeaponKind;
  side: Side;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  bounces: number;
  /** A bounced shell can hit anyone, its own tank included. */
  armed: boolean;
  ttl: number;
  homing: boolean;
  /** Fired by an aircraft: flies over trees. */
  high: boolean;
  /** Artillery and drone dives travel from (x0, y0) to (x1, y1) over `dur` seconds. */
  arc: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; splash: number } | null;
}

export type ArenaEvent =
  | { type: 'fire'; unit: string; kind: WeaponKind; x: number; y: number; angle: number }
  | { type: 'hit'; unit: string; x: number; y: number; damage: number }
  | { type: 'boom'; x: number; y: number; size: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'spark'; x: number; y: number }
  | { type: 'destroyed'; unit: string; cls: UnitClass; side: Side; x: number; y: number }
  | { type: 'break'; x: number; y: number }
  | { type: 'switch'; unit: string }
  | { type: 'ability'; id: AbilityId; x: number; y: number }
  | { type: 'end'; won: boolean };

export interface ArenaInput {
  /** Drive direction for the unit you control, length up to 1. */
  move?: Point | null;
  /** A tap: fire at this point. */
  fire?: Point | null;
  /** Take control of one of your units. */
  control?: string | null;
  ability?: { id: AbilityId; x?: number; y?: number } | null;
  retreat?: boolean;
  /** Let the AI drive the player's unit too (tests, and the autopilot). */
  auto?: boolean;
}

export interface Arena {
  level: Level;
  units: Unit[];
  shots: Shot[];
  mines: { x: number; y: number }[];
  bombs: { x: number; y: number; t: number }[];
  time: number;
  controlled: string | null;
  /** Seconds the attackers have held the zone. */
  capture: number;
  ended: 'won' | 'lost' | null;
  skill: number;
  abilities: Partial<Record<AbilityId, 'ready' | 'used'>>;
  sweepUntil: number;
  events: ArenaEvent[];
  stats: { shots: number; hits: number; kills: number; lost: number; bounceKills: number };
  rng: () => number;
  nextShot: number;
}

export interface ArenaResult {
  won: boolean;
  /** Strength each unit kept, permille of what it had when the battle began. */
  kept: Record<string, number>;
  time: number;
  stars: 0 | 1 | 2 | 3;
  stats: Arena['stats'];
}

const TAU = Math.PI * 2;
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

export function stats(cls: UnitClass): ClassStats {
  return CLASSES[cls];
}

export function createArena(setup: ArenaSetup): Arena {
  const level = buildLevel(setup);
  const units: Unit[] = [];
  const make = (s: UnitSpec, side: Side, at: Point, extra: number): Unit => {
    const c = CLASSES[s.cls];
    const rank = RANKS[Math.max(0, Math.min(3, s.rank))]!;
    const maxHp = Math.round(c.hp * rank.hp * extra);
    const hp = Math.max(1, Math.round((maxHp * Math.max(1, Math.min(1000, s.strength))) / 1000));
    return {
      id: s.id,
      side,
      cls: s.cls,
      name: s.name,
      color: s.color,
      rank: s.rank,
      x: at.x,
      y: at.y,
      angle: side === 'blue' ? -Math.PI / 2 : Math.PI / 2,
      aim: side === 'blue' ? -Math.PI / 2 : Math.PI / 2,
      hp,
      maxHp,
      startHp: hp,
      cooldown: 0.6 + units.length * 0.15,
      reload: c.weapon.reload * rank.reload,
      burst: 0,
      burstT: 0,
      alive: true,
      ammo: s.cls === 'drone' ? 3 : 0,
      homing: 0,
      hitT: 9,
      thinkT: units.length * 0.07,
      targetId: null,
      goal: null,
      seenT: 0,
      moving: false,
    };
  };
  const armor = setup.abilities.includes('armor');
  setup.attackers.forEach((s, i) => {
    const at = level.blueSpawn[i % level.blueSpawn.length]!;
    units.push(make(s, 'blue', { x: at.x, y: at.y - Math.floor(i / level.blueSpawn.length) }, armor && CLASSES[s.cls].heavy ? 1.25 : 1));
  });
  setup.defenders.forEach((s, i) => {
    const at = level.redSpawn[i % Math.max(1, level.redSpawn.length)] ?? { x: 7.5, y: 3.5 };
    units.push(make(s, 'red', { x: at.x, y: at.y + Math.floor(i / Math.max(1, level.redSpawn.length)) }, 1));
  });
  const abilities: Arena['abilities'] = {};
  for (const a of setup.abilities) if (!ABILITIES[a].passive) abilities[a] = 'ready';
  return {
    level,
    units,
    shots: [],
    mines: [],
    bombs: [],
    time: 0,
    controlled: units.find((u) => u.side === 'blue')?.id ?? null,
    capture: 0,
    ended: null,
    skill: Math.max(0, Math.min(1, setup.skill)),
    abilities,
    sweepUntil: -1,
    events: [],
    stats: { shots: 0, hits: 0, kills: 0, lost: 0, bounceKills: 0 },
    rng: mulberry32(setup.seed),
    nextShot: 1,
  };
}

// --- Geometry -----------------------------------------------------------------------------------

function passable(level: Level, x: number, y: number, u: Unit): boolean {
  const c = CLASSES[u.cls];
  if (c.flying) return inside(x, y);
  return walkable(level, x, y, c.foot);
}

/** Would a unit of radius `r` at (x, y) overlap ground it cannot stand on? */
function blockedAt(level: Level, u: Unit, x: number, y: number): boolean {
  const r = CLASSES[u.cls].radius;
  if (x - r < 0 || y - r < 0 || x + r > ARENA_W || y + r > ARENA_H) return true;
  for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
      if (passable(level, cx, cy, u)) continue;
      const nx = Math.max(cx, Math.min(x, cx + 1));
      const ny = Math.max(cy, Math.min(y, cy + 1));
      if ((nx - x) ** 2 + (ny - y) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** Clear line of sight (and of fire) between two points; trees block unless `overTrees`. */
export function lineClear(level: Level, x0: number, y0: number, x1: number, y1: number, overTrees = false): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (isSolid(level, cx, cy)) return false;
    if (!overTrees && inside(cx, cy) && level.cells[idx(cx, cy)] === TREE) return false;
  }
  return true;
}

function moveUnit(a: Arena, u: Unit, dx: number, dy: number): boolean {
  const lv = a.level;
  if (!blockedAt(lv, u, u.x + dx, u.y + dy)) {
    u.x += dx;
    u.y += dy;
    return true;
  }
  let moved = false;
  if (!blockedAt(lv, u, u.x + dx, u.y)) {
    u.x += dx;
    moved = true;
  } else if (!blockedAt(lv, u, u.x, u.y + dy)) {
    u.y += dy;
    moved = true;
  }
  return moved;
}

function drive(a: Arena, u: Unit, dir: Point, dt: number): void {
  const c = CLASSES[u.cls];
  const mag = Math.min(1, Math.hypot(dir.x, dir.y));
  if (mag < 0.12) {
    u.moving = false;
    return;
  }
  const want = Math.atan2(dir.y, dir.x);
  const diff = wrap(want - u.angle);
  const step = c.turn * dt;
  u.angle = wrap(u.angle + Math.max(-step, Math.min(step, diff)));
  // Vehicles slow while they swing round; troops and aircraft just go.
  const pace = c.foot || c.flying ? 1 : 0.35 + 0.65 * Math.max(0, Math.cos(diff));
  const v = c.speed * mag * pace * dt;
  u.moving = moveUnit(a, u, Math.cos(want) * v, Math.sin(want) * v);
}

// --- Fire ---------------------------------------------------------------------------------------

function spawnShot(a: Arena, u: Unit, angle: number, kind: WeaponKind, homing: boolean): void {
  const c = CLASSES[u.cls];
  const wpn = c.weapon;
  const off = c.radius + 0.12;
  a.shots.push({
    id: a.nextShot++,
    kind,
    side: u.side,
    owner: u.id,
    x: u.x + Math.cos(angle) * off,
    y: u.y + Math.sin(angle) * off,
    vx: Math.cos(angle) * wpn.speed,
    vy: Math.sin(angle) * wpn.speed,
    damage: wpn.damage,
    bounces: wpn.bounces,
    armed: false,
    ttl: (wpn.range * 1.6) / Math.max(1, wpn.speed),
    homing,
    high: c.flying,
    arc: null,
  });
}

function spawnArc(a: Arena, u: Unit, tx: number, ty: number): void {
  const c = CLASSES[u.cls];
  const d = Math.hypot(tx - u.x, ty - u.y);
  const kind = c.weapon.kind;
  const dur = kind === 'lob' ? 0.9 + d * 0.04 : d / c.weapon.speed;
  a.shots.push({
    id: a.nextShot++,
    kind,
    side: u.side,
    owner: u.id,
    x: u.x,
    y: u.y,
    vx: 0,
    vy: 0,
    damage: c.weapon.damage,
    bounces: 0,
    armed: true,
    ttl: dur + 1,
    homing: false,
    high: true,
    arc: { x0: u.x, y0: u.y, x1: tx, y1: ty, t: 0, dur, splash: c.weapon.splash },
  });
}

/** Pull the trigger aimed at (tx, ty). Returns false while reloading or out of range. */
function fire(a: Arena, u: Unit, tx: number, ty: number): boolean {
  const c = CLASSES[u.cls];
  u.aim = Math.atan2(ty - u.y, tx - u.x);
  if (u.cooldown > 0 || u.burst > 0) return false;
  const wpn = c.weapon;
  if (wpn.kind === 'lob' || wpn.kind === 'dive') {
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (wpn.kind === 'lob' && d < 2.5) return false;
    if (wpn.kind === 'dive' && u.ammo <= 0) return false;
    const k = Math.min(1, wpn.range / Math.max(0.01, d));
    spawnArc(a, u, u.x + (tx - u.x) * k, u.y + (ty - u.y) * k);
    if (wpn.kind === 'dive') u.ammo -= 1;
    u.cooldown = wpn.kind === 'dive' ? 2.2 : u.reload;
  } else if (wpn.gap > 0) {
    u.burst = wpn.count;
    u.burstT = 0;
    u.cooldown = u.reload;
  } else {
    const homing = u.homing > 0;
    if (homing) u.homing -= 1;
    for (let i = 0; i < wpn.count; i++) spawnShot(a, u, u.aim + (i - (wpn.count - 1) / 2) * wpn.spread, wpn.kind, homing);
    u.cooldown = u.reload;
  }
  a.stats.shots += u.side === 'blue' ? 1 : 0;
  a.events.push({ type: 'fire', unit: u.id, kind: wpn.kind, x: u.x, y: u.y, angle: u.aim });
  return true;
}

function damage(a: Arena, u: Unit, amount: number, kind: WeaponKind, by: Shot | null): void {
  if (!u.alive || amount <= 0) return;
  const c = CLASSES[u.cls];
  let dmg = amount * damageFactor(kind, c);
  if (c.foot && a.level.cells[idx(Math.floor(u.x), Math.floor(u.y))] === TREE) dmg *= 0.5;
  dmg = Math.round(dmg);
  u.hp -= dmg;
  u.hitT = 0;
  if (by?.side === 'blue' && u.side === 'red') a.stats.hits += 1;
  a.events.push({ type: 'hit', unit: u.id, x: u.x, y: u.y, damage: dmg });
  if (u.hp <= 0) {
    u.hp = 0;
    u.alive = false;
    if (u.side === 'red') {
      a.stats.kills += 1;
      if (by?.armed && by.kind === 'shell') a.stats.bounceKills += 1;
    } else a.stats.lost += 1;
    a.events.push({ type: 'destroyed', unit: u.id, cls: u.cls, side: u.side, x: u.x, y: u.y });
    a.events.push({ type: 'boom', x: u.x, y: u.y, size: CLASSES[u.cls].heavy ? 1.6 : 1.1 });
  }
}

function explode(a: Arena, x: number, y: number, radius: number, amount: number, kind: WeaponKind, air: boolean, by: Shot | null): void {
  a.events.push({ type: 'boom', x, y, size: radius });
  for (const u of a.units) {
    if (!u.alive || (CLASSES[u.cls].flying && !air)) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > radius + CLASSES[u.cls].radius) continue;
    damage(a, u, amount * (1 - 0.6 * Math.min(1, d / radius)), kind, by);
  }
  for (let cy = Math.floor(y - radius); cy <= Math.floor(y + radius); cy++) {
    for (let cx = Math.floor(x - radius); cx <= Math.floor(x + radius); cx++) {
      if (!inside(cx, cy) || (cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > radius * radius) continue;
      const i = idx(cx, cy);
      const cell = a.level.cells[i];
      if (cell === CRATE || cell === TREE) breakCell(a, cx, cy);
    }
  }
}

function breakCell(a: Arena, cx: number, cy: number): void {
  const i = idx(cx, cy);
  a.level.cells[i] = OPEN;
  a.level.style[i] = null;
  a.level.height[i] = 0;
  a.level.hp[i] = 0;
  a.events.push({ type: 'break', x: cx + 0.5, y: cy + 0.5 });
}

// --- Shots --------------------------------------------------------------------------------------

function stepShots(a: Arena, dt: number): void {
  const lv = a.level;
  for (const s of a.shots) {
    if (s.ttl <= 0) continue;
    s.ttl -= dt;
    if (s.arc) {
      s.arc.t += dt;
      const p = Math.min(1, s.arc.t / s.arc.dur);
      s.x = s.arc.x0 + (s.arc.x1 - s.arc.x0) * p;
      s.y = s.arc.y0 + (s.arc.y1 - s.arc.y0) * p;
      if (p >= 1) {
        explode(a, s.x, s.y, s.arc.splash, s.damage, s.kind, s.kind === 'dive', s);
        s.ttl = 0;
      }
      continue;
    }
    if (s.homing) {
      const t = nearestEnemy(a, s.side, s.x, s.y, false);
      if (t) {
        const want = Math.atan2(t.y - s.y, t.x - s.x);
        const cur = Math.atan2(s.vy, s.vx);
        const turn = Math.max(-4 * dt, Math.min(4 * dt, wrap(want - cur)));
        const sp = Math.hypot(s.vx, s.vy);
        s.vx = Math.cos(cur + turn) * sp;
        s.vy = Math.sin(cur + turn) * sp;
      }
    }
    const ox = s.x;
    const oy = s.y;
    const nx = s.x + s.vx * dt;
    const ny = s.y + s.vy * dt;
    const cx = Math.floor(nx);
    const cy = Math.floor(ny);
    const out = nx < 0 || ny < 0 || nx >= ARENA_W || ny >= ARENA_H;
    const cell = out ? WALL : lv.cells[idx(cx, cy)];
    const hard = out || cell === WALL || cell === CRATE;
    if (hard || (cell === TREE && !s.high)) {
      if (cell === CRATE && !out) {
        breakCell(a, cx, cy);
        s.ttl = 0;
        continue;
      }
      if (cell === TREE) {
        const i = idx(cx, cy);
        lv.hp[i] = (lv.hp[i] ?? 1) - 1;
        if (lv.hp[i]! <= 0) breakCell(a, cx, cy);
        a.events.push({ type: 'spark', x: nx, y: ny });
        s.ttl = 0;
        continue;
      }
      if (s.bounces > 0) {
        // Reflect off whichever face was crossed.
        const blockX = out ? nx < 0 || nx >= ARENA_W : isSolid(lv, cx, Math.floor(oy));
        const blockY = out ? ny < 0 || ny >= ARENA_H : isSolid(lv, Math.floor(ox), cy);
        if (blockX || !blockY) s.vx = -s.vx;
        if (blockY || !blockX) s.vy = -s.vy;
        s.bounces -= 1;
        s.armed = true;
        s.ttl = Math.max(s.ttl, 1.2);
        a.events.push({ type: 'bounce', x: ox, y: oy });
        continue;
      }
      if (s.kind === 'rocket' || s.kind === 'shell') explode(a, ox, oy, 0.55, s.damage * 0.4, s.kind, false, s);
      else a.events.push({ type: 'spark', x: ox, y: oy });
      s.ttl = 0;
      continue;
    }
    s.x = nx;
    s.y = ny;
    for (const u of a.units) {
      if (!u.alive) continue;
      const c = CLASSES[u.cls];
      if (c.flying && (s.kind === 'shell' || s.kind === 'lob')) continue;
      if (u.id === s.owner && !s.armed) continue;
      if (u.side === s.side && !(s.kind === 'shell' && s.armed)) continue;
      if ((u.x - s.x) ** 2 + (u.y - s.y) ** 2 > (c.radius + 0.12) ** 2) continue;
      if (s.kind === 'rocket') explode(a, s.x, s.y, 0.6, 0, s.kind, false, s);
      damage(a, u, s.damage, s.kind, s);
      s.ttl = 0;
      break;
    }
  }
  a.shots = a.shots.filter((s) => s.ttl > 0);
}

// --- AI -----------------------------------------------------------------------------------------

function nearestEnemy(a: Arena, side: Side, x: number, y: number, needSight: boolean): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of a.units) {
    if (!u.alive || u.side === side) continue;
    const d = Math.hypot(u.x - x, u.y - y) + (needSight && !lineClear(a.level, x, y, u.x, u.y, true) ? 6 : 0);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** Breadth-first distance to `goal` over cells this unit can enter (8-way, no corner cutting). */
function flowField(a: Arena, u: Unit, goal: Point): Int16Array {
  const lv = a.level;
  const dist = new Int16Array(ARENA_W * ARENA_H).fill(-1);
  const gx = Math.max(0, Math.min(ARENA_W - 1, Math.floor(goal.x)));
  const gy = Math.max(0, Math.min(ARENA_H - 1, Math.floor(goal.y)));
  const q: number[] = [idx(gx, gy)];
  dist[q[0]!] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const x = i % ARENA_W;
    const y = (i - x) / ARENA_W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny) || dist[idx(nx, ny)]! >= 0 || !passable(lv, nx, ny, u)) continue;
        if (dx && dy && (!passable(lv, x + dx, y, u) || !passable(lv, x, y + dy, u))) continue;
        dist[idx(nx, ny)] = dist[i]! + (dx && dy ? 3 : 2);
        q.push(idx(nx, ny));
      }
  }
  return dist;
}

function steerTo(a: Arena, u: Unit, goal: Point): Point {
  const field = flowField(a, u, goal);
  const x = Math.floor(u.x);
  const y = Math.floor(u.y);
  let best: Point | null = null;
  let bestD = field[idx(x, y)]! >= 0 ? field[idx(x, y)]! : 9999;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!inside(x + dx, y + dy)) continue;
      const d = field[idx(x + dx, y + dy)]!;
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = { x: x + dx + 0.5, y: y + dy + 0.5 };
      }
    }
  if (!best) return { x: goal.x - u.x, y: goal.y - u.y };
  return { x: best.x - u.x, y: best.y - u.y };
}

function think(a: Arena, u: Unit, dt: number): void {
  const c = CLASSES[u.cls];
  const skill = u.side === 'red' ? a.skill : a.time < a.sweepUntil ? 1 : 0.7;
  const target = nearestEnemy(a, u.side, u.x, u.y, true);
  if (!target) {
    u.moving = false;
    return;
  }
  const d = Math.hypot(target.x - u.x, target.y - u.y);
  const sight = c.weapon.kind === 'lob' || c.weapon.kind === 'dive' || lineClear(a.level, u.x, u.y, target.x, target.y, c.flying);
  u.seenT = sight ? u.seenT + dt : 0;
  const prefer = c.weapon.kind === 'lob' ? 9 : c.weapon.kind === 'dive' ? 7 : c.weapon.range * 0.7;

  // Where to be.
  u.thinkT -= dt;
  if (u.thinkT <= 0 || !u.goal) {
    u.thinkT = 0.45 + a.rng() * 0.3;
    const zone = a.level.zone;
    if (u.side === 'red' && zone && !c.flying && Math.hypot(u.x - zone.x, u.y - zone.y) > zone.r + 2.5) u.goal = { x: zone.x, y: zone.y };
    else if (u.side === 'blue' && zone && !c.flying && d > prefer && c.weapon.kind !== 'lob') u.goal = { x: zone.x, y: zone.y };
    else if (d > prefer || !sight) u.goal = { x: target.x, y: target.y };
    else u.goal = null;
  }
  if (u.goal) drive(a, u, steerTo(a, u, u.goal), dt);
  else {
    u.moving = false;
    const face = Math.atan2(target.y - u.y, target.x - u.x);
    u.angle = wrap(u.angle + Math.max(-c.turn * dt, Math.min(c.turn * dt, wrap(face - u.angle))));
  }

  // When to shoot: in range, in sight, and after a reaction delay that shrinks with skill.
  const reaction = 0.9 - skill * 0.7;
  if (d > c.weapon.range + 0.5 || (!sight && c.weapon.kind !== 'lob') || u.seenT < reaction) return;
  if (c.weapon.kind === 'dive' && d > 6) return;
  const err = (1 - skill) * 0.28 + 0.02;
  const lead = c.weapon.speed > 0 ? d / c.weapon.speed : 0;
  const px = target.x + (target.moving ? Math.cos(target.angle) * CLASSES[target.cls].speed * lead * skill : 0);
  const py = target.y + (target.moving ? Math.sin(target.angle) * CLASSES[target.cls].speed * lead * skill : 0);
  const ang = Math.atan2(py - u.y, px - u.x) + (a.rng() - 0.5) * 2 * err;
  const r = Math.hypot(px - u.x, py - u.y) + (c.weapon.kind === 'lob' ? (a.rng() - 0.5) * 3 * (1 - skill) : 0);
  fire(a, u, u.x + Math.cos(ang) * r, u.y + Math.sin(ang) * r);
}

// --- Abilities ----------------------------------------------------------------------------------

function useAbility(a: Arena, id: AbilityId, x: number | undefined, y: number | undefined): void {
  if (a.abilities[id] !== 'ready') return;
  const u = a.units.find((v) => v.id === a.controlled && v.alive);
  if (id === 'airstrike') {
    if (x === undefined || y === undefined) return;
    const ang = a.rng() * Math.PI;
    for (let i = -1; i <= 1; i++) a.bombs.push({ x: x + Math.cos(ang) * i * 1.3, y: y + Math.sin(ang) * i * 1.3, t: a.time + 1.3 + (i + 1) * 0.18 });
  } else if (!u) return;
  else if (id === 'repair') u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.35));
  else if (id === 'sweep') a.sweepUntil = a.time + 10;
  else if (id === 'missiles') u.homing = 3;
  else if (id === 'mines') {
    for (let i = 1; i <= 3; i++) a.mines.push({ x: u.x - Math.cos(u.angle) * (0.6 + i * 0.55), y: u.y - Math.sin(u.angle) * (0.6 + i * 0.55) });
  }
  a.abilities[id] = 'used';
  a.events.push({ type: 'ability', id, x: x ?? u?.x ?? 0, y: y ?? u?.y ?? 0 });
}

// --- Step ---------------------------------------------------------------------------------------

/** Advance the battle by `dt` seconds with the player's input. */
export function stepArena(a: Arena, dt: number, input: ArenaInput = {}): void {
  a.events = [];
  if (a.ended) return;
  if (input.retreat) {
    end(a, false);
    return;
  }
  if (input.control) {
    const u = a.units.find((v) => v.id === input.control && v.side === 'blue' && v.alive);
    if (u && u.id !== a.controlled) {
      a.controlled = u.id;
      a.events.push({ type: 'switch', unit: u.id });
    }
  }
  if (input.ability) useAbility(a, input.ability.id, input.ability.x, input.ability.y);
  let left = Math.min(dt, 0.1);
  let first = true;
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 60);
    left -= h;
    tick(a, h, first ? input : { move: input.move, auto: input.auto });
    first = false;
    if (a.ended) break;
  }
}

function tick(a: Arena, dt: number, input: ArenaInput): void {
  a.time += dt;
  const me = a.units.find((u) => u.id === a.controlled && u.alive) ?? null;
  for (const u of a.units) {
    if (!u.alive) continue;
    u.cooldown = Math.max(0, u.cooldown - dt);
    u.hitT += dt;
    // Bursts fire their rounds a beat apart.
    if (u.burst > 0) {
      u.burstT -= dt;
      if (u.burstT <= 0) {
        spawnShot(a, u, u.aim + (a.rng() - 0.5) * 0.05, CLASSES[u.cls].weapon.kind, false);
        u.burst -= 1;
        u.burstT = CLASSES[u.cls].weapon.gap;
      }
    }
    if (u === me && !input.auto) {
      if (input.move) drive(a, u, input.move, dt);
      else u.moving = false;
      if (input.fire) fire(a, u, input.fire.x, input.fire.y);
    } else think(a, u, dt);
  }
  separate(a);
  stepShots(a, dt);
  // Mines and bombs.
  for (const m of a.mines) {
    const hit = a.units.find((u) => u.alive && u.side === 'red' && !CLASSES[u.cls].flying && Math.hypot(u.x - m.x, u.y - m.y) < 0.55);
    if (hit) {
      explode(a, m.x, m.y, 1, 55, 'shell', false, null);
      m.x = -99;
    }
  }
  a.mines = a.mines.filter((m) => m.x > -50);
  for (const b of a.bombs) {
    if (a.time >= b.t) {
      explode(a, b.x, b.y, 1.5, 62, 'lob', false, null);
      b.t = Infinity;
    }
  }
  a.bombs = a.bombs.filter((b) => b.t !== Infinity);
  // The player's unit fell: hand control to the next one.
  if (me && !me.alive) {
    const next = a.units.find((u) => u.side === 'blue' && u.alive);
    a.controlled = next?.id ?? null;
    if (next) a.events.push({ type: 'switch', unit: next.id });
  }
  judge(a, dt);
}

/** Ground units do not stack on top of each other. */
function separate(a: Arena): void {
  const live = a.units.filter((u) => u.alive);
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const p = live[i]!;
      const q = live[j]!;
      if (CLASSES[p.cls].flying !== CLASSES[q.cls].flying) continue;
      const min = CLASSES[p.cls].radius + CLASSES[q.cls].radius;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) / 2;
      moveUnit(a, p, (-dx / d) * push, (-dy / d) * push);
      moveUnit(a, q, (dx / d) * push, (dy / d) * push);
    }
}

function end(a: Arena, won: boolean): void {
  a.ended = won ? 'won' : 'lost';
  a.events.push({ type: 'end', won });
}

function judge(a: Arena, dt: number): void {
  const blue = a.units.filter((u) => u.side === 'blue' && u.alive);
  const red = a.units.filter((u) => u.side === 'red' && u.alive);
  if (blue.length === 0) return end(a, false);
  if (red.length === 0) return end(a, true);
  const zone = a.level.zone;
  if (zone) {
    const inZone = (u: Unit) => !CLASSES[u.cls].flying && Math.hypot(u.x - zone.x, u.y - zone.y) <= zone.r;
    const ours = blue.some(inZone);
    const theirs = red.some(inZone);
    if (ours && !theirs) a.capture += dt;
    else if (!ours) a.capture = Math.max(0, a.capture - dt * 0.5);
    if (a.capture >= CAPTURE_TIME) return end(a, true);
  }
  if (a.time >= TIME_LIMIT) end(a, false);
}

/** What the battle did, for the war map: who won and what each unit kept. */
export function arenaResult(a: Arena): ArenaResult {
  const kept: Record<string, number> = {};
  for (const u of a.units) kept[u.id] = u.alive ? Math.max(1, Math.min(1000, Math.round((1000 * u.hp) / Math.max(1, u.startHp)))) : 0;
  const won = a.ended === 'won';
  const blue = a.units.filter((u) => u.side === 'blue');
  const par = a.level.mode === 'capture' ? 75 : 60;
  const avg = blue.reduce((s, u) => s + kept[u.id]!, 0) / Math.max(1, blue.length);
  const stars = (won ? 1 + (blue.every((u) => u.alive) ? 1 : 0) + (a.time <= par || avg >= 850 ? 1 : 0) : 0) as ArenaResult['stars'];
  return { won, kept, time: Math.round(a.time), stars, stats: { ...a.stats } };
}

