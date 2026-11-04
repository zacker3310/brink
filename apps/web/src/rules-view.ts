import type { DealTerms, DiplomaticAction, FacilityId, NationId, NationView, Relation, Stockpile, TechId, UnitClass } from '@brink/contracts';
import { FACILITIES, TECH_IDS, TECHS } from '@brink/game-data';
import { buildBlocker, checkDiplomacy, facilitySlots, pairKey, recruitCost, researchRate } from '@brink/simulation';

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

/** Research points a turn at a research share of `share` percent, as the economy reckons it: cities, labs, city levels, half the credits spent, the research bonus. */
export function researchPerTurn(view: NationView, share = view.self.budget.research): number {
  return researchRate(view, share);
}

/** Why the player may not take `action` toward `target` this turn, or null. The engine's own check, run on the view. */
export function diplomacyBlocked(view: NationView, target: NationId, action: DiplomaticAction, terms?: DealTerms): string | null {
  const relations: Record<string, Relation> = {};
  for (const [n, r] of Object.entries(view.relations)) relations[pairKey(view.self.id, n)] = r;
  return checkDiplomacy({ relations, treaties: view.treaties, turn: view.turn, nations: view.nations, sites: view.sites, tiles: view.tiles }, view.self.id, target, action, terms);
}

/** Why `facility` cannot be started at `siteId`, ignoring cost, or null. The engine's own check, in the player's words. */
export function buildBlocked(view: NationView, siteId: string, facility: FacilityId): string | null {
  const site = view.sites[siteId];
  const def = FACILITIES[facility];
  if (!site || site.owner !== view.self.id) return 'Not your site';
  if (site.facilities.includes(facility)) return 'Already built';
  if (view.self.construction.some((c) => c.siteId === siteId && c.facility === facility)) return 'Under construction';
  const why = buildBlocker(view, view.self, siteId, facility);
  if (!why) return null;
  if (why.endsWith('no room for another facility')) return `No room: ${facilitySlots(site)} facilities here at most`;
  if (why.endsWith('needs a port')) return 'Needs a port';
  if (def.requires && !view.self.research.unlocked.includes(def.requires)) return `Research ${TECHS[def.requires]?.name ?? def.requires} first`;
  return why;
}
