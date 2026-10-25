import { describe, expect, it } from 'vitest';
import { hexKey } from '@brink/map';
import { makeWorld, orders, setTerrain, unit } from './fixture.test-util';
import { lockOrders } from './validate';

const k = hexKey;

function reasons(result: ReturnType<typeof lockOrders>): string[] {
  return result.rejected.map((e) => (e.kind === 'order_rejected' ? e.reason : ''));
}

describe('lockOrders', () => {
  it('gives every own formation an order, holding by default', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    unit(w, 'a2', 'a', 'armor', k(2, 3));
    const res = lockOrders(w, []);
    expect(res.orders.a!.formations).toEqual({ a1: { type: 'hold' }, a2: { type: 'hold' } });
    expect(res.rejected).toEqual([]);
  });

  it('accepts a legal move and rejects paths that are not contiguous, impassable or too long', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    setTerrain(w, k(3, 2), 'water');
    const ok = lockOrders(w, [orders(w, 'a', { a1: { type: 'move', path: [k(2, 3), k(2, 4)] } })]);
    expect(ok.rejected).toEqual([]);
    expect(ok.orders.a!.formations.a1).toEqual({ type: 'move', path: [k(2, 3), k(2, 4)] });

    const gap = lockOrders(w, [orders(w, 'a', { a1: { type: 'move', path: [k(2, 4)] } })]);
    expect(reasons(gap)).toEqual(['path is not contiguous or crosses impassable terrain']);
    expect(gap.orders.a!.formations.a1).toEqual({ type: 'hold' });

    const wet = lockOrders(w, [orders(w, 'a', { a1: { type: 'move', path: [k(3, 2)] } })]);
    expect(reasons(wet)).toEqual(['path is not contiguous or crosses impassable terrain']);

    // Infantry has 6 MP; four plains steps cost 8.
    const far = lockOrders(w, [orders(w, 'a', { a1: { type: 'move', path: [k(3, 1), k(4, 1), k(5, 1), k(6, 1)] } })]);
    expect(reasons(far)).toEqual(['path exceeds movement allowance']);
  });

  it('scales movement allowance with readiness', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(2, 2), { readiness: 0 });
    const res = lockOrders(w, [orders(w, 'a', { a1: { type: 'move', path: [k(3, 2), k(4, 2)] } })]);
    expect(reasons(res)).toEqual(['path exceeds movement allowance']);
  });

  it('rejects orders for formations the nation does not command', () => {
    const w = makeWorld();
    unit(w, 'b1', 'b', 'infantry', k(5, 3));
    const res = lockOrders(w, [orders(w, 'a', { b1: { type: 'hold' } })]);
    expect(reasons(res)).toEqual(['formation belongs to another nation']);
    expect(res.orders.b!.formations.b1).toEqual({ type: 'hold' });
  });

  it('checks ranged range and ground assault adjacency', () => {
    const w = makeWorld();
    unit(w, 'art', 'a', 'artillery', k(2, 2));
    unit(w, 'inf', 'a', 'infantry', k(2, 3));
    const res = lockOrders(w, [
      orders(w, 'a', {
        art: { type: 'attack', target: k(5, 2), path: [] },
        inf: { type: 'attack', target: k(4, 3), path: [] },
      }),
    ]);
    expect(reasons(res).sort()).toEqual(['target is not adjacent to the end of the approach', 'target out of range']);
    const ok = lockOrders(w, [
      orders(w, 'a', {
        art: { type: 'attack', target: k(4, 2), path: [] },
        inf: { type: 'attack', target: k(4, 3), path: [k(3, 3)] },
      }),
    ]);
    expect(ok.rejected).toEqual([]);
  });

  it('reserves recruitment costs against the stockpile, one per site', () => {
    const w = makeWorld();
    w.nations.a!.stockpile = { credits: 120, energy: 50, materials: 100, food: 50 };
    const res = lockOrders(w, [
      orders(w, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'armor' }, { siteId: 'b-home', unitClass: 'infantry' }] }),
    ]);
    expect(res.orders.a!.recruit).toEqual([{ siteId: 'a-home', unitClass: 'armor' }]);
    expect(reasons(res)).toEqual(['b-home is not under your control']);

    w.nations.a!.stockpile.credits = 50;
    const poor = lockOrders(w, [orders(w, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'armor' }] })]);
    expect(poor.orders.a!.recruit).toEqual([]);
    expect(reasons(poor)[0]).toMatch(/insufficient resources/);
  });

  it('validates budget, research and diplomacy', () => {
    const w = makeWorld();
    const res = lockOrders(w, [
      orders(w, 'a', {}, {
        budget: { research: 40, infrastructure: 30, welfare: 0 },
        research: 'combined_arms',
        diplomacy: [{ target: 'b', action: 'declare_war' }],
      }),
    ]);
    expect(reasons(res).sort()).toEqual(['already at war with Nation B', 'budget shares exceed 60% of income', 'prerequisites not met']);
  });

  it('discards stale and duplicate submissions whole', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    const stale = lockOrders(w, [{ ...orders(w, 'a', { a1: { type: 'defend' } }), turn: 0 }]);
    expect(stale.orders.a!.formations.a1).toEqual({ type: 'hold' });
    const dup = lockOrders(w, [orders(w, 'a', { a1: { type: 'defend' } }), orders(w, 'a', { a1: { type: 'defend' } })]);
    expect(dup.orders.a!.formations.a1).toEqual({ type: 'hold' });
    expect(reasons(dup)).toEqual(['more than one order set submitted; all were discarded']);
  });
});
