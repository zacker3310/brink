/** A small seeded generator, so a level and its fight replay the same from a seed. */
export function mulberry32(seed: number): () => number {
  const s = { stream: seed >>> 0 };
  return () => draw(s);
}

/**
 * One draw from a mulberry32 stream whose whole state is the number in `s.stream`, so the state
 * that owns it stays plain JSON: it can be saved, posted to a worker and resumed mid-battle.
 */
export function draw(s: { stream: number }): number {
  s.stream = (s.stream + 0x6d2b79f5) >>> 0;
  let t = s.stream;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
