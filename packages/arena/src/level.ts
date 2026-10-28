import type { Terrain } from '@brink/contracts';
import { ARENA_H, ARENA_W, ZONE_RADIUS } from './rules';
import { mulberry32 } from './rng';

// The battlefield is built from the hex being fought over: forest is trees to hide in, a city is
// blocks of buildings and streets, a river cuts the field with two bridges, hills and mountains
// throw up rock ridges, an objective sits inside a ring of Hesco walls.

export const OPEN = 0;
/** Hard cover: blocks movement, sight and shots; shells bounce off it. */
export const WALL = 1;
/** Trees: block vehicles and sight; infantry walk through; shots knock them down. */
export const TREE = 2;
/** Water: only aircraft cross it; shots fly over. */
export const WATER = 3;
export const BRIDGE = 4;
/** Crates and sandbag ends: block like a wall but break after a hit. */
export const CRATE = 5;

export type Cell = typeof OPEN | typeof WALL | typeof TREE | typeof WATER | typeof BRIDGE | typeof CRATE;
export type WallStyle = 'building' | 'rock' | 'hesco' | 'sandbag';

export interface Point {
  x: number;
  y: number;
}

export type SiteKind = 'capital' | 'city' | 'objective' | 'depot' | null;

export interface LevelSetup {
  seed: number;
  terrain: Terrain;
  river: boolean;
  site: SiteKind;
}

export interface Level {
  w: number;
  h: number;
  terrain: Terrain;
  cells: Cell[];
  /** How a wall cell looks (and, for buildings, how tall it is in cells). */
  style: (WallStyle | null)[];
  height: number[];
  /** Hits left on trees and crates. */
  hp: number[];
  mode: 'destroy' | 'capture';
  zone: (Point & { r: number }) | null;
  blueSpawn: Point[];
  redSpawn: Point[];
}

export const idx = (x: number, y: number) => y * ARENA_W + x;
export const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < ARENA_W && y < ARENA_H;

export function buildLevel(setup: LevelSetup): Level {
  const rnd = mulberry32(setup.seed ^ 0x9e3779b9);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const n = ARENA_W * ARENA_H;
  const level: Level = {
    w: ARENA_W,
    h: ARENA_H,
    terrain: setup.terrain,
    cells: new Array<Cell>(n).fill(OPEN),
    style: new Array<WallStyle | null>(n).fill(null),
    height: new Array<number>(n).fill(0),
    hp: new Array<number>(n).fill(0),
    mode: setup.site === 'capital' || setup.site === 'city' || setup.site === 'objective' ? 'capture' : 'destroy',
    zone: null,
    blueSpawn: [],
    redSpawn: [],
  };
  const set = (x: number, y: number, c: Cell, style: WallStyle | null = null, height = 1) => {
    if (!inside(x, y)) return;
    const i = idx(x, y);
    level.cells[i] = c;
    level.style[i] = c === WALL || c === CRATE ? style : null;
    level.height[i] = c === WALL ? height : c === CRATE ? 0.6 : c === TREE ? 1.4 : 0;
    level.hp[i] = c === TREE ? 2 : c === CRATE ? 1 : 0;
  };
  const clump = (cx: number, cy: number, r: number, c: Cell, style: WallStyle | null = null, density = 0.75) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.5 && rnd() < density) set(x, y, c, style, 1);
  };
  const line = (x0: number, y0: number, dx: number, dy: number, len: number, c: Cell, style: WallStyle | null) => {
    for (let i = 0; i < len; i++) set(x0 + dx * i, y0 + dy * i, c, style, 1);
  };

  const urban = setup.terrain === 'urban' || setup.site === 'capital' || setup.site === 'city';
  if (urban) {
    // City blocks on a street grid, a few blocks missing, crates in the streets.
    for (let by = 2; by < ARENA_H - 4; by += 4) {
      for (let bx = 1; bx < ARENA_W - 1; bx += 4) {
        if (rnd() < 0.18) continue;
        const bw = int(2, 3);
        const bh = int(2, 3);
        const tall = int(1, 3);
        for (let y = by; y < by + bh; y++) for (let x = bx; x < Math.min(bx + bw, ARENA_W - 1); x++) set(x, y, WALL, 'building', tall + rnd() * 0.4);
      }
    }
    for (let i = 0; i < 6; i++) set(int(0, ARENA_W - 1), int(2, ARENA_H - 5), CRATE, 'sandbag');
  } else if (setup.terrain === 'forest') {
    for (let i = 0; i < 13; i++) clump(int(0, ARENA_W - 1), int(2, ARENA_H - 5), int(1, 2), TREE);
    for (let i = 0; i < 3; i++) clump(int(1, ARENA_W - 2), int(3, ARENA_H - 6), 0, WALL, 'rock', 1);
  } else if (setup.terrain === 'hills' || setup.terrain === 'mountains') {
    const ridges = setup.terrain === 'mountains' ? 7 : 4;
    for (let i = 0; i < ridges; i++) {
      const dx = rnd() < 0.5 ? 1 : -1;
      line(int(1, ARENA_W - 2), int(3, ARENA_H - 8), dx, rnd() < 0.5 ? 1 : 0, int(3, 5), WALL, 'rock');
    }
    for (let i = 0; i < (setup.terrain === 'mountains' ? 4 : 6); i++) clump(int(0, ARENA_W - 1), int(2, ARENA_H - 5), 1, TREE, null, 0.6);
  } else {
    // Open fields: sandbag lines and crates for cover, a couple of copses.
    for (let i = 0; i < 6; i++) {
      const x = int(1, ARENA_W - 4);
      const y = int(3, ARENA_H - 6);
      line(x, y, 1, 0, int(2, 3), WALL, 'sandbag');
    }
    for (let i = 0; i < 5; i++) set(int(0, ARENA_W - 1), int(2, ARENA_H - 5), CRATE, 'sandbag');
    for (let i = 0; i < 2; i++) clump(int(1, ARENA_W - 2), int(3, ARENA_H - 6), 1, TREE, null, 0.7);
  }

  if (setup.river) {
    const y0 = Math.floor(ARENA_H / 2) - 1;
    for (let y = y0; y < y0 + 3; y++) for (let x = 0; x < ARENA_W; x++) set(x, y, WATER);
    const a = int(1, 5);
    const b = int(8, ARENA_W - 3);
    for (const bx of [a, b]) for (let y = y0; y < y0 + 3; y++) for (let x = bx; x < bx + 2; x++) set(x, y, BRIDGE);
  }

  if (level.mode === 'capture') {
    const zone = { x: Math.floor(ARENA_W / 2) + 0.5, y: 5.5, r: ZONE_RADIUS };
    level.zone = zone;
    // The square at the heart of it is open ground.
    for (let y = 3; y <= 8; y++) for (let x = 4; x <= 10; x++) if ((x + 0.5 - zone.x) ** 2 + (y + 0.5 - zone.y) ** 2 <= (zone.r + 0.6) ** 2) set(x, y, OPEN);
    if (setup.site === 'objective') {
      // A Hesco ring with four gaps.
      for (let a = 0; a < 24; a++) {
        if (a % 6 === 0) continue;
        const t = (a / 24) * Math.PI * 2;
        set(Math.floor(zone.x + Math.cos(t) * (zone.r + 1.6)), Math.floor(zone.y + Math.sin(t) * (zone.r + 1.6)), WALL, 'hesco', 1);
      }
    }
  }

  // Spawns: attackers along the bottom edge, defenders up top, each on clear ground.
  for (let y = ARENA_H - 3; y < ARENA_H; y++) for (let x = 0; x < ARENA_W; x++) set(x, y, OPEN);
  for (let y = 0; y < 2; y++) for (let x = 0; x < ARENA_W; x++) if (level.cells[idx(x, y)] === WATER) set(x, y, OPEN);
  for (const x of [7, 4, 10, 2, 12, 5, 9]) level.blueSpawn.push({ x: x + 0.5, y: ARENA_H - 1.5 });
  const top: Point[] = [];
  for (let y = 1; y <= 8; y++) for (let x = 1; x < ARENA_W - 1; x++) if (level.cells[idx(x, y)] === OPEN) top.push({ x: x + 0.5, y: y + 0.5 });
  // Defenders prefer the zone (when there is one) and cover.
  const cover = (p: Point) => [-1, 0, 1].reduce((a, dy) => a + [-1, 0, 1].filter((dx) => isSolid(level, Math.floor(p.x) + dx, Math.floor(p.y) + dy)).length, 0);
  const near = (p: Point) => (level.zone ? Math.hypot(p.x - level.zone.x, p.y - level.zone.y) : Math.abs(p.y - 4));
  top.sort((p, q) => near(p) - cover(p) * 0.6 - (near(q) - cover(q) * 0.6) || rnd() - 0.5);
  for (const p of top) {
    if (level.redSpawn.every((s) => Math.hypot(s.x - p.x, s.y - p.y) >= 2.2)) level.redSpawn.push(p);
    if (level.redSpawn.length >= 7) break;
  }

  ensurePassage(level);
  return level;
}

export function isSolid(level: Level, x: number, y: number): boolean {
  if (!inside(x, y)) return true;
  const c = level.cells[idx(x, y)];
  return c === WALL || c === CRATE;
}

/** Can a ground unit (`foot`: infantry) stand in this cell? */
export function walkable(level: Level, x: number, y: number, foot: boolean): boolean {
  if (!inside(x, y)) return false;
  const c = level.cells[idx(x, y)];
  return c === OPEN || c === BRIDGE || (foot && c === TREE);
}

/** Make sure vehicles can drive from the attackers' edge to the defenders: carve a lane if not. */
function ensurePassage(level: Level): void {
  const from = { x: 7, y: ARENA_H - 2 };
  const goal = level.zone ? { x: Math.floor(level.zone.x), y: Math.floor(level.zone.y) } : { x: 7, y: 3 };
  const reach = new Set<number>([idx(from.x, from.y)]);
  const queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!walkable(level, x, y, false) || reach.has(idx(x, y))) continue;
      reach.add(idx(x, y));
      queue.push({ x, y });
    }
  }
  if (reach.has(idx(goal.x, goal.y))) return;
  // A straight road up the middle, bridging any water.
  for (let y = goal.y; y <= from.y; y++) {
    for (const x of [7, 8]) {
      const i = idx(x, y);
      const c = level.cells[i];
      if (c === WATER) level.cells[i] = BRIDGE;
      else if (c !== BRIDGE) {
        level.cells[i] = OPEN;
        level.style[i] = null;
        level.height[i] = 0;
      }
    }
  }
}
