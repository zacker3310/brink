import type { HexKey } from '@brink/contracts';

export interface Axial {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Neighbor offsets in a fixed order: E, NE, NW, W, SW, SE. */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(q: number, r: number): HexKey {
  // Normalise -0 so keys are stable.
  return `${q === 0 ? 0 : q},${r === 0 ? 0 : r}`;
}

export function keyOf(a: Axial): HexKey {
  return hexKey(a.q, a.r);
}

export function parseKey(key: HexKey): Axial {
  const comma = key.indexOf(',');
  if (comma < 0) throw new Error(`invalid hex key: ${key}`);
  const q = Number(key.slice(0, comma));
  const r = Number(key.slice(comma + 1));
  if (!Number.isInteger(q) || !Number.isInteger(r)) throw new Error(`invalid hex key: ${key}`);
  return { q, r };
}

export function add(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function keyDistance(a: HexKey, b: HexKey): number {
  return distance(parseKey(a), parseKey(b));
}

export function neighbors(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => add(a, d));
}

export function neighborKeys(key: HexKey): HexKey[] {
  return neighbors(parseKey(key)).map(keyOf);
}

export function areAdjacent(a: HexKey, b: HexKey): boolean {
  return keyDistance(a, b) === 1;
}

/** All hexes within `radius` of `center`, including the center. */
export function range(center: Axial, radius: number): Axial[] {
  const out: Axial[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: center.q + dq, r: center.r + dr });
  }
  return out;
}

export function rangeKeys(center: HexKey, radius: number): HexKey[] {
  return range(parseKey(center), radius).map(keyOf);
}

/** Odd-row offset (col, row) to axial. Used to lay out rectangular maps. */
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(a: Axial): { col: number; row: number } {
  return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r };
}

export function roundAxial(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq === 0 ? 0 : rq, r: rr === 0 ? 0 : rr };
}

const SQRT3 = Math.sqrt(3);

/** Pointy-top layout. Center of the hex in pixels for a given circumradius. */
export function hexToPixel(a: Axial, size: number): Point {
  return { x: size * SQRT3 * (a.q + a.r / 2), y: size * 1.5 * a.r };
}

export function pixelToHex(p: Point, size: number): Axial {
  const q = ((SQRT3 / 3) * p.x - (1 / 3) * p.y) / size;
  const r = ((2 / 3) * p.y) / size;
  return roundAxial(q, r);
}

/** Corner points of a pointy-top hex, clockwise from the top. */
export function hexCorners(center: Point, size: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    out.push({ x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) });
  }
  return out;
}

/** Index into DIRECTIONS for the neighbor `to` of `from`, or -1 if not adjacent. */
export function directionIndex(from: Axial, to: Axial): number {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  return DIRECTIONS.findIndex((d) => d.q === dq && d.r === dr);
}
