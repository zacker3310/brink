import type { DiplomaticAction, FacilityId, NationId, NationView, Relation, Stockpile, TechId, UnitClass } from '@brink/contracts';
import { FACILITIES, FACILITY_SLOTS, TECH_IDS, TECHS } from '@brink/game-data';
import { checkDiplomacy, pairKey, recruitCost } from '@brink/simulation';

export function recruitCostFor(view: NationView, unitClass: UnitClass): Stockpile {
  return recruitCost(view.self, unitClass);
}

/** Why the player cannot start researching `tech`, or null. Mirrors the engine's check. */
export function checkResearchView(view: NationView, tech: TechId): string | null {
  const def = TECHS[tech];
  if (!def) return 'No such technology';
  const unlocked = view.self.research.unlocked;
  if (unlocked.includes(tech)) return 'Already researched';
  const missing = def.requires.filter((r) => !unlocked.includes(r));
  return missing.length > 0 ? `Requires ${missing.map((m) => TECHS[m]?.name).join(', ')}` : null;
}

/** The research worth doing next: the cheapest project that can start now. */
export function recommendedTech(view: NationView): TechId | null {
  return [...TECH_IDS].filter((id) => !checkResearchView(view, id)).sort((x, y) => TECHS[x]!.cost - TECHS[y]!.cost || (x < y ? -1 : 1))[0] ?? null;
}

/** Research points a turn at a research share of `share` percent: what the cities make plus half the credits spent. */
export function researchPerTurn(view: NationView, share = view.self.budget.research): number {
  const mine = Object.values(view.sites).filter((s) => s.owner === view.self.id);
  const credits = mine.reduce((a, s) => a + s.yields.credits, 0);
  const cities = mine.reduce((a, s) => a + s.yields.research + s.facilities.reduce((b, f) => b + (FACILITIES[f].yields.research ?? 0), 0), 0);
  return Math.max(1, cities + Math.floor(Math.floor((credits * share) / 100) / 2));
}

/** Why the player may not take `action` toward `target` this turn, or null. The engine's own check, run on the view. */
export function diplomacyBlocked(view: NationView, target: NationId, action: DiplomaticAction): string | null {
  const relations: Record<string, Relation> = {};
  for (const [n, r] of Object.entries(view.relations)) relations[pairKey(view.self.id, n)] = r;
  return checkDiplomacy({ relations, treaties: view.treaties, turn: view.turn, nations: view.nations }, view.self.id, target, action);
}

/** Why `facility` cannot be started at `siteId`, ignoring cost, or null. Mirrors the engine's check. */
export function buildBlocked(view: NationView, siteId: string, facility: FacilityId): string | null {
  const site = view.sites[siteId];
  const def = FACILITIES[facility];
  if (!site || site.owner !== view.self.id) return 'Not your site';
  const building = view.self.construction.filter((c) => c.siteId === siteId);
  if (site.facilities.includes(facility)) return 'Already built';
  if (building.some((c) => c.facility === facility)) return 'Under construction';
  if (site.facilities.length + building.length >= FACILITY_SLOTS[site.kind]) return `No room: ${FACILITY_SLOTS[site.kind]} facilities here at most`;
  if (def.requires && !view.self.research.unlocked.includes(def.requires)) return `Research ${TECHS[def.requires]?.name ?? def.requires} first`;
  return null;
}
