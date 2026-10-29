import type { TechId } from '@brink/contracts';
import type { AbilityDef, AbilityId, Difficulty, Side } from './types';

// Ranks and research abilities for the v2 arena. The ids, techs and rank thresholds are v1's
// (docs/arena-v2.md sections 3.4, 3.10 and 9); the effects are v2's.

/** Veterancy, read from a formation's experience on the war map. `aim` is the hit bonus (section 3.4). */
export const RANKS = [
  { name: 'Recruit', from: 0, aim: 0 },
  { name: 'Veteran', from: 15, aim: 5 },
  { name: 'Elite', from: 35, aim: 9 },
  { name: 'Ace', from: 60, aim: 13 },
] as const;

export function rankOf(experience: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (experience >= RANKS[i]!.from) r = i;
  return r;
}

/** The defender's crews take their rank from the enemy skill (section 5). */
export function rankFromSkill(skill: number): number {
  if (!(skill >= 0.35)) return 0;
  if (skill < 0.6) return 1;
  if (skill < 0.8) return 2;
  return 3;
}

export interface DifficultyDef {
  /** On the shot card, by the aim it gives. */
  name: string;
  /** Added to every hit chance of the player's (blue) shots, direct, called and off-map. */
  aim: number;
  /** Added to every hit chance of the enemy's (red) shots. */
  enemyAim: number;
  /** The enemy company's unit count is scaled by this (never under FEWEST_ENEMIES). */
  enemyUnits: number;
  /** Added to the enemy skill (then clamped 0..1); it sets their decisions and their crews' rank. */
  skill: number;
}

/**
 * Battle difficulty (docs/arena-v2.md, section 11), tuned with the arena soak's mixed setups and
 * the AI's own planner in the player's seat, to win: Easy at least 80%, Normal about 55%, Hard
 * about 35%. Measured over 120 setups: Easy 80%, Normal 53%, Hard 34% (the rules as written win
 * 44%). Easy needs a lot because a third of those setups attack with one formation, some with only
 * guns or drones, and run out of rounds whatever the odds: two formations or more win 91% on Easy.
 */
export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: { name: 'Easy', aim: 30, enemyAim: -30, enemyUnits: 0.5, skill: -0.5 },
  normal: { name: 'Normal', aim: 10, enemyAim: -10, enemyUnits: 1, skill: 0 },
  hard: { name: 'Hard', aim: -10, enemyAim: 15, enemyUnits: 1, skill: 0.1 },
};

/** A smaller enemy company never drops under this many units (a template company is 10 to 16). */
export const FEWEST_ENEMIES = 6;

/** The table row for a difficulty; absent (a battle saved before there were any) is Normal. */
export function difficultyDef(d: Difficulty | undefined): DifficultyDef {
  return DIFFICULTY[d ?? 'normal'] ?? DIFFICULTY.normal;
}

/** The difficulty's hit-chance points for one side's shots. */
export function difficultyAim(d: Difficulty | undefined, side: Side): number {
  const def = difficultyDef(d);
  return side === 'blue' ? def.aim : def.enemyAim;
}

/** The enemy skill a battle plays at: the setup's, moved by the difficulty, within 0..1. */
export function battleSkill(skill: number, d: Difficulty | undefined): number {
  return Math.max(0, Math.min(1, (Number.isFinite(skill) ? skill : 0) + difficultyDef(d).skill));
}

/** Research on the war map unlocks one battle ability per technology; each is used once a battle. */
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  repair: {
    name: 'Field repair',
    text: "Fix one vehicle's damage, or get two of a squad's wounded back in the fight, anywhere on the field.",
    targeted: false,
    needsUnit: true,
    passive: false,
    tech: 'logistics_doctrine',
  },
  sweep: {
    name: 'SIGINT sweep',
    text: 'Every enemy unit is revealed to you through your next turn.',
    targeted: false,
    needsUnit: false,
    passive: false,
    tech: 'signals_intelligence',
  },
  mines: {
    name: 'Scatterable mines',
    text: 'Pick a cell within 20: five hidden AT mines land around it.',
    targeted: true,
    needsUnit: false,
    passive: false,
    tech: 'industrial_automation',
  },
  airstrike: {
    name: 'Air strike',
    text: 'Pick a cell: bombs hit it and the eight around it from above, and bring buildings down.',
    targeted: true,
    needsUnit: false,
    passive: false,
    tech: 'combined_arms',
  },
  missiles: {
    name: 'Precision rounds',
    text: 'Your next three shots are 30 points surer.',
    targeted: false,
    needsUnit: false,
    passive: false,
    tech: 'precision_munitions',
  },
  armor: {
    name: 'Composite armour',
    text: 'Your MBTs and IFVs get +100 KE and +150 CE on their fronts.',
    targeted: false,
    needsUnit: false,
    passive: true,
    tech: 'composite_armor',
  },
};

export function abilitiesFor(unlocked: readonly TechId[]): AbilityId[] {
  return (Object.keys(ABILITIES) as AbilityId[]).filter((a) => unlocked.includes(ABILITIES[a].tech)).sort();
}
