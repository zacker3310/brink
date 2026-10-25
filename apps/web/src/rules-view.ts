import type { NationView, Stockpile, TechId, UnitClass } from '@brink/contracts';
import { TECHS } from '@brink/game-data';
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
