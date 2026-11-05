import type { NationId, Treaty } from '@brink/contracts';
import { treatyIn } from './rules';

// Right of passage (military access), ruleset 2.9.0: a treaty between two powers at peace, both
// ways. While it runs each side's formations may move through the other's land and share its hexes,
// its supply runs across that land, and its aircraft rebase to the other's sites and land troops
// there. It gives no right to the ground itself: a formation on the other's land takes nothing. War
// ends it (`goToWar` in diplomacy.ts); so does its last turn. Works on a world or a view.

/** Whether `a` and `b` grant each other passage on `turn`. */
export function hasPassage(world: { treaties: readonly Treaty[]; turn: number }, a: NationId, b: NationId | null | undefined): boolean {
  if (!b || a === b) return false;
  return !!treatyIn(world.treaties, 'passage', a, b, world.turn);
}
