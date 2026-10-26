import { describe, expect, it } from 'vitest';
import { createMeridianScenario } from '@brink/scenarios';
import { hexKey } from '@brink/map';
import { buildView, lockOrders, previewAssault, resolveTurn, sortedKeys } from '@brink/simulation';
import { makeWorld, own, setRelation, site, unit } from '../../simulation/src/fixture.test-util';
import { emptyMemory, planOrders, updateMemory } from './index';

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

  it('masses formations into one assault on a held hex that no single formation could take', () => {
    const w = makeWorld(10, 6, ['a', 'b']);
    const target = hexKey(6, 2);
    site(w, 'b-town', target, 'b', 'city', 5);
    own(w, 'b', [target]);
    unit(w, 'b1', 'b', 'infantry', target, { entrenchment: 40 });
    unit(w, 'ar', 'a', 'recon', hexKey(4, 2));
    const attackers = ['a1', 'a2', 'a3'];
    unit(w, 'a1', 'a', 'infantry', hexKey(3, 2));
    unit(w, 'a2', 'a', 'infantry', hexKey(3, 3));
    unit(w, 'a3', 'a', 'mechanized', hexKey(4, 1));
    const view = buildView(w, 'a');
    // Alone, none of them is favoured.
    for (const id of attackers) expect(previewAssault(view, [id], target)!.share[0]).toBeLessThan(500);
    const o = planOrders(view, emptyMemory(), 1);
    for (const id of attackers) {
      const order = o.formations[id];
      expect(order?.type, id).toBe('attack');
      expect(order?.type === 'attack' && order.target).toBe(target);
    }
    expect(lockOrders(w, [o]).rejected).toEqual([]);
  });

  it('offers peace to one front when fighting on several, and turns on a weak partner later', () => {
    const w = makeWorld(12, 6, ['a', 'b', 'c']);
    unit(w, 'a1', 'a', 'infantry', hexKey(0, 0));
    // Fighting b and c at once: a offers peace to one of them, not to both.
    const o = planOrders(buildView(w, 'a'), emptyMemory(), 1);
    const offers = o.diplomacy.filter((d) => d.action === 'propose_peace');
    expect(offers).toHaveLength(1);

    // Later, at peace with a partner far weaker than itself, a breaks the peace.
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'a', 'c', 'peace');
    w.turn = 12;
    site(w, 'a-big', hexKey(1, 1), 'a', 'capital', 20);
    const later = planOrders(buildView(w, 'a'), emptyMemory(), 1);
    expect(later.diplomacy.some((d) => d.action === 'declare_war')).toBe(true);
    expect(lockOrders(w, [later]).rejected).toEqual([]);
  });

  it('abandons a stalled war: makes peace with the enemy it is stuck on and turns on the weakest', () => {
    const w = makeWorld(12, 6, ['a', 'b', 'c']);
    w.turn = 14;
    setRelation(w, 'a', 'c', 'peace');
    unit(w, 'a1', 'a', 'infantry', hexKey(5, 2));
    unit(w, 'b1', 'b', 'infantry', hexKey(6, 2), { entrenchment: 100 });
    site(w, 'a-cap', hexKey(1, 1), 'a', 'capital', 10);
    site(w, 'b-cap', hexKey(10, 1), 'b', 'capital', 10);
    const view = buildView(w, 'a');
    // Nothing gained for eight turns against b.
    const stalled = { ...emptyMemory(), lastGain: 4 };
    const o = planOrders(view, stalled, 1);
    expect(o.diplomacy).toContainEqual({ target: 'b', action: 'propose_peace' });
    expect(o.diplomacy).toContainEqual({ target: 'c', action: 'declare_war' });
    // Still winning ground recently: keep fighting.
    const fresh = planOrders(view, { ...emptyMemory(), lastGain: 12 }, 1);
    expect(fresh.diplomacy.some((d) => d.target === 'b')).toBe(false);
  });

  it('remembers the turn it last captured a site', () => {
    const w = makeWorld(8, 6, ['a', 'b']);
    w.turn = 7;
    const m = updateMemory(emptyMemory(), buildView(w, 'a'), [{ kind: 'site_captured', site: 'x', key: hexKey(1, 1), from: 'b', to: 'a' }]);
    expect(m.lastGain).toBe(7);
  });

  it('answers a pending world event legally, preferring stability when it is low', () => {
    const w = makeWorld(8, 6, ['a', 'b']);
    w.nations.a!.event = { id: 'general_strike', turn: 0 };
    w.nations.a!.stability = 30;
    const shaky = planOrders(buildView(w, 'a'), emptyMemory(), 1);
    expect(shaky.eventChoice).toBe(1);
    expect(lockOrders(w, [shaky]).rejected).toEqual([]);
    w.nations.a!.event = { id: 'oil_strike', turn: 0 };
    w.nations.a!.stability = 80;
    expect(planOrders(buildView(w, 'a'), emptyMemory(), 1).eventChoice).toBeDefined();
    w.nations.a!.event = null;
    expect(planOrders(buildView(w, 'a'), emptyMemory(), 1).eventChoice).toBeUndefined();
  });
});
