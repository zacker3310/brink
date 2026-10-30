import { undoable } from './engine';
import type { Battle, Difficulty } from './types';

// Taking orders back (docs/arena-v2.md, section 11): Undo takes back the last step, Reset Turn every
// step since the last one that cannot be taken back. A step can be taken back only when it drew no
// dice and showed nothing new (`undoable`), so neither ever reverses a roll or something revealed.

/** One step of the player's turn: the battle just before it, and whether it can be taken back. */
export interface Step {
  before: Battle;
  safe: boolean;
  /** The unit it was for (the one selected again after a rewind). */
  unit: string | null;
}

/** The turn's steps with one more taken (`before` the snapshot, `after` the battle now); a new turn starts afresh. */
export function recordStep(steps: readonly Step[], before: Battle, after: Battle, unit: string | null): Step[] {
  const sameTurn = steps.length > 0 && steps[0]!.before.turnIndex === before.turnIndex;
  return [...(sameTurn ? steps : []), { before, safe: undoable(before, after), unit }];
}

/** What Undo goes back to: the battle before the last step, when that step can be taken back. */
export function undoPoint(steps: readonly Step[]): Step | null {
  const last = steps.at(-1);
  return last?.safe ? last : null;
}

/** What Reset Turn goes back to: the battle before the first of the steps since the last one that cannot be taken back. */
export function resetPoint(steps: readonly Step[]): Step | null {
  let i = steps.length;
  while (i > 0 && steps[i - 1]!.safe) i--;
  return i < steps.length ? steps[i]! : null;
}

/** Resets a battle allows: any number on Easy, one on Normal, none on Hard. */
export const RESETS: Record<Difficulty, number> = { easy: Infinity, normal: 1, hard: 0 };

/** Resets left after `used` (absent difficulty: Normal). */
export function resetsLeft(d: Difficulty | undefined, used: number): number {
  return Math.max(0, RESETS[d ?? 'normal'] - used);
}
