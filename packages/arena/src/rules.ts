import type { TechId, UnitClass } from '@brink/contracts';

// Everything a unit can do in a tactical battle, in grid cells and whole turns. The field is
// ARENA_W x ARENA_H cells; the attackers enter at the bottom edge, the defenders hold the top.

export const ARENA_W = 15;
export const ARENA_H = 23;
/** Rounds a battle may last (one of your turns and one of theirs); when they run out the defenders have held. */
export const ROUND_LIMIT = 12;
/** Rounds in a row the attackers must end holding the zone, with no defender in it, to take it. */
export const CAPTURE_ROUNDS = 2;
export const ZONE_RADIUS = 2.4;

/** Direct fire needs line of sight; `area` lands on a cell over anything (artillery); `dive` is a one-way strike. */
export type WeaponKind = 'gun' | 'autocannon' | 'rocket' | 'mg' | 'area' | 'dive';

export interface Weapon {
  kind: WeaponKind;
  damage: number;
  /** Cells, measured as straight-line distance between cell centres. */
  range: number;
  /** Closest it can engage (artillery cannot fire at its own feet). */
  minRange: number;
  /** Base chance to hit, percent, at up to half range in the open. */
  aim: number;
  /** Area damage radius in cells; the edge takes half. */
  splash: number;
}

export interface ClassStats {
  name: string;
  hp: number;
  /** Movement points per turn: one per cell, diagonals cost one and a half. */
  move: number;
  flying: boolean;
  /** Walks through trees and hides in them. */
  foot: boolean;
  /** Heavy armour: small arms barely scratch it. */
  heavy: boolean;
  weapon: Weapon;
  /** One line for the unit card. */
  tip: string;
}

const w = (p: Partial<Weapon> & Pick<Weapon, 'kind' | 'damage' | 'range' | 'aim'>): Weapon => ({ minRange: 0, splash: 0, ...p });

export const CLASSES: Record<UnitClass, ClassStats> = {
  armor: {
    name: 'Tank',
    hp: 140,
    move: 5,
    flying: false,
    foot: false,
    heavy: true,
    weapon: w({ kind: 'gun', damage: 52, range: 9, aim: 78 }),
    tip: 'Main gun: the hardest hit on the field. Park it behind a wall and trade shots.',
  },
  mechanized: {
    name: 'IFV',
    hp: 90,
    move: 6,
    flying: false,
    foot: false,
    heavy: true,
    weapon: w({ kind: 'autocannon', damage: 34, range: 7, aim: 82 }),
    tip: 'Autocannon: accurate, deadly to infantry and helicopters. Quick enough to flank.',
  },
  infantry: {
    name: 'Rifle squad',
    hp: 45,
    move: 4,
    flying: false,
    foot: true,
    heavy: false,
    weapon: w({ kind: 'rocket', damage: 44, range: 5, aim: 70 }),
    tip: 'Anti-tank rockets at close range. Walks through forest and is hard to hit in it.',
  },
  recon: {
    name: 'Scout car',
    hp: 55,
    move: 8,
    flying: false,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'mg', damage: 22, range: 7, aim: 80 }),
    tip: 'Fastest on the field. Its machine gun shreds infantry and drones; it spots for the guns.',
  },
  artillery: {
    name: 'Howitzer',
    hp: 55,
    move: 3,
    flying: false,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'area', damage: 48, range: 16, minRange: 3, aim: 70, splash: 1 }),
    tip: 'Shells any cell in range, over walls. Hits everything next to it too. Keep it back.',
  },
  air: {
    name: 'Attack helicopter',
    hp: 75,
    move: 8,
    flying: true,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'rocket', damage: 40, range: 7, aim: 74 }),
    tip: 'Flies over everything and sees over walls. IFVs and scout cars can bring it down.',
  },
  drone: {
    name: 'Strike drone',
    hp: 20,
    move: 9,
    flying: true,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'dive', damage: 70, range: 4, aim: 88, splash: 1 }),
    tip: 'Fly in, then dive on a target: one strike, then it is gone.',
  },
};

/** Damage multiplier by weapon against a target type. */
export function damageFactor(kind: WeaponKind, target: ClassStats): number {
  if (kind === 'mg') return target.heavy ? 0.3 : target.foot || target.flying ? 1.5 : 1;
  if (kind === 'autocannon') return target.flying ? 1.5 : target.foot ? 1.3 : target.heavy ? 0.8 : 1;
  if (kind === 'rocket') return target.heavy ? 1.15 : target.foot ? 0.7 : 1;
  if (kind === 'gun') return target.foot ? 0.85 : target.flying ? 0.6 : 1;
  if (kind === 'area') return target.flying ? 0.4 : 1;
  return 1;
}

/** Veterancy, read from a formation's experience on the war map: more health, steadier aim. */
export const RANKS = [
  { name: 'Recruit', from: 0, hp: 1, aim: 0 },
  { name: 'Veteran', from: 15, hp: 1.1, aim: 5 },
  { name: 'Elite', from: 35, hp: 1.2, aim: 9 },
  { name: 'Ace', from: 60, hp: 1.3, aim: 13 },
] as const;

export function rankOf(experience: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (experience >= RANKS[i]!.from) r = i;
  return r;
}

/** Cover a target gets against a shot, as points off the hit chance. */
export const COVER = { full: 40, half: 22, trees: 22, dug: 10 } as const;
/** Overwatch shots are snap shots. */
export const OVERWATCH_AIM = -12;

export type AbilityId = 'repair' | 'sweep' | 'mines' | 'airstrike' | 'missiles' | 'armor';

export interface AbilityDef {
  name: string;
  text: string;
  /** Needs a cell picked on the field. */
  targeted: boolean;
  /** Always on: no button. */
  passive: boolean;
  tech: TechId;
}

/** Research on the war map unlocks one battle ability per technology; each is used once a battle. */
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  repair: { name: 'Field repair', text: 'The selected unit gets back 40% of its health.', targeted: false, passive: false, tech: 'logistics_doctrine' },
  sweep: { name: 'Recon sweep', text: 'Every shot your side fires this turn and next is 15 points surer.', targeted: false, passive: false, tech: 'signals_intelligence' },
  mines: { name: 'Mines', text: 'Mine the three cells ahead of the selected unit. An enemy that drives in stops and takes 35.', targeted: false, passive: false, tech: 'industrial_automation' },
  airstrike: { name: 'Air strike', text: 'Pick a cell: bombs hit it and every cell around it.', targeted: true, passive: false, tech: 'combined_arms' },
  missiles: { name: 'Guided missiles', text: 'Your next three direct shots are 30 points surer.', targeted: false, passive: false, tech: 'precision_munitions' },
  armor: { name: 'Composite armour', text: 'Tanks and IFVs start with 25% more health.', targeted: false, passive: true, tech: 'composite_armor' },
};

export function abilitiesFor(unlocked: readonly TechId[]): AbilityId[] {
  return (Object.keys(ABILITIES) as AbilityId[]).filter((a) => unlocked.includes(ABILITIES[a].tech)).sort();
}
