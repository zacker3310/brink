import type { NationView, Stockpile, TechId, UnitClass } from '@brink/contracts';
import { TECH_IDS, TECHS } from '@brink/game-data';
import { recruitCost } from '@brink/simulation';

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
  const cities = mine.reduce((a, s) => a + s.yields.research, 0);
  return Math.max(1, cities + Math.floor(Math.floor((credits * share) / 100) / 2));
}
