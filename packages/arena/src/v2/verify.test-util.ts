import type { Terrain, UnitClass } from '@brink/contracts';
import { draw } from '../rng';
import { advise, decide, enemyArea } from './ai';
import { bestFire, fireInfo, fitMen, usableWeapons, type FireInfo } from './combat';
import { act, createBattle, reachable, strikeInfo, supportChance, undoable, unitValue, whyNot } from './engine';
import { passable } from './map';
import { observe } from './observe';
import { hashBattle, submit, type PlayerCommand } from './replay';
import { ABILITIES } from './rules';
import { TYPES, typeOf } from './roster';
import { cheb, dist, isFlying, visibleTo } from './sight';
import {
  at,
  BUILDING,
  CAPTURE_ROUNDS,
  FACTION_OF,
  H,
  inside,
  ROUND_LIMIT,
  W,
  type AbilityId,
  type Action,
  type Arsenal,
  type ArenaSetup,
  type Battle,
  type BattleEvent,
  type Biome,
  type Difficulty,
  type Point,
  type SiteKind,
  type TimeOfDay,
  type TypeId,
  type Unit,
  type UnitSpec,
  type Weather,
} from './types';

// The verification backbone's shared parts (docs/architecture.md, Battles): a tiny seeded generator,
// setups across the field's dimensions, a seeded player that mixes advice, the planner, random
// legal orders and orders meant to be refused, checks on states and on steps between them, and the
// fog probe: everything the player is shown, to compare across changes it must not see.

// --- A seeded generator ------------------------------------------------------------------------------

/** A tiny seeded generator whose whole state is one number, so it copies with the battle. */
export interface Rng {
  s: { stream: number };
  next(): number;
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
}

export function rng(seed: number): Rng {
  const s = { stream: seed >>> 0 };
  const next = () => draw(s);
  return {
    s,
    next,
    int: (n) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    chance: (p) => next() < p,
  };
}

// --- Setups ------------------------------------------------------------------------------------------

export const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban'];
export const SITES: readonly SiteKind[] = [null, 'city', 'objective', 'depot', 'capital'];
export const BIOMES: readonly Biome[] = ['temperate', 'steppe', 'desert', 'winter', 'urban'];
export const TIMES: readonly TimeOfDay[] = ['day', 'dawn', 'dusk', 'night'];
export const WEATHERS: readonly Weather[] = ['clear', 'overcast', 'rain', 'fog', 'snow'];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const CLASSES: readonly UnitClass[] = ['armor', 'mechanized', 'infantry', 'recon', 'artillery', 'air', 'drone'];
const WEST: readonly Arsenal[] = ['us', 'europe'];
const EAST: readonly Arsenal[] = ['russia', 'legacy'];
const ABILITY_IDS = Object.keys(ABILITIES).sort() as AbilityId[];

/** Company shapes: template formations by class, or (`roster`) small explicit lists of any types of the side's faction. */
export const MIXES = ['mixed', 'air', 'armour', 'infantry', 'artillery', 'drones', 'urban', 'long', 'roster'] as const;
export type Mix = (typeof MIXES)[number];

const SHAPES: Record<Exclude<Mix, 'mixed' | 'roster'>, { blue: UnitClass[]; red: UnitClass[] }> = {
  air: { blue: ['air', 'air', 'drone'], red: ['mechanized', 'infantry'] },
  armour: { blue: ['armor', 'armor', 'mechanized'], red: ['armor', 'mechanized'] },
  infantry: { blue: ['infantry', 'infantry'], red: ['infantry', 'recon'] },
  artillery: { blue: ['artillery', 'artillery', 'recon'], red: ['infantry', 'armor'] },
  drones: { blue: ['drone', 'drone', 'recon'], red: ['mechanized', 'armor'] },
  urban: { blue: ['infantry', 'mechanized', 'armor'], red: ['infantry', 'infantry'] },
  long: { blue: ['armor', 'recon', 'artillery'], red: ['armor', 'recon'] },
};

export interface SetupPick {
  terrain?: Terrain;
  site?: SiteKind;
  river?: boolean;
  biome?: Biome;
  time?: TimeOfDay;
  weather?: Weather;
  difficulty?: Difficulty;
  mix?: Mix;
}

const formationOf = (id: string, cls: UnitClass, r: Rng): UnitSpec => ({ id, cls, strength: 600 + r.int(401), name: id, color: '#888888', rank: r.int(2) });

/** An explicit list: a carrier with a squad, engineers, a medic, and a random spread of the faction's types. */
function roster(arsenal: Arsenal, n: number, r: Rng): TypeId[] {
  const faction = FACTION_OF[arsenal];
  const types = (Object.keys(TYPES) as TypeId[]).filter((t) => TYPES[t].faction === faction).sort();
  const west = faction === 'west';
  const out: TypeId[] = [west ? r.pick(['m2a3', 'stryker', 'cv90'] as const) : 'bmp3', west ? 'squad_w' : 'squad_e', west ? 'engineer_w' : 'engineer_e', west ? 'medic_w' : 'medic_e'];
  while (out.length < n) out.push(r.pick(types));
  return out;
}

/** A battle setup from a seed; anything in `pick` is taken as given, the rest is drawn. */
export function arenaSetup(seed: number, pick: SetupPick = {}): ArenaSetup {
  const r = rng(seed * 7919 + 17);
  const mix = pick.mix ?? r.pick(MIXES);
  const westBlue = r.chance(0.5);
  const blueArsenal = r.pick(westBlue ? WEST : EAST);
  const redArsenal = r.pick(westBlue ? EAST : WEST);
  let terrain = pick.terrain ?? r.pick(TERRAINS);
  let site = pick.site !== undefined ? pick.site : r.pick(SITES);
  let time = pick.time ?? (r.chance(0.5) ? r.pick(TIMES) : undefined);
  let weather = pick.weather ?? (r.chance(0.5) ? r.pick(WEATHERS) : undefined);
  if (mix === 'urban') {
    terrain = 'urban';
    site = pick.site ?? 'city';
  }
  if (mix === 'long') {
    terrain = pick.terrain ?? 'plains';
    time = pick.time ?? 'day';
    weather = pick.weather ?? 'clear';
  }
  let biome = pick.biome ?? (r.chance(0.6) ? r.pick(BIOMES) : undefined);
  // Snow falls only in winter, and the desert gets neither rain nor snow.
  if (weather === 'snow') biome = 'winter';
  if (biome === 'desert' && weather === 'rain') biome = 'steppe';
  let attackers: UnitSpec[];
  let defenders: UnitSpec[];
  if (mix === 'roster') {
    attackers = [{ id: 'bx', cls: 'mechanized', strength: 1000, name: 'Blue', color: '#3fa796', rank: r.int(3), types: roster(blueArsenal, 6 + r.int(5), r) }];
    defenders = [{ id: 'rx', cls: 'infantry', strength: 1000, name: 'Red', color: '#c9733a', rank: r.int(2), types: roster(redArsenal, 5 + r.int(4), r) }];
  } else if (mix === 'mixed') {
    attackers = Array.from({ length: 1 + r.int(3) }, (_, i) => formationOf(`b${i}`, r.pick(CLASSES), r));
    defenders = Array.from({ length: 1 + r.int(2) }, (_, i) => formationOf(`r${i}`, r.pick(CLASSES), r));
  } else {
    attackers = SHAPES[mix].blue.map((c, i) => formationOf(`b${i}`, c, r));
    defenders = SHAPES[mix].red.map((c, i) => formationOf(`r${i}`, c, r));
  }
  return {
    seed,
    terrain,
    river: pick.river ?? (terrain !== 'urban' && r.chance(0.25)),
    site,
    attackers,
    defenders,
    arsenal: { blue: blueArsenal, red: redArsenal },
    skill: 0.2 + r.next() * 0.6,
    difficulty: pick.difficulty ?? r.pick(DIFFICULTIES),
    abilities: ABILITY_IDS.filter(() => r.chance(0.35)),
    theatre: r.pick(['meridian-crisis', 'highland-front', 'varn-delta']),
    ...(biome ? { biome } : {}),
    ...(time ? { time } : {}),
    ...(weather ? { weather } : {}),
  };
}

/**
 * Setups that cover every value of every dimension (terrain, site, river, biome, time, weather,
 * company shape, difficulty) a few times over in `n`: each dimension steps through its values at
 * its own stride, so the combinations spread instead of repeating.
 */
export function coveringSetups(n: number, base = 1): ArenaSetup[] {
  return Array.from({ length: n }, (_, i) => coveringSetup(i, base));
}

/** The `i`th covering setup on its own (the same whatever `n` a run asks for). */
export function coveringSetup(i: number, base = 1): ArenaSetup {
  return arenaSetup(base + i, {
    terrain: TERRAINS[i % TERRAINS.length]!,
    site: SITES[(i * 2 + 1) % SITES.length]!,
    river: i % 3 === 1,
    biome: BIOMES[(i * 3 + 2) % BIOMES.length]!,
    time: TIMES[(i + Math.floor(i / 4)) % TIMES.length]!,
    weather: WEATHERS[(i * 2 + Math.floor(i / 5)) % WEATHERS.length]!,
    mix: MIXES[(i * 4 + 3) % MIXES.length]!,
    difficulty: DIFFICULTIES[(i + Math.floor(i / 3)) % DIFFICULTIES.length]!,
  });
}

export const copyBattle = (b: Battle): Battle => JSON.parse(JSON.stringify(b)) as Battle;
const onField = (u: Unit) => u.alive && u.carrier === null;
export const blueUnits = (b: Battle) => b.units.filter((u) => u.side === 'blue' && onField(u));

// --- Orders --------------------------------------------------------------------------------------------

const randomCell = (r: Rng): Point => ({ x: r.int(W), y: r.int(H) });
const near = (p: Point, d: number, r: Rng): Point => ({ x: Math.max(0, Math.min(W - 1, p.x + r.int(2 * d + 1) - d)), y: Math.max(0, Math.min(H - 1, p.y + r.int(2 * d + 1) - d)) });
const adjacent = (p: Point, r: Rng): Point => {
  const d = r.pick([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ] as const);
  return { x: p.x + d[0], y: p.y + d[1] };
};

/** A cell worth aiming at: a last known position, nudged, or anywhere. */
function aimCell(b: Battle, r: Rng): Point {
  const ghosts = Object.values(b.intel.blue);
  return ghosts.length && r.chance(0.7) ? near(r.pick(ghosts), 1, r) : randomCell(r);
}

const KINDS: readonly (readonly [Action['type'], number])[] = [
  ['move', 30],
  ['fire', 20],
  ['face', 4],
  ['overwatch', 5],
  ['hunker', 4],
  ['strike', 7],
  ['support', 2],
  ['smoke', 3],
  ['embark', 3],
  ['dismount', 3],
  ['split', 2],
  ['merge', 2],
  ['treat', 2],
  ['repair', 2],
  ['breach', 3],
  ['mine', 3],
  ['ability', 3],
];
const KIND_TOTAL = KINDS.reduce((s, [, w]) => s + w, 0);

/** A random order for a blue unit of a kind drawn by weight; legal or not, the battle decides. */
export function randomAction(b: Battle, u: Unit, r: Rng): Action | null {
  let k = r.next() * KIND_TOTAL;
  let kind: Action['type'] = 'move';
  for (const [t, w] of KINDS) {
    if (k < w) {
      kind = t;
      break;
    }
    k -= w;
  }
  const friends = blueUnits(b).filter((f) => f.id !== u.id);
  const t = typeOf(u.type);
  switch (kind) {
    case 'move': {
      const dash = r.chance(0.2);
      const reach = reachable(b, u, dash, visibleTo(b, 'blue'));
      const start = at(b.map, u.x, u.y);
      const cells = [...reach.cost.keys()].filter((i) => i !== start).sort((p, q) => p - q);
      if (!cells.length) return null;
      const i = r.pick(cells);
      return { type: 'move', unit: u.id, to: { x: i % W, y: Math.floor(i / W) }, ...(dash ? { dash: true } : {}) };
    }
    case 'fire': {
      const known = visibleTo(b, 'blue');
      const targets = b.units.filter((e) => known.has(e.id)).sort((p, q) => (p.id < q.id ? -1 : 1));
      const weapons = usableWeapons(u).filter((w) => !w.indirect);
      if (!targets.length || !weapons.length) return null;
      return { type: 'fire', unit: u.id, target: r.pick(targets).id, weapon: r.pick(weapons).id };
    }
    case 'face':
      return { type: 'face', unit: u.id, facing: (r.next() * 2 - 1) * Math.PI };
    case 'overwatch':
    case 'hunker':
    case 'dismount':
    case 'split':
      return { type: kind, unit: u.id };
    case 'strike': {
      const w = t.weapons.find((x) => x.indirect);
      return w ? { type: 'strike', unit: u.id, at: aimCell(b, r), weapon: w.id, ...(r.chance(0.2) ? { smoke: true } : {}) } : null;
    }
    case 'support': {
      const s = b.support.find((x) => x.side === 'blue');
      return s ? { type: 'support', asset: s.id, at: aimCell(b, r) } : null;
    }
    case 'smoke':
      return t.engineer ? { type: 'smoke', unit: u.id, at: adjacent(u, r) } : { type: 'smoke', unit: u.id };
    case 'embark': {
      const carriers = friends.filter((f) => typeOf(f.type).seats > 0);
      return carriers.length ? { type: 'embark', unit: u.id, carrier: r.pick(carriers).id } : null;
    }
    case 'merge': {
      const halves = friends.filter((f) => f.parent === u.id || u.parent === f.id || (!!u.parent && f.parent === u.parent));
      return halves.length ? { type: 'merge', unit: u.id, with: r.pick(halves).id } : null;
    }
    case 'treat':
    case 'repair': {
      const next = friends.filter((f) => cheb(f, u) <= 1);
      return next.length ? { type: kind, unit: u.id, target: r.pick(next).id } : null;
    }
    case 'breach':
    case 'mine':
      return { type: kind, unit: u.id, at: adjacent(u, r) };
    case 'ability': {
      const ready = ABILITY_IDS.filter((a) => b.abilities[a] === 'ready');
      return ready.length ? { type: 'ability', id: r.pick(ready), unit: u.id, at: aimCell(b, r) } : null;
    }
  }
}

/** A command meant to be refused, and why it must be. */
export interface Refusable {
  cmd: PlayerCommand;
  why: string;
}

const bad = (v: unknown): PlayerCommand => v as PlayerCommand;

/**
 * A command the battle must refuse: a red unit, a dead or carried or done unit, a target nobody
 * has, one out of sight, a cell out of reach, an empty asset, or a malformed order or command.
 */
export function refusable(b: Battle, r: Rng): Refusable {
  const blue = b.units.filter((u) => u.side === 'blue');
  const live = blueUnits(b);
  const red = b.units.filter((u) => u.side === 'red');
  const u = live.length ? r.pick(live) : blue[0]!;
  const w = typeOf(u.type).weapons[0]?.id ?? 'none';
  const seen = visibleTo(b, 'blue');
  const options: (() => Refusable | null)[] = [
    () => (red.length ? { cmd: { type: 'act', action: { type: 'move', unit: r.pick(red).id, to: randomCell(r) } }, why: 'wrong side' } : null),
    () => (red.length ? { cmd: { type: 'act', action: { type: 'hunker', unit: r.pick(red).id } }, why: 'wrong side' } : null),
    () => ({ cmd: { type: 'act', action: { type: 'fire', unit: u.id, target: 'nobody:0', weapon: w } }, why: 'unknown target' }),
    () => ({ cmd: { type: 'act', action: { type: 'overwatch', unit: 'nobody:0' } }, why: 'unknown unit' }),
    () => {
      const done = live.filter((x) => x.acted && !x.smoked);
      const target = red.find((e) => seen.has(e.id));
      if (!done.length) return null;
      const d = r.pick(done);
      const wd = typeOf(d.type).weapons[0]?.id ?? 'none';
      return { cmd: { type: 'act', action: target ? { type: 'fire', unit: d.id, target: target.id, weapon: wd } : { type: 'overwatch', unit: d.id } }, why: 'done this turn' };
    },
    () => {
      const hidden = red.filter((e) => e.alive && !seen.has(e.id));
      if (!hidden.length) return null;
      return { cmd: { type: 'act', action: { type: 'fire', unit: u.id, target: r.pick(hidden).id, weapon: w } }, why: 'target out of sight' };
    },
    () => {
      const dead = blue.filter((x) => !x.alive);
      return dead.length ? { cmd: { type: 'act', action: { type: 'move', unit: r.pick(dead).id, to: randomCell(r) } }, why: 'dead unit' } : null;
    },
    () => {
      const aboard = blue.filter((x) => x.alive && x.carrier);
      return aboard.length ? { cmd: { type: 'act', action: { type: 'hunker', unit: r.pick(aboard).id } }, why: 'aboard a carrier' } : null;
    },
    () => {
      const reach = reachable(b, u, true);
      const out: number[] = [];
      for (let i = 0; i < W * H; i++) if (!reach.cost.has(i)) out.push(i);
      if (!out.length) return null;
      const i = r.pick(out);
      return { cmd: { type: 'act', action: { type: 'move', unit: u.id, to: { x: i % W, y: Math.floor(i / W) } } }, why: 'out of reach' };
    },
    () => ({ cmd: { type: 'act', action: { type: 'move', unit: u.id, to: { x: u.x, y: u.y } } }, why: 'already there' }),
    () => ({ cmd: { type: 'act', action: { type: 'support', asset: b.support.some((s) => s.side === 'blue' && s.id === 'himars') ? 'tornado' : 'himars', at: randomCell(r) } }, why: 'no such asset' }),
    () =>
      r.pick([
        { cmd: bad({ type: 'act', action: { type: 'teleport', unit: u.id, to: { x: 3, y: 3 } } }), why: 'malformed: unknown order' },
        { cmd: bad({ type: 'act', action: { type: 'move', unit: u.id, to: { x: u.x + 0.5, y: u.y } } }), why: 'malformed: off a cell' },
        { cmd: bad({ type: 'act', action: { type: 'move', unit: u.id, to: { x: -1, y: u.y } } }), why: 'malformed: off the field' },
        { cmd: bad({ type: 'act', action: { type: 'move', unit: u.id, to: { x: u.x } } }), why: 'malformed: half a point' },
        { cmd: bad({ type: 'act', action: { type: 'face', unit: u.id, facing: Number.NaN } }), why: 'malformed: NaN facing' },
        { cmd: bad({ type: 'act', action: { type: 'face', unit: u.id, facing: Number.POSITIVE_INFINITY } }), why: 'malformed: infinite facing' },
        { cmd: bad({ type: 'act', action: { type: 'strike', unit: u.id, at: { x: 2.5, y: 9 }, weapon: w } }), why: 'malformed: strike off a cell' },
        { cmd: bad({ type: 'act', action: { type: 'support', asset: 'himars', at: { x: 99, y: 2 } } }), why: 'malformed: support off the field' },
        { cmd: bad({ type: 'act', action: { type: 'fire', unit: u.id, target: 7, weapon: w } }), why: 'malformed: numeric target' },
        { cmd: bad({ type: 'act', action: { type: 'ability', id: 'nukes' } }), why: 'malformed: unknown ability' },
        { cmd: bad({ type: 'act', action: null }), why: 'malformed: no order' },
        { cmd: bad({ type: 'act' }), why: 'malformed: no order' },
        { cmd: bad({ type: 'surrender' }), why: 'malformed: unknown command' },
        { cmd: bad(null), why: 'malformed: null command' },
      ]),
  ];
  for (let tries = 0; tries < 8; tries++) {
    const got = r.pick(options)();
    if (got) return got;
  }
  return { cmd: { type: 'act', action: { type: 'overwatch', unit: 'nobody:0' } }, why: 'unknown unit' };
}

// --- The seeded player ---------------------------------------------------------------------------

export interface PolicyOptions {
  /** Chance a step is a command the battle must refuse. */
  illegal?: number;
  /** Chance a step asks for advice and plays it in order, stopping at the first refusal. */
  advice?: number;
  /** Chance a step plays the side planner's next choice (asked on a copy of the battle). */
  planner?: number;
  /** Chance a turn ends with Let Crews Play rather than End Turn. */
  auto?: number;
  /** Chance a turn ends with Retreat. */
  retreat?: number;
}

export interface Player {
  r: Rng;
  o: Required<PolicyOptions>;
  tried: number;
  accepted: number;
  refused: number;
  /** Commands meant to be refused that were accepted: each is a defect. */
  wrongly: Refusable[];
  /** Refusable commands tried, by reason. */
  refusals: Record<string, number>;
}

export interface Step {
  cmd: PlayerCommand;
  ok: boolean;
  /** The battle's JSON before the command (when a step watcher asked for it). */
  before: string | null;
  b: Battle;
  /** Why it must be refused, for a refusable command. */
  must: string | null;
}

export type Watch = (s: Step) => void;

export function player(seed: number, opts: PolicyOptions = {}): Player {
  return { r: rng(seed), o: { illegal: 0.12, advice: 0.06, planner: 0.03, auto: 0.25, retreat: 0.004, ...opts }, tried: 0, accepted: 0, refused: 0, wrongly: [], refusals: {} };
}

/** A player that carries on exactly where this one is (its generator's state copied). */
export function copyPlayer(p: Player): Player {
  const r = rng(0);
  r.s.stream = p.r.s.stream;
  return { ...p, r, wrongly: [...p.wrongly], refusals: { ...p.refusals } };
}

function send(p: Player, b: Battle, cmd: PlayerCommand, watch: Watch | undefined, must: string | null = null): boolean {
  const before = watch ? JSON.stringify(b) : null;
  const ok = submit(b, cmd);
  p.tried++;
  if (ok) p.accepted++;
  else p.refused++;
  if (must !== null) {
    p.refusals[must] = (p.refusals[must] ?? 0) + 1;
    if (ok) p.wrongly.push({ cmd, why: must });
  }
  watch?.({ cmd, ok, before, b, must });
  return ok;
}

/** Play one blue turn with the seeded policy and end it (or retreat); `stopAfter` leaves it mid-turn after that many steps. */
export function playTurn(p: Player, b: Battle, watch?: Watch, stopAfter = Infinity): void {
  const { r, o } = p;
  const done = new Set<string>();
  const misses = new Map<string, number>();
  const cap = 3 * blueUnits(b).length + 8;
  for (let steps = 0; steps < cap && !b.ended && b.turn === 'blue'; steps++) {
    if (steps >= stopAfter) return;
    if (r.chance(o.illegal)) {
      const x = refusable(b, r);
      send(p, b, x.cmd, watch, x.why);
      continue;
    }
    const ready = blueUnits(b).filter((u) => !done.has(u.id) && !(u.acted && !(u.smoked && !u.moved)));
    if (!ready.length) break;
    const u = r.pick(ready);
    const k = r.next();
    if (k < o.advice) {
      const plan = advise(b, u.id);
      if (!plan.length) done.add(u.id);
      for (const a of plan) if (!send(p, b, { type: 'act', action: a }, watch)) break;
      continue;
    }
    if (k < o.advice + o.planner) {
      const a = decide(copyBattle(b), 'blue');
      if (a) send(p, b, { type: 'act', action: a }, watch);
      else done.add(u.id);
      continue;
    }
    const a = randomAction(b, u, r);
    if (a && send(p, b, { type: 'act', action: a }, watch)) continue;
    const n = (misses.get(u.id) ?? 0) + 1;
    misses.set(u.id, n);
    if (n >= 3) done.add(u.id);
  }
  if (b.ended) return;
  if (r.chance(o.retreat)) send(p, b, { type: 'retreat' }, watch);
  else send(p, b, { type: r.chance(o.auto) ? 'auto' : 'end' }, watch);
}

export interface Played {
  setup: ArenaSetup;
  b: Battle;
  p: Player;
  /** The battle's hash after `at` commands: at the start, after every turn, and at the end. */
  marks: { at: number; hash: string }[];
}

/** A battle played by the seeded policy for up to `turns` player turns (to its end by default). */
export function play(setup: ArenaSetup, seed: number, opts: PolicyOptions & { turns?: number } = {}, watch?: Watch): Played {
  const b = createBattle(setup);
  const p = player(seed, opts);
  const marks = [{ at: 0, hash: hashBattle(b) }];
  const turns = opts.turns ?? ROUND_LIMIT + 1;
  for (let t = 0; t < turns && !b.ended; t++) {
    playTurn(p, b, watch);
    marks.push({ at: b.commands?.length ?? 0, hash: hashBattle(b) });
  }
  return { setup, b, p, marks };
}

/** Rebuild a played battle command by command; the first mark whose hash differs, or null. */
export function replayDiverges(played: Played): { at: number; want: string; got: string } | null {
  const rb = createBattle(played.setup);
  const cmds = played.b.commands ?? [];
  let next = 0;
  for (let i = 0; i <= cmds.length; i++) {
    while (next < played.marks.length && played.marks[next]!.at === i) {
      const got = hashBattle(rb);
      if (got !== played.marks[next]!.hash) return { at: i, want: played.marks[next]!.hash, got };
      next++;
    }
    if (i < cmds.length && !submit(rb, cmds[i]!)) return { at: i, want: 'accepted', got: 'refused' };
  }
  const got = hashBattle(rb);
  const want = hashBattle(played.b);
  return got === want ? null : { at: cmds.length, want, got };
}

// --- Checks on a state and on a step --------------------------------------------------------------

function nonFinite(v: unknown, path: string, out: string[]): void {
  if (out.length > 5) return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(`${path} is ${v}`);
  } else if (Array.isArray(v)) v.forEach((x, i) => nonFinite(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) nonFinite(x, `${path}.${k}`, out);
}

const isInt = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

/** Everything that must hold in any battle state. Returns what broke. */
export function stateProblems(b: Battle): string[] {
  const bad: string[] = [];
  nonFinite(b, 'battle', bad);
  if (!isInt(b.round, 1, ROUND_LIMIT)) bad.push(`round ${b.round}`);
  if (b.turnIndex !== 2 * (b.round - 1) + (b.turn === 'red' ? 1 : 0)) bad.push(`turn index ${b.turnIndex} in round ${b.round} (${b.turn})`);
  if ((b.ended === null) !== (b.endReason === null)) bad.push(`ended ${b.ended} for ${b.endReason}`);
  if (!isInt(b.stream, 0, 0xffffffff)) bad.push(`stream ${b.stream}`);
  if (!isInt(b.capture, 0, CAPTURE_ROUNDS)) bad.push(`capture ${b.capture}`);
  if (!isInt(b.precision, 0, 3)) bad.push(`precision ${b.precision}`);
  for (const s of ['blue', 'red'] as const) for (const [k, v] of Object.entries(b.stats[s])) if (!isInt(v, 0, 1e9)) bad.push(`${s} ${k} ${v}`);
  for (const s of b.support) if (!isInt(s.missions, 0, 99)) bad.push(`${s.id} missions ${s.missions}`);
  const n = W * H;
  const m = b.map;
  for (const k of ['cells', 'elev', 'storeys', 'hp', 'variant', 'crater'] as const) if (m[k].length !== n) bad.push(`map ${k} has ${m[k].length}`);
  for (let i = 0; i < n; i++) {
    if (!isInt(m.cells[i]!, 0, 8)) bad.push(`cell ${i} is ${m.cells[i]}`);
    if (!isInt(m.elev[i]!, 0, 4)) bad.push(`elevation ${i} is ${m.elev[i]}`);
    if (!isInt(m.hp[i]!, 0, 1000)) bad.push(`hp ${i} is ${m.hp[i]}`);
    if (m.crater[i] !== 0 && m.crater[i] !== 1) bad.push(`crater ${i} is ${m.crater[i]}`);
    if ((m.cells[i] === BUILDING) !== (m.storeys[i]! > 0)) bad.push(`cell ${i} is ${m.cells[i]} with ${m.storeys[i]} storeys`);
    if (bad.length > 20) return bad;
  }
  const ids = new Set<string>();
  const ground = new Map<string, string>();
  const air = new Map<string, string>();
  for (const u of b.units) {
    const t = TYPES[u.type];
    if (!t) {
      bad.push(`${u.id} has type ${u.type}`);
      continue;
    }
    if (ids.has(u.id)) bad.push(`two units ${u.id}`);
    ids.add(u.id);
    if (!isInt(u.x, 0, W - 1) || !isInt(u.y, 0, H - 1)) bad.push(`${u.id} at ${u.x},${u.y}`);
    if (!isInt(u.supp, 0, 100)) bad.push(`${u.id} suppression ${u.supp}`);
    if (!isInt(u.crew, 0, t.crew)) bad.push(`${u.id} crew ${u.crew}`);
    if (!isInt(u.aps, 0, t.aps?.charges ?? 0)) bad.push(`${u.id} APS ${u.aps}`);
    if (!Number.isInteger(u.revealed) || u.revealed < -1) bad.push(`${u.id} revealed ${u.revealed}`);
    for (const [k, v] of [...Object.entries(u.ammo), ...Object.entries(u.smoke)]) if (!isInt(v, 0, 999)) bad.push(`${u.id} ${k} ${v}`);
    if (u.men.length > (t.men?.length ?? 0)) bad.push(`${u.id} has ${u.men.length} men`);
    if (u.alive !== (u.status === 'ok')) bad.push(`${u.id} alive ${u.alive} but ${u.status}`);
    if (!(u.startValue >= 0)) bad.push(`${u.id} start value ${u.startValue}`);
    if (u.carrier) {
      const c = b.units.find((x) => x.id === u.carrier);
      if (!c || !c.passengers.includes(u.id)) bad.push(`${u.id} aboard ${u.carrier} that does not carry it`);
      else if (c.x !== u.x || c.y !== u.y) bad.push(`${u.id} at ${u.x},${u.y} aboard ${c.id} at ${c.x},${c.y}`);
    }
    for (const id of u.passengers) if (b.units.find((x) => x.id === id)?.carrier !== u.id) bad.push(`${u.id} carries ${id} that is not aboard`);
    if (!u.alive && u.passengers.length) bad.push(`${u.id} dead with ${u.passengers.length} aboard`);
    if (!u.alive || u.carrier) continue;
    if (t.mobility === 'foot' && fitMen(u) === 0) bad.push(`${u.id} alive with nobody fit`);
    const key = `${u.x},${u.y}`;
    const layer = isFlying(t) ? air : ground;
    if (layer.has(key)) bad.push(`${u.id} and ${layer.get(key)} share ${key}`);
    layer.set(key, u.id);
  }
  const mines = new Set<string>();
  for (const x of b.mines) {
    if (!inside(x.x, x.y) || !Number.isInteger(x.x) || !Number.isInteger(x.y)) bad.push(`mine at ${x.x},${x.y}`);
    if (mines.has(`${x.x},${x.y}`)) bad.push(`two mines at ${x.x},${x.y}`);
    mines.add(`${x.x},${x.y}`);
  }
  for (const s of b.smoke) if (!inside(s.x, s.y) || !(s.until > b.turnIndex)) bad.push(`smoke at ${s.x},${s.y} until ${s.until} in turn ${b.turnIndex}`);
  for (const w of b.wrecks) if (!inside(w.x, w.y) || !isInt(w.burning, 0, 3)) bad.push(`wreck ${w.unit} at ${w.x},${w.y} burning ${w.burning}`);
  for (const s of ['blue', 'red'] as const)
    for (const g of Object.values(b.intel[s])) if (!inside(g.x, g.y) || !TYPES[g.type] || g.turn > b.turnIndex) bad.push(`${s} ghost ${g.unit} at ${g.x},${g.y} turn ${g.turn}`);
  return bad;
}

/** What acted in an event, when a unit did. */
function actor(e: BattleEvent): string | null {
  switch (e.type) {
    case 'move':
    case 'face':
    case 'embark':
    case 'split':
    case 'merge':
    case 'treat':
    case 'repair':
      return e.unit;
    case 'fire':
      return e.unit.startsWith('support:') ? null : e.unit;
    case 'dismount':
      return e.carrier;
    default:
      return null;
  }
}

/** Everything that must hold from one state to the next across a command. Returns what broke. */
export function stepProblems(before: Battle, after: Battle, cmd: PlayerCommand, ok: boolean): string[] {
  const bad: string[] = [];
  const logged = (after.commands?.length ?? 0) - (before.commands?.length ?? 0);
  if (logged !== (ok ? 1 : 0)) bad.push(`${ok ? 'accepted' : 'refused'} command logged ${logged} times`);
  if (after.round < before.round || after.turnIndex < before.turnIndex) bad.push(`time went back: round ${before.round} to ${after.round}`);
  if (after.events.length < before.events.length) bad.push('events were dropped');
  else if (before.events.length && JSON.stringify(after.events[before.events.length - 1]) !== JSON.stringify(before.events.at(-1))) bad.push('an old event changed');
  if (before.ended && JSON.stringify({ ...after, commands: undefined }) !== JSON.stringify({ ...before, commands: undefined })) bad.push('a finished battle changed');
  for (const s of ['blue', 'red'] as const) for (const k of ['shots', 'hits', 'kills', 'lost'] as const) if (after.stats[s][k] < before.stats[s][k]) bad.push(`${s} ${k} went down`);
  for (const a of Object.keys(before.abilities) as AbilityId[]) if (before.abilities[a] === 'used' && after.abilities[a] !== 'used') bad.push(`${a} was used and is back`);
  for (const s of before.support) if ((after.support.find((x) => x.id === s.id && x.side === s.side)?.missions ?? 0) > s.missions) bad.push(`${s.id} missions went up`);
  const dead = new Set(before.units.filter((u) => !u.alive).map((u) => u.id));
  for (const u of before.units) {
    const v = after.units.find((x) => x.id === u.id);
    if (!u.alive) {
      if (!v) bad.push(`dead ${u.id} vanished`);
      else if (v.alive || v.x !== u.x || v.y !== u.y) bad.push(`dead ${u.id} came back or moved`);
      continue;
    }
    if (!v) continue;
    for (const [k, n] of Object.entries(u.ammo)) if ((v.ammo[k] ?? 0) > n && u.type === v.type) bad.push(`${u.id} ${k} rose from ${n} to ${v.ammo[k]}`);
  }
  for (const e of after.events.slice(before.events.length)) {
    const who = actor(e);
    if (who && dead.has(who)) bad.push(`dead ${who} did ${e.type}`);
  }
  if (ok && cmd && cmd.type === 'act' && 'unit' in cmd.action && cmd.action.unit && cmd.action.type !== 'ability') {
    const a = cmd.action;
    const u = before.units.find((x) => x.id === a.unit);
    if (!u || u.side !== 'blue' || !u.alive) bad.push(`${a.type} by ${a.unit}, not a live blue unit, was accepted`);
    else if (u.acted && a.type !== 'dismount' && !(a.type === 'move' && u.smoked && !a.dash)) bad.push(`${u.id} acted again (${a.type})`);
    else if (u.moved && (a.type === 'move' || a.type === 'face')) bad.push(`${u.id} moved again (${a.type})`);
  }
  return bad;
}

// --- The fog probe ---------------------------------------------------------------------------------

/** The HUD's enemy strength bar (ArenaScreen's `strengths`): theirs as far as blue has seen it fall. */
export function knownStrength(b: Battle): number {
  const start = b.units.filter((u) => u.side === 'red').reduce((s, u) => s + u.startValue, 0) || 1;
  const gone = new Set<string>();
  for (const e of b.events) if (e.type === 'destroyed' && e.seen) gone.add(e.unit);
  const seen = visibleTo(b, 'blue');
  let red = start;
  for (const u of b.units) {
    if (u.side !== 'red') continue;
    if (gone.has(u.id)) red -= u.startValue;
    else if (seen.has(u.id)) red -= u.startValue - unitValue(u);
  }
  return Math.max(0, red / start);
}

/** What the film may show blue of an event (by its `seen` flags and sides); the fog probe compares only these. */
export function blueMaySee(e: BattleEvent): boolean {
  switch (e.type) {
    case 'move':
      return e.seen.some(Boolean);
    case 'spotted':
    case 'lost':
    case 'radio':
      return e.side === 'blue';
    case 'mine':
      return e.side === 'blue' || !e.laid;
    case 'turn':
    case 'smoke':
    case 'crater':
    case 'terrain':
    case 'capture':
    case 'end':
    case 'ability':
    case 'split':
    case 'merge':
    case 'treat':
    case 'repair':
      return true;
    default:
      return e.seen;
  }
}

const card = (f: FireInfo | null) =>
  f && { weapon: f.weapon.id, chance: f.chance, parts: f.parts, cover: f.cover, hullDown: f.hullDown, facing: f.facing, pen: f.pen, aps: f.aps, kill: f.kill, intercept: f.intercept, casualties: f.casualties, supp: f.supp };

/** The cells, ids and steps a probe asks about: chosen once, from the battle as it was, so both sides of a comparison ask the same. */
export interface ProbeAsk {
  cells: Point[];
  ids: string[];
  /** Blue units to ask for advice. */
  advise: string[];
  /** Blue orders whose refusal reasons are read (`whyNot`). */
  orders: Action[];
  /** Blue steps taken on a copy to read whether they could be undone. */
  steps: Action[];
}

/** Questions for a probe: cells around blue's units and ghosts, plus `extra` (the cells a change touched). */
export function probeAsk(b: Battle, r: Rng, touched: Point[] = [], ids: string[] = [], adviceUnits = 1): ProbeAsk {
  const blue = blueUnits(b).sort((p, q) => (p.id < q.id ? -1 : 1));
  // A change that touched many cells (overwatch on every hidden unit) is asked about three of them.
  const pool = [...touched];
  const extra: Point[] = [];
  while (extra.length < 3 && pool.length) extra.push(pool.splice(r.int(pool.length), 1)[0]!);
  const cells: Point[] = [...extra];
  const ghosts = Object.values(b.intel.blue).sort((p, q) => (p.unit < q.unit ? -1 : 1));
  for (let i = 0; i < 3 && ghosts.length; i++) cells.push({ ...ghosts.splice(r.int(ghosts.length), 1)[0]! });
  for (let i = 0; i < 3 && blue.length; i++) cells.push(near(r.pick(blue), 8, r));
  cells.push(randomCell(r));
  const orders: Action[] = [];
  const steps: Action[] = [];
  // Orders from four units, engineers and guns first: they are the ones whose orders read a cell.
  const askers = [...blue].sort((p, q) => Number(!typeOf(p.type).engineer && !typeOf(p.type).weapons.some((w) => w.indirect)) - Number(!typeOf(q.type).engineer && !typeOf(q.type).weapons.some((w) => w.indirect)) || r.next() - 0.5);
  for (const u of askers.slice(0, 4)) {
    const w = typeOf(u.type).weapons;
    for (const p of extra) {
      orders.push({ type: 'move', unit: u.id, to: p });
      if (typeOf(u.type).engineer) {
        orders.push({ type: 'breach', unit: u.id, at: p }, { type: 'mine', unit: u.id, at: p });
      }
      const ind = w.find((x) => x.indirect);
      if (ind) orders.push({ type: 'strike', unit: u.id, at: p, weapon: ind.id });
    }
    for (const id of ids) if (w[0]) orders.push({ type: 'fire', unit: u.id, target: id, weapon: w[0].id });
    if (typeOf(u.type).engineer) for (let i = 0; i < 3; i++) {
      const p = adjacent(u, r);
      if (inside(p.x, p.y)) orders.push({ type: 'breach', unit: u.id, at: p }, { type: 'mine', unit: u.id, at: p });
    }
  }
  for (const s of b.support) if (s.side === 'blue') for (const p of extra) orders.push({ type: 'support', asset: s.id, at: p });
  // Steps: a move toward each changed cell and a few anywhere in reach, a turn, overwatch, hunker.
  const known = visibleTo(b, 'blue');
  for (const u of blue.filter((x) => !x.moved && !x.acted)) {
    const reach = [...reachable(b, u, false, known).cost.keys()].filter((i) => i !== at(b.map, u.x, u.y)).sort((p, q) => p - q);
    if (!reach.length) continue;
    for (const p of extra) {
      const best = reach.reduce((m, i) => (dist({ x: i % W, y: Math.floor(i / W) }, p) < dist({ x: m % W, y: Math.floor(m / W) }, p) ? i : m), reach[0]!);
      steps.push({ type: 'move', unit: u.id, to: { x: best % W, y: Math.floor(best / W) } });
    }
    if (r.chance(0.3)) {
      const i = r.pick(reach);
      steps.push({ type: 'move', unit: u.id, to: { x: i % W, y: Math.floor(i / W) } });
    }
  }
  const idle = blue.filter((x) => !x.acted);
  if (idle.length) {
    const u = r.pick(idle);
    steps.push({ type: 'overwatch', unit: u.id });
    steps.push(typeOf(u.type).mobility === 'foot' ? { type: 'hunker', unit: u.id } : { type: 'face', unit: u.id, facing: r.next() * 6 - 3 });
  }
  const free = [...idle];
  const chosen: string[] = [];
  while (chosen.length < adviceUnits && free.length) chosen.push(free.splice(r.int(free.length), 1)[0]!.id);
  return { cells, ids, advise: chosen, orders, steps: steps.slice(0, 8) };
}

const sortedReach = (b: Battle, u: Unit, dash: boolean, known: Set<string>) => {
  const r = reachable(b, u, dash, known);
  return [...r.cost.entries()].sort((p, q) => p[0] - q[0]).map(([i, c]) => `${i}:${c}:${r.prev.get(i) ?? -1}`).join(' ');
};

/** One undo question: whether the step could be taken back, and what blue saw of it. */
export interface UndoRead {
  ok: boolean;
  undo: boolean;
  /** Blue's picture after the step and the new events it may see. */
  saw: string;
  /** Red's side sighted or lost a blue unit in the step (blue is not shown this). */
  redSaw: boolean;
}

/**
 * Everything the player is shown from blue's seat, as plain data: what it sees, the enemy area,
 * every unit's reach, shot cards on everything in sight (from where it stands and from a cell it
 * could move to), called and off-map fire on the asked cells, why orders would be refused, advice,
 * whether steps could be undone, the strength bar, and the hash of blue's observation.
 */
export function probe(b: Battle, ask: ProbeAsk, opts: { advice?: boolean; exclude?: ReadonlySet<string> } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const known = visibleTo(b, 'blue');
  const ex = opts.exclude ?? new Set<string>();
  out.visible = [...known].filter((id) => !ex.has(id)).sort();
  out.area = enemyArea(b);
  const blue = blueUnits(b).sort((p, q) => (p.id < q.id ? -1 : 1));
  const targets = b.units.filter((e) => known.has(e.id)).sort((p, q) => (p.id < q.id ? -1 : 1));
  for (const u of blue) {
    out[`reach ${u.id}`] = sortedReach(b, u, false, known);
    out[`dash ${u.id}`] = sortedReach(b, u, true, known);
    const reach = [...reachable(b, u, false, known).cost.keys()].sort((p, q) => p - q);
    const cell = reach[Math.floor(reach.length / 2)];
    const from = cell === undefined ? u : { x: cell % W, y: Math.floor(cell / W) };
    for (const e of targets) {
      out[`best ${u.id}>${e.id}`] = card(bestFire(b, u, e, u, false, known));
      out[`from ${u.id}>${e.id}`] = card(bestFire(b, { ...u, moved: true }, e, from, false, known));
      for (const w of usableWeapons(u)) if (!w.indirect) out[`card ${u.id}>${e.id} ${w.id}`] = card(fireInfo(b, u, e, w, u, false, known));
    }
    for (const w of typeOf(u.type).weapons.filter((x) => x.indirect))
      for (const p of ask.cells) {
        const s = strikeInfo(b, u, p, w);
        const m = strikeInfo(b, u, p, w, true);
        out[`strike ${u.id}@${p.x},${p.y}`] = [s && { chance: s.chance, observed: s.observed, parts: s.parts }, m && m.chance];
      }
  }
  for (const s of b.support) if (s.side === 'blue') for (const p of ask.cells) out[`support ${s.id}@${p.x},${p.y}`] = supportChance(b, 'blue', s.id, p);
  ask.orders.forEach((a, i) => (out[`why ${i} ${a.type}`] = whyNot(b, a, 'blue')));
  if (opts.advice) for (const id of ask.advise) out[`advice ${id}`] = advise(b, id);
  const undo: UndoRead[] = [];
  for (const a of ask.steps) {
    const before = copyBattle(b);
    const after = copyBattle(b);
    const ok = act(after, a, 'blue');
    const fresh = after.events.slice(before.events.length);
    undo.push({
      ok,
      undo: ok && undoable(before, after),
      saw: ok ? `${hashBattle(observe(after, 'blue'))} ${JSON.stringify(fresh.filter(blueMaySee))}` : '',
      redSaw: fresh.some((e) => (e.type === 'spotted' || e.type === 'lost') && e.side === 'red'),
    });
  }
  out.undo = undo;
  out.strength = knownStrength(b);
  out.observation = hashBattle(observe(b, 'blue'));
  return out;
}

export interface Leak {
  key: string;
  was: unknown;
  now: unknown;
}

/**
 * Where two probes differ. Undo is compared only where the step showed blue the same thing in
 * both: a step that met something hidden shows it (a shot, a stop), and then its undo may differ.
 */
export function leaks(was: Record<string, unknown>, now: Record<string, unknown>, skip: ReadonlySet<string> = new Set()): Leak[] {
  const out: Leak[] = [];
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (skip.has(key)) continue;
    if (key === 'undo') {
      const a = was.undo as UndoRead[];
      const c = now.undo as UndoRead[];
      a.forEach((x, i) => {
        const y = c[i]!;
        if (x.ok === y.ok && x.saw === y.saw && x.undo !== y.undo) out.push({ key: `undo ${i}`, was: x, now: y });
        else if (x.ok !== y.ok) out.push({ key: `undo ${i} accepted`, was: x.ok, now: y.ok });
      });
      continue;
    }
    const p = JSON.stringify(was[key]);
    const q = JSON.stringify(now[key]);
    if (p !== q) out.push({ key, was: was[key], now: now[key] });
  }
  return out;
}

/** The family a probe key belongs to, for tallies: sight, reach, shot card, refusal of an order, and so on. */
export function family(key: string): string {
  if (key === 'visible') return 'sight';
  if (key === 'area') return 'enemy area';
  if (key === 'strength') return 'strength bar';
  if (key === 'observation') return 'observation';
  if (key.startsWith('undo')) return 'undo';
  const why = /^why \d+ (\w+)$/.exec(key);
  if (why) return `refusal: ${why[1]}`;
  const head = key.split(' ')[0]!;
  return ({ reach: 'reach', dash: 'reach', best: 'shot card', from: 'shot card', card: 'shot card', strike: 'called fire', support: 'off-map fire', advice: 'advice' } as Record<string, string>)[head] ?? key;
}

/**
 * Leaks already reported as defects, by id, or null for a new one. `refusal-names-hidden`: `whyNot`
 * on a fire order says "No shot" for a hidden unit and "No such weapon" for an id nobody has.
 * `refusal-engineer-cell`: `whyNot` on a breach or a mine reads hidden mines and units on the
 * cell next to the engineer. `undo-red-sighting`: a step a hidden enemy sees (or stops seeing)
 * cannot be undone, though blue is shown nothing of it.
 */
export function knownLeak(l: Leak): string | null {
  const f = family(l.key);
  if (f === 'refusal: fire' && new Set([l.was, l.now, 'No shot', 'No such weapon']).size === 2) return 'refusal-names-hidden';
  if (f === 'refusal: breach' || f === 'refusal: mine') return 'refusal-engineer-cell';
  if (l.key.startsWith('undo ') && !l.key.endsWith('accepted') && (l.was as UndoRead).redSaw !== (l.now as UndoRead).redSaw) return 'undo-red-sighting';
  return null;
}

// --- Changes blue must not see -------------------------------------------------------------------

export const CHANGES = ['move', 'remove', 'add', 'state', 'mine-add', 'mine-remove', 'mine-move', 'overwatch', 'intel', 'dice', 'stores'] as const;
export type Change = (typeof CHANGES)[number];

export interface Changed {
  b: Battle;
  kind: Change;
  /** The hidden unit it touched. */
  unit: string | null;
  /** Cells it touched, for the probe to ask about. */
  cells: Point[];
  /** It changed the enemy's starting company (a unit added or taken away). */
  roster: boolean;
}

const sameSet = (a: Set<string>, c: Set<string>) => a.size === c.size && [...a].every((x) => c.has(x));

function freeCell(b: Battle, r: Rng, air: boolean, around: Point | null): Point | null {
  for (let i = 0; i < 40; i++) {
    const p = around ? near(around, 2 + r.int(7), r) : randomCell(r);
    if (b.units.some((u) => onField(u) && u.x === p.x && u.y === p.y && isFlying(typeOf(u.type)) === air)) continue;
    return p;
  }
  return null;
}

/** Where a change goes: near blue's units (just out of sight), on a last known position, near `home`, or anywhere. */
function target(b: Battle, r: Rng, home: Point | null = null): Point | null {
  const blue = blueUnits(b);
  const ghosts = Object.values(b.intel.blue);
  const k = r.next();
  if (k < 0.3 && blue.length) return r.pick(blue);
  if (k < 0.55 && ghosts.length) return r.pick(ghosts);
  if (k < 0.85 && home) return home;
  return null;
}

function hiddenUnit(type: TypeId, id: string, p: Point): Unit {
  const t = typeOf(type);
  const ammo: Record<string, number> = {};
  const smoke: Record<string, number> = {};
  for (const w of t.weapons) {
    if (w.ammo !== null) ammo[w.id] = w.ammo;
    if (w.indirect && w.smoke) smoke[w.id] = w.smoke;
  }
  if (t.smoke) smoke.grenades = t.smoke;
  return {
    id,
    type,
    side: 'red',
    formation: 'hidden',
    name: id,
    rank: 1,
    x: p.x,
    y: p.y,
    facing: Math.PI / 2,
    aim: Math.PI / 2,
    alive: true,
    status: 'ok',
    crew: t.crew,
    mobilityKill: false,
    firepowerKill: false,
    optics: false,
    men: (t.men ?? []).map((role) => ({ role, state: 'fit' as const })),
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
    carrier: null,
    passengers: [],
    parent: null,
    revealed: -1,
    startValue: t.value,
  };
}

/**
 * A copy of the battle with one change blue cannot see (a hidden red unit moved, taken away,
 * added or altered; red mines laid, cleared or moved; red overwatch switched; red's picture of
 * blue; the dice; what red units in sight carry), or null when none could be made that stays
 * hidden. Hidden means blue sees exactly the same units afterwards.
 */
export function change(b: Battle, kind: Change, r: Rng): Changed | null {
  const seen = visibleTo(b, 'blue');
  const redAlive = b.units.filter((u) => u.side === 'red' && u.alive && unitValue(u) > 0);
  const hidden = b.units.filter((u) => u.side === 'red' && onField(u) && !seen.has(u.id)).sort((p, q) => (p.id < q.id ? -1 : 1));
  for (let attempt = 0; attempt < 20; attempt++) {
    const c = copyBattle(b);
    let unit: string | null = null;
    let roster = false;
    const cells: Point[] = [];
    const u = hidden.length ? c.units.find((x) => x.id === r.pick(hidden).id)! : null;
    switch (kind) {
      case 'move': {
        if (!u) return null;
        const p = freeCell(c, r, isFlying(typeOf(u.type)), target(c, r, u));
        if (!p || !passable(c.map, p.x, p.y, typeOf(u.type).mobility, typeOf(u.type).amphibious)) continue;
        cells.push({ x: u.x, y: u.y }, p);
        u.x = p.x;
        u.y = p.y;
        for (const id of u.passengers) {
          const q = c.units.find((x) => x.id === id);
          if (q) {
            q.x = p.x;
            q.y = p.y;
          }
        }
        unit = u.id;
        break;
      }
      case 'remove': {
        // Never the last of them: a battle with no enemy left is over.
        if (!u || redAlive.filter((x) => x.id !== u.id && !u.passengers.includes(x.id)).length === 0) return null;
        cells.push({ x: u.x, y: u.y });
        const gone = new Set([u.id, ...u.passengers]);
        c.units = c.units.filter((x) => !gone.has(x.id));
        unit = u.id;
        roster = true;
        break;
      }
      case 'add': {
        const faction = typeOf(b.units.find((x) => x.side === 'red')?.type ?? 't90m').faction;
        const types = (Object.keys(TYPES) as TypeId[]).filter((t) => TYPES[t].faction === faction).sort();
        const type = r.pick(types);
        const p = freeCell(c, r, isFlying(typeOf(type)), target(c, r, hidden.length ? r.pick(hidden) : null));
        if (!p || !passable(c.map, p.x, p.y, typeOf(type).mobility, typeOf(type).amphibious)) continue;
        const id = `hidden:${attempt}`;
        const h = hiddenUnit(type, id, p);
        h.overwatch = r.chance(0.5) && usableWeapons(h).some((w) => !w.indirect);
        h.hunker = typeOf(type).mobility === 'foot' && r.chance(0.5);
        c.units.push(h);
        cells.push(p);
        unit = id;
        roster = true;
        break;
      }
      case 'state': {
        if (!u) return null;
        const t = typeOf(u.type);
        u.supp = r.int(101);
        u.facing = (r.next() * 2 - 1) * Math.PI;
        u.aim = u.facing;
        u.overwatch = r.chance(0.5);
        u.hunker = t.mobility === 'foot' && r.chance(0.5);
        u.moved = r.chance(0.5);
        u.acted = r.chance(0.5);
        if (t.crew > 1) u.crew = 1 + r.int(t.crew);
        if (t.armour) {
          u.mobilityKill = r.chance(0.3);
          u.firepowerKill = r.chance(0.3);
        }
        for (const m of u.men) if (r.chance(0.3)) m.state = r.chance(0.5) ? 'wounded' : 'dead';
        if (u.men.length && fitMen(u) === 0) u.men[0]!.state = 'fit';
        for (const k of Object.keys(u.ammo)) u.ammo[k] = r.int((u.ammo[k] ?? 0) + 1);
        cells.push({ x: u.x, y: u.y });
        unit = u.id;
        break;
      }
      case 'mine-add': {
        // Next to a blue engineer when there is one: where a mine detector would tell.
        const eng = blueUnits(c).filter((x) => typeOf(x.type).engineer);
        const p = eng.length && r.chance(0.6) ? adjacent(r.pick(eng), r) : near(target(c, r) ?? randomCell(r), 3, r);
        if (!inside(p.x, p.y) || !passable(c.map, p.x, p.y, 'tracked') || c.mines.some((m) => m.x === p.x && m.y === p.y)) continue;
        c.mines.push({ x: p.x, y: p.y, side: 'red' });
        cells.push(p);
        break;
      }
      case 'mine-remove': {
        const red = c.mines.filter((m) => m.side === 'red');
        if (!red.length) return null;
        const m = r.pick(red);
        c.mines = c.mines.filter((x) => x !== m);
        cells.push({ x: m.x, y: m.y });
        break;
      }
      case 'mine-move': {
        const red = c.mines.filter((m) => m.side === 'red');
        if (!red.length) return null;
        const m = r.pick(red);
        const p = near(m, 4, r);
        if (!passable(c.map, p.x, p.y, 'tracked') || c.mines.some((x) => x.x === p.x && x.y === p.y)) continue;
        cells.push({ x: m.x, y: m.y }, p);
        m.x = p.x;
        m.y = p.y;
        break;
      }
      case 'overwatch': {
        if (!hidden.length) return null;
        const on = r.chance(0.5);
        for (const h of hidden) {
          const x = c.units.find((y) => y.id === h.id)!;
          x.overwatch = on && usableWeapons(x).some((w) => !w.indirect);
          cells.push({ x: x.x, y: x.y });
        }
        break;
      }
      case 'intel': {
        const blue = c.units.filter((x) => x.side === 'blue');
        if (r.chance(0.5)) c.intel.red = {};
        else for (const x of blue) if (r.chance(0.5)) c.intel.red[x.id] = { unit: x.id, type: x.type, x: x.x, y: x.y, turn: c.turnIndex, now: r.chance(0.5) };
        break;
      }
      case 'dice':
        c.stream = (c.stream ^ (1 + r.int(0x7fffffff))) >>> 0;
        break;
      case 'stores': {
        const inSight = c.units.filter((x) => seen.has(x.id));
        if (!inSight.length) return null;
        for (const x of inSight) {
          for (const k of Object.keys(x.ammo)) x.ammo[k] = r.int((x.ammo[k] ?? 0) + 1);
          for (const k of Object.keys(x.smoke)) x.smoke[k] = r.int((x.smoke[k] ?? 0) + 1);
          x.aps = r.int(x.aps + 1);
          x.optics = r.chance(0.3);
          cells.push({ x: x.x, y: x.y });
        }
        break;
      }
    }
    if (!sameSet(visibleTo(c, 'blue'), seen)) continue;
    if (c.ended !== b.ended) continue;
    return { b: c, kind, unit, cells: cells.filter((p) => inside(p.x, p.y)), roster };
  }
  return null;
}

/** Hidden ids a probe should name (the changed unit and one other out of sight), so `whyNot` is asked about them. */
export const probeIds = (b: Battle, c: Changed): string[] => {
  const ids = c.unit ? [c.unit] : [];
  const seen = visibleTo(b, 'blue');
  const any = b.units.find((u) => u.side === 'red' && !seen.has(u.id));
  if (any && !ids.includes(any.id)) ids.push(any.id);
  return ids;
};
