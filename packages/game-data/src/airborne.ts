// Airborne warfare and right of passage: the balance numbers (ruleset 2.9.0). The rules are in
// `packages/simulation/src/airborne.ts` and `passage.ts`; the design in GAME_DESIGN.md.

import type { Stockpile, UnitClass } from '@brink/contracts';

/** Where a lift can take off from, how far it reaches and how many formations it flies a turn. */
export interface AirliftOriginDef {
  name: string;
  /** Hexes from the origin to the landing hex. */
  range: number;
  /** Formations lifted from one origin in one turn. */
  capacity: number;
}

export const AIRBORNE = {
  /** Light formations that can jump or fly in by helicopter onto any land hex in range. */
  drop: ['infantry', 'recon'] as readonly UnitClass[],
  /**
   * Formations that can be flown in to an own or allied airfield (air-land, never a drop): the light
   * ones and mechanized infantry, whose vehicles need a runway at both ends.
   */
  land: ['infantry', 'recon', 'mechanized'] as readonly UnitClass[],
  origins: {
    /** An own site with an Airbase: transports and tankers, the longest reach. */
    airbase: { name: 'Airbase', range: 12, capacity: 2 },
    /** An own capital-class site (a nation's capital, or one taken): its airport. */
    capital: { name: 'Airport', range: 10, capacity: 1 },
    /**
     * An own carrier group lending its helicopters and tiltrotors to troops aboard an amphibious group
     * in its hex: the air assault from the deck. Capacity per carrier in the hex.
     */
    carrier: { name: 'Carrier deck', range: 7, capacity: 2 },
  } satisfies Record<'airbase' | 'capital' | 'carrier', AirliftOriginDef>,
  /**
   * Paid per formation lifted, when the turn resolves (reserved at validation after deals): the
   * airframe hours and the crews.
   */
  cost: { credits: 20, energy: 0, materials: 0, food: 0 } satisfies Stockpile,
  /**
   * Energy (aviation fuel) burned per formation lifted, drawn when the turn resolves from what is
   * there, like the logistics refills: never reserved, never below zero. Every power runs its energy
   * down within a few turns, and a lift grounded by an empty tank is no lift at all.
   */
  fuel: 4,
  /** A drop scatters the force: organization and readiness lost on landing. Air-landed troops lose none. */
  dropOrganization: 25,
  dropReadiness: 20,
  /** Attack removed when the drop lands beside a held hex and storms it at once (a combat assault). */
  assaultPenalty: 40,
  /**
   * Interception: percent chance a lifted formation is hit, summed over every hostile threat near
   * the flight path or the landing hex, capped at `max`. Aircraft and drones cover their strike range,
   * missile batteries `batteryRange` and ships `shipRange` hexes.
   */
  intercept: { air: 12, drone: 6, fleet: 8, carrier: 4, battery: 15, max: 45, batteryRange: 3, shipRange: 2 },
  /** Strength (of 1000) and organization a formation loses when its lift is hit. */
  interceptLoss: 250,
  interceptOrganization: 15,
} as const;

/** Right of passage (military access): a treaty between two powers at peace. */
export const PASSAGE = {
  /** Turns it runs; renew by offering again in its last turn. Ends at war. */
  turns: 8,
  /** The lowest mood toward the asker at which a leader grants it, by temperament. */
  mood: { hawk: 15, opportunist: 0, dove: -5 },
  /** Asked without naming whom it is for: a leader wants this much more warmth. */
  unnamed: 10,
} as const;
