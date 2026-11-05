import { describe, expect, it } from 'vitest';
import { createPacificScenario } from '@brink/scenarios';
import { UNITS } from '@brink/game-data';
import { buildView, lockOrders, resolveTurn, sortedKeys } from '@brink/simulation';
import type { WorldState } from '@brink/contracts';
import { emptyMemory, operationById, planOrders, proposeOperations } from './index';

const siteNamed = (w: WorldState, name: string) => Object.values(w.sites).find((s) => s.name === name)!;

/** Play `me` with the operation's target, everyone else on their own plan; the turn the prize fell, or null. */
function run(seed: number, me: string, prize: string, turns: number): { fell: number | null; rejected: number } {
  let w = createPacificScenario(seed);
  const site = siteNamed(w, prize);
  let rejected = 0;
  for (let t = 0; t < turns && !w.victory; t++) {
    const subs = sortedKeys(w.nations)
      .filter((n) => !w.nations[n]!.eliminated)
      .map((n) => planOrders(buildView(w, n), emptyMemory(), w.seed, n === me ? { target: site.id } : {}));
    rejected += lockOrders(w, subs).rejected.filter((e) => e.kind === 'order_rejected' && e.nation === me).length;
    w = resolveTurn(w, subs).world;
    if (w.sites[site.id]!.owner === me) return { fell: w.turn - 1, rejected };
  }
  return { fell: null, rejected };
}

describe('operations', () => {
  it('proposes named, phased operations from the player view, deterministically', () => {
    const w = createPacificScenario(1);
    const view = buildView(w, 'china');
    const ops = proposeOperations(view, 4);
    expect(ops.length).toBeGreaterThan(1);
    expect(proposeOperations(JSON.parse(JSON.stringify(view)), 4)).toEqual(ops);
    expect(new Set(ops.map((o) => o.kind))).toEqual(new Set(['overland', 'amphibious']));
    for (const o of ops) {
      expect(o.codename).toMatch(/^Operation \w+ \w+$/);
      expect(o.phases.filter((p) => p.state === 'now').length).toBeGreaterThan(0);
      expect(o.army.every((id) => view.formations[id] && UNITS[view.formations[id]!.unitClass].ground)).toBe(true);
      expect(o.turns).toBeGreaterThan(0);
    }
    const taipei = operationById(view, `take:${siteNamed(w, 'Taipei').id}`)!;
    expect(taipei.kind).toBe('amphibious');
    expect(taipei.phases.map((p) => p.id)).toEqual(['assemble', 'embark', 'sail', 'shape', 'land', 'assault']);
  });

  it('a launched landing is carried through to the prize with every order accepted', () => {
    const china = run(1, 'china', 'Taipei', 12);
    expect(china.rejected).toBe(0);
    expect(china.fell).not.toBeNull();
    // A landing across the ocean onto a great power's coast: Petropavlovsk, on Kamchatka (it falls on
    // turn 12).
    const usa = run(1, 'usa', 'Petropavlovsk', 16);
    expect(usa.rejected).toBe(0);
    expect(usa.fell).not.toBeNull();
    // And onto the home islands themselves: a US landing on Hokkaido takes Sapporo (turn 9), and
    // Japan's army takes it back about ten turns later. From ruleset 2.7.0 to 2.8.0 no lone US
    // landing took a Japanese city in 30 turns: the US staff sailed its troops in ones and twos,
    // built no lift to follow them (and what it built, it built at Houston, on a sea with no way to
    // the Pacific), and stormed the city with whatever stood at its gates. Since 2.9.0 an operation
    // across the sea builds lift for eight formations on the fleet's own sea, a transport fills
    // before it sails, a city is stormed only in mass, and a dug-in garrison counts for less.
    // Tokyo, Sendai, Nagoya, Osaka and Fukuoka still hold.
    const japanHome = run(1, 'usa', 'Sapporo', 20);
    expect(japanHome.rejected).toBe(0);
    expect(japanHome.fell).not.toBeNull();
    // And the island power carries its own landing across the ocean: Honolulu falls on turn 13.
    // (Seattle, on the US mainland, now holds for 30 turns.)
    const japan = run(1, 'japan', 'Honolulu', 22);
    expect(japan.rejected).toBe(0);
    expect(japan.fell).not.toBeNull();
  }, 300_000);

  it('keeps a landing a landing once troops are ashore, and ends when the prize is taken', () => {
    const w = createPacificScenario(1);
    const taipei = siteNamed(w, 'Taipei');
    const id = `take:${taipei.id}`;
    // Put a Chinese unit ashore next to Taipei.
    const unit = Object.values(w.formations).find((f) => f.owner === 'china' && f.aboard)!;
    const beach = Object.values(w.tiles).find((t) => t.owner === 'taiwan' && t.terrain !== 'water' && !t.siteId)!;
    delete unit.aboard;
    unit.key = beach.key;
    const op = operationById(buildView(w, 'china'), id, 'amphibious')!;
    expect(op.kind).toBe('amphibious');
    expect(op.phases.find((p) => p.id === 'land')!.state).toBe('done');
    expect(op.phases.find((p) => p.id === 'assault')!.state).toBe('now');
    w.sites[taipei.id]!.owner = 'china';
    w.tiles[taipei.key]!.owner = 'china';
    expect(operationById(buildView(w, 'china'), id)).toBeNull();
  });

  it('tells the player to play a beach-landing card in hand on the landing turn', () => {
    const w = createPacificScenario(1);
    const id = `take:${siteNamed(w, 'Taipei').id}`;
    const tip = (o: { why: string[] }) => o.why.filter((l) => l.includes('landing turn'));
    w.nations.china!.doctrine = { cp: 3, hand: ['dig_in', 'requisition'], deck: [], discard: [], effects: [] };
    expect(tip(operationById(buildView(w, 'china'), id)!)).toEqual([]);
    w.nations.china!.doctrine!.hand = ['dig_in', 'joint_island_landing'];
    expect(tip(operationById(buildView(w, 'china'), id)!)).toEqual(['Play Joint Island Landing on the landing turn: no beach penalty for the troops going ashore']);
    // Overland operations never mention it.
    for (const o of proposeOperations(buildView(w, 'china'), 4)) if (o.kind === 'overland') expect(tip(o)).toEqual([]);
  });

  it('asks for an amphibious group when there is none, at a port it holds', () => {
    const w = createPacificScenario(1);
    for (const f of Object.values(w.formations)) {
      if (f.owner !== 'china') continue;
      if (UNITS[f.unitClass].carries === 'ground') delete w.formations[f.id];
    }
    for (const f of Object.values(w.formations)) if (f.owner === 'china' && f.aboard && !w.formations[f.aboard]) delete f.aboard;
    const op = operationById(buildView(w, 'china'), `take:${siteNamed(w, 'Taipei').id}`)!;
    expect(op.phases[0]!.id).toBe('lift');
    expect(op.needs?.unitClass).toBe('transport');
    expect(w.sites[op.needs!.siteId]!.owner).toBe('china');
    expect(w.tiles[w.sites[op.needs!.siteId]!.key]!.port).toBe(true);
  });

  it('ignores a target that is no prize: the plan is the same as without one', () => {
    const w = createPacificScenario(2);
    const view = buildView(w, 'china');
    const home = Object.values(view.sites).find((s) => s.owner === 'china')!;
    expect(planOrders(view, emptyMemory(), 3, { target: home.id })).toEqual(planOrders(view, emptyMemory(), 3));
  });
});
