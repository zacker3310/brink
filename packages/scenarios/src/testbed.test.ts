import { describe, expect, it } from 'vitest';
import { UNITS } from '@brink/game-data';
import { sortedKeys } from '@brink/simulation';
import { createScenario } from './index';
import { createTestbedScenario, TESTBED_ID, TESTBED_MAP } from './testbed';

describe('the six-power testbed', () => {
  const w = createTestbedScenario(1);
  const powers = sortedKeys(w.nations).filter((n) => !w.nations[n]!.minor);

  it('is six powers and four minor states on a 64 x 32 map', () => {
    expect(TESTBED_MAP.cols * TESTBED_MAP.rows).toBe(64 * 32);
    expect(Object.keys(w.tiles)).toHaveLength(64 * 32);
    expect(powers).toHaveLength(6);
    expect(sortedKeys(w.nations).filter((n) => w.nations[n]!.minor)).toHaveLength(4);
    expect(createScenario(TESTBED_ID, 1).commanders).toBeDefined();
  });

  it('gives every power a capital, an opening army, a doctrine and the minor capitals as objectives', () => {
    for (const p of powers) {
      const sites = Object.values(w.sites).filter((s) => s.owner === p);
      expect(sites.filter((s) => s.kind === 'capital'), p).toHaveLength(1);
      expect(Object.values(w.formations).filter((f) => f.owner === p && !UNITS[f.unitClass].naval).length, p).toBeGreaterThanOrEqual(10);
      expect(w.nations[p]!.doctrine, p).toBeDefined();
      expect(w.nations[p]!.objectives).toHaveLength(4);
    }
  });

  it('starts every power level, however many there are', () => {
    const vp = (p: string) => Object.values(w.sites).filter((s) => s.owner === p).reduce((a, s) => a + s.victoryPoints, 0);
    const army = (p: string) => Object.values(w.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
    const spread = (f: (p: string) => number) => {
      const v = powers.map(f);
      return (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    };
    expect(spread(vp)).toBeLessThanOrEqual(0.05);
    expect(spread(army)).toBeLessThanOrEqual(0.15);
  });

  it('is deterministic in the seed', () => {
    expect(createTestbedScenario(5)).toEqual(createTestbedScenario(5));
  });
});
