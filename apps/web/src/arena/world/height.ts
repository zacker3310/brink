import { BRIDGE, BUILDING, ROAD, TREES, WATER, type BattleMap, type Biome } from '@brink/arena/v2';
import { LEVEL } from '../quality';
import { clamp, fbm, lattice, noise2, smooth, wadi } from './noise';

// The ground's shape. Cell levels become a smooth heightfield (Catmull-Rom between cell centres,
// held inside the neighbouring levels so it never overshoots), flattened under buildings, with
// fine noise that fades on roads. The field is ringed by a margin of MARGIN cells that rolls on
// into the haze; rivers carry on through it. World units: one cell is one unit; cell (x, y) is
// centred at (x + 0.5, y + 0.5) on x and z.

/** Cells of ground drawn beyond the field on each side. */
export const MARGIN = 8;
/** How far a river bed sits under its banks, world units. */
export const BED = 0.24;
/** Water surface under the bank top. */
export const WATER_DROP = 0.07;

/** Distance (cells) from every extended cell to the nearest cell matching a test, capped. */
function chamfer(ew: number, eh: number, seed: (i: number) => boolean, cap: number): Float32Array {
  const d = new Float32Array(ew * eh);
  for (let i = 0; i < d.length; i++) d[i] = seed(i) ? 0 : cap;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < eh; y++)
    for (let x = 0; x < ew; x++) {
      const i = y * ew + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + a);
      if (y > 0) {
        v = Math.min(v, d[i - ew]! + a);
        if (x > 0) v = Math.min(v, d[i - ew - 1]! + b);
        if (x < ew - 1) v = Math.min(v, d[i - ew + 1]! + b);
      }
      d[i] = v;
    }
  for (let y = eh - 1; y >= 0; y--)
    for (let x = ew - 1; x >= 0; x--) {
      const i = y * ew + x;
      let v = d[i]!;
      if (x < ew - 1) v = Math.min(v, d[i + 1]! + a);
      if (y < eh - 1) {
        v = Math.min(v, d[i + ew]! + a);
        if (x < ew - 1) v = Math.min(v, d[i + ew + 1]! + b);
        if (x > 0) v = Math.min(v, d[i + ew - 1]! + b);
      }
      d[i] = v;
    }
  return d;
}

/** The field and its margin as cells: levels, water carried out of the field, distance fields. */
export class Layout {
  readonly w: number;
  readonly h: number;
  /** Extended grid size (field plus margin). */
  readonly ew: number;
  readonly eh: number;
  /** Level of each extended cell, world units. */
  readonly level: Float32Array;
  /** 1 for river (water or bridge) in each extended cell. */
  readonly water: Uint8Array;
  /** Water surface of each extended cell (the river's own level, carried to its banks). */
  readonly waterLevel: Float32Array;
  readonly distWater: Float32Array;
  readonly distRoad: Float32Array;
  readonly distBuilding: Float32Array;
  readonly distTrees: Float32Array;

  constructor(
    readonly map: BattleMap,
    seed: number,
  ) {
    const M = MARGIN;
    this.w = map.w;
    this.h = map.h;
    this.ew = map.w + M * 2;
    this.eh = map.h + M * 2;
    const n = this.ew * this.eh;
    this.level = new Float32Array(n);
    this.water = new Uint8Array(n);
    this.waterLevel = new Float32Array(n);
    const t = lattice(seed ^ 0x7e11);
    let mean = 0;
    for (const e of map.elev) mean += e;
    mean = (mean / Math.max(1, map.elev.length)) * LEVEL;
    for (let ey = 0; ey < this.eh; ey++)
      for (let ex = 0; ex < this.ew; ex++) {
        const x = ex - M;
        const y = ey - M;
        const cx = clamp(x, 0, map.w - 1);
        const cy = clamp(y, 0, map.h - 1);
        const ci = cy * map.w + cx;
        const edge = (map.elev[ci] ?? 0) * LEVEL;
        const c = map.cells[ci];
        const out = Math.max(cx - x, x - cx, cy - y, y - cy);
        const i = ey * this.ew + ex;
        // Water runs straight out of the field across the margin.
        const river = c === WATER || c === BRIDGE;
        const straight = (x !== cx) !== (y !== cy);
        if (river && (out === 0 || straight)) {
          this.water[i] = 1;
          this.level[i] = edge;
          continue;
        }
        // Beyond the field the land rolls away from the edge's level toward a gentle country of its own.
        const roll = mean + (fbm(t, x * 0.11, y * 0.11, 3) - 0.45) * 2.2 * LEVEL;
        const k = smooth(0, M * 0.85, out);
        this.level[i] = edge * (1 - k) + Math.max(0, roll) * k;
      }
    // The outermost ring settles to the far plain.
    let lo = Infinity;
    for (const v of this.level) lo = Math.min(lo, v);
    this.baseLevel = lo - 0.15;
    for (let ey = 0; ey < this.eh; ey++)
      for (let ex = 0; ex < this.ew; ex++) {
        const ring = Math.min(ex, ey, this.ew - 1 - ex, this.eh - 1 - ey);
        if (ring > 1) continue;
        const i = ey * this.ew + ex;
        this.level[i] = this.baseLevel + (this.level[i]! - this.baseLevel) * (ring === 0 ? 0 : 0.5);
      }
    // Each bank cell knows the level of the river beside it.
    for (let i = 0; i < n; i++) this.waterLevel[i] = this.level[i]!;
    for (let ey = 0; ey < this.eh; ey++)
      for (let ex = 0; ex < this.ew; ex++) {
        const i = ey * this.ew + ex;
        if (this.water[i]) continue;
        let best = Infinity;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = ex + dx;
            const ny = ey + dy;
            if (nx < 0 || ny < 0 || nx >= this.ew || ny >= this.eh) continue;
            const j = ny * this.ew + nx;
            if (this.water[j]) best = Math.min(best, this.level[j]!);
          }
        if (best < Infinity) this.waterLevel[i] = best;
      }
    const isCell = (test: (c: number) => boolean) => (i: number) => {
      const x = (i % this.ew) - M;
      const y = Math.floor(i / this.ew) - M;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
      return test(map.cells[y * map.w + x]!);
    };
    this.distWater = chamfer(this.ew, this.eh, (i) => this.water[i] === 1, 12);
    this.distRoad = chamfer(this.ew, this.eh, isCell((c) => c === ROAD || c === BRIDGE), 12);
    this.distBuilding = chamfer(this.ew, this.eh, isCell((c) => c === BUILDING), 12);
    this.distTrees = chamfer(this.ew, this.eh, isCell((c) => c === TREES), 12);
  }

  readonly baseLevel: number;

  /** Extended index of field cell (x, y), which may lie in the margin. */
  idx(x: number, y: number): number {
    const ex = clamp(x + MARGIN, 0, this.ew - 1);
    const ey = clamp(y + MARGIN, 0, this.eh - 1);
    return ey * this.ew + ex;
  }

  /** A distance field sampled at a world point, bilinear between cell centres. */
  sample(f: Float32Array, x: number, z: number): number {
    const gx = clamp(x + MARGIN - 0.5, 0, this.ew - 1.001);
    const gy = clamp(z + MARGIN - 0.5, 0, this.eh - 1.001);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * this.ew + x0;
    const a = f[i]!;
    const b = f[i + 1]!;
    const c = f[i + this.ew]!;
    const d = f[i + this.ew + 1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Micro-relief amplitude by biome: dunes roll, towns are graded flat. */
const RELIEF: Record<Biome, number> = { temperate: 1, steppe: 0.8, desert: 1.3, winter: 0.9, urban: 0.35 };

export class Heightfield {
  /** Vertices per cell. */
  readonly res: number;
  readonly nx: number;
  readonly nz: number;
  /** Heights at the grid vertices, row-major from (-MARGIN, -MARGIN). */
  readonly h: Float32Array;
  /** Water surface at the grid vertices (only meaningful near rivers). */
  readonly surface: Float32Array;
  readonly normals: Float32Array;

  constructor(
    readonly layout: Layout,
    res: number,
    seed: number,
  ) {
    const L = layout;
    const map = L.map;
    this.res = res;
    this.nx = L.ew * res + 1;
    this.nz = L.eh * res + 1;
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    this.surface = new Float32Array(n);
    this.normals = new Float32Array(n * 3);
    const t = lattice(seed ^ 0x5eed);
    const relief = RELIEF[map.biome] ?? 1;
    const lv = (ex: number, ey: number) => L.level[clamp(ey, 0, L.eh - 1) * L.ew + clamp(ex, 0, L.ew - 1)]!;
    const wl = (ex: number, ey: number) => L.waterLevel[clamp(ey, 0, L.eh - 1) * L.ew + clamp(ex, 0, L.ew - 1)]!;
    const wt = (ex: number, ey: number) => L.water[clamp(ey, 0, L.eh - 1) * L.ew + clamp(ex, 0, L.ew - 1)]!;
    const rows = [0, 0, 0, 0];
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) {
        const x = i / res - MARGIN;
        const z = j / res - MARGIN;
        // Cell-centre coordinates in the extended grid.
        const u = x + MARGIN - 0.5;
        const v = z + MARGIN - 0.5;
        const i0 = Math.floor(u);
        const j0 = Math.floor(v);
        const fu = u - i0;
        const fv = v - j0;
        for (let k = 0; k < 4; k++) rows[k] = catmull(lv(i0 - 1, j0 - 1 + k), lv(i0, j0 - 1 + k), lv(i0 + 1, j0 - 1 + k), lv(i0 + 2, j0 - 1 + k), fu);
        let hh = catmull(rows[0]!, rows[1]!, rows[2]!, rows[3]!, fv);
        const a = lv(i0, j0);
        const b = lv(i0 + 1, j0);
        const c = lv(i0, j0 + 1);
        const d = lv(i0 + 1, j0 + 1);
        hh = clamp(hh, Math.min(a, b, c, d), Math.max(a, b, c, d));
        // River bed and its water surface.
        const wa = wt(i0, j0);
        const wb = wt(i0 + 1, j0);
        const wc = wt(i0, j0 + 1);
        const wd = wt(i0 + 1, j0 + 1);
        const wm = wa + (wb - wa) * fu + (wc - wa) * fv + (wa - wb - wc + wd) * fu * fv;
        const sa = wl(i0, j0);
        const sb = wl(i0 + 1, j0);
        const sc = wl(i0, j0 + 1);
        const sd = wl(i0 + 1, j0 + 1);
        const surf = sa + (sb - sa) * fu + (sc - sa) * fv + (sa - sb - sc + sd) * fu * fv;
        const carve = smooth(0.18, 0.72, wm + (noise2(t, x * 2.3, z * 2.3) - 0.5) * 0.25);
        hh = hh * (1 - carve) + (surf - BED) * carve;
        this.surface[j * this.nx + i] = surf - WATER_DROP;
        // Fine relief, calm on roads and by buildings.
        const road = smooth(1.2, 0.2, L.sample(L.distRoad, x, z));
        const built = smooth(1.0, 0.1, L.sample(L.distBuilding, x, z));
        const out = Math.max(-x, x - map.w, -z, z - map.h, 0);
        const amp = relief * (1 - 0.85 * Math.max(road, built)) * (1 - carve * 0.5) * (1 + Math.min(1, out / 3));
        const big = (fbm(t, x * 0.35 + 11, z * 0.35 - 7, 3) - 0.5) * 0.11;
        const fine = (fbm(t, x * 1.7 - 31, z * 1.7 + 5, 2) - 0.5) * 0.045;
        let dune = 0;
        if (map.biome === 'desert') dune = (1 - Math.abs(noise2(t, x * 0.28 + z * 0.12, z * 0.5 - x * 0.1) * 2 - 1)) * 0.06;
        hh += (big + fine + dune) * amp;
        // Wadis cut shallow beds through the desert (not through towns or roads).
        if (map.biome === 'desert') hh -= wadi(x, z, seed) * 0.09 * (1 - Math.max(road, built));
        this.h[j * this.nx + i] = hh;
      }
    // Building pads: flat at the cell's own level so walls stand true.
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const ci = y * map.w + x;
        if (map.cells[ci] !== BUILDING) continue;
        const pad = (map.elev[ci] ?? 0) * LEVEL;
        const r0 = Math.floor((x + MARGIN - 0.35) * res);
        const r1 = Math.ceil((x + MARGIN + 1.35) * res);
        const s0 = Math.floor((y + MARGIN - 0.35) * res);
        const s1 = Math.ceil((y + MARGIN + 1.35) * res);
        for (let j = s0; j <= s1; j++)
          for (let i = r0; i <= r1; i++) {
            if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
            const px = i / res - MARGIN;
            const pz = j / res - MARGIN;
            const dx = Math.max(x - px, px - (x + 1), 0);
            const dz = Math.max(y - pz, pz - (y + 1), 0);
            const k = smooth(0.34, 0.06, Math.hypot(dx, dz));
            const p = j * this.nx + i;
            this.h[p] = this.h[p]! + (pad - this.h[p]!) * k;
          }
      }
    this.computeNormals();
  }

  private computeNormals(): void {
    const { nx, nz, h, res } = this;
    const step = 1 / res;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const l = h[j * nx + Math.max(0, i - 1)]!;
        const r = h[j * nx + Math.min(nx - 1, i + 1)]!;
        const u = h[Math.max(0, j - 1) * nx + i]!;
        const d = h[Math.min(nz - 1, j + 1) * nx + i]!;
        const ddx = (r - l) / (2 * step);
        const ddz = (d - u) / (2 * step);
        const len = Math.hypot(ddx, 1, ddz);
        const k = (j * nx + i) * 3;
        this.normals[k] = -ddx / len;
        this.normals[k + 1] = 1 / len;
        this.normals[k + 2] = -ddz / len;
      }
  }

  private bilinear(f: Float32Array, x: number, z: number): number {
    const gx = clamp((x + MARGIN) * this.res, 0, this.nx - 1.0001);
    const gz = clamp((z + MARGIN) * this.res, 0, this.nz - 1.0001);
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    const fx = gx - i0;
    const fz = gz - j0;
    const p = j0 * this.nx + i0;
    const a = f[p]!;
    const b = f[p + 1]!;
    const c = f[p + this.nx]!;
    const d = f[p + this.nx + 1]!;
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /** Ground height at a world point. */
  at(x: number, z: number): number {
    return this.bilinear(this.h, x, z);
  }

  /** Water surface at a world point (by a river). */
  surfaceAt(x: number, z: number): number {
    return this.bilinear(this.surface, x, z);
  }

  /** Slope 0 (flat) .. 1 (steep) at a world point. */
  slopeAt(x: number, z: number): number {
    const gx = clamp(Math.round((x + MARGIN) * this.res), 0, this.nx - 1);
    const gz = clamp(Math.round((z + MARGIN) * this.res), 0, this.nz - 1);
    return 1 - this.normals[(gz * this.nx + gx) * 3 + 1]!;
  }

  /** Surface normal at a world point (nearest vertex). */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const gx = clamp(Math.round((x + MARGIN) * this.res), 0, this.nx - 1);
    const gz = clamp(Math.round((z + MARGIN) * this.res), 0, this.nz - 1);
    const k = (gz * this.nx + gx) * 3;
    out.x = this.normals[k]!;
    out.y = this.normals[k + 1]!;
    out.z = this.normals[k + 2]!;
  }
}
