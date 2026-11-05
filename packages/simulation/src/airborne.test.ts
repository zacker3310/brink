import { describe, expect, it } from 'vitest';
import type { GameEvent, WorldState } from '@brink/contracts';
import { AIRBORNE, PASSAGE } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { airliftTargets, interceptChance, liftContext, checkAirlift } from './airborne';
import { attackerPower } from './combat';
import { buildView } from './fog';
import { makeWorld, orders, own, setRelation, setTerrain, site, unit } from './fixture.test-util';
import { hasPassage } from './passage';
import { resolveTurn } from './resolve';
import { nationModifiers, pairKey } from './rules';
import { supplyDistances } from './supply';
import { checkFormationOrder, lockOrders } from './validate';

// Airborne warfare and right of passage (ruleset 2.9.0, game-data `AIRBORNE` and `PASSAGE`).

const k = hexKey;
const lifts = (events: readonly GameEvent[]) => events.filter((e): e is Extract<GameEvent, { kind: 'airlift' }> => e.kind === 'airlift');
const rejected = (w: WorldState, o: ReturnType<typeof orders>) => lockOrders(w, [o]).rejected.filter((e) => e.kind === 'order_rejected');

/**
 * A long strip, 24 x 6, all plains. a holds the west (q 0..5) with its capital at 1,2 and an airbase
 * city at 4,2; b holds the east (q 16..23) with its home city at 23,5; the middle is nobody's.
 */
function strip() {
  const w = makeWorld(24, 6, ['a', 'b']);
  for (let q = 0; q < 24; q++) for (let r = 0; r < 6; r++) if (q <= 5 || q >= 16) own(w, q <= 5 ? 'a' : 'b', [k(q, r)]);
  site(w, 'a-cap', k(1, 2), 'a', 'capital', 10);
  site(w, 'a-base', k(4, 2), 'a', 'city', 5).facilities.push('airbase');
  w.sites['b-home']!.victoryPoints = 15;
  return w;
}

describe('airlift: who flies, from where, how far', () => {
  it('flies light troops from an airbase 12 hexes and a capital 10; never from an ordinary city', () => {
    const w = strip();
    unit(w, 'i', 'a', 'infantry', k(4, 2));
    unit(w, 'c', 'a', 'infantry', k(1, 2));
    unit(w, 'x', 'a', 'infantry', k(0, 0)); // a-home: a city without an airbase
    expect(checkFormationOrder(w, 'a', 'i', { type: 'airlift', target: k(16, 2) })).toBeNull(); // 12 from the airbase
    expect(checkFormationOrder(w, 'a', 'i', { type: 'airlift', target: k(17, 2) })).toMatch(/out of range/);
    expect(checkFormationOrder(w, 'a', 'c', { type: 'airlift', target: k(11, 2) })).toBeNull(); // 10 from the capital
    expect(checkFormationOrder(w, 'a', 'c', { type: 'airlift', target: k(12, 2) })).toMatch(/out of range/);
    expect(checkFormationOrder(w, 'a', 'x', { type: 'airlift', target: k(3, 0) })).toMatch(/no airfield/);
    expect(checkFormationOrder(w, 'a', 'i', { type: 'airlift', target: k(4, 2) })).toMatch(/already there/);
  });

  it('flies infantry and recon anywhere; mechanized only onto an own or allied airfield; never armour or guns', () => {
    const w = strip();
    unit(w, 'r', 'a', 'recon', k(4, 2));
    unit(w, 'm', 'a', 'mechanized', k(4, 2));
    unit(w, 't', 'a', 'armor', k(1, 2));
    unit(w, 'g', 'a', 'artillery', k(1, 2));
    expect(checkFormationOrder(w, 'a', 'r', { type: 'airlift', target: k(10, 3) })).toBeNull();
    expect(checkFormationOrder(w, 'a', 'm', { type: 'airlift', target: k(10, 3) })).toMatch(/only air-lands/);
    expect(checkFormationOrder(w, 'a', 'm', { type: 'airlift', target: k(1, 2) })).toBeNull(); // the capital: air-landed
    expect(checkFormationOrder(w, 'a', 't', { type: 'airlift', target: k(4, 2) })).toMatch(/cannot be flown/);
    expect(checkFormationOrder(w, 'a', 'g', { type: 'airlift', target: k(4, 2) })).toMatch(/cannot be flown/);
  });

  it('never lands in the sea, in a full landing zone, or in the land of a power at peace without passage', () => {
    const w = strip();
    unit(w, 'i', 'a', 'infantry', k(4, 2));
    setTerrain(w, k(9, 2), 'water');
    expect(checkFormationOrder(w, 'a', 'i', { type: 'airlift', target: k(9, 2) })).toMatch(/nowhere to land/);
    for (const id of ['p', 'q', 's']) unit(w, id, 'a', 'infantry', k(10, 2));
    expect(checkFormationOrder(w, 'a', 'i', { type: 'airlift', target: k(10, 2) })).toMatch(/full/);
    // A neutral's land: the order stands (a view may only know who held it), the lift turns back.
    setRelation(w, 'a', 'b', 'peace');
    w.formations.i!.key = k(4, 2);
    let r = resolveTurn(w, [orders(w, 'a', { i: { type: 'airlift', target: k(16, 1) } })]);
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    expect(lifts(r.events)[0]!.aborted).toMatch(/peace/);
    expect(r.world.formations.i!.key).toBe(k(4, 2));
    expect(airliftTargets(buildView(w, 'a'), w.formations.i!).some((t) => t.key === k(16, 1))).toBe(false);
    w.treaties.push({ kind: 'passage', a: 'a', b: 'b', from: 1, until: 8 });
    r = resolveTurn(w, [orders(w, 'a', { i: { type: 'airlift', target: k(16, 1) } })]);
    expect(r.world.formations.i!.key).toBe(k(16, 1));
    expect(r.world.tiles[k(16, 1)]!.owner).toBe('b');
  });
});

describe('airlift: landing', () => {
  it('air-lands at an own site in good order; a drop comes down scattered and stays put', () => {
    const w = strip();
    unit(w, 'i', 'a', 'infantry', k(1, 2), { organization: 80, readiness: 90 });
    unit(w, 'j', 'a', 'infantry', k(4, 2), { organization: 80, readiness: 90 });
    const r = resolveTurn(w, [orders(w, 'a', { i: { type: 'airlift', target: k(4, 2) }, j: { type: 'airlift', target: k(12, 4) } })]);
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    const [land, drop] = [lifts(r.events).find((e) => e.formation === 'i')!, lifts(r.events).find((e) => e.formation === 'j')!];
    expect(land.mode).toBe('airland');
    expect(drop.mode).toBe('drop');
    expect(r.world.formations.i!.key).toBe(k(4, 2));
    expect(r.world.formations.j!.key).toBe(k(12, 4));
    // Organization and readiness after the economy's own recovery: the drop is down both.
    const i = r.world.formations.i!;
    const j = r.world.formations.j!;
    expect(i.organization - j.organization).toBeGreaterThanOrEqual(AIRBORNE.dropOrganization - 5);
    expect(i.readiness).toBeGreaterThan(j.readiness);
    // The ground it came down on is taken; next turn it may attack from there.
    expect(r.world.tiles[k(12, 4)]!.owner).toBe('a');
    unit(r.world, 'e', 'b', 'infantry', k(13, 4));
    expect(checkFormationOrder(r.world, 'a', 'j', { type: 'attack', target: k(13, 4), path: [] })).toBeNull();
  });

  it('is out of supply off its own lines until it links up', () => {
    const w = strip();
    unit(w, 'j', 'a', 'infantry', k(4, 2));
    let r = resolveTurn(w, [orders(w, 'a', { j: { type: 'airlift', target: k(14, 3) } })]);
    expect(supplyDistances(r.world, 'a').has(k(14, 3))).toBe(false);
    r = resolveTurn(r.world, [orders(r.world, 'a')]);
    expect(r.world.formations.j!.supply).toBeLessThan(25);
    // An own site taken by the drop is a supply source of its own.
    const w2 = strip();
    site(w2, 'objective', k(14, 3), null, 'depot', 1);
    unit(w2, 'j', 'a', 'infantry', k(4, 2));
    r = resolveTurn(w2, [orders(w2, 'a', { j: { type: 'airlift', target: k(14, 3) } })]);
    expect(r.world.sites.objective!.owner).toBe('a');
    r = resolveTurn(r.world, [orders(r.world, 'a')]);
    expect(r.world.formations.j!.supply).toBeGreaterThan(25);
  });

  it('a drop onto a held hex comes down beside it and storms it at once, at a heavy penalty', () => {
    const w = strip();
    unit(w, 'j', 'a', 'infantry', k(4, 2));
    unit(w, 'e', 'b', 'recon', k(12, 2), { strength: 300, organization: 30 });
    const r = resolveTurn(w, [orders(w, 'a', { j: { type: 'airlift', target: k(12, 2) } })]);
    const l = lifts(r.events)[0]!;
    expect(l.mode).toBe('assault');
    expect(l.landed).not.toBe(k(12, 2));
    const fight = r.events.find((e) => e.kind === 'engagement' && e.location === k(12, 2));
    expect(fight && fight.kind === 'engagement' && fight.participants.some((p) => p.formation === 'j' && p.role === 'attacker' && p.from === l.landed)).toBe(true);
    // The penalty itself.
    const a = w.formations.j!;
    const d = [w.formations.e!];
    const ctx = { terrain: 'plains' as const, river: false, tileOwner: null, spotted: true, airSupport: false, artillerySupport: false, attackerMods: nationModifiers(w.nations.a!), defenderMods: () => nationModifiers(w.nations.b!), defending: () => false };
    const plain = attackerPower([a], d, ctx);
    const dropped = attackerPower([a], d, { ...ctx, airborne: new Set(['j']) });
    expect(Math.abs(dropped - Math.floor((plain * (100 - AIRBORNE.assaultPenalty)) / 100))).toBeLessThanOrEqual(1);
  });

  it('two powers coming down in one hex both turn back', () => {
    const w = strip();
    site(w, 'b-base', k(19, 2), 'b', 'capital', 5);
    unit(w, 'j', 'a', 'infantry', k(4, 2));
    unit(w, 'f', 'b', 'infantry', k(19, 2));
    const r = resolveTurn(w, [orders(w, 'a', { j: { type: 'airlift', target: k(12, 2) } }), orders(w, 'b', { f: { type: 'airlift', target: k(12, 2) } })]);
    expect(lifts(r.events).map((e) => e.aborted)).toEqual([expect.stringMatching(/another power/), expect.stringMatching(/another power/)]);
    expect(r.world.formations.j!.key).toBe(k(4, 2));
    expect(r.world.formations.f!.key).toBe(k(19, 2));
  });
});

describe('airlift: capacity and cost', () => {
  it('lifts at most the origin capacity a turn: the capital one, an airbase two', () => {
    const w = strip();
    for (const id of ['c1', 'c2']) unit(w, id, 'a', 'infantry', k(1, 2));
    for (const id of ['b1', 'b2', 'b3']) unit(w, id, 'a', 'infantry', k(4, 2));
    const o = orders(w, 'a', {
      c1: { type: 'airlift', target: k(8, 1) },
      c2: { type: 'airlift', target: k(8, 2) },
      b1: { type: 'airlift', target: k(10, 1) },
      b2: { type: 'airlift', target: k(10, 2) },
      b3: { type: 'airlift', target: k(10, 3) },
    });
    const bad = rejected(w, o);
    expect(bad.map((e) => (e.kind === 'order_rejected' ? e.formation : null))).toEqual(['b3', 'c2']);
    expect(AIRBORNE.origins.capital.capacity).toBe(1);
    expect(AIRBORNE.origins.airbase.capacity).toBe(2);
  });

  it('costs credits, reserved after recruits, and burns fuel as there is; paid on the production line of the books', () => {
    const w = strip();
    unit(w, 'i', 'a', 'infantry', k(4, 2));
    w.nations.a!.stockpile.credits = AIRBORNE.cost.credits - 1;
    expect(rejected(w, orders(w, 'a', { i: { type: 'airlift', target: k(9, 2) } })).map((e) => e.kind === 'order_rejected' && e.reason)).toEqual(['not enough credits in the stockpile for the lift']);
    // A recruit reserved first leaves too little.
    w.nations.a!.stockpile.credits = 50;
    expect(rejected(w, orders(w, 'a', { i: { type: 'airlift', target: k(9, 2) } }, { recruit: [{ siteId: 'a-cap', unitClass: 'infantry' }] })).length).toBe(1);
    w.nations.a!.stockpile.credits = 500;
    w.nations.a!.stockpile.energy = 100;
    let r = resolveTurn(w, [orders(w, 'a', { i: { type: 'airlift', target: k(9, 2) } })]);
    const ledger = (x: typeof r) => x.events.find((e) => e.kind === 'economy' && e.nation === 'a') as Extract<GameEvent, { kind: 'economy' }>;
    expect(ledger(r).ledger.production.credits).toBe(AIRBORNE.cost.credits);
    expect(ledger(r).ledger.production.energy).toBe(AIRBORNE.fuel);
    // With an empty tank the lift still flies: the fuel is drawn as there is.
    w.nations.a!.stockpile.energy = 0;
    r = resolveTurn(w, [orders(w, 'a', { i: { type: 'airlift', target: k(9, 2) } })]);
    expect(r.world.formations.i!.key).toBe(k(9, 2));
    expect(ledger(r).ledger.production.energy).toBe(0);
  });
});

describe('airlift: the deck', () => {
  function sea() {
    const w = strip();
    for (let q = 6; q <= 9; q++) for (let r = 0; r < 6; r++) setTerrain(w, k(q, r), 'water');
    unit(w, 'cv', 'a', 'carrier', k(8, 2));
    unit(w, 'lift', 'a', 'transport', k(8, 2));
    for (const id of ['m1', 'm2', 'm3']) unit(w, id, 'a', 'infantry', k(8, 2), { aboard: id === 'm3' ? 'lift2' : 'lift' });
    unit(w, 'lift2', 'a', 'transport', k(8, 2));
    return w;
  }

  it('flies troops aboard an amphibious group lying with a carrier 7 hexes, two a carrier', () => {
    const w = sea();
    expect(AIRBORNE.origins.carrier.range).toBe(7);
    expect(checkFormationOrder(w, 'a', 'm1', { type: 'airlift', target: k(15, 2) })).toBeNull();
    expect(checkFormationOrder(w, 'a', 'm1', { type: 'airlift', target: k(16, 2) })).toMatch(/out of range/);
    const o = orders(w, 'a', { m1: { type: 'airlift', target: k(13, 1) }, m2: { type: 'airlift', target: k(13, 2) }, m3: { type: 'airlift', target: k(13, 3) } });
    expect(rejected(w, o).map((e) => e.kind === 'order_rejected' && e.formation)).toEqual(['m3']);
    const r = resolveTurn(w, [o]);
    expect(r.world.formations.m1!.key).toBe(k(13, 1));
    expect(r.world.formations.m1!.aboard).toBeUndefined();
    expect(r.world.formations.m3!.aboard).toBe('lift2');
  });

  it('needs the carrier in the hex', () => {
    const w = sea();
    w.formations.cv!.key = k(7, 2);
    expect(checkFormationOrder(w, 'a', 'm1', { type: 'airlift', target: k(13, 1) })).toMatch(/carriers/);
  });
});

describe('airlift: interception', () => {
  it('sums the threats near the flight and the landing zone, capped', () => {
    const I = AIRBORNE.intercept;
    expect(interceptChance([], k(0, 0), k(10, 0)).chance).toBe(0);
    expect(interceptChance([{ owner: 'b', kind: 'air', key: k(5, 3) }], k(0, 0), k(10, 0))).toEqual({ chance: I.air, by: ['b'] });
    // Far off the corridor: no threat.
    expect(interceptChance([{ owner: 'b', kind: 'air', key: k(5, 9) }], k(0, 0), k(10, 0)).chance).toBe(0);
    const many = Array.from({ length: 10 }, (_, i) => ({ owner: 'b', kind: 'battery' as const, key: k(10, i % 2) }));
    expect(interceptChance(many, k(0, 0), k(10, 0)).chance).toBe(I.max);
  });

  it('is a roll on the seed, the turn and the formation: the same every time, whatever the submission order', () => {
    const outcome = (seed: number) => {
      const w = strip();
      w.seed = seed;
      for (const id of ['h1', 'h2']) unit(w, id, 'b', 'air', k(17, 2));
      w.sites['b-home']!.facilities.push('missile_battery');
      unit(w, 'j', 'a', 'infantry', k(4, 2));
      unit(w, 'e', 'b', 'infantry', k(22, 0));
      const subs = [orders(w, 'a', { j: { type: 'airlift', target: k(15, 2) } }), orders(w, 'b')];
      const r = resolveTurn(w, subs);
      expect(resolveTurn(w, [...subs].reverse()).hash).toBe(r.hash);
      return { lift: lifts(r.events)[0]!, j: r.world.formations.j };
    };
    const seen = new Map<boolean, ReturnType<typeof outcome>>();
    for (let seed = 1; seed < 40 && seen.size < 2; seed++) {
      const o = outcome(seed);
      expect(o.lift.chance).toBe(2 * AIRBORNE.intercept.air);
      expect(outcome(seed)).toEqual(o);
      seen.set(o.lift.hit, o);
    }
    const hit = seen.get(true)!;
    const miss = seen.get(false)!;
    expect(hit.lift.strengthLoss).toBe(AIRBORNE.interceptLoss);
    expect(hit.lift.by).toEqual(['b']);
    expect(miss.lift.strengthLoss).toBe(0);
    expect(hit.j!.strength).toBeLessThan(miss.j!.strength);
  });

  it('is told to the shooters and shown to the player before the order as a risk per landing hex', () => {
    const w = strip();
    unit(w, 'h', 'b', 'air', k(14, 2));
    unit(w, 'j', 'a', 'infantry', k(4, 2));
    unit(w, 's', 'a', 'recon', k(12, 2)); // sees the helicopters
    const r = resolveTurn(w, [orders(w, 'a', { s: { type: 'hold' } })]);
    const view = r.observations.a!;
    const targets = airliftTargets(view, view.formations.j!);
    const near = targets.find((t) => t.key === k(14, 3))!;
    const far = targets.find((t) => t.key === k(5, 0))!;
    expect(near.chance).toBe(AIRBORNE.intercept.air);
    expect(far.chance).toBe(0);
    expect(targets.every((t) => checkAirlift(liftContext(r.world, 'a'), r.world.formations.j!, t.key) === null)).toBe(true);
  });
});

describe('aircraft follow the war', () => {
  it('rebase onto a site the moment it is ours', () => {
    const w = strip();
    site(w, 'prize', k(10, 2), null, 'city', 3);
    unit(w, 'h', 'a', 'air', k(4, 2));
    unit(w, 'j', 'a', 'infantry', k(4, 2));
    expect(checkFormationOrder(w, 'a', 'h', { type: 'move', path: [k(10, 2)] })).toMatch(/own sites/);
    const r = resolveTurn(w, [orders(w, 'a', { j: { type: 'airlift', target: k(10, 2) } })]);
    expect(r.world.sites.prize!.owner).toBe('a');
    expect(checkFormationOrder(r.world, 'a', 'h', { type: 'move', path: [k(10, 2)] })).toBeNull();
    const r2 = resolveTurn(r.world, [orders(r.world, 'a', { h: { type: 'move', path: [k(10, 2)] } })]);
    expect(r2.world.formations.h!.key).toBe(k(10, 2));
  });
});

describe('right of passage', () => {
  function peaceful() {
    const w = strip();
    setRelation(w, 'a', 'b', 'peace');
    // b's land reaches west to q 6 so a's troops walk straight into it.
    for (let q = 6; q < 16; q++) for (let r = 0; r < 6; r++) w.tiles[k(q, r)]!.owner = 'b';
    site(w, 'b-field', k(9, 2), 'b', 'city', 5);
    return w;
  }

  it('is signed when both offer it, between powers at peace, never at war or between allies', () => {
    const w = peaceful();
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_passage' }] }), orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_passage' }] })]);
    const t = r.world.treaties.find((x) => x.kind === 'passage')!;
    expect(t).toMatchObject({ a: 'a', b: 'b', until: w.turn + PASSAGE.turns - 1 });
    expect(hasPassage(r.world, 'a', 'b')).toBe(true);
    const war = makeWorld(4, 4, ['a', 'b']);
    expect(rejected(war, orders(war, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_passage' }] })).length).toBe(1);
    war.relations[pairKey('a', 'b')] = 'alliance';
    expect(rejected(war, orders(war, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_passage' }] })).map((e) => e.kind === 'order_rejected' && e.reason)).toEqual([expect.stringMatching(/ally/)]);
  });

  it('lets the grantee march through and supply across the grantor land, and its aircraft base there', () => {
    const w = peaceful();
    unit(w, 'i', 'a', 'infantry', k(5, 2));
    unit(w, 'h', 'a', 'air', k(4, 2));
    const path = [k(6, 2), k(7, 2), k(8, 2)];
    const without = resolveTurn(w, [orders(w, 'a', { i: { type: 'move', path } })]);
    expect(without.world.formations.i!.key).toBe(k(5, 2));
    expect(checkFormationOrder(w, 'a', 'h', { type: 'move', path: [k(9, 2)] })).toMatch(/own sites/);
    expect(supplyDistances(w, 'a').has(k(8, 2))).toBe(false);
    w.treaties.push({ kind: 'passage', a: 'a', b: 'b', from: 1, until: 8 });
    const r = resolveTurn(w, [orders(w, 'a', { i: { type: 'move', path }, h: { type: 'move', path: [k(9, 2)] } })]);
    expect(r.world.formations.i!.key).toBe(k(8, 2));
    expect(r.world.formations.h!.key).toBe(k(9, 2));
    expect(supplyDistances(r.world, 'a').has(k(8, 2))).toBe(true);
    // It takes no ground: the hexes stay b's.
    expect(r.world.tiles[k(8, 2)]!.owner).toBe('b');
  });

  it('ends at war', () => {
    const w = peaceful();
    w.treaties.push({ kind: 'passage', a: 'a', b: 'b', from: 1, until: 8 });
    const r = resolveTurn(w, [orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'declare_war' }] })]);
    expect(r.world.treaties.some((t) => t.kind === 'passage')).toBe(false);
    expect(r.events.some((e) => e.kind === 'treaty_ended' && e.treaty === 'passage' && e.reason === 'war')).toBe(true);
  });

  it('is public: a third power sees it', () => {
    const w = makeWorld(6, 4, ['a', 'b', 'c']);
    setRelation(w, 'a', 'b', 'peace');
    w.treaties.push({ kind: 'passage', a: 'a', b: 'b', from: 1, until: 8 });
    expect(buildView(w, 'c').treaties.some((t) => t.kind === 'passage')).toBe(true);
  });
});
