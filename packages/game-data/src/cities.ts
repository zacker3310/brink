// City development: how capitals and cities grow, what a bigger city gives, and the three
// facilities research adds to the six of ruleset 2.0 (naval yard, airbase, missile battery).

import type { Stockpile, Yields } from '@brink/contracts';
import type { CardSupportAsset } from './doctrine';

function stock(credits: number, energy: number, materials: number, food: number): Stockpile {
  return { credits, energy, materials, food };
}

export const CITY_GROWTH = {
  /** Development a held capital or city gains a turn. */
  base: 2,
  /** More for each facility standing there. */
  perFacility: 1,
  /** More for a capital. */
  capital: 1,
  /** No growth while the owner's stability is below this, or food ran short this turn. */
  minStability: 40,
  /** Development needed for each level, from level 1. */
  levels: [0, 24, 60, 120, 200] as readonly number[],
  /** Development stops here. */
  max: 200,
  /** Percent of its development a city keeps when it changes hands. */
  keptOnCapture: 50,
} as const;

/** What each level a city has above the first adds to its yields. */
export const LEVEL_YIELDS: Partial<Yields> = { credits: 2, industry: 2, research: 2 };

/** A city reaching each of these levels gains one more facility slot. */
export const LEVEL_SLOT_AT: readonly number[] = [3, 5];

export const LEVEL_NAMES: readonly string[] = ['Developing', 'Growing', 'Thriving', 'Booming', 'Megacity'];

/** Off-map support a facility puts over its owner's hand-fought battles within `reach` hexes. */
export interface FacilitySupport {
  asset: CardSupportAsset;
  missions: number;
  reach: number;
}

/** Facility ids research adds, beside the six of ruleset 2.0. */
export type ProgressionFacilityId = 'naval_yard' | 'airbase' | 'missile_battery';

/** Shared shape with `FacilityDef` in `index.ts` (kept here so this file has no runtime import of it). */
export interface ProgressionFacilityDef {
  name: string;
  summary: string;
  cost: Stockpile;
  industry: number;
  yields: Partial<Yields>;
  upkeep: Stockpile;
  requires: string | null;
  port?: true;
  supply?: number;
  defense?: number;
  support?: FacilitySupport;
}

export const PROGRESSION_FACILITIES: Record<ProgressionFacilityId, ProgressionFacilityDef> = {
  naval_yard: {
    name: 'Naval yard',
    summary: '+6 industry and +20 supply capacity. Ports only.',
    cost: stock(110, 0, 70, 0),
    industry: 50,
    yields: { industry: 6 },
    upkeep: stock(2, 1, 0, 0),
    requires: 'naval_engineering',
    port: true,
    supply: 20,
  },
  airbase: {
    name: 'Airbase',
    summary: 'A strike sortie in your battles within 4 hexes; +10 supply capacity.',
    cost: stock(120, 10, 60, 0),
    industry: 55,
    yields: {},
    upkeep: stock(3, 2, 0, 0),
    requires: 'air_mobility',
    supply: 10,
    support: { asset: 'strike_jet', missions: 1, reach: 4 },
  },
  missile_battery: {
    name: 'Missile battery',
    summary: 'Your defenders here fight 15% harder; a cruise missile in your battles within 3 hexes.',
    cost: stock(130, 0, 90, 0),
    industry: 60,
    yields: {},
    upkeep: stock(3, 0, 1, 0),
    requires: 'cruise_missiles',
    defense: 15,
    support: { asset: 'cruise_missile', missions: 1, reach: 3 },
  },
};
