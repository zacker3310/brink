import { describe, expect, it } from 'vitest';
import { TREATIES, VICTORY } from '@brink/game-data';
import type { WorldState } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { makeWorld, orders, setRelation, site, unit } from './fixture.test-util';
import { buildView } from './fog';
import { hashState } from './hash';
import { resolveTurn } from './resolve';
import { clone, treatyIn } from './rules';
import { allianceBlocs, coalitionShare, evaluateVictory, supremacyStanding } from './victory';

const k = hexKey;

/** Both sides offer the same thing in one turn. */
function both(w: WorldState, action: 'propose_nonaggression' | 'propose_trade' | 'propose_alliance') {
  return resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action }] }), orders(w, 'b', {}, { diplomacy: [{ target: 'a', action }] })]);
}

describe('treaties', () => {
  it('signs a non-aggression pact when both offer it, and it binds both sides', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const r = both(w, 'propose_nonaggression');
    const pact = treatyIn(r.world.treaties, 'nonaggression', 'a', 'b', r.world.turn);
    expect(pact).toMatchObject({ from: 1, until: TREATIES.nonaggressionTurns });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'treaty', treaty: 'nonaggression', a: 'a', b: 'b' }));
    // A declaration of war on a pact partner is refused, and the peace holds.
    const r2 = resolveTurn(r.world, [orders(r.world, 'b', {}, { diplomacy: [{ target: 'a', action: 'declare_war' }] })]);
    expect(r2.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', nation: 'b', reason: expect.stringContaining('non-aggression') }));
    expect(r2.world.relations['a|b']).toBe('peace');
  });

  it('a one-sided offer waits; it does not bind', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_nonaggression' }] })]);
    expect(r.world.treaties).toEqual([]);
    expect(r.world.proposals).toContainEqual(expect.objectContaining({ from: 'a', to: 'b', kind: 'nonaggression' }));
    // The answer a turn later seals it.
    const r2 = resolveTurn(r.world, [orders(r.world, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_nonaggression' }] })]);
    expect(treatyIn(r2.world.treaties, 'nonaggression', 'a', 'b', r2.world.turn)).toBeDefined();
  });

  it('a pact lapses after its last turn and war is legal again', () => {
    let w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    w = both(w, 'propose_nonaggression').world;
    for (let i = 1; i < TREATIES.nonaggressionTurns; i++) w = resolveTurn(w, []).world;
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'treaty_ended', treaty: 'nonaggression', reason: 'expired' }));
    expect(r.world.relations['a|b']).toBe('war');
  });

  it('trade pays both partners every turn it runs, and war ends it', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const plain = resolveTurn(clone(w), []);
    const traded = both(w, 'propose_trade');
    const income = (r: typeof plain, n: string) => {
      const e = r.events.find((x) => x.kind === 'economy' && x.nation === n);
      return e?.kind === 'economy' ? e.ledger.income : null;
    };
    for (const n of ['a', 'b']) {
      expect(income(traded, n)!.credits - income(plain, n)!.credits).toBeGreaterThan(0);
      expect(income(traded, n)!.materials - income(plain, n)!.materials).toBeGreaterThan(0);
    }
    const war = resolveTurn(traded.world, [orders(traded.world, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    expect(war.events).toContainEqual(expect.objectContaining({ kind: 'treaty_ended', treaty: 'trade', reason: 'war' }));
    expect(war.world.treaties.filter((t) => t.kind === 'trade')).toEqual([]);
  });

  it('an embargo ends trade and bars a new agreement while it lasts', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const traded = both(w, 'propose_trade').world;
    const r = resolveTurn(traded, [orders(traded, 'a', {}, { diplomacy: [{ target: 'b', action: 'embargo' }] })]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'treaty_ended', treaty: 'trade', reason: 'embargo' }));
    expect(treatyIn(r.world.treaties, 'embargo', 'a', 'b', r.world.turn)).toMatchObject({ by: 'a' });
    const again = both(r.world, 'propose_trade');
    expect(again.events.filter((e) => e.kind === 'order_rejected')).toHaveLength(2);
  });

  it('refuses offers that make no sense', () => {
    const w = makeWorld();
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_nonaggression' }] }), orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_trade' }] })]);
    const why = r.events.filter((e) => e.kind === 'order_rejected').map((e) => (e.kind === 'order_rejected' ? e.reason : ''));
    expect(why).toEqual([expect.stringContaining('needs peace'), expect.stringContaining('at war')]);
  });

  it('resolves the same way whatever order the offers arrive in', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'b', 'c', 'peace');
    const subs = [
      orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_trade' }] }),
      orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_trade' }, { target: 'c', action: 'propose_nonaggression' }] }),
      orders(w, 'c', {}, { diplomacy: [{ target: 'b', action: 'propose_nonaggression' }] }),
    ];
    expect(resolveTurn(w, subs).hash).toBe(resolveTurn(w, [...subs].reverse()).hash);
  });
});

describe('victory paths', () => {
  /** Four nations with a 10 VP city each, and three free objectives: 100 VP in all. */
  function four(): WorldState {
    const w = makeWorld(10, 8, ['a', 'b', 'c', 'd']);
    for (const id of Object.keys(w.sites)) w.sites[id]!.victoryPoints = 10;
    site(w, 'x1', k(4, 3), null, 'objective', 25);
    site(w, 'x2', k(5, 4), null, 'objective', 25);
    site(w, 'x3', k(6, 3), null, 'objective', 10);
    w.turn = VICTORY.supremacyFromTurn;
    return w;
  }

  it('a coalition wins when an all-allied bloc holds enough of the map', () => {
    const w = four();
    setRelation(w, 'a', 'b', 'alliance');
    // Two allies hold 20 of 100: not enough.
    expect(evaluateVictory(w)).toBeNull();
    expect(allianceBlocs(w)).toEqual([['a', 'b']]);
    // 35 each: neither dominates alone (40), but together 70 >= 60.
    w.sites.x1!.owner = 'a';
    w.sites.x2!.owner = 'b';
    expect(coalitionShare(2)).toBe(60);
    expect(evaluateVictory(w)).toMatchObject({ reason: 'coalition', winner: 'a', coalition: ['a', 'b'] });
  });

  it('three allies cannot win by signing: the bar rises with the bloc', () => {
    const w = four();
    setRelation(w, 'a', 'b', 'alliance');
    setRelation(w, 'a', 'c', 'alliance');
    setRelation(w, 'b', 'c', 'alliance');
    w.sites.x1!.owner = 'a';
    w.sites.x3!.owner = 'b';
    // 65 of 100, short of the 80 three need.
    expect(coalitionShare(3)).toBe(80);
    expect(evaluateVictory(w)).toBeNull();
  });

  it('supremacy needs dominance in land, army and output together', () => {
    const w = four();
    w.sites.x1!.owner = 'a';
    for (let i = 0; i < 6; i++) unit(w, `a${i}`, 'a', 'armor', k(0, 1));
    unit(w, 'b1', 'b', 'infantry', k(9, 7));
    // 35% of the land, short of domination, but the army and the output carry it.
    expect(supremacyStanding(w).a).toBeGreaterThanOrEqual(VICTORY.supremacyShare);
    expect(evaluateVictory(w)).toMatchObject({ reason: 'supremacy', winner: 'a' });
    // Not with a nation in turmoil, and not before its turn.
    w.nations.a!.stability = VICTORY.supremacyStability - 1;
    expect(evaluateVictory(w)).toBeNull();
    w.nations.a!.stability = 60;
    w.turn = VICTORY.supremacyFromTurn - 1;
    expect(evaluateVictory(w)).toBeNull();
  });

  it('domination comes first, and every campaign ends at its turn limit', () => {
    const w = four();
    w.turn = w.maxTurns;
    expect(evaluateVictory(w)).toMatchObject({ reason: 'turn_limit' });
    w.turn = 1;
    w.sites.x1!.owner = 'a';
    w.sites.x3!.owner = 'a';
    expect(evaluateVictory(w)?.reason).toBe('victory_points');
  });

  it('views carry every treaty and the public supremacy standing', () => {
    const w = four();
    setRelation(w, 'a', 'b', 'peace');
    const signed = both(w, 'propose_trade').world;
    // Third parties see the agreement too: treaties are public.
    const v = buildView(signed, 'c');
    expect(v.treaties).toEqual([expect.objectContaining({ kind: 'trade', a: 'a', b: 'b' })]);
    expect(Object.keys(v.supremacy).sort()).toEqual(['a', 'b', 'c', 'd']);
    // Deterministic: the same world and offers give the same hash.
    const again = four();
    setRelation(again, 'a', 'b', 'peace');
    expect(hashState(both(again, 'propose_trade').world)).toBe(hashState(signed));
  });
});
