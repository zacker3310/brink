// Versioned balance data. Every number the simulation uses for balance lives here, so a
// change to balance is a change to RULESET_VERSION and old saves are refused cleanly.
//
// Conventions: integers only. Percentages are whole percent (115 = +15%). Strength is
// 0..1000; organization, morale, readiness, fuel, ammunition, experience, entrenchment and
// supply are 0..100. One turn is six simulated hours.

import type { GovernmentId, Resource, Stockpile, TechId, Terrain, UnitClass } from '@brink/contracts';

export const RULESET_VERSION = '1.0.0';

export const HOURS_PER_TURN = 6;

export interface TerrainDef {
  name: string;
  /** Movement points to enter. null = impassable to ground formations. */
  moveCost: number | null;
  /** Percent added to defense. */
  defense: number;
  /** Percent removed from armored (mechanized, armor) attacks into this terrain. */
  armorPenalty: number;
  /** Hides formations from observers further than one hex unless they are reconnaissance. */
  concealing: boolean;
  /** Cost of one supply step through this terrain, before infrastructure. */
  supplyCost: number;
}

export const TERRAIN: Record<Terrain, TerrainDef> = {
  plains: { name: 'Plains', moveCost: 2, defense: 0, armorPenalty: 0, concealing: false, supplyCost: 2 },
  forest: { name: 'Forest', moveCost: 3, defense: 25, armorPenalty: 25, concealing: true, supplyCost: 3 },
  hills: { name: 'Hills', moveCost: 4, defense: 35, armorPenalty: 10, concealing: false, supplyCost: 3 },
  mountains: { name: 'Mountains', moveCost: 6, defense: 60, armorPenalty: 40, concealing: true, supplyCost: 5 },
  urban: { name: 'Urban', moveCost: 2, defense: 45, armorPenalty: 30, concealing: true, supplyCost: 1 },
  water: { name: 'Water', moveCost: null, defense: 0, armorPenalty: 0, concealing: false, supplyCost: 99 },
};

/** Extra movement points to enter a hex carrying a river. */
export const RIVER_MOVE_COST = 2;
/** Percent removed from ground assaults into a river hex. */
export const RIVER_ASSAULT_PENALTY = 20;

export interface UnitDef {
  name: string;
  short: string;
  /** Movement points per turn at full readiness and fuel. 0 = moves only by rebasing. */
  movement: number;
  softAttack: number;
  hardAttack: number;
  defense: number;
  /** 0..100: share of incoming fire that counts as hitting a hard (armored) target. */
  hardness: number;
  /** Ranged strike radius in hexes. 0 = assaults only. */
  range: number;
  vision: number;
  /** Uses fuel to move, and loses half its movement without it. */
  motorized: boolean;
  /** Takes and holds ground. Air does not. */
  ground: boolean;
  fuelPerMove: number;
  ammoPerAttack: number;
  cost: Stockpile;
  /** Industrial capacity required to complete. */
  industry: number;
  upkeep: Stockpile;
  /** Supply points demanded per turn. */
  supplyDemand: number;
}

const stock = (credits: number, energy: number, materials: number, food: number): Stockpile => ({
  credits,
  energy,
  materials,
  food,
});

export const UNITS: Record<UnitClass, UnitDef> = {
  infantry: {
    name: 'Infantry',
    short: 'INF',
    movement: 6,
    softAttack: 30,
    hardAttack: 12,
    defense: 42,
    hardness: 0,
    range: 0,
    vision: 2,
    motorized: false,
    ground: true,
    fuelPerMove: 0,
    ammoPerAttack: 20,
    cost: stock(40, 0, 20, 10),
    industry: 30,
    upkeep: stock(2, 0, 0, 2),
    supplyDemand: 4,
  },
  mechanized: {
    name: 'Mechanized Infantry',
    short: 'MEC',
    movement: 10,
    softAttack: 40,
    hardAttack: 25,
    defense: 45,
    hardness: 40,
    range: 0,
    vision: 2,
    motorized: true,
    ground: true,
    fuelPerMove: 2,
    ammoPerAttack: 20,
    cost: stock(70, 10, 40, 10),
    industry: 50,
    upkeep: stock(3, 2, 0, 2),
    supplyDemand: 6,
  },
  armor: {
    name: 'Armor',
    short: 'ARM',
    movement: 10,
    softAttack: 45,
    hardAttack: 60,
    defense: 50,
    hardness: 80,
    range: 0,
    vision: 2,
    motorized: true,
    ground: true,
    fuelPerMove: 3,
    ammoPerAttack: 25,
    cost: stock(100, 15, 70, 5),
    industry: 80,
    upkeep: stock(4, 4, 0, 1),
    supplyDemand: 8,
  },
  artillery: {
    name: 'Artillery',
    short: 'ART',
    movement: 6,
    softAttack: 55,
    hardAttack: 25,
    defense: 15,
    hardness: 10,
    range: 2,
    vision: 1,
    motorized: false,
    ground: true,
    fuelPerMove: 0,
    ammoPerAttack: 30,
    cost: stock(70, 5, 50, 5),
    industry: 60,
    upkeep: stock(3, 1, 0, 1),
    supplyDemand: 7,
  },
  recon: {
    name: 'Reconnaissance',
    short: 'REC',
    movement: 14,
    softAttack: 15,
    hardAttack: 10,
    defense: 20,
    hardness: 20,
    range: 0,
    vision: 4,
    motorized: true,
    ground: true,
    fuelPerMove: 1,
    ammoPerAttack: 10,
    cost: stock(40, 5, 15, 5),
    industry: 25,
    upkeep: stock(2, 1, 0, 1),
    supplyDemand: 3,
  },
  air: {
    name: 'Air Support',
    short: 'AIR',
    movement: 0,
    softAttack: 50,
    hardAttack: 50,
    defense: 20,
    hardness: 30,
    range: 4,
    vision: 3,
    motorized: true,
    ground: false,
    fuelPerMove: 0,
    ammoPerAttack: 30,
    cost: stock(120, 20, 60, 0),
    industry: 90,
    upkeep: stock(5, 4, 0, 0),
    supplyDemand: 8,
  },
};

/** Air formations rebase between own sites up to this many hexes apart. */
export const AIR_REBASE_RANGE = 8;
/** Maximum own (and allied) formations in one hex. */
export const STACK_LIMIT = 3;

export interface Modifiers {
  /** Percent added to each resource's gross income. */
  income?: Partial<Record<Resource, number>>;
  industry?: number;
  research?: number;
  stability?: number;
  attack?: number;
  /** Percent added to defense when defending own territory. */
  homeDefense?: number;
  /** Percent removed from recruitment resource costs. */
  recruitDiscount?: number;
  supplyCapacity?: number;
  supplyRange?: number;
  vision?: number;
  combinedArms?: number;
  /** Percent added to ranged (artillery and air) strikes. */
  ranged?: number;
  /** Percent added to defense of armored formations. */
  armorDefense?: number;
}

export interface GovernmentDef {
  name: string;
  summary: string;
  modifiers: Modifiers;
}

export const GOVERNMENTS: Record<GovernmentId, GovernmentDef> = {
  commonwealth: {
    name: 'Mercantile Commonwealth',
    summary: 'Rich treasury and steady institutions; a modest army.',
    modifiers: { income: { credits: 20 }, stability: 5, research: 10, attack: -5 },
  },
  directorate: {
    name: 'Industrial Directorate',
    summary: 'Heavy industry and an offensive doctrine; brittle at home.',
    modifiers: { industry: 20, attack: 10, stability: -8 },
  },
  federation: {
    name: 'Technocratic Federation',
    summary: 'Fast research and long supply lines; thin raw materials.',
    modifiers: { research: 25, supplyRange: 2, income: { materials: -10, food: 10 } },
  },
  union: {
    name: 'Agrarian Union',
    summary: 'Cheap, stubborn mass armies that defend home ground fiercely.',
    modifiers: { income: { food: 20, materials: 10 }, recruitDiscount: 15, homeDefense: 15, research: -10 },
  },
};

export interface TechDef {
  name: string;
  summary: string;
  cost: number;
  requires: TechId[];
  modifiers: Modifiers;
}

export const TECHS: Record<TechId, TechDef> = {
  logistics_doctrine: {
    name: 'Logistics Doctrine',
    summary: '+25% supply capacity, +2 supply range.',
    cost: 120,
    requires: [],
    modifiers: { supplyCapacity: 25, supplyRange: 2 },
  },
  signals_intelligence: {
    name: 'Signals Intelligence',
    summary: '+1 vision for every formation.',
    cost: 140,
    requires: [],
    modifiers: { vision: 1 },
  },
  industrial_automation: {
    name: 'Industrial Automation',
    summary: '+20% industrial capacity.',
    cost: 160,
    requires: [],
    modifiers: { industry: 20 },
  },
  combined_arms: {
    name: 'Combined Arms Doctrine',
    summary: '+5% per extra unit class in an assault.',
    cost: 180,
    requires: ['logistics_doctrine'],
    modifiers: { combinedArms: 5 },
  },
  precision_munitions: {
    name: 'Precision Munitions',
    summary: '+20% artillery and air strikes.',
    cost: 200,
    requires: ['signals_intelligence'],
    modifiers: { ranged: 20 },
  },
  composite_armor: {
    name: 'Composite Armor',
    summary: '+20% defense for armor and mechanized infantry.',
    cost: 200,
    requires: ['industrial_automation'],
    modifiers: { armorDefense: 20 },
  },
};

/** Sorted, so iteration never depends on object insertion order. */
export const TECH_IDS: readonly TechId[] = Object.keys(TECHS).sort();

export const SITE_SUPPLY: Record<'capital' | 'city' | 'depot' | 'objective', number> = {
  capital: 60,
  city: 30,
  depot: 25,
  objective: 0,
};

export const RULES = {
  /** Supply route cost beyond which delivery efficiency starts to fall (plains cost 2). */
  supplyRange: 16,
  /** Delivery efficiency lost per point of route cost beyond the range, in percent. */
  supplyFalloff: 5,
  /** Extra supply cost to pass a hex next to an enemy formation. */
  interdictionCost: 3,
  /** Energy consumed per 10 fuel delivered; materials per 10 ammunition delivered. */
  logisticsPer10: 1,
  /** Assault outcome thresholds on attacker share of combat power, permille. */
  breakthrough: 600,
  repulse: 450,
  /** Defenders whose organization falls to this level break and retreat. */
  breakOrganization: 15,
  /** At or below this strength a formation is destroyed. */
  destroyedStrength: 50,
  /** Strength loss multiplier per point of opposing power. */
  attackerLethality: 4,
  defenderLethality: 5,
  /** Random swing on combat losses, percent either way. */
  combatSwing: 15,
  victoryShare: 45,
  baseStability: 60,
  /** Credits per this many owned hexes. */
  hexesPerCredit: 4,
  /** Food consumed per this many thousand population. */
  popPerFood: 200,
  /** Energy consumed per this many points of industrial capacity. */
  industryPerEnergy: 5,
  newFormation: { strength: 1000, organization: 60, morale: 70, readiness: 60, fuel: 100, ammunition: 100 },
  /** Strength regained per turn by a rested, fully supplied formation. */
  reinforcement: 25,
  /** Materials spent per 5 strength regained. */
  reinforcementMaterialsPer5: 1,
} as const;
