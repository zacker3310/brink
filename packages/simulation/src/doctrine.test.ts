import { describe, expect, it } from 'vitest';
import type { CardId, CardPlay, GameEvent, NationOrders, WorldState } from '@brink/contracts';
import { CARDS, DOCTRINE, GOVERNMENT_DECKS, NATION_DOCTRINES, UNITS, describeCard } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { attackerPower } from './combat';
import { cardSupport, checkPlays, cpIncome, initDoctrine, marchBonus, newDoctrine } from './doctrine';
import { buildView } from './fog';
import { hashState } from './hash';
import { makeWorld, orders, own, setRelation, setTerrain, site, unit } from './fixture.test-util';
import { nationModifiers } from './rules';
import { resolveTurn } from './resolve';
import { lockOrders } from './validate';

// Doctrine cards: Command Points, a hand of three drawn by address, plays checked with the orders,
// settled in the doctrine phase from one snapshot, lasting effects read where they apply.

const k = hexKey;

/** Give `nation` exactly this hand and these Command Points, with an empty deck behind it. */
function deal(w: WorldState, nation: string, hand: CardId[], cp = 8, deck: CardId[] = ['requisition', 'requisition', 'requisition']): void {
  w.nations[nation]!.doctrine = { cp, hand: [...hand].sort(), deck: [...deck].sort(), discard: [], effects: [] };
}

function world3(): WorldState {
  const w = makeWorld(10, 8, ['a', 'b', 'c']);
  // a's capital at 0,0 (the fixture's city made a capital), its ground the west two columns.
  w.sites['a-home']!.kind = 'capital';
  own(w, 'a', [0, 1].flatMap((q) => [0, 1, 2, 3, 4, 5, 6, 7].map((r) => k(q, r))));
  own(w, 'b', [8, 9].flatMap((q) => [2, 3, 4, 5, 6, 7].map((r) => k(q, r))));
  // Even points: no turn here ends the match.
  for (const id of Object.keys(w.sites)) w.sites[id]!.victoryPoints = 5;
  initDoctrine(w);
  return w;
}

const play = (w: WorldState, nation: string, plays: CardPlay[], extra: Partial<NationOrders> = {}) => orders(w, nation, {}, { play: plays, ...extra });
const played = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { kind: 'card_played' }> => e.kind === 'card_played');

describe('doctrine data', () => {
  it('every card has an integer cost, a duration, effects and plain words; every deck names real cards', () => {
    for (const id of Object.keys(CARDS)) {
      const c = CARDS[id]!;
      expect(c.id).toBe(id);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(describeCard(c).length).toBeGreaterThan(10);
    }
    for (const deck of [...Object.values(GOVERNMENT_DECKS), ...Object.values(NATION_DOCTRINES).map((d) => d.deck)]) for (const id of deck) expect(CARDS[id]).toBeDefined();
    expect(Object.keys(CARDS).length).toBeGreaterThanOrEqual(12);
  });
});

describe('a doctrine is dealt', () => {
  it('a full hand, the rest of the deck sorted, the starting Command Points; minors get none', () => {
    const w = world3();
    w.nations.c!.minor = true;
    delete w.nations.c!.doctrine;
    initDoctrine(w);
    const d = w.nations.a!.doctrine!;
    expect(d.hand).toHaveLength(DOCTRINE.handSize);
    expect(d.cp).toBe(DOCTRINE.cpStart);
    expect(d.hand.length + d.deck.length).toBe(GOVERNMENT_DECKS.union.length);
    expect([...d.deck].sort()).toEqual(d.deck);
    expect(w.nations.c!.doctrine).toBeUndefined();
  });

  it('the same seed deals the same hand; the draw depends on the seed', () => {
    const n = { id: 'a', government: 'union' as const };
    expect(newDoctrine(7, n)).toEqual(newDoctrine(7, n));
    const hands = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => newDoctrine(s, n).hand.join(',')));
    expect(hands.size).toBeGreaterThan(1);
  });

  it('Command Points come from the base, capitals and every four cities', () => {
    const w = world3();
    expect(cpIncome(w, 'a')).toBe(DOCTRINE.cpBase + DOCTRINE.cpPerCapital);
    for (let i = 0; i < 4; i++) site(w, `a-c${i}`, k(1, i + 1), 'a', 'city');
    expect(cpIncome(w, 'a')).toBe(DOCTRINE.cpBase + DOCTRINE.cpPerCapital + 1);
    expect(cpIncome(w, 'b')).toBe(DOCTRINE.cpBase);
  });
});

describe('playing a card is checked with the orders', () => {
  it('in hand, a copy per play, paid for, at most two, and never by the order it came in', () => {
    const w = world3();
    deal(w, 'a', ['requisition', 'propaganda', 'rally'], 3);
    const r = checkPlays(w, 'a', w.nations.a!.doctrine, [{ card: 'rally' }, { card: 'propaganda' }, { card: 'requisition' }]);
    // By card id: propaganda (2), rally (2 more is over 3: refused), requisition (1).
    expect(r.accepted.map((p) => p.card)).toEqual(['propaganda', 'requisition']);
    expect(r.rejected).toEqual(['not enough Command Points for Rally']);
    const rev = checkPlays(w, 'a', w.nations.a!.doctrine, [{ card: 'requisition' }, { card: 'propaganda' }, { card: 'rally' }]);
    expect(rev).toEqual(r);
    expect(checkPlays(w, 'a', w.nations.a!.doctrine, [{ card: 'forced_march' }]).rejected).toEqual(['Forced March is not in your hand']);
    expect(checkPlays(w, 'a', w.nations.a!.doctrine, [{ card: 'requisition' }, { card: 'requisition' }]).rejected).toEqual(['Requisition is not in your hand']);
    deal(w, 'a', ['requisition', 'requisition', 'requisition'], 8);
    expect(checkPlays(w, 'a', w.nations.a!.doctrine, [{ card: 'requisition' }, { card: 'requisition' }, { card: 'requisition' }]).rejected).toEqual(['only 2 cards a turn: Requisition waits']);
  });

  it('targets: own ground, ground you do not hold, a rival power, a coast by a fleet, range from the capital', () => {
    const w = world3();
    deal(w, 'a', ['dig_in', 'disinformation', 'missile_barrage'], 8);
    const check = (p: CardPlay) => checkPlays(w, 'a', w.nations.a!.doctrine, [p]).rejected[0] ?? null;
    expect(check({ card: 'dig_in', target: k(1, 1) })).toBeNull();
    expect(check({ card: 'dig_in', target: k(5, 1) })).toBe('Dig In is played on your own ground');
    expect(check({ card: 'dig_in' })).toBe('Dig In needs a hex');
    expect(check({ card: 'disinformation', nation: 'b' })).toBeNull();
    expect(check({ card: 'disinformation', nation: 'a' })).toBe('Disinformation needs a rival power');
    expect(check({ card: 'missile_barrage', target: k(5, 1) })).toBeNull();
    expect(check({ card: 'missile_barrage', target: k(1, 1) })).toBe('Missile Barrage is played on ground you do not hold');
    expect(check({ card: 'missile_barrage', target: k(9, 7) })).toBe('out of range: 6 hexes from your capital or a carrier');
    deal(w, 'a', ['naval_bombardment'], 8);
    setTerrain(w, k(5, 4), 'water');
    expect(check({ card: 'naval_bombardment', target: k(5, 3) })).toBe('no fleet of yours within 2 hexes');
    unit(w, 'af', 'a', 'fleet', k(5, 4));
    expect(check({ card: 'naval_bombardment', target: k(5, 3) })).toBeNull();
    expect(check({ card: 'naval_bombardment', target: k(7, 0) })).toBe('Naval Bombardment needs a coastal hex');
  });

  it('a refused play is an order_rejected event and costs nothing; the hand is untouched', () => {
    const w = world3();
    deal(w, 'a', ['rally'], 1);
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'rally' }])]);
    expect(r.events).toContainEqual({ kind: 'order_rejected', nation: 'a', formation: null, reason: 'not enough Command Points for Rally' });
    expect(played(r.events)).toHaveLength(0);
    expect(r.world.nations.a!.doctrine!.hand).toContain('rally');
  });
});

describe('the doctrine phase', () => {
  it('pays, discards, announces to everyone, then gains Command Points and draws back to three', () => {
    const w = world3();
    deal(w, 'a', ['propaganda', 'rally', 'requisition'], 5);
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'requisition' }])]);
    const d = r.world.nations.a!.doctrine!;
    expect(d.cp).toBe(5 - 1 + cpIncome(r.world, 'a'));
    expect(d.discard).toEqual(['requisition']);
    expect(d.hand).toHaveLength(3);
    expect(played(r.events)).toEqual([{ kind: 'card_played', nation: 'a', card: 'requisition' }]);
    // Public: b and c hear of it.
    for (const n of ['b', 'c']) expect(played(r.reports[n]!.events)).toEqual([{ kind: 'card_played', nation: 'a', card: 'requisition' }]);
    // Rivals see the Command Points and the size of the hand, never the cards.
    expect(r.observations.b!.nations.a!.doctrine).toEqual({ cp: d.cp, hand: 3 });
    expect(JSON.stringify(r.observations.b!.nations.a)).not.toContain('propaganda');
    expect(r.observations.a!.self.doctrine).toEqual(d);
  });

  it('Command Points never bank past the cap', () => {
    const w = world3();
    deal(w, 'a', ['rally'], DOCTRINE.cpCap);
    expect(resolveTurn(w, []).world.nations.a!.doctrine!.cp).toBe(DOCTRINE.cpCap);
  });

  it('an empty deck takes the discard back', () => {
    const w = world3();
    w.nations.a!.doctrine = { cp: 8, hand: ['rally', 'requisition'], deck: [], discard: ['propaganda'], effects: [] };
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'requisition' }])]);
    const d = r.world.nations.a!.doctrine!;
    expect(d.hand).toHaveLength(3);
    expect([...d.hand, ...d.deck, ...d.discard].sort()).toEqual(['propaganda', 'rally', 'requisition']);
  });

  it('Requisition fills the stockpile; Propaganda lifts stability; Disinformation lowers a rival', () => {
    const w = world3();
    deal(w, 'a', ['propaganda', 'requisition'], 8);
    deal(w, 'b', ['disinformation'], 8);
    const base = resolveTurn(w, []);
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'propaganda' }, { card: 'requisition' }]), play(w, 'b', [{ card: 'disinformation', nation: 'c' }])]);
    expect(r.world.nations.a!.stockpile.materials - base.world.nations.a!.stockpile.materials).toBe(50);
    expect(r.world.nations.a!.stockpile.energy - base.world.nations.a!.stockpile.energy).toBeGreaterThanOrEqual(29);
    expect(r.world.nations.a!.stability).toBeGreaterThan(base.world.nations.a!.stability);
    expect(r.world.nations.c!.stability).toBeLessThan(base.world.nations.c!.stability);
  });

  it('Missile Barrage hits every enemy in the hex, softened by entrenchment, and only an enemy', () => {
    const w = world3();
    setRelation(w, 'a', 'c', 'peace');
    deal(w, 'a', ['missile_barrage'], 8);
    unit(w, 'b1', 'b', 'infantry', k(4, 2));
    unit(w, 'b2', 'b', 'infantry', k(4, 2), { entrenchment: 60 });
    unit(w, 'c1', 'c', 'infantry', k(4, 2));
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'missile_barrage', target: k(4, 2) }])]);
    const e = played(r.events)[0]!;
    expect(e.victims).toEqual([
      { formation: 'b1', owner: 'b', strengthLoss: 120 },
      { formation: 'b2', owner: 'b', strengthLoss: 84 },
    ]);
    // Out of supply on unowned ground costs c1 its usual 10; the barrage costs it nothing.
    expect(r.world.formations.c1!.strength).toBe(resolveTurn(w, []).world.formations.c1!.strength);
    // c, with a unit in the hex, sees who it hit; without one, it hears of the card but not who it hit.
    expect(played(r.reports.c!.events)[0]!.victims).toHaveLength(2);
    delete w.formations.c1;
    const unseen = resolveTurn(w, [play(w, 'a', [{ card: 'missile_barrage', target: k(4, 2) }])]);
    expect(played(unseen.reports.c!.events)[0]).toEqual({ kind: 'card_played', nation: 'a', card: 'missile_barrage', target: k(4, 2), victims: [] });
  });

  it('Naval Bombardment shells a coastal hex beside an own fleet', () => {
    const w = world3();
    setTerrain(w, k(5, 4), 'water');
    unit(w, 'af', 'a', 'fleet', k(5, 4));
    unit(w, 'b1', 'b', 'infantry', k(5, 3));
    deal(w, 'a', ['naval_bombardment'], 8);
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'naval_bombardment', target: k(5, 3) }])]);
    expect(played(r.events)[0]!.victims).toEqual([{ formation: 'b1', owner: 'b', strengthLoss: 90 }]);
  });

  it('Dig In entrenches own ground units around the hex; Rally restores organization and morale', () => {
    const w = world3();
    unit(w, 'a1', 'a', 'infantry', k(1, 2), { organization: 30, morale: 30 });
    unit(w, 'a2', 'a', 'infantry', k(1, 7));
    deal(w, 'a', ['dig_in', 'rally'], 8);
    const base = resolveTurn(w, []);
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'dig_in', target: k(1, 1) }, { card: 'rally' }])]);
    expect(r.world.formations.a1!.entrenchment - base.world.formations.a1!.entrenchment).toBe(40);
    expect(r.world.formations.a2!.entrenchment).toBe(base.world.formations.a2!.entrenchment);
    expect(r.world.formations.a1!.organization - base.world.formations.a1!.organization).toBe(25);
    expect(r.world.formations.a1!.morale - base.world.formations.a1!.morale).toBe(20);
  });

  it('Forced March: a longer move is legal and is walked this turn, then the effect retires', () => {
    const w = world3();
    unit(w, 'a1', 'a', 'infantry', k(1, 4));
    deal(w, 'a', ['forced_march'], 8);
    const hexes = (UNITS.infantry.movement + 2) / 2;
    const path = Array.from({ length: hexes }, (_, i) => k(2 + i, 4));
    expect(lockOrders(w, [orders(w, 'a', { a1: { type: 'move', path } })]).rejected).toEqual([{ kind: 'order_rejected', nation: 'a', formation: 'a1', reason: 'path exceeds movement allowance' }]);
    const sub = orders(w, 'a', { a1: { type: 'move', path } }, { play: [{ card: 'forced_march' }] });
    expect(lockOrders(w, [sub]).rejected).toEqual([]);
    expect(marchBonus(w.nations.a, w.turn, { unitClass: 'infantry' }, [{ card: 'forced_march' }])).toBe(2);
    expect(marchBonus(w.nations.a, w.turn, { unitClass: 'fleet' }, [{ card: 'forced_march' }])).toBe(0);
    const r = resolveTurn(w, [sub]);
    expect(r.world.formations.a1!.key).toBe(path.at(-1));
    expect(r.world.nations.a!.doctrine!.effects).toEqual([{ card: 'forced_march', from: 1, until: 1 }]);
    const next = resolveTurn(r.world, []);
    expect(next.world.nations.a!.doctrine!.effects).toEqual([]);
  });

  it('Air Superiority: war-map air strikes hit 25% harder, and hand-fought battles get two strike sorties', () => {
    const w = world3();
    unit(w, 'aw', 'a', 'air', k(1, 3));
    unit(w, 'b1', 'b', 'infantry', k(4, 3));
    deal(w, 'a', ['air_superiority'], 8);
    const strike = { aw: { type: 'attack' as const, target: k(4, 3), path: [] } };
    const lossOf = (r: ReturnType<typeof resolveTurn>) => r.events.flatMap((e) => (e.kind === 'strike' ? e.victims : [])).find((v) => v.formation === 'b1')!.strengthLoss;
    const base = lossOf(resolveTurn(w, [orders(w, 'a', strike)]));
    const boosted = lossOf(resolveTurn(w, [orders(w, 'a', strike, { play: [{ card: 'air_superiority' }] })]));
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(Math.ceil((base * 125) / 100) + 1);
    expect(cardSupport(w.nations.a, w.turn, [{ card: 'air_superiority' }])).toEqual([{ id: 'strike_jet', missions: 2 }]);
    expect(cardSupport(w.nations.a, w.turn, [{ card: 'air_superiority' }, { card: 'kamikaze_swarm' }])).toEqual([
      { id: 'kamikaze', missions: 2 },
      { id: 'strike_jet', missions: 2 },
    ]);
    expect(cardSupport(w.nations.a, w.turn)).toEqual([]);
  });

  it('Sabotage: enemy units around the hex get no supply this turn', () => {
    const w = world3();
    unit(w, 'b1', 'b', 'infantry', k(8, 4));
    unit(w, 'b2', 'b', 'infantry', k(9, 6));
    deal(w, 'a', ['sabotage'], 8);
    const base = resolveTurn(w, []);
    expect(base.world.formations.b1!.supply).toBeGreaterThan(0);
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'sabotage', target: k(8, 4) }])]);
    expect(r.world.formations.b1!.supply).toBe(0);
    expect(r.world.formations.b2!.supply).toBe(base.world.formations.b2!.supply);
  });

  it('Recon Flight: everything within three hexes is seen and detected, cover or not, into the next planning', () => {
    const w = world3();
    setTerrain(w, k(6, 4), 'forest');
    unit(w, 'b1', 'b', 'infantry', k(6, 4));
    deal(w, 'a', ['recon_flight'], 8);
    expect(resolveTurn(w, []).observations.a!.contacts.b1).toBeUndefined();
    const r = resolveTurn(w, [play(w, 'a', [{ card: 'recon_flight', target: k(6, 3) }])]);
    expect(r.observations.a!.contacts.b1).toMatchObject({ confirmed: true, key: k(6, 4) });
    // The view rebuilt in the next planning still has it; the next turn's resolution retires it.
    expect(buildView(r.world, 'a').contacts.b1?.confirmed).toBe(true);
    expect(resolveTurn(r.world, []).world.nations.a!.doctrine!.effects).toEqual([]);
  });

  it('Amphibious Doctrine: a landing pays no beach penalty', () => {
    const w = world3();
    const marine = unit(w, 'm', 'a', 'infantry', k(3, 3), { aboard: 'ship' });
    const defender = unit(w, 'd', 'b', 'infantry', k(4, 3));
    const ctx = { terrain: 'plains' as const, river: false, tileOwner: 'b', spotted: true, airSupport: false, artillerySupport: false, attackerMods: nationModifiers(w.nations.a!), defenderMods: () => nationModifiers(w.nations.b!), defending: () => false };
    const plain = attackerPower([marine], [defender], ctx);
    const doctrine = attackerPower([marine], [defender], { ...ctx, amphibious: true });
    expect(doctrine).toBeGreaterThan(plain);
    expect(doctrine).toBe(attackerPower([{ ...marine, aboard: undefined }], [defender], ctx));
  });
});

describe('doctrine determinism', () => {
  function busy(): WorldState {
    const w = world3();
    unit(w, 'a1', 'a', 'infantry', k(1, 4));
    unit(w, 'aw', 'a', 'air', k(1, 3));
    unit(w, 'b1', 'b', 'infantry', k(3, 3));
    unit(w, 'b2', 'b', 'infantry', k(8, 4));
    unit(w, 'c1', 'c', 'infantry', k(3, 3));
    deal(w, 'a', ['air_superiority', 'missile_barrage', 'forced_march'], 8);
    deal(w, 'b', ['dig_in', 'rally', 'sabotage'], 8);
    deal(w, 'c', ['missile_barrage', 'recon_flight', 'propaganda'], 8);
    w.sites['c-home']!.kind = 'capital';
    return w;
  }
  const subs = (w: WorldState): NationOrders[] => [
    orders(w, 'a', { aw: { type: 'attack', target: k(3, 3), path: [] } }, { play: [{ card: 'air_superiority' }, { card: 'missile_barrage', target: k(3, 3) }] }),
    orders(w, 'b', { b1: { type: 'defend' } }, { play: [{ card: 'dig_in', target: k(8, 3) }, { card: 'rally' }] }),
    orders(w, 'c', {}, { play: [{ card: 'missile_barrage', target: k(3, 3) }, { card: 'recon_flight', target: k(2, 3) }] }),
  ];

  it('the same inputs give the same world and hash', () => {
    const w = busy();
    const before = hashState(w);
    const r1 = resolveTurn(w, subs(w));
    const r2 = resolveTurn(w, subs(w));
    expect(r1.hash).toBe(r2.hash);
    expect(r1.events).toEqual(r2.events);
    expect(hashState(w)).toBe(before);
    expect(played(r1.events)).toHaveLength(6);
  });

  it('submission order, play order and key order do not change the result', () => {
    const w = busy();
    const r1 = resolveTurn(w, subs(w));
    const reversed = subs(w)
      .reverse()
      .map((o) => ({ ...o, play: [...(o.play ?? [])].reverse(), formations: Object.fromEntries(Object.entries(o.formations).reverse()) }));
    expect(resolveTurn(w, reversed).hash).toBe(r1.hash);
    const w2 = JSON.parse(JSON.stringify(w)) as WorldState;
    w2.nations = Object.fromEntries(Object.entries(w2.nations).reverse());
    w2.formations = Object.fromEntries(Object.entries(w2.formations).reverse());
    expect(resolveTurn(w2, subs(w2)).hash).toBe(r1.hash);
  });

  it('two powers striking one hex both land, from one snapshot', () => {
    const w = busy();
    const r = resolveTurn(w, subs(w));
    const hits = played(r.events).filter((e) => e.card === 'missile_barrage');
    expect(hits.map((e) => e.nation)).toEqual(['a', 'c']);
    // a hits b1 and c1 (both at war with it); c hits a's enemies there that are its own enemies too.
    expect(hits[0]!.victims!.map((v) => v.formation)).toEqual(['b1', 'c1']);
    expect(hits[1]!.victims!.map((v) => v.formation)).toEqual(['b1']);
  });
});
