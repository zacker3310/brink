// Small deterministic helpers shared by the world builders: seeded streams, hashes, value noise
// (plain and tileable), and colour mixing. Everything is a pure function of its seed.

export type RGB = [number, number, number];

/** A seeded stream in 0..1 (mulberry32). */
export function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixIn(h: number, v: number): number {
  h ^= v | 0;
  h = Math.imul(h, 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return h ^ (h >>> 15);
}

/** A hash of up to four integers to 0..1 (fixed arity: it runs millions of times a build). */
export function hash(a: number, b = 0, c = 0, d = 0): number {
  let h = 0x811c9dc5;
  h = mixIn(h, a);
  h = mixIn(h, b);
  h = mixIn(h, c);
  h = mixIn(h, d);
  return (h >>> 0) / 4294967296;
}

/** A 256 x 256 lattice of random values for value noise. */
export function lattice(seed: number): Float32Array {
  const out = new Float32Array(256 * 256);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    out[i] = (s >>> 8) / 16777216;
  }
  return out;
}

/** Smooth value noise, 0..1. Repeats every `period` lattice units (a power of two up to 256). */
export function noise2(t: Float32Array, x: number, y: number, period = 256): number {
  const m = period - 1;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = xi & m;
  const x1 = (xi + 1) & m;
  const y0 = (yi & m) * 256;
  const y1 = ((yi + 1) & m) * 256;
  const a = t[y0 + x0]!;
  const b = t[y0 + x1]!;
  const c = t[y1 + x0]!;
  const d = t[y1 + x1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise, 0..1. With a period, each octave doubles it so the sum still tiles. */
export function fbm(t: Float32Array, x: number, y: number, octaves: number, period = 0): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const p = period ? Math.min(256, period * f) : 256;
    sum += noise2(t, x * f + (period ? 0 : i * 17.3), y * f - (period ? 0 : i * 9.1), p) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Ridged noise for cracks, ruts and drifts: 1 on the ridge lines. */
export function ridged(t: Float32Array, x: number, y: number, period = 256): number {
  return 1 - Math.abs(noise2(t, x, y, period) * 2 - 1);
}

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export const hex = (h: string): RGB => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
export function mix(a: RGB, b: RGB, t: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
export const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Dry stream beds across a desert field: 1 in a wadi's bed, falling to 0 on its banks. */
export function wadi(x: number, z: number, seed: number): number {
  let best = 0;
  for (let k = 0; k < 2; k++) {
    const x0 = 5 + hash(seed, k, 71) * 20;
    const f = 0.12 + hash(seed, k, 72) * 0.1;
    const a = 1.5 + hash(seed, k, 73) * 2.5;
    const ph = hash(seed, k, 74) * 6.28;
    const xc = x0 + Math.sin(z * f + ph) * a + Math.sin(z * f * 2.3 + ph * 1.7) * a * 0.35;
    const w = 0.55 + 0.25 * Math.sin(z * 0.37 + ph);
    best = Math.max(best, smooth(w + 0.6, w * 0.5, Math.abs(x - xc)));
  }
  return best;
}
