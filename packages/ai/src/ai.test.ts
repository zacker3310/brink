import { describe, expect, it } from 'vitest';
import { createMeridianScenario } from '@brink/scenarios';
import { buildView, lockOrders, resolveTurn, sortedKeys } from '@brink/simulation';
import { emptyMemory, planOrders } from './index';

describe('AI', () => {
  it('only ever submits orders the validator accepts, over whole matches', () => {
    for (const seed of [1, 2, 3, 4]) {
      let w = createMeridianScenario(seed);
      for (let turn = 0; turn < 30 && !w.victory; turn++) {
        const subs = sortedKeys(w.nations)
          .filter((n) => !w.nations[n]!.eliminated)
          .map((n) => planOrders(buildView(w, n), emptyMemory(), w.seed));
        const { rejected } = lockOrders(w, subs);
        expect(rejected, `seed ${seed} turn ${w.turn}`).toEqual([]);
        w = resolveTurn(w, subs).world;
      }
    }
  });

  it('is deterministic and reads nothing but its own view', () => {
    const w = createMeridianScenario(5);
    const view = buildView(w, 'korva');
    const a = planOrders(view, emptyMemory(), 9);
    const b = planOrders(JSON.parse(JSON.stringify(view)), emptyMemory(), 9);
    expect(a).toEqual(b);
    expect(Object.keys(a.formations).every((id) => view.formations[id])).toBe(true);
  });

  it('issues movement and recruitment on the first turn', () => {
    const w = createMeridianScenario(3);
    const o = planOrders(buildView(w, 'aster'), emptyMemory(), 3);
    expect(Object.values(o.formations).some((x) => x.type === 'move' || x.type === 'recon')).toBe(true);
    expect(o.recruit.length).toBeGreaterThan(0);
  });
});
