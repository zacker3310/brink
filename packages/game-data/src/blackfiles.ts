// The Black Files: balance data (MASTER-PLAN Phase 8). Rules: simulation `blackfiles.ts`. State:
// contracts `blackfiles.ts`. Every number here is an integer; a change is a ruleset change.
//
// The Visitors are wholly fictional. Their design language: lattices, not hulls; they do not fly
// flags, they grow; they do not talk. Their three kinds of formation are named for what a human
// staff officer would call them.

import type { FormationClass, Stockpile, UnitClass, VisitorClass } from '@brink/contracts';
import type { UnitDef } from './index';

const none: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };

/** The Visitors' formations. They cost nothing and pay no upkeep: incursions grow them (`BLACK_FILES.spawnEvery`). */
export const VISITOR_UNITS: Record<VisitorClass, UnitDef> = {
  /** A lattice of crystal on six legs: slow, very hard to hurt, and it walks through anything. */
  walker: {
    name: 'Crystalline Walker',
    short: 'XWK',
    movement: 8,
    softAttack: 50,
    hardAttack: 55,
    defense: 55,
    hardness: 85,
    range: 0,
    vision: 2,
    motorized: false,
    ground: true,
    fuelPerMove: 0,
    ammoPerAttack: 0,
    cost: none,
    industry: 0,
    upkeep: none,
    supplyDemand: 1,
  },
  /** A cloud of drones a hand long. Fast, fragile, and past a size it splits in two (`splitAt`). */
  swarm: {
    name: 'Swarm Drones',
    short: 'XSW',
    movement: 14,
    softAttack: 40,
    hardAttack: 30,
    defense: 22,
    hardness: 10,
    range: 0,
    vision: 3,
    motorized: false,
    ground: true,
    fuelPerMove: 0,
    ammoPerAttack: 0,
    cost: none,
    industry: 0,
    upkeep: none,
    supplyDemand: 1,
  },
  /** A spire that throws a shield over its hex: assaults there are absorbed (`shieldAbsorb`); strikes break it. */
  emitter: {
    name: 'Shield Emitter',
    short: 'XSE',
    movement: 4,
    softAttack: 15,
    hardAttack: 15,
    defense: 70,
    hardness: 90,
    range: 0,
    vision: 2,
    motorized: false,
    ground: true,
    fuelPerMove: 0,
    ammoPerAttack: 0,
    cost: none,
    industry: 0,
    upkeep: none,
    supplyDemand: 1,
  },
};

export const BLACK_FILES = {
  /** Turns a power must hold an excavation site running for it to yield an artefact. */
  digTurns: 3,
  /** Artefacts in each excavation site. */
  digYield: 2,
  /** Artefacts dug up before the Visitors wake, by default (a scenario may set its own). */
  wakeAt: 3,
  /** Hexes round an incursion's centre that are the Visitors' from the moment it opens. */
  incursionRadius: 1,
  /** Victory points an incursion is worth to whoever takes it. */
  incursionVp: 6,
  /** Each incursion grows a formation every this many turns, while it holds fewer than `incursionCap` near it. */
  spawnEvery: 1,
  incursionCap: 5,
  /** What an incursion grows, in turn: `roll` picks from this list. */
  spawnMix: ['walker', 'swarm', 'swarm', 'walker', 'emitter'] as readonly VisitorClass[],
  /** The incursion's first wave, per incursion, on the turn it opens. */
  firstWave: ['walker', 'swarm', 'emitter'] as readonly VisitorClass[],
  /** A swarm this strong (of 1000) or more splits into two at half strength, into a free hex next to it. */
  splitAt: 800,
  /** A new swarm's strength: it regrows to `splitAt` and splits. */
  swarmBirth: 600,
  /** Two swarms in one hex whose strength sums to at most this re-form into one. */
  reformAt: 1000,
  /**
   * The incursion zone spreads: every `bloomEvery` turns, crystal at least `bloomDistance` from every
   * incursion the Visitors hold blooms into a new one with `bloomWave`, up to `maxIncursions` ever.
   */
  bloomEvery: 3,
  bloomDistance: 3,
  maxIncursions: 6,
  bloomWave: ['walker', 'swarm'] as readonly VisitorClass[],
  /** Turns the Visitors must hold a hex running before it turns to crystal (rough hills). */
  convertTurns: 3,
  /** Percent of the damage an assault deals that is absorbed when a shield emitter stands in the hex: only strikes break it. */
  shieldAbsorb: 60,
  /** Stability lost by a power that breaks the Accord, once. */
  betrayalStability: 25,
  /** Percent chance a turn that a power with reverse-engineered technology has its programme leak. */
  leakChance: 6,
  /**
   * The Visitors win holding this percent of all victory points, or at the turn limit still holding
   * `limitShare` percent: the incursion was never put down.
   */
  visitorsShare: 30,
  limitShare: 12,
  /** Every Visitors formation regains this much strength a turn on crystal or its own ground. */
  regrowth: 50,
} as const;

/**
 * What a power's staff reads a Visitors formation as, where a table knows only the powers' classes:
 * the AI's tally of what it faces, and the arena's stand-in templates for a hand-fought battle.
 */
export const VISITOR_STAND_IN: Record<VisitorClass, UnitClass> = { walker: 'armor', swarm: 'drone', emitter: 'artillery' };

/** A formation's class as one of the powers' own: itself, or the Visitors' stand-in. */
export function standIn(c: FormationClass): UnitClass {
  return (VISITOR_STAND_IN as Partial<Record<FormationClass, UnitClass>>)[c] ?? (c as UnitClass);
}
