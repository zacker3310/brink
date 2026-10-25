import { describe, expect, it } from 'vitest';
import type { HexKey } from '@brink/contracts';
import { hexKey, areAdjacent, keyOf, range } from './hex';
import { findPath, pathFromReach, reachable, type StepCost } from './pathfinding';

const grid = new Set(range({ q: 0, r: 0 }, 6).map(keyOf));
const walls = new Set(['1,0', '1,-1', '0,1', '1,1', '2,-1', '2,0']);
const mud = new Set(['-1,0', '-1,1']);

const cost: StepCost = (_from, to) => {
  if (!grid.has(to) || walls.has(to)) return null;
  return mud.has(to) ? 4 : 1;
};

function isContiguous(start: HexKey, path: HexKey[]): boolean {
  let prev = start;
  for (const k of path) {
    if (!areAdjacent(prev, k)) return false;
    prev = k;
  }
  return true;
}

describe('findPath', () => {
  it('returns an empty path when start is the goal', () => {
    expect(findPath('0,0', '0,0', cost)).toEqual({ path: [], cost: 0 });
  });

  it('routes around impassable hexes', () => {
    const res = findPath('0,0', '3,0', cost);
    expect(res).not.toBeNull();
    expect(res!.path.at(-1)).toBe('3,0');
    expect(isContiguous('0,0', res!.path)).toBe(true);
    for (const k of res!.path) expect(walls.has(k)).toBe(false);
  });

  it('prefers cheaper terrain over shorter paths', () => {
    const direct = findPath('0,0', '-2,1', (_f, to) => (grid.has(to) ? 1 : null));
    const muddy = findPath('0,0', '-2,1', cost);
    expect(direct!.cost).toBe(2);
    expect(muddy!.cost).toBe(4);
    for (const k of muddy!.path.slice(0, -1)) expect(mud.has(k)).toBe(false);
  });

  it('returns null for unreachable goals', () => {
    expect(findPath('0,0', '1,0', cost)).toBeNull();
    expect(findPath('0,0', hexKey(20, 20), cost)).toBeNull();
  });

  it('respects maxCost', () => {
    expect(findPath('0,0', '-4,0', cost, { maxCost: 3 })).toBeNull();
  });

  it('is deterministic', () => {
    const a = findPath('-3,3', '4,-2', cost);
    const b = findPath('-3,3', '4,-2', cost);
    expect(a).toEqual(b);
  });
});

describe('reachable', () => {
  it('contains only hexes within budget with consistent paths', () => {
    const reach = reachable('0,0', 3, cost);
    expect(reach['0,0']!.cost).toBe(0);
    for (const [k, v] of Object.entries(reach)) {
      expect(v.cost).toBeLessThanOrEqual(3);
      const path = pathFromReach(reach, k)!;
      expect(isContiguous('0,0', path)).toBe(true);
      let total = 0;
      let prev = '0,0';
      for (const step of path) {
        total += cost(prev, step)!;
        prev = step;
      }
      expect(total).toBe(v.cost);
    }
  });

  it('matches findPath costs', () => {
    const reach = reachable('0,0', 8, cost);
    for (const k of Object.keys(reach)) {
      expect(findPath('0,0', k, cost)!.cost).toBe(reach[k]!.cost);
    }
  });
});
