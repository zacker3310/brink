import type { TechId } from '@brink/contracts';
import type { AbilityDef, AbilityId } from './types';

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
