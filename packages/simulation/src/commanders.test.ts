import { describe, expect, it } from 'vitest';
import type { Commander, Formation, GameEvent, NationOrders, WorldState } from '@brink/contracts';
import { COMMANDER_RULES, PERK_IDS, PERKS, levelForXp, rosterFor } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { attackerPower, type AssaultContext } from './combat';
import { commanderEffect, leaderEffects, perkOffer, portraitOf, seedCommanders } from './commanders';
import { buildView } from './fog';
import { hashState } from './hash';
import { makeWorld, orders, own, unit } from './fixture.test-util';
import { resolveTurn } from './resolve';
import { roll } from './rng';
import { nationModifiers } from './rules';
import { lockOrders } from './validate';

const k = hexKey;

/** Two powers at war, a's infantry next to b's, each with its starting generals. */
function front(): WorldState {
  const w = makeWorld(8, 6, ['a', 'b']);
  unit(w, 'a1', 'a', 'infantry', k(2, 2));
  unit(w, 'a2', 'a', 'armor', k(2, 3));
  unit(w, 'b1', 'b', 'infantry', k(3, 2));
  own(w, 'b', [k(3, 2)]);
  seedCommanders(w);
  return w;
}

const gen = (w: WorldState, id: string): Commander => w.commanders![id]!;
const assign = (commander: string, formation: string | null) => ({ commanders: { assign: [{ commander, formation }] } });
const rejections = (events: GameEvent[]) => events.filter((e) => e.kind === 'order_rejected').map((e) => (e.kind === 'order_rejected' ? e.reason : ''));

describe('commanders: the roster', () => {
  it('gives every power three generals from its roster, minor states none, and only once', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'm']);
    w.nations.m!.minor = true;
    seedCommanders(w);
    const ids = Object.keys(w.commanders!).sort();
    expect(ids).toEqual(['a-gen-1', 'a-gen-2', 'a-gen-3', 'b-gen-1', 'b-gen-2', 'b-gen-3']);
    const roster = rosterFor('a', 'union');
    expect(gen(w, 'a-gen-1')).toMatchObject({ name: roster[0]!.name, traits: [roster[0]!.trait], level: 1, xp: 0, perks: [], formation: null, status: 'active', offer: null });
    gen(w, 'a-gen-1').xp = 9;
    seedCommanders(w);
    expect(gen(w, 'a-gen-1').xp).toBe(9);
    expect(portraitOf('Eleanor Ashby')).toBe('EA');
    expect(portraitOf('Cher')).toBe('C');
  });

  it('levels by the experience table, 1 to 5', () => {
    expect(COMMANDER_RULES.levelXp.map(levelForXp)).toEqual([1, 2, 3, 4, 5]);
    expect(levelForXp(COMMANDER_RULES.levelXp[1]! - 1)).toBe(1);
    expect(levelForXp(10_000)).toBe(5);
    expect(PERK_IDS.length).toBeGreaterThanOrEqual(8);
    expect(PERK_IDS.length).toBeLessThanOrEqual(12);
    for (const p of PERK_IDS) for (const v of Object.values(PERKS[p]!.effect)) expect(Number.isInteger(v), p).toBe(true);
  });
});

describe('commanders: orders', () => {
  it('assigns a general to an own formation at once, before the fighting', () => {
    const w = front();
    const r = resolveTurn(w, [orders(w, 'a', {}, assign('a-gen-1', 'a1')), orders(w, 'b')]);
    expect(rejections(r.events)).toEqual([]);
    expect(r.world.commanders!['a-gen-1']!.formation).toBe('a1');
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'commander', change: 'assigned', commander: 'a-gen-1', formation: 'a1' }));
    // Relieved next turn, back to the reserve.
    const r2 = resolveTurn(r.world, [orders(r.world, 'a', {}, assign('a-gen-1', null)), orders(r.world, 'b')]);
    expect(r2.world.commanders!['a-gen-1']!.formation).toBeNull();
  });

  it('refuses what a general cannot do, and takes postings as one reshuffle', () => {
    const w = front();
    unit(w, 'ship', 'a', 'transport', k(0, 5));
    gen(w, 'a-gen-1').formation = 'a1';
    gen(w, 'a-gen-3').status = 'killed';
    gen(w, 'a-gen-2').status = 'wounded';
    gen(w, 'a-gen-2').woundedTurns = 2;
    const sub = (c: NationOrders['commanders']) => lockOrders(w, [orders(w, 'a', {}, { commanders: c })]);
    const why = (c: NationOrders['commanders']) => rejections(sub(c).rejected);
    expect(why({ assign: [{ commander: 'b-gen-1', formation: 'a1' }] })).toEqual(['no such general of yours']);
    expect(why({ assign: [{ commander: 'a-gen-3', formation: 'a2' }] })[0]).toMatch(/has fallen/);
    expect(why({ assign: [{ commander: 'a-gen-2', formation: 'a2' }] })[0]).toMatch(/recovering/);
    expect(why({ assign: [{ commander: 'a-gen-1', formation: 'b1' }] })).toEqual(['no such formation of yours']);
    expect(why({ assign: [{ commander: 'a-gen-1', formation: 'ship' }] })[0]).toMatch(/not ships/);
    expect(why({ assign: [{ commander: 'a-gen-1', formation: 'a1' }] })[0]).toMatch(/already leads/);
    expect(why({ assign: [{ commander: 'a-gen-1', formation: null }, { commander: 'a-gen-1', formation: 'a2' }] })[0]).toMatch(/more than one/);
    expect(why({ perks: { 'a-gen-1': 0 } })[0]).toMatch(/no promotion waiting/);
    // A wounded general may still be sent to the reserve; a formation already led is refused.
    gen(w, 'a-gen-2').status = 'active';
    expect(why({ assign: [{ commander: 'a-gen-2', formation: 'a1' }] })[0]).toMatch(/already has a general/);
    // One reshuffle: a-gen-1 leaves a1 for a2, so a-gen-2 may take a1.
    const ok = sub({ assign: [{ commander: 'a-gen-2', formation: 'a1' }, { commander: 'a-gen-1', formation: 'a2' }] });
    expect(rejections(ok.rejected)).toEqual([]);
    expect(ok.orders.a!.commanders!.assign).toEqual([{ commander: 'a-gen-1', formation: 'a2' }, { commander: 'a-gen-2', formation: 'a1' }]);
    // A chain written lowest id first: a-gen-1 takes the command a-gen-2 leaves.
    gen(w, 'a-gen-1').formation = null;
    gen(w, 'a-gen-2').formation = 'a1';
    const chain = sub({ assign: [{ commander: 'a-gen-1', formation: 'a1' }, { commander: 'a-gen-2', formation: 'a2' }] });
    expect(rejections(chain.rejected)).toEqual([]);
    expect(chain.orders.a!.commanders!.assign).toEqual([{ commander: 'a-gen-1', formation: 'a1' }, { commander: 'a-gen-2', formation: 'a2' }]);
    // A swap is one reshuffle.
    gen(w, 'a-gen-1').formation = 'a2';
    const swapped = sub({ assign: [{ commander: 'a-gen-2', formation: 'a2' }, { commander: 'a-gen-1', formation: 'a1' }] });
    expect(rejections(swapped.rejected)).toEqual([]);
    const done = resolveTurn(w, [orders(w, 'a', {}, { commanders: { assign: [{ commander: 'a-gen-2', formation: 'a2' }, { commander: 'a-gen-1', formation: 'a1' }] } }), orders(w, 'b')]).world;
    expect([done.commanders!['a-gen-1']!.formation, done.commanders!['a-gen-2']!.formation]).toEqual(['a1', 'a2']);
    // Relieved and replaced in one turn.
    const relieve = sub({ assign: [{ commander: 'a-gen-1', formation: 'a1' }, { commander: 'a-gen-2', formation: null }] });
    expect(rejections(relieve.rejected)).toEqual([]);
    gen(w, 'a-gen-1').formation = 'a1';
    gen(w, 'a-gen-2').formation = null;
    const swap = sub({ assign: [{ commander: 'a-gen-1', formation: 'a2' }, { commander: 'a-gen-2', formation: null }] });
    expect(rejections(swap.rejected)[0]).toMatch(/already in reserve/);
    expect(swap.orders.a!.commanders!.assign).toEqual([{ commander: 'a-gen-1', formation: 'a2' }]);
  });
});

describe('commanders: in battle', () => {
  const ctx = (leader?: AssaultContext['leader']): AssaultContext => {
    const mods = nationModifiers({ government: 'union', research: { current: null, progress: 0, unlocked: [] } });
    return { terrain: 'plains', river: false, tileOwner: null, spotted: true, airSupport: false, artillerySupport: false, attackerMods: mods, defenderMods: () => mods, defending: () => false, ...(leader ? { leader } : {}) };
  };

  it('a led assault hits harder, and the defender loses more', () => {
    const plain = front();
    const led = front();
    gen(led, 'a-gen-1').formation = 'a1';
    const attack = (w: WorldState) => resolveTurn(w, [orders(w, 'a', { a1: { type: 'attack', target: k(3, 2), path: [] } }), orders(w, 'b')]);
    const loss = (w: WorldState) => {
      const e = attack(w).events.find((x) => x.kind === 'engagement');
      return e?.kind === 'engagement' ? e.participants.find((p) => p.formation === 'b1')!.strengthLoss : -1;
    };
    expect(loss(led)).toBeGreaterThan(loss(plain));
  });

  it('a beachmaster takes the whole beach-landing penalty away, a marine half of it', () => {
    const w = makeWorld();
    const marines = unit(w, 'i', 'a', 'infantry', k(1, 1), { aboard: 't' });
    const target = [unit(w, 'd', 'b', 'infantry', k(2, 1))];
    const ashore: Formation = { ...marines, aboard: undefined };
    delete ashore.aboard;
    const eff = (traits: string[], perks: string[]) => commanderEffect({ traits, perks });
    const none = { ...eff([], []), attack: 0, defense: 0 };
    const p = (f: Formation, e = none) => attackerPower([f], target, ctx(() => e));
    expect(p(marines)).toBeLessThan(p(ashore));
    expect(p(marines, { ...none, amphibious: 100 })).toBe(p(ashore));
    expect(p(marines, { ...none, amphibious: 50 })).toBeGreaterThan(p(marines));
    expect(p(marines, { ...none, amphibious: 50 })).toBeLessThan(p(ashore));
    expect(eff(['marine'], ['beachmaster']).amphibious).toBe(100);
  });

  it('earns experience for fighting, then a promotion offers two perks it lacks', () => {
    const w = front();
    gen(w, 'a-gen-1').formation = 'a1';
    gen(w, 'a-gen-1').xp = COMMANDER_RULES.levelXp[1]! - 1;
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'attack', target: k(3, 2), path: [] } }), orders(w, 'b')]);
    const c = r.world.commanders!['a-gen-1']!;
    expect(c.xp).toBeGreaterThanOrEqual(COMMANDER_RULES.levelXp[1]!);
    expect(c.level).toBe(2);
    expect(c.battles).toBe(1);
    expect(c.offer).not.toBeNull();
    const [x, y] = c.offer!.options;
    expect(x).not.toBe(y);
    expect(c.offer!.options).toEqual(perkOffer(w.seed, w.turn, { id: 'a-gen-1', perks: [] }));
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'commander', change: 'level_up', level: 2 }));
    // The other side never hears of it.
    expect(r.reports.b!.events.some((e) => e.kind === 'commander' && e.nation === 'a')).toBe(false);

    // Answered: the second card is taken at once.
    const w2 = r.world;
    const answered = resolveTurn(w2, [orders(w2, 'a', {}, { commanders: { perks: { 'a-gen-1': 1 } } }), orders(w2, 'b')]);
    expect(answered.world.commanders!['a-gen-1']!.perks).toEqual([y]);
    expect(answered.world.commanders!['a-gen-1']!.offer).toBeNull();
    // Unanswered: offered at the end of last turn, so this turn's end takes the first card.
    const ignored = resolveTurn(w2, [orders(w2, 'a'), orders(w2, 'b')]);
    expect(ignored.world.commanders!['a-gen-1']!.perks).toEqual([x]);
    expect(ignored.events).toContainEqual(expect.objectContaining({ kind: 'commander', change: 'perk', perk: x }));
  });

  it('a destroyed formation kills, wounds or loses its general by the roll', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40 && seen.size < 3; seed++) {
      const w = front();
      w.seed = seed;
      w.formations.b1!.strength = 60;
      w.formations.b1!.organization = 10;
      gen(w, 'b-gen-1').formation = 'b1';
      const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'attack', target: k(3, 2), path: [] }, a2: { type: 'attack', target: k(3, 2), path: [] } }), orders(w, 'b')]);
      expect(r.world.formations.b1).toBeUndefined();
      const c = r.world.commanders!['b-gen-1']!;
      expect(c.formation).toBeNull();
      const guard = 100 - commanderEffect(c).survival;
      const die = roll(seed, w.turn, 'commander-fate', 'b-gen-1') % 100;
      const killed = Math.floor((COMMANDER_RULES.destroyed.killed * guard) / 100);
      const wounded = killed + Math.floor((COMMANDER_RULES.destroyed.wounded * guard) / 100);
      const expected = die < killed ? 'killed' : die < wounded ? 'wounded' : 'active';
      expect(c.status, `seed ${seed}`).toBe(expected);
      if (expected === 'wounded') expect(c.woundedTurns).toBe(COMMANDER_RULES.woundTurns.destroyed);
      seen.add(expected);
    }
    expect([...seen].sort()).toEqual(['active', 'killed', 'wounded']);
  });

  it('a wound heals after its turns, and the general can lead again', () => {
    const w = front();
    gen(w, 'a-gen-1').status = 'wounded';
    gen(w, 'a-gen-1').woundedTurns = 2;
    let cur = w;
    for (let i = 0; i < 2; i++) cur = resolveTurn(cur, [orders(cur, 'a'), orders(cur, 'b')]).world;
    expect(cur.commanders!['a-gen-1']!.status).toBe('active');
    const r = resolveTurn(cur, [orders(cur, 'a', {}, assign('a-gen-1', 'a1')), orders(cur, 'b')]);
    expect(rejections(r.events)).toEqual([]);
  });

  it('standing effects: supply after logistics, morale and entrenchment each turn, sight', () => {
    const w = front();
    gen(w, 'a-gen-1').formation = 'a1';
    gen(w, 'a-gen-1').perks = ['iron_supply', 'rally', 'dig_deep', 'eyes_forward'];
    const twin = front();
    const go = (x: WorldState) => resolveTurn(x, [orders(x, 'a', { a1: { type: 'defend' } }), orders(x, 'b', { b1: { type: 'defend' } })]).world;
    const led = go(w).formations.a1!;
    const plain = go(twin).formations.a1!;
    expect(led.supply).toBeGreaterThan(plain.supply);
    expect(led.morale).toBeGreaterThan(plain.morale);
    expect(led.entrenchment).toBe(Math.min(100, plain.entrenchment + 10));
    expect(Object.keys(buildView(w, 'a').tiles).filter((t) => buildView(w, 'a').tiles[t]!.visibility === 'visible').length).toBeGreaterThan(
      Object.keys(buildView(twin, 'a').tiles).filter((t) => buildView(twin, 'a').tiles[t]!.visibility === 'visible').length,
    );
    expect(leaderEffects(w.commanders).a1!.vision).toBe(1);
  });
});

describe('commanders: fog', () => {
  it('shows your own generals in full and a foreign one leading a seen contact by name and level only', () => {
    const w = front();
    gen(w, 'b-gen-2').formation = 'b1';
    gen(w, 'b-gen-2').level = 3;
    const view = buildView(w, 'a');
    expect(Object.keys(view.commanders!).sort()).toEqual(['a-gen-1', 'a-gen-2', 'a-gen-3']);
    expect(view.enemyCommanders).toEqual({ b1: { name: gen(w, 'b-gen-2').name, level: 3, nation: 'b' } });
    // Out of sight: nothing.
    w.formations.b1!.key = k(7, 5);
    own(w, 'b', [k(7, 5)]);
    w.tiles[k(7, 5)]!.terrain = 'forest';
    w.sites['b-home']!.key = k(7, 0);
    const hidden = buildView(w, 'a');
    expect(hidden.enemyCommanders).toEqual({});
  });
});

describe('commanders: determinism', () => {
  it('submission order, key order and assignment order do not change the result', () => {
    const w = front();
    gen(w, 'a-gen-1').xp = 9;
    gen(w, 'b-gen-1').formation = 'b1';
    const subs = (): NationOrders[] => [
      orders(w, 'a', { a1: { type: 'attack', target: k(3, 2), path: [] }, a2: { type: 'attack', target: k(3, 2), path: [] } }, { commanders: { assign: [{ commander: 'a-gen-1', formation: 'a1' }, { commander: 'a-gen-2', formation: 'a2' }] } }),
      orders(w, 'b', { b1: { type: 'defend' } }),
    ];
    const r1 = resolveTurn(w, subs());
    const reversed = subs()
      .reverse()
      .map((o) => ({ ...o, formations: Object.fromEntries(Object.entries(o.formations).reverse()), ...(o.commanders ? { commanders: { assign: [...o.commanders.assign!].reverse() } } : {}) }));
    expect(resolveTurn(w, reversed).hash).toBe(r1.hash);
    const w2 = JSON.parse(JSON.stringify(w)) as WorldState;
    w2.commanders = Object.fromEntries(Object.entries(w2.commanders!).reverse());
    expect(resolveTurn(w2, subs()).hash).toBe(r1.hash);
    expect(hashState(resolveTurn(w, subs()).world)).toBe(r1.hash);
  });
});
