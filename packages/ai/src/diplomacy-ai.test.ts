import { describe, expect, it } from 'vitest';
import type { DealTerms, NationOrders, WorldState } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { buildView, clone, lockOrders, resolveTurn } from '@brink/simulation';
import { makeWorld, setRelation, site } from '../../simulation/src/fixture.test-util';
import { consider, jointOpTarget, leaderDiplomacy, verdictLine } from './diplomacy-ai';
import { emptyMemory } from './index';

const blank = (w: WorldState, nation: string, extra: Partial<NationOrders> = {}): NationOrders => ({ nation, turn: w.turn, formations: {}, recruit: [], diplomacy: [], ...extra });

/** Three powers at peace; `b` is led by the Directorate's hawk, the rest by the Union's dove. */
function peaceful(): WorldState {
  const w = makeWorld(8, 6, ['a', 'b', 'c']);
  setRelation(w, 'a', 'b', 'peace');
  setRelation(w, 'a', 'c', 'peace');
  setRelation(w, 'b', 'c', 'peace');
  w.nations.b!.government = 'directorate';
  return w;
}

describe('leaders answering offers', () => {
  it('makes no peace with the power an ordered operation marches on', () => {
    const w = peaceful();
    setRelation(w, 'a', 'c', 'war');
    const view = buildView(w, 'c');
    // Without an operation the offer is weighed on mood and the war; with one, its prize's holder is the focus.
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'peace' }).reason).not.toBe('focus');
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'peace' }, { target: 'a-home' })).toEqual({ accept: false, reason: 'focus' });
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'ceasefire' }, { target: 'a-home' })).toEqual({ accept: false, reason: 'focus' });
    // A peace the war plan drafted toward that power is dropped, and only that one.
    const planned = blank(w, 'c', { diplomacy: [{ target: 'a', action: 'propose_peace' }] });
    expect(leaderDiplomacy(view, emptyMemory(), planned, { target: 'a-home' }).diplomacy.filter((d) => d.target === 'a' && d.action === 'propose_peace')).toEqual([]);
  });

  it('trades with a neutral power, not with one that betrayed it', () => {
    const w = peaceful();
    expect(consider(buildView(w, 'c'), emptyMemory(), { from: 'a', kind: 'trade' })).toEqual({ accept: true, reason: 'agreed' });
    w.memories = { c: [{ about: 'a', kind: 'betrayed', turn: 1 }, { about: 'a', kind: 'took_city', turn: 1 }] };
    const v = consider(buildView(w, 'c'), emptyMemory(), { from: 'a', kind: 'trade' });
    expect(v).toEqual({ accept: false, reason: 'mood' });
    expect(verdictLine(v)).toBe('reject_mood');
  });

  it('weighs an exchange at its own prices and never promises what it cannot pay', () => {
    const w = peaceful();
    const view = buildView(w, 'c');
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'exchange', terms: { give: { credits: 100 }, get: { food: 60 } } }).accept).toBe(true);
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'exchange', terms: { give: { food: 20 }, get: { credits: 300 } } })).toEqual({ accept: false, reason: 'terms' });
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'exchange', terms: { give: { credits: 400 }, get: { food: 300 } } })).toEqual({ accept: false, reason: 'cannot' });
  });

  it('pays tribute only to a much stronger power, and a hawk needs it stronger still', () => {
    const w = peaceful();
    const dove = buildView(w, 'c');
    const hawk = buildView(w, 'b');
    const demand = { from: 'a', kind: 'tribute' as const, terms: { get: { credits: 50 } } };
    expect(consider(dove, emptyMemory(), demand)).toEqual({ accept: false, reason: 'strength' });
    dove.supremacy = { a: 45, b: 30, c: 25 };
    hawk.supremacy = { a: 45, b: 30, c: 25 };
    expect(consider(dove, emptyMemory(), demand).accept).toBe(true);
    expect(consider(hawk, emptyMemory(), demand)).toEqual({ accept: false, reason: 'strength' });
    // Never more than a share of what it holds.
    expect(consider(dove, emptyMemory(), { ...demand, terms: { get: { food: 150 } } })).toEqual({ accept: false, reason: 'terms' });
  });

  it('allies against a common enemy it already fights, not against a friend', () => {
    const w = peaceful();
    setRelation(w, 'b', 'c', 'war');
    w.memories = { b: [{ about: 'a', kind: 'comrades', turn: 1 }, { about: 'a', kind: 'comrades', turn: 1 }, { about: 'a', kind: 'dealt', turn: 1 }] };
    w.treaties.push({ kind: 'trade', a: 'a', b: 'b', from: 1, until: 8 });
    const view = buildView(w, 'b');
    expect(view.attitudes!.a!.mood).toBeGreaterThanOrEqual(20);
    expect(consider(view, emptyMemory(), { from: 'a', kind: 'alliance', terms: { against: 'c' } }).accept).toBe(true);
    // Against a friend: no, and the reason says so. (Until ruleset 2.10 any power not already hated
    // was refused with 'mood', even with a friend asking: joining a war was never a real ask. The
    // case kept here is the one the name means: c is b's friend.)
    setRelation(w, 'b', 'c', 'peace');
    w.memories.b!.push({ about: 'c', kind: 'comrades', turn: 1 }, { about: 'c', kind: 'comrades', turn: 1 }, { about: 'c', kind: 'dealt', turn: 1 });
    w.treaties.push({ kind: 'trade', a: 'b', b: 'c', from: 1, until: 8 });
    expect(buildView(w, 'b').attitudes!.c!.mood).toBeGreaterThanOrEqual(20);
    expect(consider(buildView(w, 'b'), emptyMemory(), { from: 'a', kind: 'alliance', terms: { against: 'c' } })).toEqual({ accept: false, reason: 'likes_target' });
  });
});

describe('leaders asked to join a war', () => {
  /** a asks b to fight c; b likes a (comrades, trade). */
  function asked(): WorldState {
    const w = peaceful();
    w.nations.b!.government = 'union';
    w.memories = { b: [{ about: 'a', kind: 'comrades', turn: 1 }, { about: 'a', kind: 'comrades', turn: 1 }, { about: 'a', kind: 'dealt', turn: 1 }] };
    w.treaties.push({ kind: 'trade', a: 'a', b: 'b', from: 1, until: 8 });
    return w;
  }
  const against = (view: ReturnType<typeof buildView>, terms: DealTerms = { against: 'c' }) => consider(view, emptyMemory(), { from: 'a', kind: 'alliance', terms });

  it('a friendly dove joins its ally against the power running away with the race', () => {
    const w = asked();
    setRelation(w, 'a', 'b', 'alliance');
    const view = buildView(w, 'b');
    expect(view.attitudes!.a!.mood).toBeGreaterThanOrEqual(20);
    view.supremacy = { a: 30, b: 25, c: 45 };
    expect(against(view)).toEqual({ accept: true, reason: 'agreed' });
    // Not when it is no threat at all: a small power far behind.
    view.supremacy = { a: 40, b: 40, c: 20 };
    expect(against(view).accept).toBe(false);
  });

  it('says why it will not: it likes the target, or has wars enough', () => {
    const w = asked();
    w.memories!.b!.push({ about: 'c', kind: 'comrades', turn: 1 }, { about: 'c', kind: 'comrades', turn: 1 });
    w.treaties.push({ kind: 'trade', a: 'b', b: 'c', from: 1, until: 8 });
    expect(against(buildView(w, 'b')).reason).toBe('likes_target');
    // Two wars on its hands already (d and e): stretched.
    const x = makeWorld(8, 6, ['a', 'b', 'c', 'd']);
    x.nations.e = { ...clone(x.nations.d!), id: 'e', name: 'Nation E' };
    x.intel.e = { observed: {}, knownOwner: {}, lastKnown: {} };
    site(x, 'e-home', hexKey(3, 3), 'e');
    for (const [p, q] of [['a', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'd'], ['a', 'e'], ['c', 'd'], ['c', 'e'], ['d', 'e']] as const) setRelation(x, p, q, 'peace');
    setRelation(x, 'b', 'e', 'war');
    x.memories = { b: [{ about: 'a', kind: 'comrades', turn: 1 }, { about: 'a', kind: 'dealt', turn: 1 }] };
    expect(consider(buildView(x, 'b'), emptyMemory(), { from: 'a', kind: 'alliance', terms: { against: 'c' } })).toEqual({ accept: false, reason: 'stretched' });
    // A power it spares (a human on Easy) it never goes to war with.
    expect(consider(buildView(w, 'b'), emptyMemory(), { from: 'a', kind: 'alliance', terms: { against: 'c' } }, { spare: ['c'] })).toEqual({ accept: false, reason: 'likes_target' });
  });

  it('a sweetener can carry the deal, and what it is asked to pay it must hold', () => {
    const w = asked();
    const view = buildView(w, 'b');
    view.supremacy = { a: 34, b: 33, c: 33 };
    const plain = against(view);
    expect(plain.accept).toBe(false);
    expect(against(view, { against: 'c', give: { credits: 300, materials: 200 } })).toEqual({ accept: true, reason: 'agreed' });
    // Asked to pay more than it holds: it cannot.
    expect(against(view, { against: 'c', get: { credits: 900 } })).toEqual({ accept: false, reason: 'cannot' });
  });

  it('a partner at peace with the holder accepts a joint operation, goes to war, and marches on the prize', () => {
    const w = asked();
    setRelation(w, 'a', 'c', 'war');
    site(w, 'prize', hexKey(4, 3), 'c', 'city', 1);
    // b has seen the prize (it is known, if not in sight now).
    w.intel.b = { observed: { [hexKey(4, 3)]: 0 }, knownOwner: { [hexKey(4, 3)]: 'c' }, lastKnown: {} };
    const view = buildView(w, 'b');
    view.supremacy = { a: 30, b: 25, c: 45 };
    const offer = { from: 'a', kind: 'joint_op' as const, terms: { site: 'prize' } };
    expect(consider(view, emptyMemory(), offer)).toEqual({ accept: true, reason: 'agreed' });
    const out = leaderDiplomacy(view, emptyMemory(), blank(w, 'b'), { incoming: [offer] });
    expect(out.diplomacy).toContainEqual({ target: 'a', action: 'propose_joint_op', terms: { site: 'prize' } });
    const subs = [blank(w, 'a', { diplomacy: [{ target: 'b', action: 'propose_joint_op', terms: { site: 'prize' } }] }), out];
    expect(lockOrders(w, subs).rejected).toEqual([]);
    const r = resolveTurn(w, subs);
    expect(r.world.relations['b|c']).toBe('war');
    expect(jointOpTarget(buildView(r.world, 'b'))).toBe('prize');
    // And while it runs, no peace with the holder: neither offered nor accepted, unless losing.
    const after = buildView(r.world, 'b');
    after.supremacy = { a: 30, b: 30, c: 30 };
    expect(consider(after, emptyMemory(), { from: 'c', kind: 'peace' })).toEqual({ accept: false, reason: 'focus' });
    const planned = blank(r.world, 'b', { diplomacy: [{ target: 'c', action: 'propose_peace' }] });
    expect(leaderDiplomacy(after, emptyMemory(), planned).diplomacy.some((d) => d.target === 'c' && d.action === 'propose_peace')).toBe(false);
  });
});

describe('leaders on the turn', () => {
  it('answers an offer made this turn in kind, making room by dropping recruits, all accepted by the validator', () => {
    const w = peaceful();
    w.nations.c!.stockpile = { credits: 130, energy: 200, materials: 200, food: 200 };
    const offer = { from: 'a', kind: 'exchange' as const, terms: { give: { food: 150 }, get: { credits: 100 } } };
    const view = buildView(w, 'c');
    expect(consider(view, emptyMemory(), offer).accept).toBe(true);
    const planned = blank(w, 'c', { recruit: [{ siteId: 'c-home', unitClass: 'infantry' }] });
    const out = leaderDiplomacy(view, emptyMemory(), planned, { incoming: [offer] });
    expect(out.diplomacy).toContainEqual({ target: 'a', action: 'propose_exchange', terms: { give: { credits: 100 }, get: { food: 150 } } });
    expect(out.recruit).toEqual([]);
    const subs = [blank(w, 'a', { diplomacy: [{ target: 'c', action: 'propose_exchange', terms: offer.terms }] }), out];
    expect(lockOrders(w, subs).rejected).toEqual([]);
    expect(resolveTurn(w, subs).events).toContainEqual(expect.objectContaining({ kind: 'exchange', a: 'a', b: 'c', aGave: { food: 150 }, bGave: { credits: 100 } }));
  });

  it('drops what it refused this turn from its own plan, so a no stays a no', () => {
    const w = peaceful();
    w.memories = { c: [{ about: 'a', kind: 'betrayed', turn: 1 }, { about: 'a', kind: 'took_city', turn: 1 }] };
    const planned = blank(w, 'c', { diplomacy: [{ target: 'a', action: 'propose_trade' }] });
    const out = leaderDiplomacy(buildView(w, 'c'), emptyMemory(), planned, { incoming: [{ from: 'a', kind: 'trade' }] });
    expect(out.diplomacy.find((d) => d.target === 'a' && d.action === 'propose_trade')).toBeUndefined();
  });

  it('a dove will not stab a friend in the back; a hawk will war on a power that defied it', () => {
    const w = peaceful();
    w.treaties.push({ kind: 'trade', a: 'a', b: 'c', from: 1, until: 8 });
    w.memories = { c: [{ about: 'a', kind: 'dealt', turn: 1 }, { about: 'a', kind: 'comrades', turn: 1 }], b: [{ about: 'a', kind: 'defied', turn: 1 }] };
    const dove = leaderDiplomacy(buildView(w, 'c'), emptyMemory(), blank(w, 'c', { diplomacy: [{ target: 'a', action: 'declare_war' }] }));
    expect(dove.diplomacy).toEqual([]);
    const hawk = leaderDiplomacy(buildView(w, 'b'), emptyMemory(), blank(w, 'b'));
    expect(hawk.diplomacy).toContainEqual({ target: 'a', action: 'declare_war' });
    // ...but never on a power it spares (a human on Easy), nor through a pact.
    expect(leaderDiplomacy(buildView(w, 'b'), emptyMemory(), blank(w, 'b'), { spare: ['a'] }).diplomacy.some((d) => d.action === 'declare_war')).toBe(false);
    w.treaties.push({ kind: 'nonaggression', a: 'a', b: 'b', from: 1, until: 6 });
    expect(leaderDiplomacy(buildView(w, 'b'), emptyMemory(), blank(w, 'b')).diplomacy.some((d) => d.action === 'declare_war')).toBe(false);
  });

  it('a hawk far ahead sends a weaker power an ultimatum now and then', () => {
    const w = peaceful();
    let demanded = false;
    for (let turn = 1; turn <= 6; turn++) {
      w.turn = turn;
      const view = buildView(w, 'b');
      view.supremacy = { a: 10, b: 60, c: 30 };
      const out = leaderDiplomacy(view, emptyMemory(), blank(w, 'b'));
      const d = out.diplomacy.find((x) => x.action === 'demand_tribute');
      if (d) {
        demanded = true;
        expect(d.target).toBe('a');
        expect(lockOrders(w, [out]).rejected).toEqual([]);
      }
    }
    expect(demanded).toBe(true);
  });

  it('marches on the prize of a joint operation', () => {
    const w = peaceful();
    setRelation(w, 'a', 'c', 'war');
    site(w, 'prize', hexKey(4, 3), 'c', 'city', 1);
    w.treaties.push({ kind: 'joint_op', a: 'a', b: 'b', from: 1, until: 5, site: 'prize' });
    setRelation(w, 'b', 'c', 'war');
    expect(jointOpTarget(buildView(w, 'b'))).toBe('prize');
    expect(jointOpTarget(buildView(w, 'a'))).toBe('prize');
    // A prize nobody sees now may have changed hands: no joint operation is agreed on it.
    w.treaties = w.treaties.filter((t) => t.kind !== 'joint_op');
    expect(buildView(w, 'b').tiles[hexKey(4, 3)]!.visibility).not.toBe('visible');
    expect(consider(buildView(w, 'b'), emptyMemory(), { from: 'a', kind: 'joint_op', terms: { site: 'prize' } })).toEqual({ accept: false, reason: 'cannot' });
    w.treaties.push({ kind: 'joint_op', a: 'a', b: 'b', from: 1, until: 5, site: 'prize' });
    // Once a partner holds it, the operation is done.
    w.sites.prize!.owner = 'a';
    expect(jointOpTarget(buildView(w, 'a'))).toBeUndefined();
  });
});
