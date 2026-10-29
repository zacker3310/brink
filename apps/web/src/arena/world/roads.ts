import * as THREE from 'three';
import { BRIDGE, ROAD, WATER, type BattleMap, type Biome } from '@brink/arena/v2';
import type { Polyline } from './ground';
import { MARGIN, type Heightfield, type Layout } from './height';
import { clamp, fbm, lattice, noise2, stream } from './noise';

// Roads drawn as ribbons over the ground, so their edges and markings stay sharp at any zoom:
// the road cells become a graph, the graph becomes chains between junctions, each chain is
// smoothed into a curve and laid on the heightfield (or a bridge deck). Asphalt in towns and on
// main roads, dirt tracks in the country; roads that leave the field run on into the margin.

const isRoad = (c: number | undefined) => c === ROAD || c === BRIDGE;

/** A bridge: a run of bridge cells across a river, its deck height from bank to bank. */
export interface Bridge {
  cells: number[];
  axis: 'x' | 'z';
  /** Deck span along the axis (world), and across. */
  from: number;
  to: number;
  across0: number;
  across1: number;
  /** Deck top at each end. */
  h0: number;
  h1: number;
}

export function findBridges(map: BattleMap, hf: Heightfield): Bridge[] {
  const seen = new Set<number>();
  const out: Bridge[] = [];
  for (let i = 0; i < map.cells.length; i++) {
    if (map.cells[i] !== BRIDGE || seen.has(i)) continue;
    const comp: number[] = [];
    const q = [i];
    seen.add(i);
    while (q.length) {
      const c = q.pop()!;
      comp.push(c);
      const x = c % map.w;
      const y = Math.floor(c / map.w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const j = ny * map.w + nx;
        if (map.cells[j] === BRIDGE && !seen.has(j)) {
          seen.add(j);
          q.push(j);
        }
      }
    }
    const xs = comp.map((c) => c % map.w);
    const ys = comp.map((c) => Math.floor(c / map.w));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    // A bridge spans the water: along z when land lies north and south of it.
    const landNS = [y0 - 1, y1 + 1].some((y) => y >= 0 && y < map.h && map.cells[y * map.w + x0] !== WATER && map.cells[y * map.w + x0] !== BRIDGE);
    const landEW = [x0 - 1, x1 + 1].some((x) => x >= 0 && x < map.w && map.cells[y0 * map.w + x] !== WATER && map.cells[y0 * map.w + x] !== BRIDGE);
    const axis: 'x' | 'z' = landNS && !landEW ? 'z' : landEW && !landNS ? 'x' : y1 - y0 >= x1 - x0 ? 'z' : 'x';
    const from = (axis === 'z' ? y0 : x0) - 0.3;
    const to = (axis === 'z' ? y1 + 1 : x1 + 1) + 0.3;
    const mid = axis === 'z' ? (x0 + x1 + 1) / 2 : (y0 + y1 + 1) / 2;
    const span = axis === 'z' ? x1 - x0 + 1 : y1 - y0 + 1;
    const half = Math.max(0.36, span / 2 - 0.12);
    const end = (s: number) => (axis === 'z' ? hf.at(mid, s) : hf.at(s, mid));
    const surf = axis === 'z' ? hf.surfaceAt(mid, (y0 + y1 + 1) / 2) : hf.surfaceAt((x0 + x1 + 1) / 2, mid);
    const h0 = Math.max(end(from - 0.15), surf + 0.16) + 0.02;
    const h1 = Math.max(end(to + 0.15), surf + 0.16) + 0.02;
    out.push({ cells: comp, axis, from, to, across0: mid - half, across1: mid + half, h0, h1 });
  }
  return out;
}

/** Deck top at a point, or null off every bridge. */
export function deckAt(bridges: Bridge[], x: number, z: number): number | null {
  for (const b of bridges) {
    const s = b.axis === 'z' ? z : x;
    const a = b.axis === 'z' ? x : z;
    if (s < b.from || s > b.to || a < b.across0 - 0.05 || a > b.across1 + 0.05) continue;
    const k = (s - b.from) / (b.to - b.from);
    // A gentle hog-back over the river.
    return b.h0 + (b.h1 - b.h0) * k + Math.sin(k * Math.PI) * 0.03;
  }
  return null;
}

interface Chain {
  cells: number[];
}

function chains(map: BattleMap): { chains: Chain[]; junctions: number[] } {
  const w = map.w;
  const nb = (c: number): number[] => {
    const x = c % w;
    const y = Math.floor(c / w);
    const out: number[] = [];
    const road = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < map.h && isRoad(map.cells[yy * w + xx]);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (road(x + dx, y + dy)) out.push((y + dy) * w + x + dx);
    // Diagonal steps only where no straight step links them.
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const)
      if (road(x + dx, y + dy) && !road(x + dx, y) && !road(x, y + dy)) out.push((y + dy) * w + x + dx);
    return out;
  };
  const nodes: number[] = [];
  for (let i = 0; i < map.cells.length; i++) if (isRoad(map.cells[i])) nodes.push(i);
  const adj = new Map<number, number[]>();
  for (const n of nodes) adj.set(n, nb(n));
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const out: Chain[] = [];
  const walk = (start: number, next: number) => {
    const cells = [start];
    let prev = start;
    let cur = next;
    used.add(key(start, next));
    for (;;) {
      cells.push(cur);
      const links = adj.get(cur)!;
      if (links.length !== 2) break;
      const go = links[0] === prev ? links[1]! : links[0]!;
      if (used.has(key(cur, go))) break;
      used.add(key(cur, go));
      prev = cur;
      cur = go;
    }
    out.push({ cells });
  };
  for (const n of nodes) {
    const links = adj.get(n)!;
    if (links.length === 2) continue;
    for (const m of links) if (!used.has(key(n, m))) walk(n, m);
  }
  // Loops with no junction.
  for (const n of nodes) for (const m of adj.get(n)!) if (!used.has(key(n, m))) walk(n, m);
  const junctions = nodes.filter((n) => adj.get(n)!.length >= 3);
  // Lone road cells: a short stub.
  for (const n of nodes) if (adj.get(n)!.length === 0) out.push({ cells: [n] });
  return { chains: out, junctions };
}

/** Douglas-Peucker: drop the stair steps of a cell path, keep its real bends. */
function simplify(pts: { x: number; z: number }[], tol: number): { x: number; z: number }[] {
  if (pts.length < 3) return pts;
  const a = pts[0]!;
  const b = pts.at(-1)!;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const d = Math.abs((b.x - a.x) * (a.z - p.z) - (a.x - p.x) * (b.z - a.z)) / len;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/** Simplify between fixed points (bridge spans stay exactly on their cells). */
function simplifyKeeping(pts: { x: number; z: number }[], keep: boolean[], tol: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  let from = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!keep[i] && i !== pts.length - 1) continue;
    const part = simplify(pts.slice(from, i + 1), tol);
    out.push(...(out.length ? part.slice(1) : part));
    from = i;
  }
  return out.length ? out : pts;
}

function chaikin(pts: { x: number; z: number }[], rounds: number): { x: number; z: number }[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const q: { x: number; z: number }[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    q.push(p.at(-1)!);
    p = q;
  }
  return p;
}

export interface RoadNet {
  lines: Polyline[];
  /** Junction centres and the widest road meeting there. */
  junctions: { x: number; z: number; width: number; asphalt: boolean }[];
}

export function roadNetwork(map: BattleMap, layout: Layout): RoadNet {
  const { chains: cs, junctions } = chains(map);
  const urban = map.biome === 'urban';
  const lines: Polyline[] = [];
  const centre = (c: number) => ({ x: (c % map.w) + 0.5, z: Math.floor(c / map.w) + 0.5 });
  const onEdge = (c: number) => {
    const x = c % map.w;
    const y = Math.floor(c / map.w);
    return x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
  };
  const jWidth = new Map<number, { width: number; asphalt: boolean }>();
  for (const ch of cs) {
    const pts = ch.cells.map(centre);
    // Bridges and the cells either side of them hold their line.
    const keep = ch.cells.map((c, k) => [ch.cells[k - 1], c, ch.cells[k + 1]].some((n) => n !== undefined && map.cells[n] === BRIDGE));
    // Roads leaving the field run on, straight, into the margin.
    const extend = (end: number, inner: number | undefined, atStart: boolean) => {
      if (!onEdge(end)) return;
      const e = centre(end);
      const x = end % map.w;
      const y = Math.floor(end / map.w);
      let dx = x === 0 ? -1 : x === map.w - 1 ? 1 : 0;
      let dz = y === 0 ? -1 : y === map.h - 1 ? 1 : 0;
      if (inner !== undefined) {
        const i = centre(inner);
        // Leave the way the road was heading when it runs along the edge.
        if (dx !== 0 && dz !== 0) {
          if (Math.abs(e.x - i.x) > Math.abs(e.z - i.z)) dz = 0;
          else dx = 0;
        } else if ((dx !== 0 && e.x === i.x) || (dz !== 0 && e.z === i.z)) return;
      }
      const far = { x: e.x + dx * (MARGIN + 1), z: e.z + dz * (MARGIN + 1) };
      const midp = { x: e.x + dx * 2, z: e.z + dz * 2 };
      if (atStart) {
        pts.unshift(far, midp);
        keep.unshift(false, false);
      } else {
        pts.push(midp, far);
        keep.push(false, false);
      }
    };
    const first = ch.cells[0]!;
    const last = ch.cells.at(-1)!;
    const firstDeg = ch.cells.length > 1 ? 1 : 0;
    if (ch.cells.length === 1 || !junctions.includes(first)) extend(first, ch.cells[firstDeg], true);
    if (ch.cells.length > 1 && !junctions.includes(last)) extend(last, ch.cells.at(-2), false);
    if (pts.length === 1) {
      const p = pts[0]!;
      pts.splice(0, 1, { x: p.x - 0.45, z: p.z }, { x: p.x + 0.45, z: p.z });
      keep.splice(0, 1, false, false);
    }
    const nearTown = ch.cells.some((c) => layout.distBuilding[layout.idx(c % map.w, Math.floor(c / map.w))]! <= 1.5);
    const asphalt = urban || ch.cells.length >= 14 || nearTown;
    const width = urban ? 1.0 : asphalt ? 0.52 : 0.36;
    for (const end of [first, last])
      if (junctions.includes(end)) {
        const j = jWidth.get(end);
        if (!j || width > j.width) jWidth.set(end, { width, asphalt });
      }
    lines.push({ pts: chaikin(simplifyKeeping(pts, keep, 0.75), 3), width, asphalt });
  }
  return {
    lines,
    junctions: junctions.map((j) => ({ ...centre(j), width: jWidth.get(j)?.width ?? 0.5, asphalt: jWidth.get(j)?.asphalt ?? true })),
  };
}

// --- Texture -------------------------------------------------------------------------------------

/** Road texture bands across u: rural asphalt, town street with pavements, dirt track. */
export const BAND = { rural: 0, street: 1, dirt: 2 } as const;
/** World length of one texture repeat along a road. */
const TILE = 2;

export function roadTexture(biome: Biome, size: number, seed: number): THREE.CanvasTexture {
  const w = size;
  const h = size;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const d = img.data;
  const t = lattice(seed ^ 0x40ad);
  const bw = w / 3;
  const winter = biome === 'winter';
  const desert = biome === 'desert';
  const asphalt: [number, number, number] = winter ? [62, 64, 66] : desert ? [92, 88, 80] : [66, 66, 64];
  const dirt: [number, number, number] = winter ? [196, 199, 200] : desert ? [176, 152, 116] : biome === 'steppe' ? [98, 84, 66] : [110, 94, 72];
  const rut: [number, number, number] = winter ? [96, 90, 82] : desert ? [150, 128, 96] : [80, 66, 50];
  const grass: [number, number, number] = winter ? [214, 218, 219] : desert ? [150, 136, 100] : biome === 'steppe' ? [140, 128, 88] : [96, 100, 62];
  const pave: [number, number, number] = winter ? [170, 172, 172] : [128, 124, 116];
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const band = Math.min(2, Math.floor(x / bw));
      const u = (x - band * bw) / bw;
      const k = (y * w + x) * 4;
      const fine = noise2(t, (x / w) * 128, v * 128, 128);
      const mid = fbm(t, (x / w) * 24 + band * 5, v * 24, 3, 32);
      let r: number;
      let gg: number;
      let b: number;
      let a = 255;
      if (band === BAND.dirt) {
        // Two ruts, a grassy crown, soft edges that fade into the field.
        const r1 = Math.exp(-(((u - 0.3) / 0.09) ** 2));
        const r2 = Math.exp(-(((u - 0.7) / 0.09) ** 2));
        const ruts = Math.min(1, r1 + r2);
        const crown = Math.exp(-(((u - 0.5) / 0.08) ** 2)) * (0.5 + mid * 0.6);
        const base = dirt.map((cc, i) => cc + (rut[i]! - cc) * ruts * 0.8 + (grass[i]! - cc) * crown * 0.7) as [number, number, number];
        const shade = 0.86 + fine * 0.22 + (mid - 0.5) * 0.2;
        r = base[0] * shade;
        gg = base[1] * shade;
        b = base[2] * shade;
        // Puddles in the ruts (dark).
        if (!desert && ruts > 0.6 && mid > 0.66) {
          r *= 0.6;
          gg *= 0.62;
          b *= 0.66;
        }
        const edge = Math.min(u, 1 - u);
        a = clamp((edge - 0.02) / 0.16 + (mid - 0.5) * 0.6) * 255;
      } else {
        // Asphalt: grain, patches, cracks.
        const patch = mid > 0.64 ? 0.86 : mid < 0.3 ? 1.08 : 1;
        const crack = Math.abs(noise2(t, (x / w) * 40 + 9, v * 40 + 3, 64) - 0.5) < 0.012 ? 0.72 : 1;
        const shade = (0.84 + fine * 0.3) * patch * crack;
        r = asphalt[0] * shade;
        gg = asphalt[1] * shade;
        b = asphalt[2] * shade;
        if (band === BAND.street) {
          // Pavements and kerbs on both sides.
          const side = Math.min(u, 1 - u);
          if (side < 0.18) {
            const slab = (Math.floor((v * TILE * 10) % 10) + Math.floor(side * 60)) % 2;
            const joint = Math.abs(((v * TILE * 10) % 1) - 0.5) > 0.46 ? 0.8 : 1;
            const ps = (0.9 + fine * 0.16 + slab * 0.03) * joint;
            r = pave[0] * ps;
            gg = pave[1] * ps;
            b = pave[2] * ps;
          } else if (side < 0.2) {
            r = gg = b = (winter ? 200 : 150) * (0.9 + fine * 0.15);
          }
        }
        // Worn white edge lines and a dashed centre line.
        const lineCol = winter ? 0 : 1;
        const edgeU = band === BAND.street ? 0.24 : 0.08;
        const edgeLine = Math.abs(Math.min(u, 1 - u) - edgeU) < 0.012 && band === BAND.rural;
        const dash = Math.abs(u - 0.5) < 0.011 && (v * TILE * 2) % 1 < 0.5;
        const wear = 0.35 + mid * 0.5;
        if (lineCol && (edgeLine || dash) && fine > 0.25) {
          r += (205 - r) * wear;
          gg += (200 - gg) * wear;
          b += (186 - b) * wear;
        }
        // Packed snow over the road in winter, worn to wet asphalt in the wheel tracks; dust in the desert.
        const side = Math.min(u, 1 - u);
        if (winter) {
          const tracks = Math.exp(-(((Math.abs(u - 0.5) - 0.2) / 0.07) ** 2));
          const snow = clamp(0.92 - tracks * 0.75 + (mid - 0.5) * 0.5 + (fine > 0.8 ? 0.1 : 0)) * (band === BAND.street && side < 0.2 ? 0.7 : 1);
          r += (206 - r) * snow;
          gg += (210 - gg) * snow;
          b += (213 - b) * snow;
        } else if (desert) {
          const dust = clamp((0.12 - side) / 0.1 + (mid - 0.5) * 0.5) * 0.7;
          r += (190 - r) * dust;
          gg += (168 - gg) * dust;
          b += (130 - b) * dust;
        }
        // Crumbling edges.
        a = clamp((side - 0.0) / 0.05 + (fine - 0.5) * 0.6) * 255;
      }
      d[k] = clamp(r, 0, 255);
      d[k + 1] = clamp(gg, 0, 255);
      d[k + 2] = clamp(b, 0, 255);
      d[k + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// --- Ribbons -------------------------------------------------------------------------------------

/** The roads as one mesh draped on the ground and the bridge decks. */
export function roadGeometry(net: RoadNet, hf: Heightfield, bridges: Bridge[], seed: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const LIFT = 0.018;
  const heightAt = (x: number, z: number) => {
    const deck = deckAt(bridges, x, z);
    return (deck ?? hf.at(x, z)) + LIFT;
  };
  const rnd = stream(seed ^ 0x40);
  for (const line of net.lines) {
    // Resample evenly so the ribbon hugs the ground.
    const pts = line.pts;
    const samples: { x: number; z: number; s: number }[] = [];
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / 0.2));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        samples.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, s: s + len * f });
      }
      s += len;
    }
    const last = pts.at(-1)!;
    samples.push({ x: last.x, z: last.z, s });
    const band = line.width >= 0.9 ? BAND.street : line.asphalt ? BAND.rural : BAND.dirt;
    const u0 = band / 3 + 0.004;
    const u1 = (band + 1) / 3 - 0.004;
    const vOff = rnd();
    const base = pos.length / 3;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i]!;
      const a = samples[Math.max(0, i - 1)]!;
      const b = samples[Math.min(samples.length - 1, i + 1)]!;
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const half = line.width / 2;
      for (let k = 0; k < 3; k++) {
        const o = (k - 1) * half;
        const x = p.x - tz * o;
        const z = p.z + tx * o;
        pos.push(x, heightAt(x, z), z);
        nrm.push(0, 1, 0);
        uv.push(u0 + (u1 - u0) * (k / 2), p.s / TILE + vOff);
      }
      if (i > 0) {
        const r0 = base + (i - 1) * 3;
        const r1 = base + i * 3;
        for (let k = 0; k < 2; k++) idx.push(r0 + k, r0 + k + 1, r1 + k, r0 + k + 1, r1 + k + 1, r1 + k);
      }
    }
  }
  // Junctions: a plain patch of the widest road's surface.
  for (const j of net.junctions) {
    const band = j.width >= 0.9 ? BAND.street : j.asphalt ? BAND.rural : BAND.dirt;
    const r = j.width / 2;
    // Planar UVs inside the band's plain surface, so the patch keeps the road's grain.
    const lo = band === BAND.dirt ? 0.42 : 0.16;
    const hi = band === BAND.dirt ? 0.58 : 0.36;
    const uAt = (x: number) => (band + lo + (hi - lo) * Math.min(1, Math.max(0, ((x - j.x) / (r * 1.6) + 1) / 2))) / 3;
    const vAt = (z: number) => (z - j.z) / TILE;
    const c0 = pos.length / 3;
    pos.push(j.x, heightAt(j.x, j.z) + 0.002, j.z);
    nrm.push(0, 1, 0);
    uv.push(uAt(j.x), vAt(j.z));
    const seg = band === BAND.street ? 4 : 14;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2 + (band === BAND.street ? Math.PI / 4 : 0);
      const rr = band === BAND.street ? r * Math.SQRT2 * 0.62 : r * 1.05;
      const x = j.x + Math.cos(a) * rr;
      const z = j.z + Math.sin(a) * rr;
      pos.push(x, heightAt(x, z) + 0.002, z);
      nrm.push(0, 1, 0);
      uv.push(uAt(x), vAt(z));
      if (k > 0) idx.push(c0, c0 + k + 1, c0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
