import { readCareer, type Career } from '../arena/career';
import type { BattleRequest } from '../arena/battle';
import { SKIRMISHES, skirmishRequest, type Skirmish } from '../arena/skirmish';

/**
 * Quick Battle: the battle most worth playing next, straight from the title. Among the skirmishes
 * your stars have opened, the one you have the fewest stars on (the easiest of those first), on a
 * fresh field each time.
 */
export function quickPick(career: Pick<Career, 'stars' | 'best'> = readCareer()): Skirmish {
  const open = SKIRMISHES.filter((s) => s.stars <= career.stars);
  const pool = open.length ? open : [SKIRMISHES[0]!];
  return [...pool].sort((a, b) => (career.best[a.id] ?? 0) - (career.best[b.id] ?? 0) || a.stars - b.stars)[0]!;
}

export function quickBattle(attempt = Date.now() % 1_000_000): BattleRequest {
  return skirmishRequest(quickPick(), attempt);
}
