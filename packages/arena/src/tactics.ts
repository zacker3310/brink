import type { UnitClass } from '@brink/contracts';
import { buildLevel, CRATE, idx, inside, OPEN, TREE, walkable, WALL, type Level, type LevelSetup, type Point } from './level';
import { draw, mulberry32 } from './rng';
import { ABILITIES, ARENA_H, ARENA_W, CAPTURE_ROUNDS, CLASSES, COVER, damageFactor, OVERWATCH_AIM, RANKS, ROUND_LIMIT, type AbilityId, type WeaponKind } from './rules';

// A tactical battle on one hex, fought in turns. On your turn each unit may move, then act: fire
// (with the hit chance shown before you commit), dig in, or set overwatch. Then the enemy moves.
// Everything is a pure function of the setup and the actions taken, so a battle replays exactly
// from its seed and can be tested headless; the web app animates the event log.

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
  /** Enemy skill, 0 (raw) to 1 (sharp): how well it reads the field and how straight it shoots. */
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
  /** Cell. */
  x: number;
  y: number;
  /** Hull heading, radians; 0 faces +x, the attackers start facing up (-y). */
  facing: number;
  /** Turret or weapon heading. */
  aim: number;
  hp: number;
  maxHp: number;
  startHp: number;
  moved: boolean;
  acted: boolean;
  /** Dug in: harder to hit until its side's next turn. */
  dug: boolean;
  /** Fires at the first enemy that moves in its sights before its side's next turn. */
  overwatch: boolean;
  alive: boolean;
}

export type ArenaEvent =
  | { type: 'turn'; side: Side; round: number }
  | { type: 'move'; unit: string; path: Point[] }
  | { type: 'fire'; unit: string; kind: WeaponKind; from: Point; to: Point; target: string | null; hit: boolean; chance: number; overwatch: boolean }
  | { type: 'hit'; unit: string; damage: number; x: number; y: number }
  | { type: 'miss'; unit: string; x: number; y: number }
  | { type: 'boom'; x: number; y: number; size: number }
  | { type: 'destroyed'; unit: string; cls: UnitClass; side: Side; x: number; y: number }
  | { type: 'break'; x: number; y: number }
  | { type: 'mine'; x: number; y: number }
  | { type: 'dig'; unit: string }
  | { type: 'overwatch'; unit: string }
  | { type: 'ability'; id: AbilityId; x: number; y: number }
  | { type: 'capture'; rounds: number }
  | { type: 'end'; won: boolean };

export type Action =
  | { type: 'move'; unit: string; to: Point }
  /** Direct fire at a unit, or a dive. */
  | { type: 'fire'; unit: string; target: string }
  /** Artillery: shell a cell. */
  | { type: 'strike'; unit: string; at: Point }
  | { type: 'dig'; unit: string }
  | { type: 'overwatch'; unit: string }
  | { type: 'ability'; id: AbilityId; unit?: string; at?: Point };

export interface Arena {
  level: Level;
  units: Unit[];
  /** 1-based. A round is your turn then theirs. */
  round: number;
  turn: Side;
  ended: 'won' | 'lost' | null;
  skill: number;
  abilities: Partial<Record<AbilityId, 'ready' | 'used'>>;
  /** Your shots are surer through this round. */
  sweepUntil: number;
  /** Guided shots left. */
  missiles: number;
  mines: Point[];
  /** Rounds in a row the attackers have ended holding the zone. */
  capture: number;
  /** Append-only: the renderer plays it from where it last read. */
  events: ArenaEvent[];
  stats: { shots: number; hits: number; kills: number; lost: number };
  /** The seeded stream's state: the whole arena is plain JSON, so it saves and resumes exactly. */
  stream: number;
}

export interface ArenaResult {
  won: boolean;
  /** Strength each unit kept, permille of what it had when the battle began. */
  kept: Record<string, number>;
  rounds: number;
  stars: 0 | 1 | 2 | 3;
  stats: Arena['stats'];
}

export interface FireInfo {
  /** Percent, 5..95. */
  chance: number;
  /** Damage on a hit, before the roll (which is 85% to 115%). */
  damage: number;
  cover: 'none' | 'half' | 'full' | 'trees';
  /** The reasons, for the shot card: label and points. */
  parts: [string, number][];
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

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clampChance = (n: number) => Math.max(5, Math.min(95, Math.round(n)));
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

export function createArena(setup: ArenaSetup): Arena {
  const level = buildLevel(setup);
  const units: Unit[] = [];
  const taken = new Set<number>();
  const place = (want: Point, side: Side): Point => {
    // The nearest free cell the unit can stand on, searching outward from where it wants to be.
    const ok = (x: number, y: number) => inside(x, y) && walkable(level, x, y, true) && level.cells[idx(x, y)] !== TREE && !taken.has(idx(x, y));
    for (let r = 0; r < 8; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.floor(want.x) + dx;
          const y = Math.floor(want.y) + (side === 'blue' ? Math.abs(dy) : -Math.abs(dy));
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ok(x, y)) return { x, y };
        }
    return { x: Math.floor(want.x), y: Math.floor(want.y) };
  };
  const make = (s: UnitSpec, side: Side, at: Point, extra: number): Unit => {
    const c = CLASSES[s.cls];
    const rank = RANKS[Math.max(0, Math.min(3, s.rank))]!;
    const maxHp = Math.round(c.hp * rank.hp * extra);
    const hp = Math.max(1, Math.round((maxHp * Math.max(1, Math.min(1000, s.strength))) / 1000));
    const p = place(at, side);
    taken.add(idx(p.x, p.y));
    const facing = side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
    return { id: s.id, side, cls: s.cls, name: s.name, color: s.color, rank: s.rank, x: p.x, y: p.y, facing, aim: facing, hp, maxHp, startHp: hp, moved: false, acted: false, dug: false, overwatch: false, alive: true };
  };
  const armor = setup.abilities.includes('armor');
  setup.attackers.forEach((s, i) => {
    const at = level.blueSpawn[i % level.blueSpawn.length]!;
    units.push(make(s, 'blue', { x: at.x, y: at.y - Math.floor(i / level.blueSpawn.length) }, armor && CLASSES[s.cls].heavy ? 1.25 : 1));
  });
  setup.defenders.forEach((s, i) => {
    const at = level.redSpawn[i % Math.max(1, level.redSpawn.length)] ?? { x: 7.5, y: 3.5 };
    const u = make(s, 'red', { x: at.x, y: at.y + Math.floor(i / Math.max(1, level.redSpawn.length)) }, 1);
    // Defenders have had time to dig in.
    u.dug = !CLASSES[s.cls].flying;
    units.push(u);
  });
  const abilities: Arena['abilities'] = {};
  for (const a of setup.abilities) if (!ABILITIES[a].passive) abilities[a] = 'ready';
  return {
    level,
    units,
    round: 1,
    turn: 'blue',
    ended: null,
    skill: Math.max(0, Math.min(1, setup.skill)),
    abilities,
    sweepUntil: 0,
    missiles: 0,
    mines: [],
    capture: 0,
    events: [{ type: 'turn', side: 'blue', round: 1 }],
    stats: { shots: 0, hits: 0, kills: 0, lost: 0 },
    stream: setup.seed >>> 0,
  };
}

// --- Ground and sight ----------------------------------------------------------------------------

export function unitAt(a: Arena, x: number, y: number): Unit | undefined {
  return a.units.find((u) => u.alive && u.x === x && u.y === y);
}

/** Can a unit of this class stand in the cell (ignoring other units)? */
function standable(a: Arena, u: Unit, x: number, y: number): boolean {
  const c = CLASSES[u.cls];
  if (!inside(x, y)) return false;
  if (c.flying) return a.level.cells[idx(x, y)] !== WALL;
  return walkable(a.level, x, y, c.foot);
}

function passable(a: Arena, u: Unit, x: number, y: number): boolean {
  if (CLASSES[u.cls].flying) return inside(x, y);
  return standable(a, u, x, y);
}

export interface Reach {
  /** Cell index to movement spent, in half points (a straight step is 2, a diagonal 3). */
  cost: Map<number, number>;
  prev: Map<number, number>;
}

/** Every cell the unit can move to this turn (its own included), cheapest first. */
export function reachable(a: Arena, u: Unit): Reach {
  const budget = CLASSES[u.cls].move * 2;
  const start = idx(u.x, u.y);
  const cost = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  if (u.moved || u.acted) return { cost, prev };
  const open: number[] = [start];
  // Enemies block their own layer: aircraft fly over ground units, vehicles drive under aircraft.
  const flies = CLASSES[u.cls].flying;
  const blocked = new Set(a.units.filter((o) => o.alive && o.side !== u.side && CLASSES[o.cls].flying === flies).map((o) => idx(o.x, o.y)));
  const mined = flies || u.side === 'blue' ? new Set<number>() : new Set(a.mines.map((m) => idx(m.x, m.y)));
  while (open.length) {
    // Small grids: a linear scan for the cheapest open cell is plenty.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (cost.get(open[i]!)! < cost.get(open[bi]!)!) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (mined.has(cur) && cur !== start) continue;
    const cx = cur % ARENA_W;
    const cy = Math.floor(cur / ARENA_W);
    for (const [dx, dy] of DIRS) {
      const x = cx + dx;
      const y = cy + dy;
      if (!passable(a, u, x, y)) continue;
      const diag = dx !== 0 && dy !== 0;
      if (diag && !CLASSES[u.cls].flying && (!passable(a, u, cx + dx, cy) || !passable(a, u, cx, cy + dy))) continue;
      const i = idx(x, y);
      if (blocked.has(i)) continue;
      const c = cost.get(cur)! + (diag ? 3 : 2);
      if (c > budget || c >= (cost.get(i) ?? Infinity)) continue;
      cost.set(i, c);
      prev.set(i, cur);
      open.push(i);
    }
  }
  // Only cells it can stop in count: not on another unit, not inside a wall.
  for (const i of [...cost.keys()]) {
    if (i === start) continue;
    const x = i % ARENA_W;
    const y = Math.floor(i / ARENA_W);
    if (!standable(a, u, x, y) || unitAt(a, x, y)) cost.delete(i);
  }
  return { cost, prev };
}

function pathTo(reach: Reach, to: number): Point[] {
  const out: Point[] = [];
  for (let i: number | undefined = to; i !== undefined; i = reach.prev.get(i)) out.unshift({ x: i % ARENA_W, y: Math.floor(i / ARENA_W) });
  return out;
}

/** The cells a line between two cell centres passes through, ends excluded. */
function cellsBetween(from: Point, to: Point): Point[] {
  const out: Point[] = [];
  const seen = new Set<number>([idx(from.x, from.y), idx(to.x, to.y)]);
  const n = Math.ceil(dist(from, to) / 0.2);
  for (let i = 1; i < n; i++) {
    const x = Math.floor(from.x + 0.5 + ((to.x - from.x) * i) / n);
    const y = Math.floor(from.y + 0.5 + ((to.y - from.y) * i) / n);
    const k = idx(x, y);
    if (!inside(x, y) || seen.has(k)) continue;
    seen.add(k);
    out.push({ x, y });
  }
  return out;
}

const near = (p: Point, q: Point) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) <= 1;

/**
 * Line of fire from a cell to a target cell: blocked by walls in between (a wall next to the
 * shooter is leaned round, a wall next to the target is its cover). Low walls and crates never
 * block but cover; trees on the way spoil the aim.
 */
function lineOfFire(a: Arena, from: Point, to: Point, shooterFlies: boolean, targetFlies: boolean): { clear: boolean; cover: FireInfo['cover']; trees: number } | null {
  let cover: FireInfo['cover'] = 'none';
  let trees = 0;
  const rank = { none: 0, trees: 1, half: 2, full: 3 } as const;
  const better = (c: FireInfo['cover']) => {
    if (rank[c] > rank[cover]) cover = c;
  };
  for (const p of cellsBetween(from, to)) {
    const c = a.level.cells[idx(p.x, p.y)];
    const style = a.level.style[idx(p.x, p.y)];
    const hard = c === WALL && style !== 'sandbag';
    if (c === WALL || c === CRATE) {
      if (near(p, to) && !targetFlies) better(hard ? 'full' : 'half');
      else if (hard && !near(p, from) && !shooterFlies && !(targetFlies && style !== 'building')) return null;
    } else if (c === TREE) {
      if (near(p, to) && !targetFlies) better('trees');
      else if (!shooterFlies && !targetFlies) trees++;
    }
  }
  if (!targetFlies && a.level.cells[idx(to.x, to.y)] === TREE) better('trees');
  if (shooterFlies && cover !== 'none') cover = cover === 'full' ? 'half' : 'trees';
  return { clear: true, cover, trees: Math.min(3, trees) };
}

/** Does any wall, crate or tree stand next to this cell (a place to be flanked from)? */
function hasCoverNearby(a: Arena, p: Point): boolean {
  for (const [dx, dy] of DIRS) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (!inside(x, y)) continue;
    const c = a.level.cells[idx(x, y)];
    if (c === WALL || c === CRATE) return true;
  }
  return false;
}

function aimBonus(a: Arena, side: Side): number {
  // The enemy's skill moves its aim a little either way; your side shoots as your crews do.
  return side === 'red' ? Math.round((a.skill - 0.5) * 30) : a.sweepUntil >= a.round ? 15 : 0;
}

/**
 * Chance and damage of a shot from `shooter` standing at `from` at `target`, or null when it
 * cannot fire at it (range, sight, weapon). Shared by the rules, the AI and the shot card.
 */
export function fireInfo(a: Arena, shooter: Unit, target: Unit, from: Point = shooter, overwatch = false): FireInfo | null {
  const c = CLASSES[shooter.cls];
  const wpn = c.weapon;
  const tc = CLASSES[target.cls];
  if (!target.alive || target.side === shooter.side || wpn.kind === 'area') return null;
  const d = dist(from, target);
  if (d > wpn.range + 0.01 || d < wpn.minRange) return null;
  const line = lineOfFire(a, from, target, c.flying, tc.flying);
  if (!line) return null;
  const parts: [string, number][] = [['Base', wpn.aim]];
  const rank = RANKS[Math.max(0, Math.min(3, shooter.rank))]!.aim;
  if (rank) parts.push([RANKS[shooter.rank]!.name, rank]);
  const far = Math.round(Math.max(0, d - wpn.range / 2) * 3);
  if (far) parts.push(['Range', -far]);
  if (line.cover === 'full') parts.push(['Full cover', -COVER.full]);
  else if (line.cover === 'half') parts.push(['Half cover', -COVER.half]);
  else if (line.cover === 'trees') parts.push(['Trees', -COVER.trees]);
  else if (!tc.flying && hasCoverNearby(a, target)) parts.push(['Flanked', 10]);
  if (line.trees) parts.push(['Through trees', -8 * line.trees]);
  if (target.dug) parts.push(['Dug in', -COVER.dug]);
  if (tc.flying && (wpn.kind === 'autocannon' || wpn.kind === 'mg')) parts.push(['Anti-air', 10]);
  const bonus = aimBonus(a, shooter.side);
  if (bonus) parts.push([shooter.side === 'red' ? 'Enemy skill' : 'Recon sweep', bonus]);
  if (shooter.side === 'blue' && a.missiles > 0 && wpn.kind !== 'dive') parts.push(['Guided', 30]);
  if (overwatch) parts.push(['Snap shot', OVERWATCH_AIM]);
  const chance = clampChance(parts.reduce((s, [, v]) => s + v, 0));
  return { chance, damage: Math.round(wpn.damage * damageFactor(wpn.kind, tc)), cover: line.cover, parts };
}

/** Artillery: chance its shell lands on the cell aimed at (a miss lands next to it). */
export function strikeChance(a: Arena, shooter: Unit, at: Point, from: Point = shooter): number | null {
  const wpn = CLASSES[shooter.cls].weapon;
  if (wpn.kind !== 'area' || !inside(at.x, at.y)) return null;
  const d = dist(from, at);
  if (d > wpn.range + 0.01 || d < wpn.minRange) return null;
  return clampChance(wpn.aim + RANKS[Math.max(0, Math.min(3, shooter.rank))]!.aim - Math.round(Math.max(0, d - wpn.range / 2) * 2) + aimBonus(a, shooter.side));
}

/** Who this unit could fire at from where it stands, best chance first. */
export function targetsOf(a: Arena, u: Unit): { unit: Unit; info: FireInfo }[] {
  if (!u.alive || u.acted) return [];
  const out: { unit: Unit; info: FireInfo }[] = [];
  for (const t of a.units) {
    const info = fireInfo(a, u, t);
    if (info) out.push({ unit: t, info });
  }
  return out.sort((p, q) => q.info.chance - p.info.chance || (p.unit.id < q.unit.id ? -1 : 1));
}

// --- Doing things --------------------------------------------------------------------------------

function damage(a: Arena, t: Unit, amount: number, by: Side | null): void {
  if (!t.alive || amount <= 0) return;
  t.hp = Math.max(0, t.hp - amount);
  a.events.push({ type: 'hit', unit: t.id, damage: amount, x: t.x, y: t.y });
  if (t.hp > 0) return;
  t.alive = false;
  t.overwatch = false;
  a.events.push({ type: 'destroyed', unit: t.id, cls: t.cls, side: t.side, x: t.x, y: t.y });
  if (t.side === 'red' && by === 'blue') a.stats.kills++;
  if (t.side === 'blue') a.stats.lost++;
}

const roll = (a: Arena, base: number) => Math.round((base * (85 + Math.floor(draw(a) * 31))) / 100);

/** Area damage around a cell: full in it, half next to it; crates and trees there break. */
function blast(a: Arena, at: Point, dmg: number, kind: WeaponKind, radius: number, by: Side | null): void {
  a.events.push({ type: 'boom', x: at.x, y: at.y, size: radius + 1 });
  for (const u of a.units) {
    if (!u.alive) continue;
    const d = Math.max(Math.abs(u.x - at.x), Math.abs(u.y - at.y));
    if (d > radius) continue;
    const base = dmg * damageFactor(kind, CLASSES[u.cls]) * (d === 0 ? 1 : 0.5);
    damage(a, u, roll(a, base), by);
  }
  for (let y = at.y - radius; y <= at.y + radius; y++)
    for (let x = at.x - radius; x <= at.x + radius; x++) {
      if (!inside(x, y)) continue;
      const i = idx(x, y);
      if (a.level.cells[i] === CRATE || a.level.cells[i] === TREE) {
        a.level.cells[i] = OPEN;
        a.level.style[i] = null;
        a.level.height[i] = 0;
        a.events.push({ type: 'break', x, y });
      }
    }
}

function shoot(a: Arena, u: Unit, t: Unit, info: FireInfo, overwatch: boolean): void {
  const kind = CLASSES[u.cls].weapon.kind;
  u.aim = Math.atan2(t.y - u.y, t.x - u.x);
  const hit = draw(a) * 100 < info.chance;
  if (u.side === 'blue') {
    a.stats.shots++;
    if (hit) a.stats.hits++;
    if (a.missiles > 0 && kind !== 'dive') a.missiles--;
  }
  a.events.push({ type: 'fire', unit: u.id, kind, from: { x: u.x, y: u.y }, to: { x: t.x, y: t.y }, target: t.id, hit, chance: info.chance, overwatch });
  if (kind === 'dive') {
    // The drone goes in either way; a miss still bursts nearby.
    u.alive = false;
    a.events.push({ type: 'destroyed', unit: u.id, cls: u.cls, side: u.side, x: u.x, y: u.y });
    if (u.side === 'blue') a.stats.lost++;
    if (hit) blast(a, t, CLASSES[u.cls].weapon.damage, kind, 1, u.side);
    else a.events.push({ type: 'miss', unit: t.id, x: t.x, y: t.y }, { type: 'boom', x: t.x, y: t.y, size: 1 });
    return;
  }
  if (hit) damage(a, t, roll(a, info.damage), u.side);
  else a.events.push({ type: 'miss', unit: t.id, x: t.x, y: t.y });
}

/** Enemies on overwatch take their shot at a unit that just moved into a cell. Returns false if it died. */
function overwatchAt(a: Arena, mover: Unit, flush: () => void): boolean {
  for (const w of a.units) {
    if (!mover.alive) return false;
    if (!w.alive || !w.overwatch || w.side === mover.side) continue;
    const info = fireInfo(a, w, mover, w, true);
    if (!info) continue;
    flush();
    w.overwatch = false;
    shoot(a, w, mover, info, true);
  }
  return mover.alive;
}

function checkEnd(a: Arena): void {
  if (a.ended) return;
  if (!a.units.some((u) => u.side === 'red' && u.alive)) a.ended = 'won';
  else if (!a.units.some((u) => u.side === 'blue' && u.alive)) a.ended = 'lost';
  if (a.ended) a.events.push({ type: 'end', won: a.ended === 'won' });
}

/** Can this action be taken now? The UI greys out what it cannot do. */
export function canAct(a: Arena, act: Action, side: Side = a.turn): boolean {
  if (a.ended || a.turn !== side) return false;
  if (act.type === 'ability') {
    if (side !== 'blue' || a.abilities[act.id] !== 'ready') return false;
    if (act.id === 'repair' || act.id === 'mines') {
      const u = a.units.find((x) => x.id === act.unit && x.alive && x.side === side);
      return !!u && (act.id === 'mines' || u.hp < u.maxHp);
    }
    if (act.id === 'airstrike') return !!act.at && inside(act.at.x, act.at.y);
    return true;
  }
  const u = a.units.find((x) => x.id === act.unit);
  if (!u || !u.alive || u.side !== side || u.acted) return false;
  if (act.type === 'move') return !u.moved && reachable(a, u).cost.has(idx(act.to.x, act.to.y)) && (act.to.x !== u.x || act.to.y !== u.y);
  if (act.type === 'fire') {
    const t = a.units.find((x) => x.id === act.target);
    return !!t && !!fireInfo(a, u, t);
  }
  if (act.type === 'strike') return strikeChance(a, u, act.at) !== null;
  return true;
}

/** Take one action. Returns false (and changes nothing) if it is not allowed. */
export function act(a: Arena, action: Action, side: Side = a.turn): boolean {
  if (!canAct(a, action, side)) return false;
  if (action.type === 'ability') {
    useAbility(a, action);
    checkEnd(a);
    return true;
  }
  const u = a.units.find((x) => x.id === action.unit)!;
  if (action.type === 'move') {
    const reach = reachable(a, u);
    const path = pathTo(reach, idx(action.to.x, action.to.y));
    const walked: Point[] = [path[0]!];
    u.moved = true;
    u.dug = false;
    // The walk is logged in legs: each overwatch shot is played where the unit was when it came.
    const flush = () => {
      if (walked.length > 1) a.events.push({ type: 'move', unit: u.id, path: [...walked] });
      walked.splice(0, walked.length - 1);
    };
    for (const p of path.slice(1)) {
      const last = walked.at(-1)!;
      u.facing = Math.atan2(p.y - last.y, p.x - last.x);
      u.aim = u.facing;
      u.x = p.x;
      u.y = p.y;
      walked.push(p);
      const mine = !CLASSES[u.cls].flying ? a.mines.findIndex((m) => m.x === p.x && m.y === p.y) : -1;
      if (mine >= 0) {
        flush();
        a.mines.splice(mine, 1);
        a.events.push({ type: 'mine', x: p.x, y: p.y }, { type: 'boom', x: p.x, y: p.y, size: 1 });
        damage(a, u, 35, other(u.side));
        checkEnd(a);
        return true;
      }
      if (!overwatchAt(a, u, flush)) {
        checkEnd(a);
        return true;
      }
    }
    if (walked.length > 1) a.events.push({ type: 'move', unit: u.id, path: walked });
    checkEnd(a);
    return true;
  }
  if (action.type === 'fire') {
    const t = a.units.find((x) => x.id === action.target)!;
    shoot(a, u, t, fireInfo(a, u, t)!, false);
    u.acted = true;
  } else if (action.type === 'strike') {
    const chance = strikeChance(a, u, action.at)!;
    const hit = draw(a) * 100 < chance;
    let at = action.at;
    if (!hit) {
      const [dx, dy] = DIRS[Math.floor(draw(a) * 8)]!;
      at = { x: Math.max(0, Math.min(ARENA_W - 1, at.x + dx)), y: Math.max(0, Math.min(ARENA_H - 1, at.y + dy)) };
    }
    u.aim = Math.atan2(action.at.y - u.y, action.at.x - u.x);
    if (u.side === 'blue') {
      a.stats.shots++;
      if (hit) a.stats.hits++;
    }
    a.events.push({ type: 'fire', unit: u.id, kind: 'area', from: { x: u.x, y: u.y }, to: at, target: null, hit, chance, overwatch: false });
    blast(a, at, CLASSES[u.cls].weapon.damage, 'area', CLASSES[u.cls].weapon.splash, u.side);
    u.acted = true;
  } else if (action.type === 'dig') {
    u.dug = !CLASSES[u.cls].flying;
    u.acted = true;
    a.events.push({ type: 'dig', unit: u.id });
  } else {
    u.overwatch = true;
    u.acted = true;
    a.events.push({ type: 'overwatch', unit: u.id });
  }
  checkEnd(a);
  return true;
}

function useAbility(a: Arena, action: Extract<Action, { type: 'ability' }>): void {
  a.abilities[action.id] = 'used';
  const u = a.units.find((x) => x.id === action.unit);
  if (action.id === 'repair' && u) {
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.4));
    a.events.push({ type: 'ability', id: 'repair', x: u.x, y: u.y });
  } else if (action.id === 'mines' && u) {
    for (const dx of [-1, 0, 1]) {
      const x = u.x + dx;
      const y = u.y - 1;
      if (inside(x, y) && walkable(a.level, x, y, false) && !unitAt(a, x, y)) a.mines.push({ x, y });
    }
    a.events.push({ type: 'ability', id: 'mines', x: u.x, y: u.y - 1 });
  } else if (action.id === 'sweep') {
    a.sweepUntil = a.round + 1;
    a.events.push({ type: 'ability', id: 'sweep', x: 7, y: 11 });
  } else if (action.id === 'missiles') {
    a.missiles = 3;
    a.events.push({ type: 'ability', id: 'missiles', x: u?.x ?? 7, y: u?.y ?? 20 });
  } else if (action.id === 'airstrike' && action.at) {
    a.events.push({ type: 'ability', id: 'airstrike', x: action.at.x, y: action.at.y });
    blast(a, action.at, 55, 'area', 1, 'blue');
  }
}

function startTurn(a: Arena, side: Side): void {
  a.turn = side;
  for (const u of a.units) {
    if (u.side !== side) continue;
    u.moved = false;
    u.acted = false;
    u.overwatch = false;
    u.dug = false;
  }
  a.events.push({ type: 'turn', side, round: a.round });
}

/** In capture fights: the attackers are in the zone and no defender is. */
export function holdingZone(a: Arena): boolean {
  const z = a.level.zone;
  if (!z) return false;
  const inZone = (u: Unit) => u.alive && Math.hypot(u.x + 0.5 - z.x, u.y + 0.5 - z.y) <= z.r;
  return a.units.some((u) => u.side === 'blue' && inZone(u)) && !a.units.some((u) => u.side === 'red' && inZone(u));
}

/**
 * End your turn: the enemy takes theirs (played by the AI), then the round closes (capture and the
 * round limit are checked there) and your next turn starts.
 */
export function endTurn(a: Arena): void {
  if (a.ended || a.turn !== 'blue') return;
  startTurn(a, 'red');
  playSide(a, 'red');
  if (a.ended) return;
  if (a.level.mode === 'capture') {
    a.capture = holdingZone(a) ? a.capture + 1 : 0;
    if (a.capture > 0) a.events.push({ type: 'capture', rounds: a.capture });
    if (a.capture >= CAPTURE_ROUNDS) {
      a.ended = 'won';
      a.events.push({ type: 'end', won: true });
      return;
    }
  }
  if (a.round >= ROUND_LIMIT) {
    a.ended = 'lost';
    a.events.push({ type: 'end', won: false });
    return;
  }
  a.round++;
  startTurn(a, 'blue');
}

/** Pull back: the battle is lost, the units keep what they have left. */
export function retreat(a: Arena): void {
  if (a.ended) return;
  a.ended = 'lost';
  a.events.push({ type: 'end', won: false });
}

// --- The AI ----------------------------------------------------------------------------------------

interface Plan {
  to: Point;
  shot: { target: string } | { at: Point } | null;
  score: number;
}

/** Expected damage of a shot, with a bonus for finishing a unit off. */
function shotValue(info: FireInfo, t: Unit): number {
  const dmg = Math.min(info.damage, t.hp);
  return (info.chance / 100) * (dmg + (info.damage >= t.hp ? 30 : 0));
}

function bestShotFrom(a: Arena, u: Unit, from: Point): { shot: Plan['shot']; value: number } {
  const c = CLASSES[u.cls];
  if (c.weapon.kind === 'area') {
    let best: { shot: Plan['shot']; value: number } = { shot: null, value: 0 };
    const cells = a.units.filter((t) => t.alive && t.side !== u.side).map((t) => ({ x: t.x, y: t.y }));
    for (const at of cells) {
      const chance = strikeChance(a, u, at, from);
      if (chance === null) continue;
      let v = 0;
      for (const t of a.units) {
        if (!t.alive) continue;
        const d = Math.max(Math.abs(t.x - at.x), Math.abs(t.y - at.y));
        if (d > c.weapon.splash) continue;
        const dmg = c.weapon.damage * damageFactor('area', CLASSES[t.cls]) * (d === 0 ? (chance / 100) : 0.5);
        v += (t.side === u.side ? -1.5 : 1) * Math.min(dmg, t.hp);
      }
      if (v > best.value) best = { shot: { at }, value: v };
    }
    return best;
  }
  let best: { shot: Plan['shot']; value: number } = { shot: null, value: 0 };
  for (const t of a.units) {
    const info = fireInfo(a, u, t, from);
    if (!info) continue;
    // A drone spends itself: only worth it on something that matters.
    const v = shotValue(info, t) * (c.weapon.kind === 'dive' ? (CLASSES[t.cls].heavy || t.hp <= info.damage ? 1 : 0.5) : 1);
    if (v > best.value) best = { shot: { target: t.id }, value: v };
  }
  return best;
}

/** How much the enemy could hurt this unit standing here, from where they are now. */
function threatAt(a: Arena, u: Unit, at: Point): number {
  let sum = 0;
  const ghost: Unit = { ...u, x: at.x, y: at.y, dug: false };
  for (const e of a.units) {
    if (!e.alive || e.side === u.side) continue;
    const ec = CLASSES[e.cls];
    if (ec.weapon.kind === 'area') {
      sum += dist(e, at) <= ec.weapon.range ? ec.weapon.damage * 0.35 : 0;
      continue;
    }
    // They can close in: test from where they stand and from a step toward this cell.
    const d = dist(e, at);
    const step = Math.min(ec.move * 0.8, Math.max(0, d - ec.weapon.range + 0.5));
    const from = { x: Math.round(e.x + ((at.x - e.x) / (d || 1)) * step), y: Math.round(e.y + ((at.y - e.y) / (d || 1)) * step) };
    const info = fireInfo(a, e, ghost, inside(from.x, from.y) ? from : e);
    if (info) sum += (info.chance / 100) * Math.min(info.damage, u.hp);
  }
  return sum;
}

function planUnit(a: Arena, u: Unit, skill: number, noise: () => number): Plan {
  const reach = reachable(a, u);
  const c = CLASSES[u.cls];
  const enemies = a.units.filter((e) => e.alive && e.side !== u.side);
  const zone = a.level.zone;
  const caution = c.weapon.kind === 'dive' ? 0 : 0.25 + 0.55 * skill;
  let best: Plan = { to: { x: u.x, y: u.y }, shot: null, score: -Infinity };
  for (const [i, cost] of reach.cost) {
    const at = { x: i % ARENA_W, y: Math.floor(i / ARENA_W) };
    const shot = bestShotFrom(a, u, at);
    let score = shot.value;
    score -= threatAt(a, u, at) * caution;
    const nearest = Math.min(...enemies.map((e) => dist(e, at)));
    if (zone) {
      const dz = Math.hypot(at.x + 0.5 - zone.x, at.y + 0.5 - zone.y);
      if (u.side === 'red') score -= Math.max(0, dz - zone.r) * 2.5;
      else score -= dz * 3.2;
    }
    if (!shot.shot) {
      // Nothing to shoot from here: close in, or for the guns, find a firing position.
      score -= Math.max(0, nearest - c.weapon.range * 0.8) * (u.side === 'blue' && !zone ? 3.5 : 1.6);
    }
    if (c.weapon.kind === 'area') score -= Math.max(0, 4 - nearest) * 12;
    score -= cost * 0.05;
    score += noise() * (1 - skill) * 22;
    if (score > best.score) best = { to: at, shot: shot.shot, score };
  }
  return best;
}

/** Play one whole side's turn with the AI (the enemy, or your own side on autopilot). */
export function playSide(a: Arena, side: Side): void {
  const skill = side === 'red' ? a.skill : 0.75;
  const noise = mulberry32(Math.floor(draw(a) * 4294967296));
  // Guns first (they soften what the others then finish), then the rest in a fixed order.
  const order = a.units
    .filter((u) => u.side === side)
    .sort((p, q) => Number(CLASSES[q.cls].weapon.kind === 'area') - Number(CLASSES[p.cls].weapon.kind === 'area') || (p.id < q.id ? -1 : 1));
  for (const u of order) {
    if (a.ended) return;
    if (!u.alive || u.acted) continue;
    const plan = planUnit(a, u, skill, noise);
    if (plan.to.x !== u.x || plan.to.y !== u.y) act(a, { type: 'move', unit: u.id, to: plan.to }, side);
    if (a.ended || !u.alive) continue;
    // Re-read the shot from where it actually stopped (a mine or overwatch may have cut it short).
    const shot = bestShotFrom(a, u, u).shot;
    const shotInfo = shot && 'target' in shot ? fireInfo(a, u, a.units.find((t) => t.id === shot.target)!) : null;
    // Raw crews take long shots; sharp ones wait for a better one on overwatch.
    const minChance = 6 + skill * 12;
    if (shot && 'at' in shot) act(a, { type: 'strike', unit: u.id, at: shot.at }, side);
    else if (shot && shotInfo && shotInfo.chance >= minChance) act(a, { type: 'fire', unit: u.id, target: shot.target }, side);
    else if (!CLASSES[u.cls].flying && skill < 0.35) act(a, { type: 'dig', unit: u.id }, side);
    else act(a, { type: 'overwatch', unit: u.id }, side);
  }
}

/** Let the AI play your turn for you, then end it. */
export function autoTurn(a: Arena): void {
  if (a.ended || a.turn !== 'blue') return;
  playSide(a, 'blue');
  endTurn(a);
}

/** Fight the whole battle on autopilot (tests, and Quick resolve's honest alternative). */
export function autoBattle(a: Arena, limit = ROUND_LIMIT + 1): Arena {
  for (let i = 0; i < limit && !a.ended; i++) autoTurn(a);
  return a;
}

export function arenaResult(a: Arena): ArenaResult {
  const kept: Record<string, number> = {};
  for (const u of a.units) kept[u.id] = u.alive ? Math.max(1, Math.min(1000, Math.round((u.hp / u.startHp) * 1000))) : 0;
  const won = a.ended === 'won';
  const blue = a.units.filter((u) => u.side === 'blue');
  const lost = blue.filter((u) => !u.alive).length;
  const taken = blue.reduce((s, u) => s + (u.startHp - (u.alive ? u.hp : 0)), 0) / Math.max(1, blue.reduce((s, u) => s + u.startHp, 0));
  const stars = (won ? 1 + (lost === 0 ? 1 : 0) + (a.round <= 6 || taken <= 0.2 ? 1 : 0) : 0) as ArenaResult['stars'];
  return { won, kept, rounds: a.round, stars, stats: { ...a.stats } };
}
