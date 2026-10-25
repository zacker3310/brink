import { fnv1a } from './hash';

// Random values are derived from what they are for, not drawn from a stream. A draw keyed by
// (seed, turn, phase, entity ids) gives the same value no matter how many other draws happened
// first or in what order the entities were visited.

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function roll(seed: number, ...parts: (string | number)[]): number {
  return mix(fnv1a(`${seed}|${parts.join('|')}`));
}

/** Integer in [lo, hi], inclusive. */
export function rollRange(lo: number, hi: number, seed: number, ...parts: (string | number)[]): number {
  if (hi < lo) throw new Error(`empty range ${lo}..${hi}`);
  return lo + (roll(seed, ...parts) % (hi - lo + 1));
}

/** Sequential PRNG (mulberry32) for scenario generation only, never for turn resolution. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
