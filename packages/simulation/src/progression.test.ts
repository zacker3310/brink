import { describe, expect, it } from 'vitest';
import type { Formation, NationView, WorldState } from '@brink/contracts';
import { BRANCHES, CITY_GROWTH, DOCTRINE, FACILITIES, FACILITY_ORDER, FACILITY_SLOTS, LEVEL_YIELDS, TECH_BRANCHES, TECH_IDS, TECHS } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { defenderPower, strikeLoss, type AssaultContext } from './combat';
import { initDoctrine, marchBonus } from './doctrine';
import { grossYields } from './economy';
import { buildView, computeVision } from './fog';
import { hashState } from './hash';
import { makeWorld, orders, own, setTerrain, site, unit } from './fixture.test-util';
import { buildBlocker, initProgression, cityLevel, facilityCost, facilitySlots, growCities, progressionSupport, researchRate, siteDefense, techMovement } from './progression';
import { resolveTurn } from './resolve';
import { nationModifiers } from './rules';
import { supplyCapacity } from './supply';
import { checkResearch } from './validate';

// Civ-style progression: the research tree, city development and the facilities research unlocks.

const k = hexKey;

/** a's home a capital in the west, b's in the east; even points so no turn ends the match. */
function world(): WorldState {
  const w = makeWorld(10, 8, ['a', 'b']);
  w.sites['a-home']!.kind = 'capital';
  own(w, 'a', [0, 1, 2].flatMap((q) => [0, 1, 2, 3, 4, 5, 6, 7].map((r) => k(q, r))));
  for (const id of Object.keys(w.sites)) w.sites[id]!.victoryPoints = 5;
  return w;
}

describe('the research tree', () => {
  it('has five branches and 16 to 24 technologies, every prerequisite real, nothing circular', () => {
    expect(TECH_BRANCHES).toHaveLength(5);
    expect(TECH_IDS.length).toBeGreaterThanOrEqual(16);
    expect(TECH_IDS.length).toBeLessThanOrEqual(24);
    for (const b of TECH_BRANCHES) {
      expect(BRANCHES[b].name.length).toBeGreaterThan(2);
      expect(TECH_IDS.filter((t) => TECHS[t]!.branch === b).length).toBeGreaterThanOrEqual(3);
    }
    const depth = (t: string, seen: string[] = []): number => {
      expect(seen).not.toContain(t);
      const def = TECHS[t]!;
      return 1 + Math.max(0, ...def.requires.map((r) => depth(r, [...seen, t])));
    };
    for (const t of TECH_IDS) {
      const def = TECHS[t]!;
      expect(Number.isInteger(def.cost) && def.cost > 0, t).toBe(true);
      for (const r of def.requires) expect(TECHS[r], `${t} needs ${r}`).toBeDefined();
      expect(depth(t)).toBeLessThanOrEqual(5);
      expect(def.gives.length).toBeGreaterThan(10);
    }
    // Every facility that needs research names a technology that exists.
    for (const f of FACILITY_ORDER) if (FACILITIES[f].requires) expect(TECHS[FACILITIES[f].requires!], f).toBeDefined();
  });

  it('every prerequisite must be done first, all of them', () => {
    const w = world();
    expect(checkResearch(w, 'a', 'heavy_armour')).toBe('prerequisites not met');
    w.nations.a!.research.unlocked = ['logistics_doctrine', 'combined_arms', 'mobile_warfare'];
    expect(checkResearch(w, 'a', 'heavy_armour')).toBe('prerequisites not met');
    w.nations.a!.research.unlocked = ['active_protection', 'combined_arms', 'composite_armor', 'industrial_automation', 'logistics_doctrine', 'mobile_warfare'];
    expect(checkResearch(w, 'a', 'heavy_armour')).toBeNull();
  });

  it('a finished technology is announced and its effects apply at once', () => {
    const w = world();
    w.nations.a!.research.progress = TECHS.staff_college!.cost;
    const r = resolveTurn(w, [orders(w, 'a', {}, { research: 'staff_college' })]);
    expect(r.events).toContainEqual({ kind: 'research', nation: 'a', tech: 'staff_college' });
    expect(nationModifiers(r.world.nations.a!).handSize).toBe(1);
  });
});

describe('research reaches the rest of the game', () => {
  it('Mobile Warfare: armour moves further; Naval Engineering: ships do; nothing else does', () => {
    const tank = { unitClass: 'armor' as const };
    const ship = { unitClass: 'fleet' as const };
    const foot = { unitClass: 'infantry' as const };
    expect(techMovement(['mobile_warfare'], tank)).toBe(1);
    expect(techMovement(['mobile_warfare'], foot)).toBe(0);
    expect(techMovement(['mobile_warfare'], { ...tank, aboard: 't1' })).toBe(0);
    expect(techMovement(['naval_engineering', 'blue_water_navy'], ship)).toBe(2);
    const w = world();
    w.nations.a!.research.unlocked = ['mobile_warfare'];
    expect(marchBonus(w.nations.a!, w.turn, tank)).toBe(1);
    expect(marchBonus(w.nations.a!, w.turn, foot)).toBe(0);
  });

  it('Mobile Warfare makes a longer tank move legal and it is walked', () => {
    const w = world();
    unit(w, 'a1', 'a', 'armor', k(0, 3));
    // Armour has 10 movement points at full readiness; four plains (8) and a forest (3) are one too many.
    setTerrain(w, k(5, 3), 'forest');
    const path = [k(1, 3), k(2, 3), k(3, 3), k(4, 3), k(5, 3)];
    const without = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path } })]);
    expect(without.events.some((e) => e.kind === 'order_rejected' && e.formation === 'a1')).toBe(true);
    w.nations.a!.research.unlocked = ['combined_arms', 'logistics_doctrine', 'mobile_warfare'];
    const withTech = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path } })]);
    expect(withTech.events.some((e) => e.kind === 'order_rejected')).toBe(false);
    expect(withTech.world.formations.a1!.key).toBe(k(5, 3));
  });

  it('Staff College: the hand fills to four; Command Networks: a Command Point more a turn', () => {
    const w = world();
    initDoctrine(w);
    w.nations.a!.research.unlocked = ['signals_intelligence', 'staff_college', 'command_networks'];
    const cpA = w.nations.a!.doctrine!.cp;
    const cpB = w.nations.b!.doctrine!.cp;
    const r = resolveTurn(w, []);
    expect(r.world.nations.a!.doctrine!.hand).toHaveLength(DOCTRINE.handSize + 1);
    expect(r.world.nations.b!.doctrine!.hand).toHaveLength(DOCTRINE.handSize);
    // a holds a capital, b a city: a's base income is one more already.
    expect(r.world.nations.a!.doctrine!.cp - cpA - (r.world.nations.b!.doctrine!.cp - cpB)).toBe(1 + DOCTRINE.cpPerCapital);
  });

  it('naval research makes ships hit harder and hold better; armour research hits harder', () => {
    const w = world();
    const fleet = unit(w, 'af', 'a', 'fleet', k(5, 7));
    const victim = unit(w, 'bi', 'b', 'infantry', k(5, 6));
    const base = { terrain: 'plains' as const, spotted: true, sourceMods: nationModifiers(w.nations.a!) };
    const plain = strikeLoss(fleet, victim, base, 100);
    w.nations.a!.research.unlocked = ['littoral_warfare', 'naval_engineering'];
    expect(strikeLoss(fleet, victim, { ...base, sourceMods: nationModifiers(w.nations.a!) }, 100)).toBeGreaterThan(plain);
    const ctx = (mods: ReturnType<typeof nationModifiers>): AssaultContext => ({
      terrain: 'plains',
      river: false,
      tileOwner: null,
      spotted: true,
      airSupport: false,
      artillerySupport: false,
      attackerMods: mods,
      defenderMods: () => mods,
      defending: () => false,
    });
    const before = defenderPower([fleet], ctx(nationModifiers({ ...w.nations.a!, research: { current: null, progress: 0, unlocked: [] } })));
    w.nations.a!.research.unlocked = ['carrier_aviation'];
    expect(defenderPower([fleet], ctx(nationModifiers(w.nations.a!)))).toBeGreaterThan(before);
  });

  it('Urban Planning makes buildings cheaper, and the discount is what the build reserves', () => {
    const w = world();
    const full = facilityCost(w.nations.a!, 'farm');
    expect(full).toEqual(FACILITIES.farm.cost);
    w.nations.a!.research.unlocked = ['industrial_automation', 'urban_planning'];
    const cheap = facilityCost(w.nations.a!, 'farm');
    expect(cheap.credits).toBeLessThan(full.credits);
    const before = w.nations.a!.stockpile.credits;
    const r = resolveTurn(w, [orders(w, 'a', {}, { build: [{ siteId: 'a-home', facility: 'farm' }] })]);
    const ledger = r.events.find((e) => e.kind === 'economy' && e.nation === 'a');
    if (ledger?.kind !== 'economy') throw new Error('no ledger');
    expect(ledger.ledger.production.credits).toBe(cheap.credits);
    expect(r.world.nations.a!.stockpile.credits).toBeLessThan(before);
  });
});

describe('city development', () => {
  it('a held city grows each turn by its base, its facilities and a capital bonus, and levels up', () => {
    const w = world();
    w.sites['a-home']!.facilities = ['farm'];
    const r = resolveTurn(w, []);
    expect(r.world.sites['a-home']!.development).toBe(CITY_GROWTH.base + CITY_GROWTH.perFacility + CITY_GROWTH.capital);
    expect(r.world.sites['b-home']!.development).toBe(CITY_GROWTH.base);
    // One short of the second level: the next turn crosses it and says so to the owner only.
    w.sites['a-home']!.development = CITY_GROWTH.levels[1]! - 1;
    const r2 = resolveTurn(w, []);
    expect(cityLevel(r2.world.sites['a-home']!.development)).toBe(2);
    expect(r2.reports.a!.events).toContainEqual({ kind: 'city_grew', nation: 'a', site: 'a-home', level: 2 });
    expect(r2.reports.b!.events.some((e) => e.kind === 'city_grew')).toBe(false);
  });

  it('a bigger city yields more: credits, industry and research for every level above the first', () => {
    const w = world();
    const small = grossYields(w, 'a');
    w.sites['a-home']!.development = CITY_GROWTH.levels[2]!;
    const big = grossYields(w, 'a');
    // Union: no credit or industry modifier; research is the raw sum here.
    expect(big.research - small.research).toBe(2 * LEVEL_YIELDS.research!);
    expect(big.industry - small.industry).toBe(2 * LEVEL_YIELDS.industry!);
  });

  it('no growth in unrest or hunger; a city taken keeps half its development', () => {
    const w = world();
    w.nations.a!.stability = 20;
    w.sites['a-home']!.development = 40;
    const r = resolveTurn(w, []);
    expect(r.world.sites['a-home']!.development).toBe(40);
    const w2 = world();
    w2.sites['b-home']!.development = 50;
    const events = [{ kind: 'site_captured' as const, site: 'b-home', key: w2.sites['b-home']!.key, from: 'b', to: 'a' }];
    w2.sites['b-home']!.owner = 'a';
    growCities(w2, { b: ['food'] }, events);
    expect(w2.sites['b-home']!.development).toBe(25 + CITY_GROWTH.base);
    expect(events.some((e) => (e.kind as string) === 'city_grew')).toBe(false);
  });

  it('levels three and five each open a facility slot, and the build check reads it', () => {
    const w = world();
    const s = w.sites['b-home']!;
    expect(facilitySlots(s)).toBe(FACILITY_SLOTS.city);
    s.facilities = ['farm', 'mine', 'power_plant'];
    expect(buildBlocker(w, w.nations.b!, 'b-home', 'fortress')).toBe('b-home has no room for another facility');
    s.development = CITY_GROWTH.levels[2]!;
    expect(facilitySlots(s)).toBe(FACILITY_SLOTS.city + 1);
    w.nations.b!.research.unlocked = ['logistics_doctrine'];
    expect(buildBlocker(w, w.nations.b!, 'b-home', 'fortress')).toBeNull();
    s.development = CITY_GROWTH.levels[4]!;
    expect(facilitySlots(s)).toBe(FACILITY_SLOTS.city + 2);
  });

  it('an older world gains development 0 on its cities only, and a second pass changes nothing', () => {
    const w = world();
    site(w, 'a-depot', k(2, 2), 'a', 'depot');
    w.sites['b-home']!.development = 33;
    initProgression(w);
    expect(w.sites['a-home']!.development).toBe(0);
    expect(w.sites['b-home']!.development).toBe(33);
    expect(w.sites['a-depot']!.development).toBeUndefined();
    const once = hashState(w);
    initProgression(w);
    expect(hashState(w)).toBe(once);
  });

  it('the growth phase is one snapshot: site order does not change the world', () => {
    const w = world();
    site(w, 'a-town', k(1, 5), 'a', 'city');
    w.sites['a-home']!.development = 23;
    w.sites['a-town']!.development = 59;
    const r1 = resolveTurn(w, []);
    const w2 = JSON.parse(JSON.stringify(w)) as WorldState;
    w2.sites = Object.fromEntries(Object.entries(w2.sites).reverse());
    const r2 = resolveTurn(w2, []);
    expect(r2.hash).toBe(r1.hash);
    expect(r1.events.filter((e) => e.kind === 'city_grew')).toEqual(r2.events.filter((e) => e.kind === 'city_grew'));
    expect(hashState(w)).toBe(hashState(JSON.parse(JSON.stringify(w)) as WorldState));
  });
});

describe('facilities from research', () => {
  it('a naval yard needs a port and Naval Engineering; it adds supply and industry', () => {
    const w = world();
    expect(buildBlocker(w, w.nations.a!, 'a-home', 'naval_yard')).toBe('a naval yard needs a port');
    w.tiles[w.sites['a-home']!.key]!.port = true;
    expect(buildBlocker(w, w.nations.a!, 'a-home', 'naval_yard')).toBe('Naval yard needs Naval Engineering');
    w.nations.a!.research.unlocked = ['naval_engineering'];
    expect(buildBlocker(w, w.nations.a!, 'a-home', 'naval_yard')).toBeNull();
    const cap = supplyCapacity(w, 'a');
    const ind = grossYields(w, 'a').industry;
    w.sites['a-home']!.facilities = ['naval_yard'];
    expect(supplyCapacity(w, 'a')).toBeGreaterThan(cap);
    expect(grossYields(w, 'a').industry).toBe(ind + FACILITIES.naval_yard.yields.industry!);
  });

  it("a missile battery stiffens its owner's defenders in the hex, nobody else's", () => {
    const w = world();
    const d = unit(w, 'a1', 'a', 'infantry', w.sites['a-home']!.key);
    expect(siteDefense(w.sites['a-home'])).toBeUndefined();
    w.sites['a-home']!.facilities = ['missile_battery'];
    const fort = siteDefense(w.sites['a-home'])!;
    expect(fort).toEqual({ owner: 'a', percent: FACILITIES.missile_battery.defense });
    const mods = nationModifiers(w.nations.a!);
    const ctx = (fortified?: AssaultContext['fortified']): AssaultContext => ({
      terrain: 'plains',
      river: false,
      tileOwner: null,
      spotted: true,
      airSupport: false,
      artillerySupport: false,
      attackerMods: mods,
      defenderMods: () => mods,
      defending: () => false,
      ...(fortified ? { fortified } : {}),
    });
    expect(defenderPower([d], ctx(fort))).toBeGreaterThan(defenderPower([d], ctx()));
    const other: Formation = { ...d, id: 'b1', owner: 'b' };
    expect(defenderPower([other], ctx(fort))).toBe(defenderPower([other], ctx()));
  });
});

describe('support over hand-fought battles', () => {
  function viewOf(w: WorldState, nation: string): NationView {
    return buildView(w, nation, computeVision(w, nation));
  }

  it('technologies bring their missions; naval ones only on the coast', () => {
    const w = world();
    w.nations.a!.research.unlocked = ['air_mobility', 'littoral_warfare', 'naval_engineering'];
    unit(w, 'a-eyes', 'a', 'recon', k(3, 3));
    const inland = progressionSupport(viewOf(w, 'a'), k(4, 3));
    expect(inland.blue).toEqual([{ id: 'strike_jet', missions: 1 }]);
    setTerrain(w, k(4, 4), 'water');
    const coast = progressionSupport(viewOf(w, 'a'), k(4, 3));
    expect(coast.blue).toEqual([
      { id: 'naval_gun', missions: 1 },
      { id: 'strike_jet', missions: 1 },
    ]);
  });

  it('own airbases within reach fly; an enemy battery counts only while it is seen', () => {
    const w = world();
    w.sites['a-home']!.facilities = ['airbase'];
    w.sites['b-home']!.facilities = ['missile_battery'];
    const near = progressionSupport(viewOf(w, 'a'), k(2, 1));
    expect(near.blue).toEqual([{ id: 'strike_jet', missions: 1 }]);
    const far = progressionSupport(viewOf(w, 'a'), k(9, 7));
    expect(far.blue).toEqual([]);
    // b's capital is out of a's sight: its battery is unknown, so it brings nothing a can count.
    expect(far.red).toEqual([]);
    unit(w, 'a-scout', 'a', 'recon', k(8, 6));
    const seen = progressionSupport(viewOf(w, 'a'), k(9, 6));
    expect(seen.red).toEqual([{ id: 'cruise_missile', missions: 1 }]);
  });

  it('the view tells development only for sites you hold or see', () => {
    const w = world();
    w.sites['b-home']!.development = 77;
    w.sites['a-home']!.development = 12;
    const v = viewOf(w, 'a');
    expect(v.sites['a-home']!.development).toBe(12);
    expect(v.sites['b-home']!.development).toBeUndefined();
  });

  it('the research rate the screens show is what the economy pays', () => {
    const w = world();
    w.sites['a-home']!.development = CITY_GROWTH.levels[1]!;
    w.nations.a!.budget = { research: 20, infrastructure: 0, welfare: 0 };
    const v = viewOf(w, 'a');
    const r = resolveTurn(w, []);
    const ledger = r.events.find((e) => e.kind === 'economy' && e.nation === 'a');
    if (ledger?.kind !== 'economy') throw new Error('no ledger');
    expect(researchRate(v)).toBe(ledger.ledger.research);
  });
});
