import { describe, expect, it } from 'vitest';
import type { DiplomacyOrder, NationId, WorldState } from '@brink/contracts';
import { LEADER_TUNING, leaderFor } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { makeWorld, orders, setRelation, site } from './fixture.test-util';
import { buildView } from './fog';
import { attitude, memoryValue, recordMemories, stanceOf } from './leaders';
import { resolveTurn } from './resolve';
import { clone, recruitCost, treatyIn } from './rules';
import { supremacyStanding } from './victory';

const k = hexKey;

function deal(w: WorldState, a: NationId, da: DiplomacyOrder, b: NationId, db: DiplomacyOrder) {
  return resolveTurn(w, [orders(w, a, {}, { diplomacy: [da] }), orders(w, b, {}, { diplomacy: [db] })]);
}

function mood(w: WorldState, from: NationId, to: NationId) {
  return attitude(w, from, to, supremacyStanding(w));
}

describe('deals', () => {
  it('a ceasefire makes peace and binds both sides for its turns', () => {
    const w = makeWorld();
    const r = deal(w, 'a', { target: 'b', action: 'propose_ceasefire' }, 'b', { target: 'a', action: 'propose_ceasefire' });
    expect(r.world.relations['a|b']).toBe('peace');
    expect(treatyIn(r.world.treaties, 'ceasefire', 'a', 'b', r.world.turn)).toMatchObject({ until: LEADER_TUNING.ceasefireTurns });
    const r2 = resolveTurn(r.world, [orders(r.world, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    expect(r2.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', nation: 'a', reason: expect.stringContaining('ceasefire') }));
    expect(r2.world.relations['a|b']).toBe('peace');
  });

  it('an exchange moves resources both ways once, only on mirrored terms', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const offer: DiplomacyOrder = { target: 'b', action: 'propose_exchange', terms: { give: { credits: 100 }, get: { materials: 60 } } };
    // Terms that do not mirror the offer: nothing moves, both offers wait.
    const miss = deal(w, 'a', offer, 'b', { target: 'a', action: 'propose_exchange', terms: { give: { materials: 50 }, get: { credits: 100 } } });
    expect(miss.events.some((e) => e.kind === 'exchange')).toBe(false);
    expect(miss.world.proposals).toHaveLength(2);
    const r = deal(w, 'a', offer, 'b', { target: 'a', action: 'propose_exchange', terms: { give: { materials: 60 }, get: { credits: 100 } } });
    const e = r.events.find((x) => x.kind === 'exchange');
    expect(e).toMatchObject({ a: 'a', b: 'b', aGave: { credits: 100 }, bGave: { materials: 60 } });
    expect(e).not.toHaveProperty('void');
    // The ledger shows it: the same turn without the deal leaves a 100 credits richer, b 60 materials.
    const plain = resolveTurn(clone(w), []);
    expect(plain.world.nations.a!.stockpile.credits - r.world.nations.a!.stockpile.credits).toBe(100);
    expect(r.world.nations.b!.stockpile.credits - plain.world.nations.b!.stockpile.credits).toBe(100);
    expect(r.world.nations.a!.stockpile.materials - plain.world.nations.a!.stockpile.materials).toBe(60);
    expect(r.world.proposals).toEqual([]);
  });

  it('a deal agreed on a later turn does not spend what that turn\'s recruits hold', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    // Turn 1: a offers credits for materials; b says nothing yet, so the offer waits.
    const first = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_exchange', terms: { give: { credits: 100 }, get: { materials: 60 } } }] })]);
    const w2 = first.world;
    expect(w2.proposals).toHaveLength(1);
    // Turn 2: a recruits with nearly every credit, and b answers the waiting offer in kind. Validation
    // reserved only the recruit (the deal is not in a's orders this turn), so the deal must not take it.
    const armor = recruitCost(w2.nations.a!, 'armor');
    w2.nations.a!.stockpile.credits = armor.credits + 50;
    const r = resolveTurn(w2, [
      orders(w2, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'armor' }] }),
      orders(w2, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_exchange', terms: { give: { materials: 60 }, get: { credits: 100 } } }] }),
    ]);
    expect(r.events.find((e) => e.kind === 'exchange')).toMatchObject({ a: 'a', b: 'b', void: true });
    expect(r.events.some((e) => e.kind === 'recruitment_queued' && e.nation === 'a')).toBe(true);
  });

  it('refuses a deal the stockpile cannot cover after recruits, and malformed terms', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    w.nations.a!.stockpile.credits = 420;
    const r = resolveTurn(w, [
      orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_exchange', terms: { give: { credits: 400 }, get: { food: 1 } } }], recruit: [{ siteId: 'a-home', unitClass: 'armor' }] }),
      orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'demand_tribute', terms: { get: { credits: 12.5 } } as never }] }),
    ]);
    const why = r.events.filter((e) => e.kind === 'order_rejected').map((e) => (e.kind === 'order_rejected' ? `${e.nation}: ${e.reason}` : ''));
    expect(why).toContainEqual(expect.stringContaining('a: not enough in the stockpile'));
    expect(why).toContainEqual(expect.stringContaining('b: a deal moves 0 to'));
  });

  it('tribute: a demand met moves the resources and is remembered on both sides; one defied lapses', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const r = deal(w, 'a', { target: 'b', action: 'demand_tribute', terms: { get: { credits: 80 } } }, 'b', { target: 'a', action: 'pay_tribute', terms: { give: { credits: 80 } } });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'exchange', a: 'b', b: 'a', aGave: { credits: 80 }, tribute: true }));
    expect(r.world.memories!.b).toContainEqual({ about: 'a', kind: 'extorted', turn: 1 });
    expect(r.world.memories!.a).toContainEqual({ about: 'b', kind: 'paid_us', turn: 1 });

    let x = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'demand_tribute', terms: { get: { credits: 80 } } }] })]).world;
    let lapsed = false;
    for (let i = 0; i < 3; i++) {
      const step = resolveTurn(x, []);
      lapsed ||= step.events.some((e) => e.kind === 'proposal_lapsed' && e.from === 'a' && e.to === 'b');
      x = step.world;
    }
    expect(lapsed).toBe(true);
    expect(x.memories!.a!.some((m) => m.about === 'b' && m.kind === 'defied')).toBe(true);
    expect(x.proposals).toEqual([]);
  });

  it('an alliance against a common enemy takes both partners to war with it, at the price of perfidy', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'a', 'c', 'war');
    setRelation(w, 'b', 'c', 'peace');
    const terms = { against: 'c' };
    const r = deal(w, 'a', { target: 'b', action: 'propose_alliance', terms }, 'b', { target: 'a', action: 'propose_alliance', terms });
    expect(r.world.relations['a|b']).toBe('alliance');
    expect(r.world.relations['b|c']).toBe('war');
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'diplomacy', a: 'b', b: 'c', relation: 'war', broke: 'peace', proposedBy: 'b' }));
    expect(r.world.memories!.c).toContainEqual({ about: 'b', kind: 'betrayed', turn: 1 });
    // Not with an enemy you hold a pact with.
    const v = clone(w);
    v.treaties.push({ kind: 'nonaggression', a: 'b', b: 'c', from: 1, until: 5 });
    const blocked = resolveTurn(v, [orders(v, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_alliance', terms }] })]);
    expect(blocked.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', nation: 'a', reason: expect.stringContaining('bound by a treaty') }));
  });

  it('a joint operation runs until a partner takes the prize, then both remember it', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c', 'd']);
    setRelation(w, 'a', 'b', 'peace');
    site(w, 'prize', k(4, 3), 'c', 'city', 1);
    const terms = { site: 'prize' };
    const r = deal(w, 'a', { target: 'b', action: 'propose_joint_op', terms }, 'b', { target: 'a', action: 'propose_joint_op', terms });
    expect(treatyIn(r.world.treaties, 'joint_op', 'a', 'b', r.world.turn)).toMatchObject({ site: 'prize', until: LEADER_TUNING.jointOpTurns });
    const won = clone(r.world);
    won.sites.prize!.owner = 'b';
    won.tiles[k(4, 3)]!.owner = 'b';
    const r2 = resolveTurn(won, []);
    expect(r2.events).toContainEqual(expect.objectContaining({ kind: 'treaty_ended', treaty: 'joint_op', reason: 'fulfilled' }));
    expect(treatyIn(r2.world.treaties, 'joint_op', 'a', 'b', r2.world.turn)).toBeUndefined();
    expect(r2.world.memories!.a).toContainEqual(expect.objectContaining({ about: 'b', kind: 'comrades' }));
    // Only against a power the proposer is at war with.
    const peace = clone(w);
    setRelation(peace, 'a', 'c', 'peace');
    const no = resolveTurn(peace, [orders(peace, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_joint_op', terms }] })]);
    expect(no.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', reason: expect.stringContaining('at war with its holder') }));
  });

  it('deals resolve the same whatever order the submissions arrive in', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'b', 'c', 'peace');
    const subs = [
      orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_exchange', terms: { give: { food: 50 }, get: { energy: 40 } } }] }),
      orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_exchange', terms: { give: { energy: 40 }, get: { food: 50 } } }, { target: 'c', action: 'demand_tribute', terms: { get: { credits: 30 } } }] }),
      orders(w, 'c', {}, { diplomacy: [{ target: 'b', action: 'pay_tribute', terms: { give: { credits: 30 } } }] }),
    ];
    expect(resolveTurn(w, subs).hash).toBe(resolveTurn(w, [...subs].reverse()).hash);
  });
});

describe('leaders', () => {
  it('every power has an invented leader, and a government fallback for any other', () => {
    for (const id of ['usa', 'china', 'japan', 'russia']) expect(leaderFor(id, 'union').id).toContain(id);
    expect(leaderFor('nowhere', 'directorate').id).toBe('gov_directorate');
  });

  it('remembers a betrayal, fading over its turns, and a grudge weighs by temperament', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    expect(r.world.memories!.b).toEqual([{ about: 'a', kind: 'betrayed', turn: 1 }]);
    const m = mood(r.world, 'b', 'a');
    // b's leader (the union's: a dove) holds the betrayal at 70%, faded by one turn.
    const expected = Math.floor((memoryValue('betrayed', 1) * LEADER_TUNING.temperament.dove.grudge) / 100);
    expect(m.reasons).toContainEqual({ id: 'betrayed', value: expected });
    expect(m.reasons).toContainEqual({ id: 'at_war', value: LEADER_TUNING.live.at_war });
    expect(m.mood).toBe(m.reasons.reduce((s, x) => s + x.value, 0));
    expect(m.stance).toBe(stanceOf(m.mood));
    expect(memoryValue('betrayed', LEADER_TUNING.memory.betrayed.turns)).toBe(0);
  });

  it('a city taken is remembered, and a homeland leader resents every city of theirs you hold', () => {
    const w = makeWorld();
    site(w, 'b-port', k(5, 5), 'b', 'city', 3);
    const r = clone(w);
    r.sites['b-port']!.owner = 'a';
    recordMemories(r, [{ kind: 'site_captured', site: 'b-port', key: k(5, 5), from: 'b', to: 'a' }]);
    expect(r.memories!.b).toEqual([{ about: 'a', kind: 'took_city', turn: 1 }]);
    // The union's leader has the homeland agenda.
    expect(mood(r, 'b', 'a').reasons).toContainEqual({ id: 'agenda_homeland', value: LEADER_TUNING.agenda.homelandPerSite });
  });

  it('keeps only the newest few memories of a kind and forgets what has faded', () => {
    const w = makeWorld();
    w.memories = { b: [] };
    for (let t = 1; t <= 5; t++) w.memories.b!.push({ about: 'a', kind: 'took_city', turn: t });
    w.memories.b!.push({ about: 'a', kind: 'dealt', turn: -50 });
    w.turn = 6;
    recordMemories(w, []);
    expect(w.memories.b!.map((m) => m.turn)).toEqual([5, 4, 3]);
  });

  it('treaties and a common enemy warm a leader; the view shows each rival leader\'s mood toward you', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    setRelation(w, 'a', 'b', 'peace');
    w.treaties.push({ kind: 'trade', a: 'a', b: 'b', from: 1, until: 8 });
    const m = mood(w, 'b', 'a');
    expect(m.reasons.map((x) => x.id)).toEqual(expect.arrayContaining(['trade', 'common_enemy']));
    const view = buildView(w, 'a');
    expect(view.moods!.b).toEqual(m);
    expect(view.attitudes!.b).toEqual(mood(w, 'a', 'b'));
    expect(view.moods!.a).toBeUndefined();
  });
});
