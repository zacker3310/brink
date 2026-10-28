import type { TechId, UnitClass } from '@brink/contracts';

// Everything a unit can do in the arena, in cells and seconds. One cell is one metre-ish of
// battlefield; the arena is ARENA_W x ARENA_H cells, attackers enter at the bottom.

export const ARENA_W = 15;
export const ARENA_H = 23;
/** Seconds a battle may last; when it runs out the defenders have held. */
export const TIME_LIMIT = 150;
/** Seconds the attackers must hold the zone, uncontested, to take a city or objective. */
export const CAPTURE_TIME = 6;
export const ZONE_RADIUS = 2.4;

export type WeaponKind = 'shell' | 'cannon' | 'rocket' | 'bullet' | 'lob' | 'dive';

export interface Weapon {
  kind: WeaponKind;
  /** Seconds between shots (or bursts). */
  reload: number;
  damage: number;
  /** Cells per second. */
  speed: number;
  /** How far the unit engages, in cells. */
  range: number;
  /** Projectiles per trigger pull, fired `spread` radians apart (rockets) or `gap` seconds apart (bursts). */
  count: number;
  gap: number;
  spread: number;
  /** Walls the projectile may bounce off before it is spent. */
  bounces: number;
  /** Area damage radius in cells (artillery, drone). */
  splash: number;
}

export interface ClassStats {
  name: string;
  hp: number;
  /** Cells per second. */
  speed: number;
  /** Hull turn rate, radians per second. */
  turn: number;
  radius: number;
  flying: boolean;
  /** Walks through trees and hides in them. */
  foot: boolean;
  /** Heavy armour shrugs off small arms. */
  heavy: boolean;
  weapon: Weapon;
  /** One-line how-to for the arena card. */
  tip: string;
}

const w = (p: Partial<Weapon> & Pick<Weapon, 'kind' | 'reload' | 'damage' | 'speed' | 'range'>): Weapon => ({ count: 1, gap: 0, spread: 0, bounces: 0, splash: 0, ...p });

export const CLASSES: Record<UnitClass, ClassStats> = {
  armor: {
    name: 'Tank',
    hp: 140,
    speed: 2.4,
    turn: 3.2,
    radius: 0.46,
    flying: false,
    foot: false,
    heavy: true,
    weapon: w({ kind: 'shell', reload: 1.3, damage: 46, speed: 8.5, range: 11, bounces: 1 }),
    tip: 'Main gun. Shells bounce once off walls: bank shots around cover.',
  },
  mechanized: {
    name: 'IFV',
    hp: 100,
    speed: 3.1,
    turn: 3.8,
    radius: 0.44,
    flying: false,
    foot: false,
    heavy: true,
    weapon: w({ kind: 'cannon', reload: 1.5, damage: 13, speed: 12, range: 9, count: 3, gap: 0.1 }),
    tip: 'Autocannon bursts. Quick and tough: lead the push.',
  },
  infantry: {
    name: 'Rifle squad',
    hp: 42,
    speed: 2.3,
    turn: 6,
    radius: 0.3,
    flying: false,
    foot: true,
    heavy: false,
    weapon: w({ kind: 'rocket', reload: 2.2, damage: 40, speed: 7.5, range: 7 }),
    tip: 'Anti-tank rockets. Walks through forest and is hard to hit inside it.',
  },
  recon: {
    name: 'Scout car',
    hp: 60,
    speed: 4.2,
    turn: 5,
    radius: 0.38,
    flying: false,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'bullet', reload: 0.22, damage: 5, speed: 14, range: 8 }),
    tip: 'Fastest on the field. Machine gun shreds infantry and drones.',
  },
  artillery: {
    name: 'Howitzer',
    hp: 60,
    speed: 1.6,
    turn: 2.4,
    radius: 0.46,
    flying: false,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'lob', reload: 3, damage: 58, speed: 0, range: 15, splash: 1.6 }),
    tip: 'Tap anywhere: shells arc over walls and land a second later. Keep it back.',
  },
  air: {
    name: 'Attack helicopter',
    hp: 80,
    speed: 3.5,
    turn: 4,
    radius: 0.5,
    flying: true,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'rocket', reload: 1.6, damage: 21, speed: 10, range: 9, count: 2, spread: 0.12 }),
    tip: 'Flies over everything. Rocket pairs. Scout cars and IFVs can hit it.',
  },
  drone: {
    name: 'Strike drone',
    hp: 18,
    speed: 4.6,
    turn: 7,
    radius: 0.26,
    flying: true,
    foot: false,
    heavy: false,
    weapon: w({ kind: 'dive', reload: 0, damage: 72, speed: 9, range: 12, splash: 1.3 }),
    tip: 'Tap a target: it dives and explodes. One use.',
  },
};

/** Damage multiplier by projectile against a target type. */
export function damageFactor(kind: WeaponKind, target: ClassStats): number {
  if (kind === 'bullet') return target.heavy ? 0.35 : target.foot || target.flying ? 1.6 : 1;
  if (kind === 'cannon') return target.flying ? 1.4 : target.foot ? 1.3 : 1;
  if (kind === 'rocket') return target.heavy ? 1.35 : target.foot ? 0.7 : 1;
  if (kind === 'shell') return target.foot ? 0.8 : 1;
  return 1;
}

/** Veterancy, read from a formation's experience on the war map. */
export const RANKS = [
  { name: 'Recruit', from: 0, hp: 1, reload: 1 },
  { name: 'Veteran', from: 15, hp: 1.1, reload: 0.92 },
  { name: 'Elite', from: 35, hp: 1.2, reload: 0.85 },
  { name: 'Ace', from: 60, hp: 1.3, reload: 0.78 },
] as const;

export function rankOf(experience: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (experience >= RANKS[i]!.from) r = i;
  return r;
}

export type AbilityId = 'repair' | 'sweep' | 'mines' | 'airstrike' | 'missiles' | 'armor';

export interface AbilityDef {
  name: string;
  text: string;
  /** Needs a tap on the arena to aim. */
  targeted: boolean;
  /** Always on: no button. */
  passive: boolean;
  tech: TechId;
}

/** Research on the war map unlocks one arena ability per technology. */
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  repair: { name: 'Field repair', text: 'Patch up the unit you drive: +35% health.', targeted: false, passive: false, tech: 'logistics_doctrine' },
  sweep: { name: 'Recon sweep', text: 'Mark every enemy; your side shoots straight for 10 seconds.', targeted: false, passive: false, tech: 'signals_intelligence' },
  mines: { name: 'Mines', text: 'Drop three mines behind you.', targeted: false, passive: false, tech: 'industrial_automation' },
  airstrike: { name: 'Air strike', text: 'Tap a spot: three bombs land a moment later.', targeted: true, passive: false, tech: 'combined_arms' },
  missiles: { name: 'Guided missiles', text: 'Your next three shots home onto the nearest enemy.', targeted: false, passive: false, tech: 'precision_munitions' },
  armor: { name: 'Composite armour', text: 'Tanks and IFVs start with +25% health.', targeted: false, passive: true, tech: 'composite_armor' },
};

export function abilitiesFor(unlocked: readonly TechId[]): AbilityId[] {
  return (Object.keys(ABILITIES) as AbilityId[]).filter((a) => unlocked.includes(ABILITIES[a].tech)).sort();
}
