import { describe, expect, it } from 'vitest';
import { FACILITIES, FORTRESS_ENTRENCHMENT, RULES } from '@brink/game-data';
import { RESOURCES } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { makeWorld, orders, site, unit } from './fixture.test-util';
import { grossYields } from './economy';
import { resolveTurn } from './resolve';
import { clone } from './rules';

const k = hexKey;

describe('facilities', () => {
  it('pays the cost up front and builds with industry, then yields', () => {
    const w = makeWorld();
    w.nations.a!.industrialCapacity = 20;
    const before = { ...w.nations.a!.stockpile };
    const r = resolveTurn(w, [orders(w, 'a', {}, { build: [{ siteId: 'a-home', facility: 'farm' }] })]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'construction_queued', site: 'a-home', facility: 'farm' }));
    const prod = r.events.find((e) => e.kind === 'economy' && e.nation === 'a');
    if (prod?.kind !== 'economy') throw new Error('no ledger');
    for (const res of RESOURCES) expect(prod.ledger.production[res]).toBe(FACILITIES.farm.cost[res]);
    expect(r.world.nations.a!.stockpile.credits).toBeLessThan(before.credits);
    // 30 industry needed at 20 a turn: done on the second turn.
    expect(r.world.nations.a!.construction[0]).toMatchObject({ facility: 'farm', progress: 20, required: 30 });
    const food = grossYields(r.world, 'a').income.food;
    const r2 = resolveTurn(r.world, []);
    expect(r2.events).toContainEqual(expect.objectContaining({ kind: 'facility_built', site: 'a-home', facility: 'farm' }));
    expect(r2.world.sites['a-home']!.facilities).toEqual(['farm']);
    // At least the farm's 12; the Agrarian Union's food bonus applies on top.
    expect(grossYields(r2.world, 'a').income.food).toBeGreaterThanOrEqual(food + FACILITIES.farm.yields.food!);
  });

  it('construction takes industry before the unit queue', () => {
    const w = makeWorld();
    w.nations.a!.industrialCapacity = 30;
    const r = resolveTurn(w, [orders(w, 'a', {}, { build: [{ siteId: 'a-home', facility: 'farm' }], recruit: [{ siteId: 'a-home', unitClass: 'infantry' }] })]);
    expect(r.events.some((e) => e.kind === 'production')).toBe(false);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'facility_built', facility: 'farm' }));
  });

  it('refuses what the rules forbid', () => {
    const w = makeWorld();
    w.sites['a-home']!.facilities = ['farm', 'mine'];
    site(w, 'b-depot', k(3, 3), 'b', 'depot');
    const r = resolveTurn(w, [
      orders(w, 'a', {}, {
        build: [
          { siteId: 'a-home', facility: 'farm' },
          { siteId: 'b-depot', facility: 'mine' },
        ],
      }),
    ]);
    const why = r.events.filter((e) => e.kind === 'order_rejected').map((e) => (e.kind === 'order_rejected' ? e.reason : ''));
    expect(why).toEqual([expect.stringContaining('already has'), expect.stringContaining('not under your control')]);
    // Factories need Industrial Automation.
    const w2 = makeWorld();
    const r2 = resolveTurn(w2, [orders(w2, 'a', {}, { build: [{ siteId: 'a-home', facility: 'factory' }] })]);
    expect(r2.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', reason: expect.stringContaining('Industrial Automation') }));
    // A city has three slots.
    const w3 = makeWorld();
    w3.sites['a-home']!.facilities = ['farm', 'mine', 'power_plant'];
    const r3 = resolveTurn(w3, [orders(w3, 'a', {}, { build: [{ siteId: 'a-home', facility: 'research_lab' }] })]);
    expect(r3.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', reason: expect.stringContaining('no room') }));
  });

  it('recruits and buildings share one budget: nothing is overspent', () => {
    const w = makeWorld();
    w.nations.a!.stockpile = { credits: 100, energy: 50, materials: 50, food: 50 };
    site(w, 'a-depot', k(1, 0), 'a', 'depot');
    const r = resolveTurn(w, [orders(w, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'infantry' }], build: [{ siteId: 'a-depot', facility: 'farm' }] })]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'order_rejected', reason: expect.stringContaining('insufficient resources for a farm') }));
    for (const res of RESOURCES) expect(r.world.nations.a!.stockpile[res]).toBeGreaterThanOrEqual(0);
  });

  it('work at a captured site is lost; standing facilities change hands', () => {
    const w = makeWorld();
    site(w, 'a-depot', k(3, 2), 'a', 'depot');
    w.sites['a-depot']!.facilities = ['mine'];
    w.nations.a!.construction = [{ id: 'c99', siteId: 'a-depot', facility: 'farm', progress: 5, required: 30 }];
    w.sites['a-depot']!.owner = 'b';
    w.tiles[k(3, 2)]!.owner = 'b';
    const r = resolveTurn(w, []);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'construction_cancelled', item: 'c99', reason: 'site lost' }));
    expect(r.world.nations.a!.construction).toEqual([]);
    expect(r.world.sites['a-depot']!.facilities).toEqual(['mine']);
    expect(grossYields(r.world, 'b').income.materials).toBeGreaterThan(grossYields(r.world, 'a').income.materials);
  });

  it('a fortress keeps its garrison dug in, even after a bombardment', () => {
    const w = makeWorld();
    w.sites['a-home']!.facilities = ['fortress'];
    unit(w, 'a1', 'a', 'infantry', k(0, 0), { entrenchment: 0 });
    unit(w, 'b1', 'b', 'artillery', k(2, 0));
    const r = resolveTurn(w, [orders(w, 'b', { b1: { type: 'attack', target: k(0, 0), path: [] } })]);
    expect(r.events.some((e) => e.kind === 'strike')).toBe(true);
    expect(r.world.formations.a1!.entrenchment).toBeGreaterThanOrEqual(FORTRESS_ENTRENCHMENT);
    expect(RULES.strikeEntrenchment).toBeGreaterThan(0);
  });

  it('upkeep is paid for every facility', () => {
    const w = makeWorld();
    const base = resolveTurn(clone(w), []);
    w.sites['a-home']!.facilities = ['power_plant'];
    const r = resolveTurn(w, []);
    const up = (x: typeof r) => {
      const e = x.events.find((ev) => ev.kind === 'economy' && ev.nation === 'a');
      return e?.kind === 'economy' ? e.ledger.upkeep.credits : -1;
    };
    expect(up(r) - up(base)).toBe(FACILITIES.power_plant.upkeep.credits);
  });
});
