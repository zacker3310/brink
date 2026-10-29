import type { Terrain } from '@brink/contracts';
import * as rng from '../rng';
import * as v2 from './types';
import type { BattleMap, Biome, Cell, MapSetup, Mobility, Point } from './types';

// Local copies: some loaders turn imported names into getter calls, which the hot loops here feel.
const { draw } = rng;
const { at, BRIDGE, BUILDING, BUILDING_HP_PER_STOREY, BUILDING_KINDS, H, MAX_ELEV, OPEN, ROAD, ROCK, RUBBLE, TREE_KINDS, TREES, W, WALL, WALL_KINDS, WATER, ZONE_RADIUS } = v2;

// The v2 battlefield: 30 x 45 cells of real ground for the biome, built from the seed. The attacker
// deploys on the bottom rows and fights north; the defender holds the top third. In order: the ground
// (ridges, valleys, the river's low banks), roads and bridges, towns and villages, woods and walls,
// the zone and the spawns, then a check that vehicles can drive from the attackers' edge to the
// objective (a road is carved if they cannot).

const N = W * H;
/** Features stop here: the rows below are the attackers' assembly area. */
const LAST_ROW = 38;
/** The attackers deploy on these rows. */
const BLUE_ROWS = 40;
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

// Kinds, kept in the low two bits of `variant`.
const HEDGE = WALL_KINDS.indexOf('hedge');
const STONE = WALL_KINDS.indexOf('stone');
const SANDBAG = WALL_KINDS.indexOf('sandbag');
const HESCO = WALL_KINDS.indexOf('hesco');
const HOUSE = BUILDING_KINDS.indexOf('house');
const APARTMENT = BUILDING_KINDS.indexOf('apartment');
const INDUSTRIAL = BUILDING_KINDS.indexOf('industrial');
const SHOP = BUILDING_KINDS.indexOf('shop');
const BROADLEAF = TREE_KINDS.indexOf('broadleaf');
const CONIFER = TREE_KINDS.indexOf('conifer');
const BIRCH = TREE_KINDS.indexOf('birch');
const SCRUB = TREE_KINDS.indexOf('scrub');

/** Share of the field under woods, by biome and terrain. */
const WOODS: Record<Biome, Record<Terrain, number>> = {
  temperate: { plains: 0.11, forest: 0.42, hills: 0.15, mountains: 0.2, urban: 0.04, water: 0.08 },
  winter: { plains: 0.15, forest: 0.47, hills: 0.2, mountains: 0.24, urban: 0.05, water: 0.1 },
  steppe: { plains: 0.025, forest: 0.24, hills: 0.06, mountains: 0.1, urban: 0.02, water: 0.03 },
  desert: { plains: 0, forest: 0.14, hills: 0, mountains: 0, urban: 0, water: 0 },
  urban: { plains: 0, forest: 0.08, hills: 0.03, mountains: 0.05, urban: 0, water: 0 },
};

interface Town {
  cx: number;
  cy: number;
  r: number;
  /** Radius of the open middle (the zone's square, the Hesco ring, the depot yard). */
  hole: number;
  /** The whole field is city (the urban biome). */
  full: boolean;
  cols: number[];
  rows: number[];
}

interface Village {
  x: number;
  y: number;
  houses: number;
}

interface River {
  /** Water rows per column, inclusive. */
  top: number[];
  bot: number[];
  /** Highest and lowest water rows anywhere. */
  north: number;
  south: number;
}

interface Gen {
  biome: Biome;
  terrain: Terrain;
  site: MapSetup['site'];
  s: { stream: number };
  cells: Cell[];
  elev: number[];
  storeys: number[];
  /** Low bits of `variant` for walls, buildings and trees; -1 elsewhere. */
  kind: number[];
  /** No buildings, trees or walls here: the zone, the Hesco ring, a depot yard. */
  reserved: Uint8Array;
  /** Dry stream beds, where desert scrub grows thicker. */
  wet: Uint8Array;
  river: River | null;
  bridges: number[];
  zone: (Point & { r: number }) | null;
  /** Where the defenders' business is: the zone, the depot, or their village. */
  heart: Point;
  town: Town | null;
  /** The main road, bottom edge to top. */
  main: number[];
  villages: Village[];
  farms: Point[];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (g: Gen) => draw(g.s);
const int = (g: Gen, a: number, b: number) => a + Math.floor(draw(g.s) * (b - a + 1));
const chance = (g: Gen, p: number) => draw(g.s) < p;
const idx = (x: number, y: number) => y * W + x;
const inField = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
const isRoad = (c: Cell | undefined) => c === ROAD || c === BRIDGE;
/** Distance; faster than Math.hypot in the hot loops. */
const hyp = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);

export function buildMap(setup: MapSetup): BattleMap {
  const g = start(setup);
  shapeGround(g);
  if (g.river) for (let x = 0; x < W; x++) for (let y = g.river.top[x]!; y <= g.river.bot[x]!; y++) g.cells[idx(x, y)] = WATER;
  if (g.town) layStreets(g);
  placeBridges(g);
  layRoads(g);
  settle(g);
  cover(g);
  finishZone(g);
  clearDeployment(g);
  level(g);
  return finish(g, ensurePassage(g));
}

// --- Setup -----------------------------------------------------------------------------------------

function start(setup: MapSetup): Gen {
  const g: Gen = {
    biome: setup.biome,
    terrain: setup.terrain,
    site: setup.site,
    s: { stream: (setup.seed ^ 0x51ed27a3) >>> 0 },
    cells: new Array<Cell>(N).fill(OPEN),
    elev: new Array<number>(N).fill(0),
    storeys: new Array<number>(N).fill(0),
    kind: new Array<number>(N).fill(-1),
    reserved: new Uint8Array(N),
    wet: new Uint8Array(N),
    river: null,
    bridges: [],
    zone: null,
    heart: { x: 15, y: 9 },
    town: null,
    main: [],
    villages: [],
    farms: [],
  };
  const capture = setup.site === 'capital' || setup.site === 'city' || setup.site === 'objective';
  if (capture) g.zone = { x: int(g, 14, 16), y: int(g, 9, 11), r: ZONE_RADIUS };
  g.heart = g.zone ? { x: g.zone.x, y: g.zone.y } : setup.site === 'depot' ? { x: int(g, 12, 17), y: int(g, 7, 10) } : { x: int(g, 9, 20), y: int(g, 6, 12) };
  const hole = setup.site === 'objective' ? ZONE_RADIUS + 2.7 : g.zone ? ZONE_RADIUS + 0.6 : setup.site === 'depot' ? 5 : 0;
  const r = townRadius(setup);
  if (r > 0) g.town = { cx: g.heart.x, cy: g.heart.y, r: r + hole * 0.6, hole, full: setup.biome === 'urban', cols: [], rows: [] };
  if (setup.river) g.river = riverPath(g);
  // The zone's square (and the Hesco ring round an objective) stay clear of buildings and trees.
  if (g.zone) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hyp(x - g.zone.x, y - g.zone.y) <= hole) g.reserved[idx(x, y)] = 1;
  return g;
}

/** Town radius in cells: the urban biome is all town; cities and capitals get a core round the zone. */
function townRadius(setup: MapSetup): number {
  if (setup.biome === 'urban') return 99;
  const urban = setup.terrain === 'urban';
  if (setup.site === 'capital') return urban ? 11 : 9;
  if (setup.site === 'city') return urban ? 10 : 7;
  return urban ? 8 : 0;
}

/** East to west across the middle band, 2 or 3 cells wide, meandering a little. */
function riverPath(g: Gen): River {
  const mid = 20.5 + rand(g) * 2;
  const amp = 0.8 + rand(g) * 1.2;
  const per = 14 + rand(g) * 14;
  const ph = rand(g) * Math.PI * 2;
  let w = int(g, 2, 3);
  const top: number[] = [];
  const bot: number[] = [];
  for (let x = 0; x < W; x++) {
    if (x > 0 && chance(g, 0.12)) w = 5 - w;
    let t = clamp(Math.round(mid + amp * Math.sin((x / per) * Math.PI * 2 + ph) - w / 2), 18, 27 - w);
    const prev = top[x - 1];
    if (prev !== undefined) t = clamp(t, prev - 1, prev + 1);
    top.push(t);
    bot.push(t + w - 1);
  }
  return { top, bot, north: Math.min(...top), south: Math.max(...bot) };
}

// --- Noise -------------------------------------------------------------------------------------------

function hash(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(seed: number, x: number, y: number, period: number): number {
  const fx = x / period;
  const fy = y / period;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(seed, ix, iy);
  const b = hash(seed, ix + 1, iy);
  const c = hash(seed, ix, iy + 1);
  const d = hash(seed, ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Smooth noise in 0..1: broad shapes at `period` cells, finer detail on top. */
function fbm(seed: number, x: number, y: number, period: number): number {
  return smooth(seed, x, y, period) * 0.6 + smooth(seed + 1, x, y, period / 2) * 0.28 + smooth(seed + 2, x, y, period / 4) * 0.12;
}

// --- Ground ------------------------------------------------------------------------------------------

function shapeGround(g: Gen): void {
  const F = new Float64Array(N);
  const ns = int(g, 1, 1 << 30);
  const t = g.terrain;
  if (t === 'hills') hillsGround(g, F, ns);
  else if (t === 'mountains') mountainGround(g, F, ns);
  else {
    // Plains roll gently, forest ground a little more, towns sit nearly flat.
    const [lo, amp] = t === 'forest' ? [0.3, 3.2] : t === 'urban' ? [0.45, 2] : [0.4, 2.4];
    const lift = g.biome === 'desert' ? 0.7 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) F[idx(x, y)] = (fbm(ns, x, y, 13) - lo) * amp + lift;
    const rises = t === 'urban' ? int(g, 0, 1) : int(g, 1, 2);
    for (let k = 0; k < rises; k++) {
      const cx = int(g, 3, W - 4);
      const cy = int(g, 3, LAST_ROW - 1);
      const r = 4 + rand(g) * 3;
      const h = 0.8 + rand(g) * 0.5;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
          const d = hyp(x - cx, y - cy) / r;
          const i = idx(x, y);
          if (d < 1) F[i] = F[i]! + h * (1 - d * d);
        }
    }
  }
  if (g.river) {
    // The river runs at the bottom of its valley, with low banks either side.
    const { top, bot } = g.river;
    for (let x = 0; x < W; x++)
      for (let y = top[x]! - 3; y <= bot[x]! + 3; y++) {
        if (y < 0 || y >= H) continue;
        const d = y < top[x]! ? top[x]! - y : y > bot[x]! ? y - bot[x]! : 0;
        const i = idx(x, y);
        F[i] = Math.min(F[i]!, d === 0 ? -1 : d === 1 ? 0.2 : d === 2 ? 0.7 : 1.3);
      }
  }
  if (g.biome === 'desert' && (t === 'plains' || t === 'forest' || t === 'hills' || t === 'water')) wadis(g, F);
  const cap = t === 'mountains' ? MAX_ELEV : t === 'hills' ? 3 : t === 'urban' ? 1 : 2;
  for (let i = 0; i < N; i++) g.elev[i] = clamp(Math.round(F[i]!), 0, cap);
  relax(g.elev);
  if (t === 'mountains') mesas(g);
}

/** Two to four ridges across the attack axis, crests up to 3, with saddles and tapering ends. */
function hillsGround(g: Gen, F: Float64Array, ns: number): void {
  const R = new Float64Array(N);
  const bands: [number, number][] = g.river ? [[4, 14], [30, 37]] : [[4, 37]];
  const count = g.river ? int(g, 2, 3) : int(g, 2, 4);
  const total = bands.reduce((a, [lo, hi]) => a + hi - lo, 0);
  for (let k = 0; k < count; k++) {
    let p = ((k + 0.3 + rand(g) * 0.4) / count) * total;
    let y0 = bands[0]![0];
    for (const [lo, hi] of bands) {
      if (p <= hi - lo) {
        y0 = lo + p;
        break;
      }
      p -= hi - lo;
    }
    const tilt = (rand(g) - 0.5) * 0.5;
    const amp = rand(g) * 1.6;
    const per = 10 + rand(g) * 12;
    const ph = rand(g) * Math.PI * 2;
    const hc = 2.6 + rand(g) * 0.7;
    const xa = int(g, -8, 6);
    const xb = int(g, 23, 37);
    const sx = int(g, 6, 23);
    const sw = 2 + rand(g) * 2;
    const sd = chance(g, 0.6) ? 0.35 + rand(g) * 0.3 : 0;
    // The forward slope (south, toward the attackers) is a little longer than the reverse.
    const wf = 3 + rand(g) * 2;
    const wb = 2.4 + rand(g) * 1.8;
    for (let x = 0; x < W; x++) {
      const line = y0 + tilt * (x - 15) + amp * Math.sin((x / per) * Math.PI * 2 + ph);
      const env = clamp(Math.min((x - xa) / 5, (xb - x) / 5), 0, 1);
      const h = hc * env * (1 - sd * Math.max(0, 1 - Math.abs(x - sx) / sw));
      if (h <= 0) continue;
      for (let y = Math.max(0, Math.floor(line - wb)); y <= Math.min(H - 1, Math.ceil(line + wf)); y++) {
        const d = y - line;
        const k2 = 1 - Math.pow(Math.abs(d) / (d > 0 ? wf : wb), 1.3);
        const i = idx(x, y);
        if (k2 > 0) R[i] = Math.max(R[i]!, h * k2);
      }
    }
  }
  const lift = g.biome === 'desert' ? 0.6 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) F[idx(x, y)] = (fbm(ns, x, y, 12) - 0.45) * 1.4 + lift + R[idx(x, y)]!;
}

/** High ground up to 4 cut by a valley from the attackers' edge to the top, a pass, a side valley. */
function mountainGround(g: Gen, F: Float64Array, ns: number): void {
  const xs = [int(g, 10, 19), int(g, 7, 22), int(g, 7, 22), g.heart.x, int(g, 6, 23)];
  const vx = (y: number) => {
    const k = Math.min(3, Math.floor((44 - y) / 11));
    const t = (44 - 11 * k - y) / 11;
    const s = (1 - Math.cos(t * Math.PI)) / 2;
    return xs[k]! + (xs[k + 1]! - xs[k]!) * s;
  };
  const passY = int(g, 29, 36);
  const by = int(g, 13, 34);
  const bx0 = vx(by);
  const bx1 = bx0 < 15 ? W - 1 : 0;
  const by1 = clamp(by + int(g, -8, 8), 2, 37);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const near = Math.max(0, 1 - Math.abs(y - passY) / 3);
      const hw = 1.6 + smooth(ns + 7, 0, y, 7) * 1.8 - near * 1.2;
      let d = Math.max(0, Math.abs(x - vx(y)) - hw);
      d = Math.min(d, Math.max(0, segmentDistance(x, y, bx0, by, bx1, by1) - 1.3) + 0.4);
      // A basin round the objective.
      d = Math.min(d, Math.max(0, hyp(x - g.heart.x, y - g.heart.y) - (g.zone ? 4.5 : 3.5)));
      const floor = near * 1.6;
      const rough = fbm(ns, x, y, 8);
      F[idx(x, y)] = floor + d * 0.85 + (rough - 0.35) * 1.5 * Math.min(1, d / 2.5);
    }
}

function segmentDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return hyp(x - x0 - dx * t, y - y0 - dy * t);
}

/** Desert: dry stream beds a level below the ground round them, across the attack axis. */
function wadis(g: Gen, F: Float64Array): void {
  const count = g.terrain === 'hills' ? 1 : int(g, 1, 2);
  for (let k = 0; k < count; k++) {
    const [lo, hi] = k === 0 ? [27, 37] : [3, 15];
    let y = int(g, lo + 1, hi - 1);
    let dy = 0;
    for (let x = 0; x < W; x++) {
      const mark = (yy: number) => {
        const i = idx(x, yy);
        F[i] = Math.min(F[i]!, -0.5);
        g.wet[i] = 1;
      };
      mark(y);
      if (chance(g, 0.35)) dy = clamp(dy + int(g, -1, 1), -1, 1);
      const ny = clamp(y + (chance(g, 0.5) ? dy : 0), lo, hi);
      if (ny !== y) mark(ny);
      y = ny;
    }
  }
}

/** Lowers cells until no orthogonal neighbours differ by more than one level (two raster passes). */
function relax(e: number[]): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      let v = e[i]!;
      if (x > 0) v = Math.min(v, e[i - 1]! + 1);
      if (y > 0) v = Math.min(v, e[i - W]! + 1);
      e[i] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = idx(x, y);
      let v = e[i]!;
      if (x < W - 1) v = Math.min(v, e[i + 1]! + 1);
      if (y < H - 1) v = Math.min(v, e[i + W]! + 1);
      e[i] = v;
    }
}

/** After lowering `cells`, lowers their neighbours in turn so no step exceeds one level there. */
function slump(e: number[], cells: number[]): void {
  const q = cells.slice();
  while (q.length) {
    const i = q.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (!inField(nx, ny)) continue;
      const j = idx(nx, ny);
      if (e[j]! > e[i]! + 1) {
        e[j] = e[i]! + 1;
        q.push(j);
      }
    }
  }
}

/** Mountains: raised tables of high ground whose edges drop two levels or more (cliffs). */
function mesas(g: Gen): void {
  const count = int(g, 1, 3);
  for (let k = 0, tries = 0; k < count && tries < 40; tries++) {
    const x = int(g, 2, W - 3);
    const y = int(g, 3, 35);
    const e = g.elev[idx(x, y)]!;
    if (e < 2 || e > 3) continue;
    if (g.river && y >= g.river.north - 5 && y <= g.river.south + 5) continue;
    if (hyp(x - g.heart.x, y - g.heart.y) < 7.5) continue;
    const r = 1.5 + rand(g) * 1.3;
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(LAST_ROW, Math.ceil(y + r)); yy++)
      for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(W - 1, Math.ceil(x + r)); xx++) {
        const i = idx(xx, yy);
        if (hyp(xx - x, yy - y) <= r && g.elev[i]! >= 2) g.elev[i] = Math.min(MAX_ELEV, g.elev[i]! + 1);
      }
    k++;
  }
}

// --- Cells -------------------------------------------------------------------------------------------

function put(g: Gen, i: number, c: Cell, kind = -1, storeys = 0): void {
  g.cells[i] = c;
  g.kind[i] = c === BUILDING || c === WALL || c === TREES ? kind : -1;
  g.storeys[i] = c === BUILDING ? storeys : 0;
}

/** Open ground a feature may take: not a road, not reserved, not in the assembly rows. */
function free(g: Gen, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= W || y > LAST_ROW) return false;
  const i = idx(x, y);
  return g.cells[i] === OPEN && g.reserved[i] === 0;
}

function inTown(g: Gen, x: number, y: number): boolean {
  const t = g.town;
  if (!t) return false;
  return t.full ? y <= LAST_ROW : hyp(x - t.cx, y - t.cy) <= t.r + 0.5;
}

/** A building on a rectangle if every cell is free; `detached` keeps a gap to other buildings. */
function building(g: Gen, x0: number, y0: number, w: number, h: number, kind: number, storeys: number, detached: boolean): boolean {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!free(g, x, y)) return false;
  if (detached)
    for (let y = y0 - 1; y <= y0 + h; y++)
      for (let x = x0 - 1; x <= x0 + w; x++) if (inField(x, y) && g.cells[idx(x, y)] === BUILDING) return false;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(g, idx(x, y), BUILDING, kind, storeys);
  return true;
}

function wall(g: Gen, x: number, y: number, kind: number): void {
  if (free(g, x, y)) put(g, idx(x, y), WALL, kind);
}

function tree(g: Gen, x: number, y: number, kind: number): void {
  if (free(g, x, y)) put(g, idx(x, y), TREES, kind);
}

function treeKind(g: Gen, n: number, e: number): number {
  switch (g.biome) {
    case 'winter':
      return n < 0.55 ? CONIFER : BIRCH;
    case 'steppe':
      return n < 0.6 ? BROADLEAF : BIRCH;
    case 'desert':
      return SCRUB;
    case 'urban':
      return g.terrain === 'mountains' ? CONIFER : BROADLEAF;
    default:
      if (g.terrain === 'mountains' || e >= 3) return n < 0.65 ? CONIFER : BIRCH;
      return n < 0.58 ? BROADLEAF : n < 0.7 ? BIRCH : CONIFER;
  }
}

/** Village gardens and field walls: stone in the desert, hedges and fences elsewhere. */
function fieldWall(g: Gen): number {
  return g.biome === 'desert' ? STONE : g.biome === 'temperate' && chance(g, 0.25) ? STONE : HEDGE;
}

// --- Search ------------------------------------------------------------------------------------------

// Shortest paths over cells; a step that turns from the way the path came in pays `turn`, so roads
// run straight. The buffers are shared between calls: the generator is synchronous, so nothing
// else touches them meanwhile.
let scratch: { dist: Float64Array; prev: Int32Array; dir: Int8Array; heapK: Float64Array; heapV: Int32Array } | null = null;

/**
 * A cheap path (cells, source first) from any source to a goal cell; `step` < 0 forbids a step.
 * Dijkstra, or with a `target` cell A* with a slightly greedy guide, which is plenty for a road.
 */
function search(sources: number[], goal: (i: number) => boolean, step: (from: number, to: number) => number, turn: number, target = -1): number[] | null {
  const tx = target % W;
  const ty = (target - tx) / W;
  const guide = (i: number) => {
    if (target < 0) return 0;
    const x = i % W;
    return (Math.abs(x - tx) + Math.abs((i - x) / W - ty)) * 0.9;
  };
  const sc = (scratch ??= { dist: new Float64Array(N), prev: new Int32Array(N), dir: new Int8Array(N), heapK: new Float64Array(N * 4), heapV: new Int32Array(N * 4) });
  const { dist, prev, dir } = sc;
  let { heapK, heapV } = sc;
  dist.fill(Infinity);
  let size = 0;
  const push = (k: number, v: number) => {
    // A greedy guide can reopen a cell, so the heap grows if it must.
    if (size === heapK.length) {
      const k2 = new Float64Array(size * 2);
      const v2 = new Int32Array(size * 2);
      k2.set(heapK);
      v2.set(heapV);
      sc.heapK = heapK = k2;
      sc.heapV = heapV = v2;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapK[p]! <= k) break;
      heapK[i] = heapK[p]!;
      heapV[i] = heapV[p]!;
      i = p;
    }
    heapK[i] = k;
    heapV[i] = v;
  };
  const pop = () => {
    const k = heapK[--size]!;
    const v = heapV[size]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && heapK[c + 1]! < heapK[c]!) c++;
      if (heapK[c]! >= k) break;
      heapK[i] = heapK[c]!;
      heapV[i] = heapV[c]!;
      i = c;
    }
    heapK[i] = k;
    heapV[i] = v;
  };
  for (const s of sources) {
    dist[s] = 0;
    prev[s] = -1;
    dir[s] = 4;
    push(guide(s), s);
  }
  while (size > 0) {
    const i = heapV[0]!;
    const k = heapK[0]! - guide(i);
    pop();
    if (k > dist[i]! + 1e-9) continue;
    if (goal(i)) {
      const path: number[] = [];
      for (let c = i; c >= 0; c = prev[c]!) path.push(c);
      return path.reverse();
    }
    const d = dir[i]!;
    const x = i % W;
    const y = (i - x) / W;
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DX[nd]!;
      const ny = y + DY[nd]!;
      if (!inField(nx, ny)) continue;
      const j = idx(nx, ny);
      const c = step(i, j);
      if (c < 0) continue;
      const nk = k + c + (d !== 4 && d !== nd ? turn : 0);
      if (nk < dist[j]!) {
        dist[j] = nk;
        prev[j] = i;
        dir[j] = nd;
        push(nk + guide(j), j);
      }
    }
  }
  return null;
}

/** Turns a path into road (water into bridge) and evens out any step of more than one level on it. */
function lay(g: Gen, path: number[]): void {
  for (const j of path) {
    const c = g.cells[j]!;
    if (c !== BRIDGE) put(g, j, c === WATER ? BRIDGE : ROAD);
  }
  const lowered: number[] = [];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const b = path[k]!;
    if (g.elev[a]! > g.elev[b]! + 1) {
      g.elev[a] = g.elev[b]! + 1;
      lowered.push(a);
    } else if (g.elev[b]! > g.elev[a]! + 1) {
      g.elev[b] = g.elev[a]! + 1;
      lowered.push(b);
    }
  }
  if (lowered.length) slump(g.elev, lowered);
}

// --- Roads -------------------------------------------------------------------------------------------

interface RoadStyle {
  turn: number;
  slope: number;
  height: number;
  noise: number;
  /** Only the main road crosses the river; side roads keep to their bank. */
  cross?: boolean;
}

function roadStep(g: Gen, o: RoadStyle, noise: Float64Array) {
  return (i: number, j: number): number => {
    const c = g.cells[j]!;
    if (c === WATER || c === BUILDING || c === ROCK || (c === BRIDGE && !o.cross)) return -1;
    const dz = Math.abs(g.elev[j]! - g.elev[i]!);
    let cost = isRoad(c) ? 0.35 : 1;
    if (c === TREES) cost += 1.5;
    else if (c === WALL || c === RUBBLE) cost += 1;
    cost += dz * o.slope + g.elev[j]! * o.height + (dz > 1 ? 12 : 0);
    const x = j % W;
    if (x < 2 || x > W - 3) cost += 1.5;
    // Join or cross another road rather than run alongside it.
    if (!isRoad(c)) {
      const y = (j - x) / W;
      for (let d = 0; d < 4; d++) {
        const k = idx(x + DX[d]!, y + DY[d]!);
        if (k !== i && inField(x + DX[d]!, y + DY[d]!) && g.cells[k] === ROAD) {
          cost += 0.8;
          break;
        }
      }
    }
    return cost + noise[j]! * o.noise;
  };
}

/** Lays a road from `from` to the first goal cell it reaches; a single `target` cell guides it. */
function road(g: Gen, from: number[], goal: (i: number) => boolean, o: RoadStyle, noise: Float64Array, target = -1): number[] | null {
  const path = search(from, goal, roadStep(g, o, noise), o.turn, target);
  if (path) lay(g, path);
  return path;
}

/** Bridges: two or three, spread across the river; in a city they carry streets. */
function placeBridges(g: Gen): void {
  const r = g.river;
  if (!r) return;
  const count = int(g, 2, 3);
  const cols: number[] = [];
  if (g.town?.full) {
    cols.push(g.heart.x);
    const cand = g.town.cols.filter((c) => c >= 2 && c <= W - 3 && c !== g.heart.x);
    while (cols.length < count && cand.length) {
      let best = -1;
      let bestD = -1;
      for (let k = 0; k < cand.length; k++) {
        const d = Math.min(...cols.map((c) => Math.abs(c - cand[k]!))) + rand(g) * 2;
        if (d > bestD) {
          bestD = d;
          best = k;
        }
      }
      cols.push(cand.splice(best, 1)[0]!);
    }
    cols.sort((a, b) => a - b);
  } else {
    for (let k = 0; k < count; k++) cols.push(int(g, Math.floor((k * W) / count) + 2, Math.floor(((k + 1) * W) / count) - 3));
  }
  for (const x of cols) for (let y = r.top[x]!; y <= r.bot[x]!; y++) put(g, idx(x, y), BRIDGE);
  g.bridges = cols;
}

function layRoads(g: Gen): void {
  const style: RoadStyle = {
    turn: g.biome === 'steppe' ? 2.2 : g.town?.full ? 0.4 : g.biome === 'desert' ? 1.2 : 0.9,
    slope: 2.5,
    height: g.terrain === 'mountains' ? 0.5 : 0.2,
    noise: g.biome === 'steppe' ? 0.2 : 0.5,
  };
  const ns = int(g, 1, 1 << 30);
  const noise = new Float64Array(N);
  for (let i = 0; i < N; i++) noise[i] = hash(ns, i, 7);
  const r = g.river;
  const heart = idx(g.heart.x, g.heart.y);
  const full = g.town?.full ?? false;
  const sx = full ? g.heart.x : int(g, 9, 20);
  const ex = full ? g.heart.x : clamp(g.heart.x + int(g, -7, 7), 3, W - 4);
  // The main road: from the attackers' edge through the objective to the top edge.
  const a = road(g, [idx(sx, H - 1)], (i) => i === heart, { ...style, cross: true }, noise, heart) ?? [];
  const b = road(g, [heart], (i) => i === ex, style, noise, ex) ?? [];
  g.main = [...a, ...b.slice(1)];
  // Bridges off the main road get a track to a road on each bank.
  if (r)
    for (const x of g.bridges) {
      const n = idx(x, r.top[x]! - 1);
      const s = idx(x, r.bot[x]! + 1);
      const north = (i: number) => i !== n && g.cells[i] === ROAD && bank(r, i) < 0;
      const south = (i: number) => i !== s && g.cells[i] === ROAD && bank(r, i) > 0;
      if (!onNetwork(g, n)) road(g, [n], north, style, noise);
      else put(g, n, ROAD);
      if (!onNetwork(g, s)) road(g, [s], south, style, noise);
      else put(g, s, ROAD);
    }
  if (full) return;
  chooseVillages(g);
  const steep = g.terrain === 'mountains' ? 0.4 : 1;
  const lateral = { temperate: 0.6, winter: 0.45, steppe: 0.75, desert: 0.35, urban: 0 }[g.biome] * steep;
  const rear = { temperate: 0.45, winter: 0.35, steppe: 0.4, desert: 0.3, urban: 0 }[g.biome] * steep;
  // A cross road through the southern village, and one through the defenders' village or zone.
  const south = g.villages.find((v) => v.y > 26);
  if (south && chance(g, lateral)) crossRoad(g, south, style, noise);
  if (!g.town && chance(g, rear)) crossRoad(g, { x: g.heart.x, y: g.heart.y, houses: 0 }, style, noise);
  // Farm tracks from the main road out to a farm near the edge.
  const [lo, hi] = { temperate: [1, 3], winter: [1, 2], steppe: [0, 1], desert: [0, 1], urban: [0, 0] }[g.biome] as [number, number];
  const farms = int(g, lo, hi);
  for (let k = 0, tries = 0; k < farms && tries < 20; tries++) {
    const fy = int(g, 3, LAST_ROW - 2);
    if (r && fy >= r.north - 2 && fy <= r.south + 2) continue;
    const fx = chance(g, 0.5) ? int(g, 1, 4) : int(g, W - 5, W - 2);
    if (!free(g, fx, fy) || inTown(g, fx, fy)) continue;
    const side = (i: number) => !r || bank(r, i) === (fy < r.north ? -1 : 1);
    const path = road(g, [idx(fx, fy)], (i) => isRoad(g.cells[i]) && i !== idx(fx, fy) && side(i), { ...style, noise: 0.8 }, noise);
    if (!path || path.length < 4) continue;
    g.farms.push({ x: fx, y: fy });
    k++;
  }
}

function onNetwork(g: Gen, i: number): boolean {
  if (g.cells[i] === ROAD) return true;
  const x = i % W;
  const y = (i - x) / W;
  for (let d = 0; d < 4; d++) if (inField(x + DX[d]!, y + DY[d]!) && g.cells[idx(x + DX[d]!, y + DY[d]!)] === ROAD) return true;
  return false;
}

function crossRoad(g: Gen, v: Village, style: RoadStyle, noise: Float64Array): void {
  const c = idx(v.x, v.y);
  const yw = clamp(v.y + int(g, -3, 3), 1, LAST_ROW);
  const ye = clamp(v.y + int(g, -3, 3), 1, LAST_ROW);
  const r = g.river;
  if (r && (inBand(r, yw) || inBand(r, ye))) return;
  const e = idx(W - 1, ye);
  road(g, [idx(0, yw)], (i) => i === c, style, noise, c);
  road(g, [c], (i) => i === e, style, noise, e);
}

const inBand = (r: River, y: number) => y >= r.north - 1 && y <= r.south + 1;

/** Which side of the river a cell is on: -1 north, 1 south, 0 in it. */
function bank(r: River, i: number): number {
  const x = i % W;
  const y = (i - x) / W;
  return y < r.top[x]! ? -1 : y > r.bot[x]! ? 1 : 0;
}

function chooseVillages(g: Gen): void {
  const b = g.biome;
  const size = () => (b === 'desert' ? int(g, 3, 5) : b === 'steppe' ? int(g, 10, 15) : b === 'winter' ? int(g, 6, 10) : int(g, 7, 12));
  const destroy = !g.zone;
  const onMain = (lo: number, hi: number): Point | null => {
    const want = int(g, lo, hi);
    // Near the wanted row, and away from the field's edges so there is room on both sides.
    const score = (x: number, y: number) => Math.abs(y - want) + (x < 6 || x > W - 7 ? 6 : 0);
    let best: Point | null = null;
    for (const i of g.main) {
      const y = (i / W) | 0;
      if (g.cells[i] !== ROAD || y < lo - 2 || y > hi + 2 || inTown(g, i % W, y)) continue;
      if (!best || score(i % W, y) < score(best.x, best.y)) best = { x: i % W, y };
    }
    return best;
  };
  // The defenders' village sits on the objective when there is no zone, depot or town there.
  const northOk = destroy && !g.town && g.site !== 'depot';
  let north = northOk && chance(g, { temperate: 0.75, winter: 0.7, steppe: 0.5, desert: 0.7, urban: 0 }[b]);
  let south = chance(g, { temperate: 0.75, winter: 0.65, steppe: 1, desert: 0.75, urban: 0 }[b] * (g.town ? 0.5 : 1));
  // The steppe has one village; the other rural biomes at least one.
  if (b === 'steppe' && north) south = false;
  if (!g.town && !north && !south) {
    if (northOk && chance(g, 0.5)) north = true;
    else south = true;
  }
  if (south) {
    const p = onMain(29, 35);
    if (p) g.villages.push({ ...p, houses: size() });
  }
  if (north) g.villages.push({ ...g.heart, houses: size() });
}

// --- Towns -------------------------------------------------------------------------------------------

/** A street grid: a main avenue through the heart, cross streets every few cells. */
function layStreets(g: Gen): void {
  const t = g.town!;
  const cols = [t.cx];
  for (let x = t.cx - int(g, 5, 7); x >= 1; x -= int(g, 5, 7)) if (t.cx - x <= t.r + 1) cols.unshift(x);
  for (let x = t.cx + int(g, 5, 7); x <= W - 2; x += int(g, 5, 7)) if (x - t.cx <= t.r + 1) cols.push(x);
  const rows = [t.cy];
  for (let y = t.cy - int(g, 4, 6); y >= 1; y -= int(g, 4, 6)) if (t.cy - y <= t.r + 1) rows.unshift(y);
  for (let y = t.cy + int(g, 4, 6); y <= LAST_ROW - 2; y += int(g, 4, 6)) if (y - t.cy <= t.r + 1) rows.push(y);
  t.cols = cols;
  t.rows = rows;
  const street = (x: number, y: number) => {
    if (!inField(x, y)) return;
    const i = idx(x, y);
    if (g.cells[i] === OPEN && (inTown(g, x, y) || (t.full && x === t.cx))) put(g, i, ROAD);
  };
  // Some short stretches are left out, so blocks join up.
  for (const x of cols) {
    const ys = [0, ...rows, t.full && x === t.cx ? H - 1 : LAST_ROW];
    for (let k = 0; k + 1 < ys.length; k++) {
      if (x !== t.cx && chance(g, 0.12)) continue;
      for (let y = ys[k]!; y <= ys[k + 1]!; y++) street(x, y);
    }
  }
  for (const y of rows) {
    const xs = [0, ...cols, W - 1];
    for (let k = 0; k + 1 < xs.length; k++) {
      if (y !== t.cy && chance(g, 0.12)) continue;
      for (let x = xs[k]!; x <= xs[k + 1]!; x++) street(x, y);
    }
  }
  // Embankment streets along the river.
  const r = g.river;
  if (r)
    for (let x = 0; x < W; x++) {
      street(x, r.top[x]! - 1);
      street(x, r.bot[x]! + 1);
    }
}

type BlockType = 'apartments' | 'mixed' | 'houses' | 'industrial' | 'park' | 'rubble' | 'lot';

function townBlocks(g: Gen): void {
  const t = g.town!;
  const xs = [Math.max(-1, t.cx - t.r - 2), ...t.cols, Math.min(W, t.cx + t.r + 2)];
  const ys = [Math.max(-1, t.cy - t.r - 2), ...t.rows, Math.min(LAST_ROW + 1, t.cy + t.r + 2)];
  // The full city keeps its sheds on one flank of the southern half.
  const sheds = chance(g, 0.5) ? -1 : 1;
  for (let a = 0; a + 1 < xs.length; a++)
    for (let b = 0; b + 1 < ys.length; b++) {
      const x0 = xs[a]! + 1;
      const x1 = xs[a + 1]! - 1;
      const y0 = ys[b]! + 1;
      const y1 = Math.min(ys[b + 1]! - 1, LAST_ROW);
      if (x1 < x0 || y1 < y0) continue;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const d = hyp(mx - t.cx, my - t.cy);
      if (!t.full && d > t.r + 1) continue;
      const flank = t.full && my > 26 && Math.sign(mx - 14.5) === sheds;
      // The blocks round the middle are tall: apartments and shops.
      const type = flank && chance(g, 0.7) ? 'industrial' : d - t.hole < 3 ? (chance(g, 0.65) ? 'apartments' : 'mixed') : blockType(g, d - t.hole);
      block(g, x0, y0, x1, y1, type);
    }
}

function blockType(g: Gen, d: number): BlockType {
  const t = g.town!;
  const r = rand(g);
  const core = t.full ? d < 6 : d < (t.r - t.hole) * 0.5;
  const mid = t.full ? d < 14 : d < (t.r - t.hole) * 0.85;
  if (core) return r < 0.5 ? 'apartments' : r < 0.85 ? 'mixed' : r < 0.93 ? 'rubble' : 'park';
  if (mid) return r < 0.3 ? 'apartments' : r < 0.58 ? 'mixed' : r < 0.82 ? 'houses' : r < 0.9 ? 'industrial' : r < 0.95 ? 'park' : 'rubble';
  return r < 0.5 ? 'houses' : r < 0.72 ? 'industrial' : r < 0.82 ? 'mixed' : r < 0.92 ? 'lot' : 'park';
}

function block(g: Gen, x0: number, y0: number, x1: number, y1: number, type: BlockType): void {
  const desert = g.biome === 'desert';
  switch (type) {
    case 'apartments':
      return perimeter(g, x0, y0, x1, y1, () => [APARTMENT, int(g, 3, 4)]);
    case 'mixed':
      return perimeter(g, x0, y0, x1, y1, () => (chance(g, 0.45) ? [SHOP, int(g, 2, 3)] : chance(g, 0.5) ? [APARTMENT, 3] : [HOUSE, desert ? 1 : 2]));
    case 'houses':
      if (!desert || x1 - x0 < 3 || y1 - y0 < 3) return houses(g, x0, y0, x1, y1);
      compound(g, x0, y0, x1 - x0 + 1, y1 - y0 + 1, gateToward(g, x0, y0, x1, y1));
      return;
    case 'industrial':
      return sheds(g, x0, y0, x1, y1);
    case 'park':
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inTown(g, x, y) && chance(g, 0.45)) tree(g, x, y, treeKind(g, rand(g), 0));
      return;
    case 'rubble':
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (!free(g, x, y) || !inTown(g, x, y)) continue;
          if (chance(g, 0.5)) put(g, idx(x, y), RUBBLE);
          else if (chance(g, 0.3)) put(g, idx(x, y), BUILDING, APARTMENT, int(g, 1, 2));
        }
      return;
    case 'lot':
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (free(g, x, y) && inTown(g, x, y) && chance(g, 0.15)) put(g, idx(x, y), RUBBLE);
      return;
  }
}

/** Buildings round the edge of a block with a courtyard inside, in runs of different heights. */
function perimeter(g: Gen, x0: number, y0: number, x1: number, y1: number, pick: () => [number, number]): void {
  const ring: Point[] = [];
  const courtyard = x1 - x0 >= 3 && y1 - y0 >= 3;
  if (courtyard) {
    for (let x = x0; x <= x1; x++) ring.push({ x, y: y0 });
    for (let y = y0 + 1; y <= y1; y++) ring.push({ x: x1, y });
    for (let x = x1 - 1; x >= x0; x--) ring.push({ x, y: y1 });
    for (let y = y1 - 1; y > y0; y--) ring.push({ x: x0, y });
  } else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ring.push({ x, y });
  let left = 0;
  let kind = 0;
  let st = 1;
  for (const p of ring) {
    if (left === 0) {
      [kind, st] = pick();
      left = int(g, 2, 4);
    }
    left--;
    const corner = (p.x === x0 || p.x === x1) && (p.y === y0 || p.y === y1);
    // Now and then an alley into the courtyard.
    if (courtyard && left === 0 && !corner && chance(g, 0.15)) continue;
    if (inTown(g, p.x, p.y) && free(g, p.x, p.y)) put(g, idx(p.x, p.y), BUILDING, kind, st);
  }
  if (courtyard && chance(g, 0.3)) tree(g, int(g, x0 + 1, x1 - 1), int(g, y0 + 1, y1 - 1), treeKind(g, rand(g), 0));
}

/** Detached houses along the block's edges with gardens between. */
function houses(g: Gen, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inTown(g, x, y)) continue;
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (edge && (x + y) % 2 === 0 && chance(g, 0.75)) building(g, x, y, 1, 1, HOUSE, chance(g, 0.4) ? 2 : 1, true);
      else if (!edge && chance(g, 0.18)) tree(g, x, y, treeKind(g, rand(g), 0));
    }
}

/** Big low sheds in a yard. */
function sheds(g: Gen, x0: number, y0: number, x1: number, y1: number): void {
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  for (let k = 0; k < 4; k++) {
    const w = int(g, Math.min(2, bw), Math.min(4, bw));
    const h = int(g, Math.min(2, bh), Math.min(3, bh));
    const x = int(g, x0, x1 - w + 1);
    const y = int(g, y0, y1 - h + 1);
    let ok = true;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!inTown(g, xx, yy)) ok = false;
    if (ok) building(g, x, y, w, h, INDUSTRIAL, chance(g, 0.75) ? 1 : 2, true);
  }
}

/** The cells of a rectangle's side nearest a road, for a gate. */
function gateToward(g: Gen, x0: number, y0: number, x1: number, y1: number): Point[] {
  const mx = (x0 + x1) >> 1;
  const my = (y0 + y1) >> 1;
  const sides: [Point, number][] = [
    [{ x: mx, y: y0 }, roadAt(g, mx, y0 - 1) ? 0 : 1],
    [{ x: mx, y: y1 }, roadAt(g, mx, y1 + 1) ? 0 : 1],
    [{ x: x0, y: my }, roadAt(g, x0 - 1, my) ? 0 : 1],
    [{ x: x1, y: my }, roadAt(g, x1 + 1, my) ? 0 : 1],
  ];
  sides.sort((a, b) => a[1] - b[1]);
  return [sides[0]![0]];
}

const roadAt = (g: Gen, x: number, y: number) => inField(x, y) && isRoad(g.cells[idx(x, y)]);

/** Desert compound: a stone wall round a yard, a gate, flat-roofed houses along the back wall. */
function compound(g: Gen, x0: number, y0: number, w: number, h: number, gate: Point[]): boolean {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!free(g, x, y)) return false;
  const isGate = (x: number, y: number) => gate.some((p) => p.x === x && p.y === y);
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const ring = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      if (ring && !isGate(x, y)) put(g, idx(x, y), WALL, STONE);
    }
  // Flat-roofed houses along the wall opposite the gate (two when there is room), often one more
  // against a side wall.
  const gp = gate[0] ?? { x: x0, y: y0 };
  const ix0 = x0 + 1;
  const ix1 = x0 + w - 2;
  const iy0 = y0 + 1;
  const iy1 = y0 + h - 2;
  const back: Point[] = [];
  const side: Point[] = [];
  if (gp.y === y0 || gp.y === y0 + h - 1) {
    const by = gp.y === y0 ? iy1 : iy0;
    for (let x = ix0; x <= ix1; x++) back.push({ x, y: by });
    const sx = chance(g, 0.5) ? ix0 : ix1;
    for (let y = iy0; y <= iy1; y++) if (y !== by && Math.abs(y - gp.y) > 1) side.push({ x: sx, y });
  } else {
    const bx = gp.x === x0 ? ix1 : ix0;
    for (let y = iy0; y <= iy1; y++) back.push({ x: bx, y });
    const sy = chance(g, 0.5) ? iy0 : iy1;
    for (let x = ix0; x <= ix1; x++) if (x !== bx && Math.abs(x - gp.x) > 1) side.push({ x, y: sy });
  }
  const gap = back.length >= 3 ? int(g, 1, back.length - 2) : -1;
  let st = chance(g, 0.75) ? 1 : 2;
  back.forEach((p, k) => {
    if (k === gap) st = chance(g, 0.75) ? 1 : 2;
    else if (free(g, p.x, p.y)) put(g, idx(p.x, p.y), BUILDING, HOUSE, st);
  });
  if (side.length && chance(g, 0.6)) {
    const p = side[int(g, 0, side.length - 1)]!;
    if (!nextTo(g, p.x, p.y, BUILDING)) building(g, p.x, p.y, 1, 1, HOUSE, 1, false);
  }
  if (chance(g, 0.3)) tree(g, int(g, x0 + 1, x0 + w - 2), int(g, y0 + 1, y0 + h - 2), SCRUB);
  // The yard stays a yard: no rocks or scrub dropped into it later.
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.reserved[idx(x, y)] = 1;
  return true;
}

// --- Settlements ------------------------------------------------------------------------------------

function settle(g: Gen): void {
  if (g.site === 'objective') hescoRing(g);
  if (g.site === 'depot') depot(g);
  if (g.town) townBlocks(g);
  for (const v of g.villages) (g.biome === 'desert' ? compoundVillage : village)(g, v);
  for (const f of g.farms) farmstead(g, f);
}

function frontage(g: Gen, v: Village, r: number): number[] {
  const out: { i: number; d: number }[] = [];
  for (let y = v.y - r; y <= v.y + r; y++)
    for (let x = v.x - r; x <= v.x + r; x++) {
      const d = hyp(x - v.x, y - v.y);
      if (inField(x, y) && g.cells[idx(x, y)] === ROAD && d <= r) out.push({ i: idx(x, y), d: d + rand(g) * 1.5 });
    }
  return out.sort((a, b) => a.d - b.d).map((o) => o.i);
}

/** Houses along the roads near the centre, a church or shop in the middle, gardens and barns. */
function village(g: Gen, v: Village): void {
  const front = frontage(g, v, g.biome === 'steppe' ? 6 : 4);
  const gardenWall = fieldWall(g);
  const garden = g.biome === 'winter' ? BIRCH : BROADLEAF;
  let placed = 0;
  for (const r of front) {
    const rx = r % W;
    const ry = (r - rx) / W;
    for (let d = 0; d < 4 && placed < v.houses; d++) {
      const dx = DX[d]!;
      const dy = DY[d]!;
      const x = rx + dx;
      const y = ry + dy;
      // Houses face the road in short rows of up to three, with gaps between.
      if (!free(g, x, y) || chance(g, 0.2) || row(g, x, y, Math.abs(dy), Math.abs(dx)) >= 2) continue;
      const deep = chance(g, 0.35);
      const x2 = x + (deep ? dx : 0);
      const y2 = y + (deep ? dy : 0);
      const first = placed === 0;
      const st = first ? 2 : chance(g, 0.3) ? 2 : 1;
      if (!building(g, Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x) + 1, Math.abs(y2 - y) + 1, first ? SHOP : HOUSE, st, false)) continue;
      placed++;
      // A garden behind the house: a hedge or wall at its end, maybe a fruit tree.
      const px = Math.abs(dy);
      const py = Math.abs(dx);
      const depth = deep ? 2 : 1;
      if (chance(g, 0.5)) for (let k = -1; k <= 1; k++) wall(g, rx + dx * (depth + 2) + px * k, ry + dy * (depth + 2) + py * k, gardenWall);
      if (chance(g, 0.3)) tree(g, rx + dx * (depth + 1) + px * int(g, -1, 1), ry + dy * (depth + 1) + py * int(g, -1, 1), garden);
    }
  }
  // Barns at the edge of the village, a short way off the road.
  for (let k = 0, tries = 0; k < 2 && tries < 25; tries++) {
    const x = v.x + int(g, -6, 6);
    const y = v.y + int(g, -6, 6);
    if (!nearRoad(g, x, y, 3) || nearRoad(g, x, y, 1)) continue;
    if (building(g, x, y, 2, 2, INDUSTRIAL, 1, true)) k++;
  }
}

/** The longest run of buildings beside (x, y) along the direction (px, py). */
function row(g: Gen, x: number, y: number, px: number, py: number): number {
  let best = 0;
  for (const s of [1, -1]) {
    let n = 0;
    while (inField(x + px * s * (n + 1), y + py * s * (n + 1)) && g.cells[idx(x + px * s * (n + 1), y + py * s * (n + 1))] === BUILDING) n++;
    best = Math.max(best, n);
  }
  return best;
}

function nearRoad(g: Gen, x: number, y: number, r: number): boolean {
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (roadAt(g, xx, yy)) return true;
  return false;
}

/** Desert village: walled compounds along the road, gates on it. */
function compoundVillage(g: Gen, v: Village): void {
  const front = frontage(g, v, 7);
  let placed = 0;
  for (const r of front) {
    const rx = r % W;
    const ry = (r - rx) / W;
    for (let d = 0; d < 4 && placed < v.houses; d++) {
      const w = int(g, 4, 6);
      const h = int(g, 4, 5);
      const dx = DX[d]!;
      const dy = DY[d]!;
      // Beside the road, gate on it, shifted a little along it.
      const along = int(g, -1, 1);
      const x0 = dx === 1 ? rx + 1 : dx === -1 ? rx - w : rx - (w >> 1) + along;
      const y0 = dy === 1 ? ry + 1 : dy === -1 ? ry - h : ry - (h >> 1) + along;
      const gate = { x: dx === 0 ? rx : dx === 1 ? x0 : x0 + w - 1, y: dy === 0 ? ry : dy === 1 ? y0 : y0 + h - 1 };
      if (compound(g, x0, y0, w, h, [gate])) placed++;
    }
    if (placed >= v.houses) break;
  }
}

function farmstead(g: Gen, f: Point): void {
  if (g.biome === 'desert') {
    const gate = gateToward(g, f.x - 2, f.y - 2, f.x + 2, f.y + 2);
    compound(g, f.x - 2, f.y - 2, 5, 5, gate);
    return;
  }
  for (let k = 0; k < 6; k++) {
    if (building(g, f.x + int(g, -2, 1), f.y + int(g, -2, 1), 1, int(g, 1, 2), HOUSE, int(g, 1, 2), true)) break;
  }
  for (let k = 0; k < 6; k++) {
    if (building(g, f.x + int(g, -3, 2), f.y + int(g, -3, 2), 2, 2, INDUSTRIAL, 1, true)) break;
  }
}

/** Objective: a ring of Hesco round the zone with gates, containers inside it. */
function hescoRing(g: Gen): void {
  const z = g.zone!;
  const R = z.r + 1.6;
  const gates = [Math.PI / 2];
  for (let k = int(g, 1, 2), tries = 0; k > 0 && tries < 30; tries++) {
    const a = rand(g) * Math.PI * 2 - Math.PI;
    if (gates.every((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 1.1)) {
      gates.push(a);
      k--;
    }
  }
  const nearGate = (a: number) => gates.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.2);
  const huts: number[] = [];
  for (let y = Math.floor(z.y - R - 1); y <= Math.ceil(z.y + R + 1); y++)
    for (let x = Math.floor(z.x - R - 1); x <= Math.ceil(z.x + R + 1); x++) {
      if (!inField(x, y)) continue;
      const i = idx(x, y);
      const d = hyp(x - z.x, y - z.y);
      const a = Math.atan2(y - z.y, x - z.x);
      if (Math.abs(d - R) < 0.6 && !nearGate(a) && g.cells[i] === OPEN) put(g, i, WALL, HESCO);
      else if (d > z.r + 0.2 && d < R - 0.6 && g.cells[i] === OPEN && !nearGate(a)) huts.push(i);
    }
  for (let k = int(g, 2, 3); k > 0 && huts.length; k--) {
    const i = huts.splice(int(g, 0, huts.length - 1), 1)[0]!;
    put(g, i, BUILDING, INDUSTRIAL, 1);
  }
}

/** Depot: a walled yard of sheds and a tank farm on the main road. */
function depot(g: Gen): void {
  const w = int(g, 9, 11);
  const h = int(g, 6, 7);
  const x0 = clamp(g.heart.x - (w >> 1), 1, W - 1 - w);
  const y0 = clamp(g.heart.y - (h >> 1), 2, LAST_ROW - h);
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;
  // A second gate in the middle of one side, besides wherever the road runs through.
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const side = int(g, 0, 3);
  const gate = (x: number, y: number) =>
    side < 2 ? y === (side === 0 ? y0 : y1) && Math.abs(x - mx) < 1 : x === (side === 2 ? x0 : x1) && Math.abs(y - my) < 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if ((x === x0 || x === x1 || y === y0 || y === y1) && !gate(x, y)) wall(g, x, y, STONE);
  for (let k = 0, tries = 0; k < 4 && tries < 30; tries++) {
    const bw = int(g, 2, 3);
    const bh = int(g, 2, 3);
    if (building(g, int(g, x0 + 1, x1 - bw), int(g, y0 + 1, y1 - bh), bw, bh, INDUSTRIAL, chance(g, 0.7) ? 1 : 2, true)) k++;
  }
  for (let tries = 0; tries < 10; tries++) if (building(g, int(g, x0 + 1, x1 - 3), int(g, y0 + 1, y1 - 1), 3, 1, INDUSTRIAL, 1, true)) break;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.reserved[idx(x, y)] = 1;
}

// --- Cover -------------------------------------------------------------------------------------------

function cover(g: Gen): void {
  // Field positions first, so woods and rocks do not take every spot.
  sandbags(g);
  woods(g);
  const mountains = g.terrain === 'mountains';
  if (g.biome === 'temperate') hedgerows(g, mountains ? 0.3 : 0.55, mountains ? STONE : HEDGE);
  if (g.biome === 'winter') hedgerows(g, 0.12, mountains ? STONE : HEDGE);
  if (g.biome === 'steppe') shelterbelts(g);
  if (g.biome === 'desert') scrub(g);
  rocks(g);
}

/** Woods where smooth noise runs highest, off the crests and above the treeline. */
function woods(g: Gen): void {
  const share = WOODS[g.biome][g.terrain];
  if (share <= 0) return;
  const ns = int(g, 1, 1 << 30);
  const ks = int(g, 1, 1 << 30);
  const period = g.terrain === 'forest' ? 11 : 8;
  const cand: { i: number; v: number }[] = [];
  for (let y = 0; y <= LAST_ROW; y++)
    for (let x = 0; x < W; x++) {
      if (!free(g, x, y) || inTown(g, x, y) || nextTo(g, x, y, BUILDING)) continue;
      const i = idx(x, y);
      const e = g.elev[i]!;
      let v = fbm(ns, x, y, period);
      if (g.terrain === 'mountains') v -= e >= 4 ? 0.25 : e === 0 ? 0.08 : 0;
      if (g.terrain === 'hills' && y > 0 && y < H - 1 && e > g.elev[i - W]! && e > g.elev[i + W]!) v -= 0.15;
      cand.push({ i, v });
    }
  cand.sort((a, b) => b.v - a.v || a.i - b.i);
  const n = Math.min(cand.length, Math.round(share * N));
  for (let k = 0; k < n; k++) {
    const i = cand[k]!.i;
    const x = i % W;
    put(g, i, TREES, treeKind(g, fbm(ks, x, (i - x) / W, 7), g.elev[i]!));
  }
}

function nextTo(g: Gen, x: number, y: number, c: Cell): boolean {
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (inField(xx, yy) && g.cells[idx(xx, yy)] === c) return true;
  return false;
}

/** Fields split into plots, hedged along some edges, with gates and the odd hedgerow tree. */
function hedgerows(g: Gen, p: number, kind: number): void {
  const rects: [number, number, number, number][] = [];
  const split = (x0: number, y0: number, x1: number, y1: number): void => {
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if ((w > 9 || h > 7) && (w >= 7 || h >= 6)) {
      if (w / 9 > h / 7) {
        const s = int(g, x0 + 3, x1 - 3);
        split(x0, y0, s - 1, y1);
        split(s, y0, x1, y1);
      } else {
        const s = int(g, y0 + 3, y1 - 3);
        split(x0, y0, x1, s - 1);
        split(x0, s, x1, y1);
      }
    } else rects.push([x0, y0, x1, y1]);
  };
  split(0, 0, W - 1, LAST_ROW);
  const line = (cells: Point[]) => {
    const gate = chance(g, 0.8) ? int(g, 0, cells.length - 1) : -1;
    cells.forEach((c, k) => {
      if (k === gate || !free(g, c.x, c.y) || inTown(g, c.x, c.y) || g.elev[idx(c.x, c.y)]! > 2) return;
      if (kind === HEDGE && chance(g, 0.08)) put(g, idx(c.x, c.y), TREES, g.biome === 'winter' ? BIRCH : BROADLEAF);
      else put(g, idx(c.x, c.y), WALL, kind);
    });
  };
  for (const [x0, y0, x1, y1] of rects) {
    if (y0 > 0 && chance(g, p)) line(Array.from({ length: x1 - x0 + 1 }, (_, k) => ({ x: x0 + k, y: y0 })));
    if (x0 > 0 && chance(g, p)) line(Array.from({ length: y1 - y0 + 1 }, (_, k) => ({ x: x0, y: y0 + k })));
  }
}

/** Steppe windbreaks: long straight tree lines along the field edges, east-west and some north-south. */
function shelterbelts(g: Gen): void {
  const rows: number[] = [];
  for (let y = int(g, 3, 6); y <= LAST_ROW - 1; y += int(g, 5, 8)) rows.push(y);
  const belt = (x: number, y: number, kind: number) => {
    if (inTown(g, x, y)) return;
    tree(g, x, y, kind);
  };
  rows.forEach((y, k) => {
    const last = k === rows.length - 1;
    const full = last || chance(g, 0.6);
    const xa = full ? 0 : int(g, 0, 9);
    const xb = full ? W - 1 : int(g, 19, W - 1);
    const kind = chance(g, 0.7) ? BROADLEAF : BIRCH;
    const double = !last && chance(g, 0.25);
    const gaps = Array.from({ length: last ? 1 : int(g, 1, 2) }, () => int(g, xa + 2, xb - 2));
    for (let x = xa; x <= xb; x++) {
      if (gaps.some((gx) => x >= gx && x <= gx + 1)) continue;
      belt(x, y, kind);
      if (double) belt(x, y + 1, kind);
    }
  });
  for (let x = int(g, 4, 8); x <= W - 4; x += int(g, 8, 12)) {
    if (!chance(g, 0.5) || rows.length < 2) continue;
    const k = int(g, 0, rows.length - 2);
    const kind = chance(g, 0.7) ? BROADLEAF : BIRCH;
    for (let y = rows[k]! + 1; y < rows[k + 1]!; y++) belt(x, y, kind);
  }
  // Villages and towns cut belts up; make sure one long one stands, on the longest open row of the
  // attackers' half.
  let best = { y: -1, x: 0, len: 0 };
  for (let y = 26; y <= LAST_ROW; y++)
    for (let x = 0, len = 0, line = 0; x < W; x++) {
      const c = g.cells[idx(x, y)];
      const open = (c === TREES || free(g, x, y)) && !inTown(g, x, y);
      len = open ? len + 1 : 0;
      line = c === TREES ? line + 1 : 0;
      if (line >= 10) return;
      if (len > best.len) best = { y, x: x - len + 1, len };
    }
  if (best.len >= 10) {
    const kind = chance(g, 0.7) ? BROADLEAF : BIRCH;
    for (let x = best.x; x < best.x + best.len; x++) belt(x, best.y, kind);
  }
}

/** Desert scrub: sparse, thicker in the wadis and along the river. */
function scrub(g: Gen): void {
  const base = g.terrain === 'forest' ? 0.06 : g.terrain === 'mountains' ? 0.02 : 0.035;
  const r = g.river;
  for (let y = 0; y <= LAST_ROW; y++)
    for (let x = 0; x < W; x++) {
      if (!free(g, x, y) || inTown(g, x, y)) continue;
      const i = idx(x, y);
      const bank = r ? Math.min(Math.abs(y - r.top[x]!), Math.abs(y - r.bot[x]!)) <= 2 : false;
      if (chance(g, g.wet[i] ? 0.22 : bank ? 0.3 : base)) put(g, i, TREES, SCRUB);
    }
}

/** Rock: outcrops on high ground, boulder fields and cliff edges in the mountains. */
function rocks(g: Gen): void {
  const t = g.terrain;
  const b = g.biome;
  if (t === 'mountains')
    for (let y = 0; y <= LAST_ROW; y++)
      for (let x = 0; x < W; x++) {
        if (!free(g, x, y) || inTown(g, x, y) || nearRoad(g, x, y, 1)) continue;
        const i = idx(x, y);
        const e = g.elev[i]!;
        let cliff = false;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d]!;
          const ny = y + DY[d]!;
          if (inField(nx, ny) && g.elev[idx(nx, ny)]! <= e - 2) cliff = true;
        }
        const p = cliff ? 0.45 : e >= 4 ? 0.2 : e === 3 ? 0.13 : e === 2 ? 0.03 : 0;
        if (chance(g, b === 'desert' ? p * 1.3 : p)) put(g, i, ROCK);
      }
  let outcrops = b === 'desert' ? int(g, 3, 6) : t === 'hills' ? int(g, 1, 3) : t === 'forest' ? int(g, 0, 2) : 0;
  if (t === 'mountains') outcrops += int(g, 1, 2);
  for (let k = 0; k < outcrops; k++) {
    // On the highest of a few spots.
    let best: Point | null = null;
    for (let s = 0; s < 5; s++) {
      const x = int(g, 1, W - 2);
      const y = int(g, 2, LAST_ROW - 1);
      if (free(g, x, y) && !inTown(g, x, y) && !nearRoad(g, x, y, 1) && (!best || g.elev[idx(x, y)]! > g.elev[idx(best.x, best.y)]!)) best = { x, y };
    }
    if (!best) continue;
    let { x, y } = best;
    for (let n = int(g, 1, 4); n > 0; n--) {
      if (free(g, x, y) && !nearRoad(g, x, y, 1)) put(g, idx(x, y), ROCK);
      const d = int(g, 0, 3);
      x += DX[d]!;
      y += DY[d]!;
    }
  }
}

/** Defenders' field positions: short sandbag lines facing the attackers. */
function sandbags(g: Gen): void {
  const count = g.biome === 'urban' ? int(g, 6, 10) : g.town ? int(g, 3, 5) : int(g, 2, 3);
  const r = g.river;
  const spread = g.town?.full ? 13 : 9;
  // Open cells round the objective with a field of fire to the south.
  const ok = (x: number, y: number) => free(g, x, y) && y + 1 < H && g.cells[idx(x, y + 1)] !== BUILDING && !nextTo(g, x, y, WALL);
  const spots: number[] = [];
  for (let y = Math.max(2, g.heart.y - 5); y <= Math.min(r ? r.north - 3 : LAST_ROW, g.heart.y + 8); y++)
    for (let x = Math.max(0, g.heart.x - spread); x < Math.min(W, g.heart.x + spread); x++) if (ok(x, y)) spots.push(idx(x, y));
  for (let k = 0; k < count && spots.length; ) {
    const i = spots.splice(int(g, 0, spots.length - 1), 1)[0]!;
    const x = i % W;
    const y = (i - x) / W;
    if (!ok(x, y)) continue;
    // A short line; in town often a single bagged corner in a yard or lot.
    let len = 1;
    const want = int(g, g.town ? 1 : 2, 3);
    while (len < want && ok(x + len, y)) len++;
    if (len < want && !g.town) continue;
    for (let k2 = 0; k2 < len; k2++) put(g, idx(x + k2, y), WALL, SANDBAG);
    k++;
  }
}

// --- Zone, deployment, levels ------------------------------------------------------------------------

/** The zone is open ground or road with a little cover: a sandbag line, a tree, some rubble. */
function finishZone(g: Gen): void {
  const z = g.zone;
  if (!z) return;
  const inner: number[] = [];
  for (let y = Math.floor(z.y - z.r); y <= Math.ceil(z.y + z.r); y++)
    for (let x = Math.floor(z.x - z.r); x <= Math.ceil(z.x + z.r); x++) {
      if (!inField(x, y) || hyp(x - z.x, y - z.y) > z.r) continue;
      const i = idx(x, y);
      const c = g.cells[i]!;
      if (c !== OPEN && c !== ROAD) put(g, i, OPEN);
      if (g.cells[i] === OPEN && (x !== z.x || y !== z.y)) inner.push(i);
    }
  for (let k = int(g, 2, 4); k > 0 && inner.length; k--) {
    const i = inner.splice(int(g, 0, inner.length - 1), 1)[0]!;
    if (g.town && chance(g, 0.4)) put(g, i, RUBBLE);
    else {
      put(g, i, WALL, SANDBAG);
      const j = i + 1;
      if (i % W < W - 1 && g.cells[j] === OPEN && inner.includes(j)) {
        put(g, j, WALL, SANDBAG);
        inner.splice(inner.indexOf(j), 1);
      }
    }
  }
}

/** The attackers' rows are clear ground. */
function clearDeployment(g: Gen): void {
  for (let i = BLUE_ROWS * W; i < N; i++) {
    const c = g.cells[i]!;
    if (c !== OPEN && c !== ROAD) put(g, i, OPEN);
  }
}

/** Each building stands on level ground; roads cut through bumps; nothing steps more than a level. */
function level(g: Gen): void {
  const e = g.elev;
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const lowered: number[] = [];
    seen.fill(0);
    for (let i = 0; i < N; i++) {
      if (g.cells[i] !== BUILDING || seen[i]) continue;
      const group: number[] = [];
      let low = MAX_ELEV;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        group.push(j);
        low = Math.min(low, e[j]!);
        const x = j % W;
        const y = (j - x) / W;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d]!;
          const ny = y + DY[d]!;
          if (!inField(nx, ny)) continue;
          const k = idx(nx, ny);
          if (!seen[k] && g.cells[k] === BUILDING) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      for (const j of group)
        if (e[j]! > low) {
          e[j] = low;
          lowered.push(j);
        }
    }
    for (let i = 0; i < N; i++) {
      if (!isRoad(g.cells[i])) continue;
      const x = i % W;
      const y = (i - x) / W;
      let top = -1;
      let n = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (inField(nx, ny) && isRoad(g.cells[idx(nx, ny)])) {
          top = Math.max(top, e[idx(nx, ny)]!);
          n++;
        }
      }
      if (n >= 2 && e[i]! > top) {
        e[i] = top;
        lowered.push(i);
      }
    }
    if (!lowered.length) break;
    slump(e, lowered);
  }
}

// --- Passage -----------------------------------------------------------------------------------------

function enters(c: Cell | undefined, mobility: Mobility, amphibious: boolean): boolean {
  switch (mobility) {
    case 'heli':
    case 'drone':
      return c !== undefined;
    case 'foot':
      return c !== undefined && c !== WATER;
    case 'tracked':
      return c === OPEN || c === ROAD || c === BRIDGE || c === RUBBLE || c === WALL || (amphibious && c === WATER);
    case 'wheeled':
      return c === OPEN || c === ROAD || c === BRIDGE || (amphibious && c === WATER);
  }
}

/** Cells a ground vehicle of this mobility reaches from `sources` by orthogonal steps. */
function flood(cells: Cell[], elev: number[], sources: number[], mobility: Mobility): Uint8Array {
  const seen = new Uint8Array(N);
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (const s of sources)
    if (!seen[s] && enters(cells[s], mobility, false)) {
      seen[s] = 1;
      q[tail++] = s;
    }
  while (head < tail) {
    const i = q[head++]!;
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (!inField(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j] || !enters(cells[j], mobility, false) || Math.abs(elev[j]! - elev[i]!) > 1) continue;
      seen[j] = 1;
      q[tail++] = j;
    }
  }
  return seen;
}

function deployment(): number[] {
  const out: number[] = [];
  for (let i = BLUE_ROWS * W; i < N; i++) out.push(i);
  return out;
}

/** The zone's centre (capture), or anywhere on row 8 (destroy). */
function goalOf(g: Gen): (i: number) => boolean {
  const z = g.zone;
  if (z) {
    const c = idx(z.x, z.y);
    return (i) => i === c;
  }
  return (i) => i >= 8 * W && i < 9 * W;
}

/**
 * Wheeled vehicles must be able to drive from the deployment rows to the goal: carve a road if not.
 * Returns the cells they reach from the deployment rows.
 */
function ensurePassage(g: Gen): Uint8Array {
  const goal = goalOf(g);
  const reached = (reach: Uint8Array) => {
    for (let i = 0; i < N; i++) if (reach[i] && goal(i)) return true;
    return false;
  };
  let reach = flood(g.cells, g.elev, deployment(), 'wheeled');
  for (let k = 0; k < 4 && !reached(reach); k++) {
    const sources: number[] = [];
    for (let i = 0; i < N; i++) if (reach[i]) sources.push(i);
    // A road the cheapest way: across fields, through hedges and woods before buildings, water last.
    const path = search(
      sources,
      goal,
      (i, j) => {
        const c = g.cells[j]!;
        const cost = isRoad(c) ? 0.5 : c === OPEN ? 1 : c === WALL || c === RUBBLE ? 2.5 : c === TREES ? 4 : c === ROCK ? 6 : c === BUILDING ? 10 + 2 * g.storeys[j]! : 40;
        return cost + (Math.abs(g.elev[j]! - g.elev[i]!) > 1 ? 6 : 0);
      },
      0.3,
    );
    if (!path) break;
    lay(g, path);
    level(g);
    reach = flood(g.cells, g.elev, deployment(), 'wheeled');
  }
  return reach;
}

// --- Output ------------------------------------------------------------------------------------------

function finish(g: Gen, fromDeploy: Uint8Array): BattleMap {
  const hp = new Array<number>(N).fill(0);
  const variant = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    const c = g.cells[i]!;
    if (c !== BUILDING) g.storeys[i] = 0;
    else if (g.storeys[i]! < 1) g.storeys[i] = 1;
    hp[i] = c === BUILDING ? BUILDING_HP_PER_STOREY * g.storeys[i]! : c === TREES ? 2 : c === WALL ? 1 : 0;
    const v = int(g, 0, 255);
    const k = c === BUILDING || c === WALL || c === TREES ? g.kind[i]! : -1;
    variant[i] = k >= 0 ? (v & 0xfc) | k : v;
  }
  const goal = goalOf(g);
  // Attackers: the deployment cells connected to the objective, middle first.
  const goals: number[] = [];
  for (let i = 0; i < N; i++) if (goal(i) && fromDeploy[i]) goals.push(i);
  const linked = flood(g.cells, g.elev, goals, 'wheeled');
  const blueSpawn: Point[] = [];
  for (let i = BLUE_ROWS * W; i < N; i++) if (linked[i]) blueSpawn.push({ x: i % W, y: (i / W) | 0 });
  blueSpawn.sort((a, b) => Math.abs(a.x - 14.5) + Math.abs(a.y - 42) * 1.2 - (Math.abs(b.x - 14.5) + Math.abs(b.y - 42) * 1.2) || a.y - b.y || a.x - b.x);
  return {
    w: W,
    h: H,
    biome: g.biome,
    terrain: g.terrain,
    cells: g.cells,
    elev: g.elev,
    storeys: g.storeys,
    hp,
    variant,
    crater: new Array<number>(N).fill(0),
    mode: g.zone ? 'capture' : 'destroy',
    zone: g.zone,
    blueSpawn,
    redSpawn: redSpawn(g),
  };
}

/** Defender positions north of the river, best first: near the objective, in cover, high, overlooking. */
function redSpawn(g: Gen): Point[] {
  const e = g.elev;
  const f = g.heart;
  const last = g.river ? Math.min(24, g.river.north - 1) : 24;
  const score = new Float64Array(N);
  const order: number[] = [];
  for (let y = 2; y <= last; y++)
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const c = g.cells[i]!;
      if (c === WATER || c === ROCK) continue;
      let s = -hyp(x - f.x, y - f.y) * 0.55 + e[i]! * 0.9;
      if (c === BUILDING) s += 4 + g.storeys[i]! * 0.5;
      else if (c === TREES) s += 2.5;
      else if (c === RUBBLE || c === WALL) s += 2;
      else if (c === ROAD) s -= 1;
      else if (c === BRIDGE) s -= 3;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (!inField(nx, y + 1)) continue;
        const n = g.cells[idx(nx, y + 1)];
        s += n === WALL || n === RUBBLE || n === ROCK ? 1.2 : n === BUILDING ? 0.6 : n === TREES ? 0.5 : 0;
      }
      // Ground falling away in front gives a field of fire; a crest just in front, a hull-down spot.
      let below = 0;
      for (let dy = 1; dy <= 5; dy++)
        for (let dx = -(dy >> 1); dx <= dy >> 1; dx++) if (inField(x + dx, y + dy) && e[idx(x + dx, y + dy)]! < e[i]!) below++;
      s += below * 0.12;
      if (y + 1 < H && e[i + W]! === e[i]! + 1) s += 2.5;
      if (g.zone && hyp(x - g.zone.x, y - g.zone.y) <= g.zone.r) s += 1.5;
      score[i] = s + rand(g) * 0.6;
      order.push(i);
    }
  order.sort((a, b) => score[b]! - score[a]! || a - b);
  return order.slice(0, 120).map((i) => ({ x: i % W, y: (i / W) | 0 }));
}

// --- Exports for the engine ------------------------------------------------------------------------

/** Can a unit of this mobility stand in or enter this cell, ignoring other units and elevation steps? */
export function passable(map: BattleMap, x: number, y: number, mobility: Mobility, amphibious?: boolean): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  return enters(map.cells[at(map, x, y)], mobility, amphibious ?? false);
}

/** Can it step from one cell to an adjacent one, given the elevation change? */
export function canStep(map: BattleMap, from: Point, to: Point, mobility: Mobility): boolean {
  if (mobility === 'heli' || mobility === 'drone') return true;
  const a = map.elev[at(map, from.x, from.y)];
  const b = map.elev[at(map, to.x, to.y)];
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= (mobility === 'foot' ? 2 : 1);
}

// Text glyphs: walls and trees by kind, buildings by storeys.
const GLYPH: Record<Cell, string> = { [OPEN]: '.', [ROAD]: '=', [TREES]: 'T', [WATER]: '~', [BRIDGE]: 'H', [BUILDING]: '1', [RUBBLE]: '%', [WALL]: '"', [ROCK]: '^' };
const WALL_GLYPH = ['"', '#', 'o', 'X'];
const TREE_GLYPH = ['T', 'A', 'Y', '*'];

function glyph(map: BattleMap, i: number, zone: boolean): string {
  const c = map.cells[i]!;
  const k = (map.variant[i] ?? 0) & 3;
  if (c === OPEN && zone) return ',';
  if (c === TREES) return TREE_GLYPH[k]!;
  if (c === WALL) return WALL_GLYPH[k]!;
  if (c === BUILDING) return String(map.storeys[i]);
  return GLYPH[c] ?? '?';
}

/** Plain-text picture of a map for debugging and test failure messages. */
export function renderAscii(map: BattleMap): string {
  const z = map.zone;
  const head = `${map.biome} ${map.terrain} ${map.mode}${z ? ` zone ${z.x},${z.y}` : ''}`;
  const lines = [head];
  for (let y = 0; y < map.h; y++) {
    let a = '';
    let b = '';
    for (let x = 0; x < map.w; x++) {
      const i = at(map, x, y);
      a += glyph(map, i, z !== null && hyp(x - z.x, y - z.y) <= z.r);
      b += String(map.elev[i]);
    }
    lines.push(`${String(y).padStart(2)} ${a}  ${b}`);
  }
  lines.push('. open  , zone  = road  ~ water  H bridge  1-4 building storeys  % rubble  ^ rock');
  lines.push('T broadleaf  A conifer  Y birch  * scrub  " hedge  # stone wall  o sandbag  X hesco');
  return lines.join('\n');
}
