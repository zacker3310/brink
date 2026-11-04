import { describe, expect, it } from 'vitest';
import { TECHS } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { createPacificScenario } from '@brink/scenarios';
import { buildView, lockOrders, resolveTurn, sortedKeys } from '@brink/simulation';
import { makeWorld, site, unit } from '../../simulation/src/fixture.test-util';
import { emptyMemory, planOrders } from './index';
import { chooseResearch, planCityBuilds } from './research';

describe('AI research and city development', () => {
  it('picks a technology it may start, and leaves a running project alone', () => {
    const w = makeWorld();
    const v = buildView(w, 'a');
    const pick = chooseResearch(v)!;
    expect(TECHS[pick]!.requires).toEqual([]);
    w.nations.a!.research.current = pick;
    expect(chooseResearch(buildView(w, 'a'))).toBeUndefined();
  });

  it('favours the branch its army is built of', () => {
    const w = makeWorld();
    w.nations.a!.research.unlocked = ['industrial_automation', 'logistics_doctrine', 'naval_engineering', 'signals_intelligence', 'staff_college', 'air_mobility'];
    for (let i = 0; i < 6; i++) unit(w, `s${i}`, 'a', 'fleet', hexKey(0, 5));
    const pick = chooseResearch(buildView(w, 'a'))!;
    expect(TECHS[pick]!.branch).toBe('naval');
  });

  it('builds a naval yard at a port when it has a fleet, and only where one can stand', () => {
    const w = makeWorld();
    w.nations.a!.stockpile = { credits: 900, energy: 300, materials: 300, food: 300 };
    w.nations.a!.research.unlocked = ['naval_engineering'];
    site(w, 'a-port', hexKey(1, 0), 'a', 'city');
    w.tiles[hexKey(1, 0)]!.port = true;
    for (let i = 0; i < 2; i++) unit(w, `s${i}`, 'a', 'fleet', hexKey(1, 0));
    // Late enough in the war for a sixth building; the home city full, the port with room.
    w.turn = 20;
    w.sites['a-home']!.facilities = ['farm', 'mine', 'power_plant'];
    w.sites['a-port']!.facilities = ['farm', 'mine'];
    const builds = planCityBuilds(buildView(w, 'a'), emptyMemory());
    expect(builds).toEqual([{ siteId: 'a-port', facility: 'naval_yard' }]);
    expect(lockOrders(w, [{ nation: 'a', turn: w.turn, formations: {}, recruit: [], diplomacy: [], build: builds }]).rejected).toEqual([]);
    // Without a port nothing of the kind is asked for.
    w.tiles[hexKey(1, 0)]!.port = false;
    expect(planCityBuilds(buildView(w, 'a'), emptyMemory())).toEqual([{ siteId: 'a-port', facility: 'power_plant' }]);
  });

  it('researches down the tree and grows its cities over a long match, never refused', () => {
    let w = createPacificScenario(5);
    const memory = Object.fromEntries(sortedKeys(w.nations).map((n) => [n, emptyMemory()]));
    for (let turn = 0; turn < 30 && !w.victory; turn++) {
      const subs = sortedKeys(w.nations)
        .filter((n) => !w.nations[n]!.eliminated)
        .map((n) => planOrders(buildView(w, n), memory[n]!, w.seed));
      expect(lockOrders(w, subs).rejected, `turn ${w.turn}`).toEqual([]);
      w = resolveTurn(w, subs).world;
    }
    for (const n of ['china', 'japan', 'russia', 'usa']) {
      const nation = w.nations[n]!;
      if (nation.eliminated) continue;
      expect(nation.research.unlocked.length, n).toBeGreaterThanOrEqual(3);
      for (const t of nation.research.unlocked) for (const p of TECHS[t]!.requires) expect(nation.research.unlocked, `${n} ${t}`).toContain(p);
    }
    expect(Object.values(w.sites).some((s) => (s.development ?? 0) >= 24)).toBe(true);
  }, 120_000);
});
