import type { AiMemory, BuildOrder, FacilityId, NationView, SiteView, Stockpile, TechId } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { TECH_IDS, TECHS, UNITS, type TechBranch } from '@brink/game-data';
import { balanceOf, buildBlocker, facilityCost, sortedKeys } from '@brink/simulation';

// The AI's research and city development. It sees only its own NationView; every pick goes
// through the engine's own checks (prerequisites, `buildBlocker`, the discounted cost), so it
// never writes an order the validator would refuse.

/**
 * How much a branch is worth to this power now: the economy and intelligence always, armour,
 * air and the navy as far as its army is built of them.
 */
function branchWeights(view: NationView): Record<TechBranch, number> {
  let armour = 0;
  let air = 0;
  let naval = 0;
  for (const id of sortedKeys(view.formations)) {
    const c = view.formations[id]!.unitClass;
    if (c === 'armor' || c === 'mechanized') armour += 1;
    else if (c === 'air' || c === 'drone' || c === 'artillery') air += 1;
    else if (UNITS[c].naval) naval += 1;
  }
  return {
    economy: 4,
    armour: 2 + Math.min(3, Math.floor(armour / 2)),
    air: 2 + Math.min(3, Math.floor(air / 2)),
    naval: naval >= 2 ? 2 + Math.min(2, Math.floor(naval / 2)) : 1,
    cyber: 3,
  };
}

/**
 * The next technology when nothing is in progress: the best worth per point among those whose
 * prerequisites are done. Undefined while a project is running (the order leaves it alone).
 */
export function chooseResearch(view: NationView): TechId | null | undefined {
  const r = view.self.research;
  if (r.current) return undefined;
  const weight = branchWeights(view);
  let best: TechId | undefined;
  let bestScore = -1;
  for (const t of TECH_IDS) {
    const def = TECHS[t]!;
    if (r.unlocked.includes(t) || !def.requires.every((p) => r.unlocked.includes(p))) continue;
    // Cheap early technologies first, the branch's worth deciding between them.
    const score = Math.floor((weight[def.branch] * 100000) / def.cost);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** A deficit the stockpile cannot pay for this many turns is mended before anything else is built. */
const DEFICIT_TURNS = 6;

const KIND_RANK: Record<SiteView['kind'], number> = { capital: 0, city: 1, depot: 2, objective: 3 };

/**
 * Which facility a site wants: a fortress or missile battery where it is pressed, whatever fixes
 * the scarcest resource, a naval yard at a port for a power with ships, an airbase for one with
 * aircraft, then growth (factory, lab) and the rest.
 */
function wantedFacility(view: NationView, memory: AiMemory, site: SiteView): FacilityId | null {
  const s = view.self.stockpile;
  const can = (f: FacilityId) => buildBlocker(view, view.self, site.id, f) === null;
  const pressed = view.turn - (memory.pressure[site.id] ?? -99) <= 2;
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!.unitClass);
  const ships = own.filter((c) => UNITS[c].naval).length;
  const flyers = own.filter((c) => c === 'air' || c === 'drone').length;
  const wants: FacilityId[] = [];
  if (pressed && site.kind === 'capital') wants.push('fortress', 'missile_battery');
  if (pressed && site.kind === 'city') wants.push('missile_battery');
  // Scarce: low in store, or running a deficit (the turns it can still be paid for decide which first).
  const net = balanceOf(view);
  const runway = (r: 'food' | 'materials' | 'energy') => s[r] + net[r] * DEFICIT_TURNS;
  const scarce = (['food', 'materials', 'energy'] as const).filter((r) => s[r] < 120 || net[r] < 0).sort((a, b) => runway(a) - runway(b) || (a < b ? -1 : 1));
  const fix: Record<string, FacilityId> = { food: 'farm', materials: 'mine', energy: 'power_plant' };
  for (const r of scarce) wants.push(fix[r]!);
  wants.push('factory', 'research_lab');
  if (ships >= 2) wants.push('naval_yard');
  if (flyers >= 1) wants.push('airbase');
  wants.push('mine', 'power_plant', 'farm');
  return wants.find(can) ?? null;
}

/** What mends each deficit. */
const MEND: Record<'energy' | 'food' | 'materials', FacilityId> = { energy: 'power_plant', food: 'farm', materials: 'mine' };

/**
 * The building wanted next: paced (two to start, one more every four turns: a war is won by armies
 * and buildings pay off slowly), except that a deficit the stockpile cannot carry for
 * `DEFICIT_TURNS` is mended whatever the pace, a power plant, a farm or a mine before anything else.
 */
function nextBuild(view: NationView, memory: AiMemory): { order: BuildOrder; cost: Stockpile; mend: boolean } | null {
  if (view.self.construction.length > 0) return null;
  const standing = sortedKeys(view.sites).reduce((a, id) => a + (view.sites[id]!.owner === view.self.id ? view.sites[id]!.facilities.length : 0), 0);
  const net = balanceOf(view);
  const short = (['energy', 'food', 'materials'] as const)
    .filter((r) => net[r] < 0 && view.self.stockpile[r] + net[r] * DEFICIT_TURNS < 0)
    .sort((a, b) => view.self.stockpile[a] + net[a] * DEFICIT_TURNS - (view.self.stockpile[b] + net[b] * DEFICIT_TURNS) || (a < b ? -1 : 1));
  const sites = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.id < b.id ? -1 : 1));
  for (const r of short) {
    for (const site of sites) {
      if (buildBlocker(view, view.self, site.id, MEND[r]) !== null) continue;
      return { order: { siteId: site.id, facility: MEND[r] }, cost: facilityCost(view.self, MEND[r]), mend: true };
    }
  }
  if (standing >= 2 + Math.floor(view.turn / 4)) return null;
  for (const site of sites) {
    const f = wantedFacility(view, memory, site);
    if (f) return { order: { siteId: site.id, facility: f }, cost: facilityCost(view.self, f), mend: false };
  }
  return null;
}

/** A reserve of what a building costs: a power plant needs no energy to build, and is most wanted at none. */
function affordable(view: NationView, cost: Stockpile, mend: boolean): boolean {
  const reserve = mend ? { credits: 20, energy: 10, materials: 20, food: 10 } : { credits: 60, energy: 25, materials: 30, food: 25 };
  return !RESOURCES.some((r) => cost[r] > 0 && view.self.stockpile[r] - cost[r] < reserve[r]);
}

/** One building at a time, keeping a reserve for upkeep and the next recruit. */
export function planCityBuilds(view: NationView, memory: AiMemory): BuildOrder[] {
  const next = nextBuild(view, memory);
  return next && affordable(view, next.cost, next.mend) ? [next.order] : [];
}

/**
 * What recruitment leaves in the treasury this turn: the cost of a building that mends a deficit
 * and cannot be paid for yet, saved toward. (Recruits took every credit as it came in, turn after
 * turn, so Japan built one power plant in thirty turns while its energy ran out and its industry
 * ran at half.)
 */
export function buildSaving(view: NationView, memory: AiMemory): Stockpile | undefined {
  const next = nextBuild(view, memory);
  return next?.mend && !affordable(view, next.cost, true) ? next.cost : undefined;
}
