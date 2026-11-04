import type { AiMemory, BuildOrder, FacilityId, NationView, SiteView, TechId } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { TECH_IDS, TECHS, UNITS, type TechBranch } from '@brink/game-data';
import { buildBlocker, facilityCost, sortedKeys } from '@brink/simulation';

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
  const scarce = (['food', 'materials', 'energy'] as const).filter((r) => s[r] < 120).sort((a, b) => s[a] - s[b] || (a < b ? -1 : 1));
  const fix: Record<string, FacilityId> = { food: 'farm', materials: 'mine', energy: 'power_plant' };
  for (const r of scarce) wants.push(fix[r]!);
  wants.push('factory', 'research_lab');
  if (ships >= 2) wants.push('naval_yard');
  if (flyers >= 1) wants.push('airbase');
  wants.push('mine', 'power_plant', 'farm');
  return wants.find(can) ?? null;
}

/** One building at a time, paced, keeping a reserve for upkeep and the next recruit. */
export function planCityBuilds(view: NationView, memory: AiMemory): BuildOrder[] {
  if (view.self.construction.length > 0) return [];
  // Paced: two to start, one more every four turns. A war is won by armies; buildings pay off slowly.
  const standing = sortedKeys(view.sites).reduce((a, id) => a + (view.sites[id]!.owner === view.self.id ? view.sites[id]!.facilities.length : 0), 0);
  if (standing >= 2 + Math.floor(view.turn / 4)) return [];
  const reserve = { credits: 60, energy: 25, materials: 30, food: 25 };
  const sites = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.id < b.id ? -1 : 1));
  for (const site of sites) {
    const f = wantedFacility(view, memory, site);
    if (!f) continue;
    const cost = facilityCost(view.self, f);
    // A reserve of what it costs: a power plant needs no energy to build, and is most wanted at none.
    if (RESOURCES.some((r) => cost[r] > 0 && view.self.stockpile[r] - cost[r] < reserve[r])) return [];
    return [{ siteId: site.id, facility: f }];
  }
  return [];
}
