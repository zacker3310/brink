import type { HexKey } from '@brink/contracts';
import { keyDistance, neighborKeys } from './hex';

/** Cost to step from `from` into the adjacent `to`; null when the step is not allowed. */
export type StepCost = (from: HexKey, to: HexKey) => number | null;

export interface PathResult {
  /** Hexes entered, excluding the start. */
  path: HexKey[];
  cost: number;
}

interface Node {
  key: HexKey;
  g: number;
  f: number;
}

/** Ordering is total (f, then g, then key) so paths are identical across runs and platforms. */
function before(a: Node, b: Node): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g > b.g;
  return a.key < b.key;
}

class MinHeap {
  private items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(n: Node): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l]!, a[m]!)) m = l;
        if (r < a.length && before(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

export interface PathOptions {
  /** Lowest possible cost of a single step; keeps the heuristic admissible. */
  minStepCost?: number;
  /** Give up on paths more expensive than this. */
  maxCost?: number;
}

/** A* over hexes. Returns null when the goal cannot be reached. */
export function findPath(start: HexKey, goal: HexKey, cost: StepCost, opts: PathOptions = {}): PathResult | null {
  if (start === goal) return { path: [], cost: 0 };
  const minStep = opts.minStepCost ?? 1;
  const maxCost = opts.maxCost ?? Infinity;
  const g = new Map<HexKey, number>([[start, 0]]);
  const prev = new Map<HexKey, HexKey>();
  const closed = new Set<HexKey>();
  const open = new MinHeap();
  open.push({ key: start, g: 0, f: keyDistance(start, goal) * minStep });

  while (open.size > 0) {
    const cur = open.pop()!;
    if (closed.has(cur.key)) continue;
    if (cur.key === goal) {
      const path: HexKey[] = [];
      let k: HexKey | undefined = goal;
      while (k !== undefined && k !== start) {
        path.push(k);
        k = prev.get(k);
      }
      path.reverse();
      return { path, cost: cur.g };
    }
    closed.add(cur.key);
    for (const next of neighborKeys(cur.key)) {
      if (closed.has(next)) continue;
      const step = cost(cur.key, next);
      if (step === null) continue;
      const ng = cur.g + step;
      if (ng > maxCost) continue;
      const known = g.get(next);
      if (known !== undefined && known <= ng) continue;
      g.set(next, ng);
      prev.set(next, cur.key);
      open.push({ key: next, g: ng, f: ng + keyDistance(next, goal) * minStep });
    }
  }
  return null;
}

export interface Reach {
  cost: number;
  prev: HexKey | null;
}

/** Every hex reachable from `start` within `budget`, with the cheapest cost and predecessor. */
export function reachable(start: HexKey, budget: number, cost: StepCost): Record<HexKey, Reach> {
  const out: Record<HexKey, Reach> = { [start]: { cost: 0, prev: null } };
  const open = new MinHeap();
  open.push({ key: start, g: 0, f: 0 });
  const closed = new Set<HexKey>();
  while (open.size > 0) {
    const cur = open.pop()!;
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);
    for (const next of neighborKeys(cur.key)) {
      if (closed.has(next)) continue;
      const step = cost(cur.key, next);
      if (step === null) continue;
      const ng = cur.g + step;
      if (ng > budget) continue;
      const known = out[next];
      if (known && known.cost <= ng) continue;
      out[next] = { cost: ng, prev: cur.key };
      open.push({ key: next, g: ng, f: ng });
    }
  }
  return out;
}

/** Rebuild the path to `goal` from a reachable() result, excluding the start. */
export function pathFromReach(reach: Record<HexKey, Reach>, goal: HexKey): HexKey[] | null {
  if (!reach[goal]) return null;
  const path: HexKey[] = [];
  let k: HexKey | null = goal;
  while (k !== null) {
    const node: Reach | undefined = reach[k];
    if (!node) return null;
    if (node.prev === null) break;
    path.push(k);
    k = node.prev;
  }
  return path.reverse();
}
