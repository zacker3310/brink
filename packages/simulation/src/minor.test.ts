import { describe, expect, it } from 'vitest';
import { hexKey } from '@brink/map';
import { makeWorld, orders, unit } from './fixture.test-util';
import { buildView } from './fog';
import { resolveTurn } from './resolve';
import { lockOrders } from './validate';
import { evaluateVictory, supremacyStanding } from './victory';

// Minor states (docs/pacific.md): nations that hold their own ground and are never players. They
// count for nothing in how a war ends; their sites are the prize.

const k = hexKey;

/** Two powers, a and b, and one minor state, m (corner cities from makeWorld). */
function withMinor() {
  const w = makeWorld(8, 6, ['a', 'b', 'm']);
  w.nations.m!.minor = true;
  return w;
}

describe('minor states', () => {
  it('the last power standing wins while a minor state still holds out', () => {
    const w = withMinor();
    unit(w, 'a1', 'a', 'infantry', k(6, 5));
    w.sites['a-home']!.victoryPoints = 1;
    w.sites['b-home']!.victoryPoints = 1;
    w.sites['m-home']!.victoryPoints = 1;
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(7, 5)] } })]);
    expect(r.world.nations.b!.eliminated).toBe(true);
    expect(r.world.nations.m!.eliminated).toBe(false);
    expect(r.world.victory).toMatchObject({ winner: 'a', reason: 'last_standing' });
  });

  it('a minor state never wins on the score at the turn limit, however strong', () => {
    const w = withMinor();
    w.turn = 30;
    for (let i = 0; i < 3; i++) unit(w, `m${i}`, 'm', 'armor', k(7, 0));
    w.sites['m-home']!.victoryPoints = 50;
    const v = evaluateVictory(w);
    expect(v?.reason).toBe('turn_limit');
    expect(['a', 'b']).toContain(v?.winner);
  });

  it('a minor state takes no share in supremacy and wins no domination', () => {
    const w = withMinor();
    w.sites['m-home']!.victoryPoints = 100;
    expect(supremacyStanding(w).m).toBe(0);
    expect(evaluateVictory(w)).toBeNull();
  });

  it('refuses any treaty or declaration toward or from a minor state', () => {
    const w = withMinor();
    const locked = lockOrders(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'm', action: 'propose_peace' }] }), orders(w, 'm', {}, { diplomacy: [{ target: 'b', action: 'propose_peace' }] })]);
    expect(locked.orders.a!.diplomacy).toEqual([]);
    expect(locked.orders.m!.diplomacy).toEqual([]);
    expect(locked.rejected.filter((e) => e.kind === 'order_rejected').map((e) => (e.kind === 'order_rejected' ? e.reason : ''))).toEqual([
      'Nation M is a minor state: it makes no treaties',
      'a minor state makes no treaties',
    ]);
  });

  it('is shown as a minor state on the public board', () => {
    const w = withMinor();
    const view = buildView(w, 'a');
    expect(view.nations.m!.minor).toBe(true);
    expect(view.nations.b!.minor).toBeUndefined();
  });
});
