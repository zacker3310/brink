import { describe, expect, it } from 'vitest';
import { RULES } from '@brink/game-data';
import type { Ledger, Stockpile, WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { hexKey, rangeKeys } from '@brink/map';
import { makeWorld, orders, own, setRelation, setTerrain, site, unit } from './fixture.test-util';
import { buildView, computeVision } from './fog';
import { hashState } from './hash';
import { resolveTurn } from './resolve';
import { supplyDistances } from './supply';

const k = hexKey;

function ledgerOf(events: ReturnType<typeof resolveTurn>['events'], nation: string): Ledger {
  const e = events.find((x) => x.kind === 'economy' && x.nation === nation);
  if (e?.kind !== 'economy') throw new Error('no ledger');
  return e.ledger;
}

describe('economy', () => {
  it('balances every stockpile against the ledger', () => {
    const w = makeWorld();
    own(w, 'a', rangeKeys(k(0, 0), 2).filter((key) => w.tiles[key]));
    unit(w, 'a1', 'a', 'armor', k(1, 1), { fuel: 40, ammunition: 30 });
    unit(w, 'a2', 'a', 'infantry', k(0, 1));
    const before = { ...w.nations.a!.stockpile };
    const r = resolveTurn(w, [orders(w, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'infantry' }], budget: { research: 20, infrastructure: 10, welfare: 10 } })]);
    const l = ledgerOf(r.events, 'a');
    const after = r.world.nations.a!.stockpile;
    for (const res of RESOURCES) {
      const expected = before[res] + l.income[res] - l.upkeep[res] - l.production[res] - l.logistics[res] - l.spending[res];
      expect(after[res], res).toBe(expected);
      expect(after[res]).toBeGreaterThanOrEqual(0);
    }
    expect(l.production.credits).toBeGreaterThan(0);
    expect(l.logistics.energy + l.logistics.materials).toBeGreaterThan(0);
  });

  it('never goes negative; unpaid upkeep is a shortage', () => {
    const w = makeWorld();
    const empty: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
    w.nations.a!.stockpile = empty;
    w.sites['a-home']!.yields = { credits: 0, energy: 0, materials: 0, food: 0, industry: 0, research: 0 };
    for (let i = 0; i < 3; i++) unit(w, `a${i}`, 'a', 'armor', k(0, 1));
    const r = resolveTurn(w, []);
    const l = ledgerOf(r.events, 'a');
    for (const res of RESOURCES) expect(r.world.nations.a!.stockpile[res]).toBeGreaterThanOrEqual(0);
    expect(l.shortages).toContain('credits');
    expect(r.world.nations.a!.stability).toBeLessThan(60);
  });

  it('builds recruited formations with industrial capacity', () => {
    const w = makeWorld();
    w.nations.a!.industrialCapacity = 100;
    const r = resolveTurn(w, [orders(w, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'infantry' }] })]);
    const made = r.events.find((e) => e.kind === 'production');
    expect(made).toMatchObject({ nation: 'a', unitClass: 'infantry', key: k(0, 0) });
  });

  it('researches the chosen technology', () => {
    const w = makeWorld();
    // The home city makes 2 research; Union's -10% leaves 1.
    w.nations.a!.research.progress = 119;
    const r = resolveTurn(w, [orders(w, 'a', {}, { research: 'logistics_doctrine' })]);
    expect(r.world.nations.a!.research.unlocked).toEqual(['logistics_doctrine']);
  });
});

describe('supply', () => {
  it('reaches through own territory and is cut by the enemy', () => {
    const w = makeWorld(8, 3);
    own(w, 'a', Object.keys(w.tiles).filter((key) => w.tiles[key]!.q <= 5));
    unit(w, 'a1', 'a', 'infantry', k(5, 1));
    expect(supplyDistances(w, 'a').has(k(5, 1))).toBe(true);
    // Enemies across every route.
    for (let r = 0; r < 3; r++) unit(w, `b${r}`, 'b', 'infantry', k(3, r));
    expect(supplyDistances(w, 'a').has(k(5, 1))).toBe(false);
    const res = resolveTurn(w, []);
    expect(res.world.formations.a1!.supply).toBe(0);
    expect(res.events.some((e) => e.kind === 'supply' && e.formation === 'a1')).toBe(true);
  });

  it('gives high-priority formations their share first when capacity is short', () => {
    const w = makeWorld();
    own(w, 'a', Object.keys(w.tiles));
    // A city gives 30 capacity; ten infantry demand 40.
    for (let i = 0; i < 10; i++) unit(w, `a${i}`, 'a', 'infantry', k(1 + (i % 3), 1 + Math.floor(i / 3)));
    const r = resolveTurn(w, [orders(w, 'a', {}, { supplyPriority: { a0: 'high', a9: 'low' } })]);
    expect(r.world.formations.a0!.supply).toBe(100);
    expect(r.world.formations.a9!.supply).toBeLessThan(r.world.formations.a0!.supply);
  });
});

describe('fog of war', () => {
  it('views contain no enemy formation outside vision', () => {
    const w = makeWorld(12, 6);
    unit(w, 'a1', 'a', 'infantry', k(1, 1));
    unit(w, 'b1', 'b', 'infantry', k(2, 1));
    unit(w, 'b2', 'b', 'armor', k(9, 3));
    const view = buildView(w, 'a');
    expect(Object.keys(view.formations)).toEqual(['a1']);
    expect(Object.keys(view.contacts)).toEqual(['b1']);
    expect(view.contacts.b1!.confirmed).toBe(true);
    expect(view.tiles[k(10, 4)]!.visibility).toBe('unknown');
    expect(view.tiles[k(10, 4)]!.terrain).toBeNull();
    // Exact strength never leaks.
    expect(JSON.stringify(view)).not.toContain('"strength":1000,"organization":80,"morale":70,"readiness":100,"fuel":100,"ammunition":100,"experience":0,"entrenchment":0,"supplyPriority":"normal","supply":100,"lastOrder":"hold","owner":"b"');
  });

  it('formations in cover are only detected up close or by reconnaissance', () => {
    const w = makeWorld(12, 6);
    setTerrain(w, k(4, 2), 'forest');
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    unit(w, 'b1', 'b', 'infantry', k(4, 2));
    expect(buildView(w, 'a').contacts.b1).toBeUndefined();
    unit(w, 'r1', 'a', 'recon', k(1, 3));
    expect(buildView(w, 'a').contacts.b1?.confirmed).toBe(true);
  });

  it('keeps last-known positions, marked unconfirmed', () => {
    const w = makeWorld(12, 6);
    unit(w, 'a1', 'a', 'infantry', k(1, 2));
    unit(w, 'b1', 'b', 'recon', k(3, 2));
    const r = resolveTurn(w, [orders(w, 'b', { b1: { type: 'withdraw', path: [k(4, 2), k(5, 2), k(6, 2), k(7, 2), k(8, 2), k(9, 2), k(10, 2)] } })]);
    const c = r.observations.a!.contacts.b1;
    expect(c).toBeUndefined();
    // Seen at the start of the turn? The sighting is recorded at the end of each turn only.
    const w2 = r.world;
    w2.formations.b1!.key = k(3, 2);
    const seen = resolveTurn(w2, []);
    const w3 = seen.world;
    w3.formations.b1!.key = k(10, 4);
    const view = buildView(w3, 'a', computeVision(w3, 'a'));
    expect(view.contacts.b1).toMatchObject({ confirmed: false, key: k(3, 2) });
  });
});

describe('victory and diplomacy', () => {
  it('ends the match when one nation holds the victory threshold', () => {
    const w = makeWorld();
    site(w, 'obj', k(4, 3), null, 'objective', 20);
    unit(w, 'a1', 'a', 'infantry', k(3, 3));
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(4, 3)] } })]);
    expect(r.world.victory).toMatchObject({ winner: 'a', reason: 'victory_points' });
    expect(() => resolveTurn(r.world, [])).toThrow(/over/);
  });

  it('last nation standing wins', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(6, 5));
    w.sites['a-home']!.victoryPoints = 1;
    w.sites['b-home']!.victoryPoints = 1;
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(7, 5)] } })]);
    expect(r.world.nations.b!.eliminated).toBe(true);
    expect(r.world.victory).toMatchObject({ winner: 'a', reason: 'last_standing' });
  });

  it('the turn limit decides on the strategic score, then victory points', () => {
    const w = makeWorld();
    w.turn = 30;
    w.sites['a-home']!.victoryPoints = 4;
    // An unheld objective keeps both below the victory-point threshold.
    site(w, 'obj', k(4, 3), null, 'objective', 10);
    const r = resolveTurn(w, []);
    expect(r.world.victory).toMatchObject({ winner: 'b', reason: 'turn_limit' });
  });

  it('peace needs both sides; declarations are immediate', () => {
    const w = makeWorld();
    const one = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_peace' }] })]);
    expect(one.world.relations['a|b']).toBe('war');
    expect(one.world.proposals).toHaveLength(1);
    const two = resolveTurn(one.world, [orders(one.world, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_peace' }] })]);
    expect(two.world.relations['a|b']).toBe('peace');
    setRelation(two.world, 'a', 'b', 'peace');
    const three = resolveTurn(two.world, [orders(two.world, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    expect(three.world.relations['a|b']).toBe('war');
  });

  it('perfidy: breaking a peace or an alliance costs the declarer stability, open war does not', () => {
    const declare = (rel: 'war' | 'peace' | 'alliance') => {
      const w = makeWorld(8, 6, ['a', 'b', 'c']);
      setRelation(w, 'a', 'b', rel);
      const before = w.nations.a!.stability;
      const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: rel === 'war' ? [] : [{ target: 'b', action: 'declare_war' }] })]);
      return { drop: before - r.world.nations.a!.stability, victim: r.world.nations.b!.stability - w.nations.b!.stability };
    };
    const baseline = declare('war').drop;
    expect(declare('peace').drop - baseline).toBe(RULES.perfidy.peace);
    expect(declare('alliance').drop - baseline).toBe(RULES.perfidy.alliance);
  });

  it('war breaking out between co-located nations pushes the trespasser off the host ground', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    own(w, 'b', [k(4, 3), k(5, 3)]);
    unit(w, 'b1', 'b', 'infantry', k(4, 3));
    unit(w, 'a1', 'a', 'infantry', k(4, 3));
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    expect(r.world.relations['a|b']).toBe('war');
    expect(r.world.formations.b1!.key).toBe(k(4, 3));
    expect(r.world.formations.a1!.key).not.toBe(k(4, 3));
    expect(r.events.some((e) => e.kind === 'retreat' && e.formation === 'a1')).toBe(true);
  });
});

describe('determinism', () => {
  function busyWorld(): WorldState {
    const w = makeWorld(10, 8, ['a', 'b', 'c']);
    unit(w, 'a1', 'a', 'armor', k(3, 3));
    unit(w, 'a2', 'a', 'artillery', k(2, 3));
    unit(w, 'b1', 'b', 'infantry', k(4, 3));
    unit(w, 'b2', 'b', 'mechanized', k(5, 2));
    unit(w, 'c1', 'c', 'infantry', k(5, 3));
    return w;
  }
  const subs = (w: WorldState) => [
    orders(w, 'a', { a1: { type: 'attack', target: k(4, 3), path: [] }, a2: { type: 'attack', target: k(4, 3), path: [] } }),
    orders(w, 'b', { b2: { type: 'move', path: [k(5, 3)] }, b1: { type: 'defend' } }),
    orders(w, 'c', { c1: { type: 'attack', target: k(4, 3), path: [] } }),
  ];

  it('the same inputs give the same world and hash, and the input is untouched', () => {
    const w = busyWorld();
    const before = hashState(w);
    const r1 = resolveTurn(w, subs(w));
    const r2 = resolveTurn(w, subs(w));
    expect(r1.hash).toBe(r2.hash);
    expect(r1.events).toEqual(r2.events);
    expect(hashState(w)).toBe(before);
  });

  it('submission order and key order do not change the result', () => {
    const w = busyWorld();
    const r1 = resolveTurn(w, subs(w));
    const reversed = subs(w).reverse().map((o) => ({ ...o, formations: Object.fromEntries(Object.entries(o.formations).reverse()) }));
    const r2 = resolveTurn(w, reversed);
    expect(r2.hash).toBe(r1.hash);
    // Rebuild the world with formations inserted in reverse.
    const w2 = JSON.parse(JSON.stringify(w)) as WorldState;
    w2.formations = Object.fromEntries(Object.entries(w2.formations).reverse());
    expect(resolveTurn(w2, subs(w2)).hash).toBe(r1.hash);
  });

  it('a different seed can change the dice', () => {
    const w = busyWorld();
    const hashes = new Set<string>();
    for (let s = 1; s <= 5; s++) hashes.add(resolveTurn({ ...w, seed: s }, subs(w)).hash);
    expect(hashes.size).toBeGreaterThan(1);
  });
});
