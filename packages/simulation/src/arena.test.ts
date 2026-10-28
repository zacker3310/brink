import { describe, expect, it } from 'vitest';
import type { ArenaBattle } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { makeWorld, orders, unit } from './fixture.test-util';
import { resolveTurn } from './resolve';

const k = hexKey;

// A battle fought in the arena replaces the dice for that attack, as long as the hex still holds
// the enemies that were fought.
describe('arena battles', () => {
  function setup() {
    const w = makeWorld(8, 6);
    unit(w, 'a1', 'a', 'armor', k(3, 3));
    unit(w, 'a2', 'a', 'artillery', k(2, 3));
    unit(w, 'b1', 'b', 'infantry', k(4, 3));
    return w;
  }
  const attack = { a1: { type: 'attack' as const, target: k(4, 3), path: [] }, a2: { type: 'attack' as const, target: k(4, 3), path: [] } };

  it('a won battle sets the losses and takes the hex', () => {
    const w = setup();
    const battle: ArenaBattle = { target: k(4, 3), attackers: ['a1', 'a2'], defenders: ['b1'], kept: { a1: 700, a2: 1000, b1: 0 }, won: true };
    const r = resolveTurn(w, [orders(w, 'a', attack, { battles: [battle] }), orders(w, 'b')]);
    expect(r.world.formations.b1).toBeUndefined();
    // 700 kept, less a little supply attrition later in the turn.
    expect(r.world.formations.a1!.strength).toBeGreaterThan(680);
    expect(r.world.formations.a1!.strength).toBeLessThanOrEqual(700);
    expect(r.world.formations.a2!.strength).toBeGreaterThan(980);
    expect(r.world.formations.a1!.key).toBe(k(4, 3));
    const e = r.events.find((x) => x.kind === 'engagement');
    expect(e?.kind === 'engagement' && e.arena).toBe(true);
    // The guns fought in the arena, not in a separate strike.
    expect(r.events.some((x) => x.kind === 'strike' && x.source === 'a2')).toBe(false);
  });

  it('a lost battle leaves the defender holding', () => {
    const w = setup();
    const battle: ArenaBattle = { target: k(4, 3), attackers: ['a1'], defenders: ['b1'], kept: { a1: 0, b1: 800 }, won: false };
    const r = resolveTurn(w, [orders(w, 'a', { a1: attack.a1 }, { battles: [battle] }), orders(w, 'b')]);
    expect(r.world.formations.a1).toBeUndefined();
    expect(r.world.formations.b1!.strength).toBeGreaterThan(780);
    expect(r.world.formations.b1!.strength).toBeLessThanOrEqual(800);
    expect(r.world.formations.b1!.key).toBe(k(4, 3));
  });

  it('a battle against defenders that are no longer the ones there falls back to the dice', () => {
    const w = setup();
    unit(w, 'b2', 'b', 'mechanized', k(5, 3));
    const battle: ArenaBattle = { target: k(4, 3), attackers: ['a1'], defenders: ['b1'], kept: { a1: 1000, b1: 0 }, won: true };
    // b2 reinforces the hex during the turn: the arena result no longer applies.
    const r = resolveTurn(w, [orders(w, 'a', { a1: attack.a1 }, { battles: [battle] }), orders(w, 'b', { b2: { type: 'move', path: [k(4, 3)] } })]);
    const e = r.events.find((x) => x.kind === 'engagement' && x.location === k(4, 3));
    expect(e?.kind === 'engagement' && e.arena).toBe('voided');
  });

  it('rejects results that do not match the orders', () => {
    const w = setup();
    const bad: ArenaBattle = { target: k(4, 3), attackers: ['a1'], defenders: ['b1'], kept: { a1: 5000 }, won: true };
    const noOrder: ArenaBattle = { target: k(5, 3), attackers: ['a1'], defenders: [], kept: {}, won: true };
    const r = resolveTurn(w, [orders(w, 'a', { a1: attack.a1 }, { battles: [bad, noOrder] }), orders(w, 'b')]);
    expect(r.events.filter((x) => x.kind === 'order_rejected').length).toBe(2);
  });
});
