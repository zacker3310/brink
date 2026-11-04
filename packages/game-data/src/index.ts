// Versioned balance data. Every number the simulation uses for balance lives here, so a
// change to balance is a change to RULESET_VERSION and old saves are refused cleanly.
//
// Conventions: integers only. Percentages are whole percent (115 = +15%). Strength is
// 0..1000; organization, morale, readiness, fuel, ammunition, experience, entrenchment and
// supply are 0..100. One turn is six simulated hours.

import type { CampaignLength, Difficulty, FacilityId, GovernmentId, Resource, SiteKind, Stockpile, TechId, Terrain, UnitClass, WorldEventId, Yields } from '@brink/contracts';

export * from './commanders';

export const RULESET_VERSION = '2.3.0';

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
/** Movement points for a ship to enter a sea hex or a port. */
export const NAVAL_MOVE_COST = 2;
/** Supply route cost per sea hex (a sea lane), and the attack lost storming a beach from a ship. */
export const SEA_SUPPLY_COST = 1;
export const AMPHIBIOUS_ASSAULT_PENALTY = 20;
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
  /** Takes and holds ground. Air and ships do not. */
  ground: boolean;
  /** Moves on water and through ports only. */
  naval?: boolean;
  /** Formations it can carry, and of what kind: a transport carries ground units, a carrier air. */
  capacity?: number;
  carries?: 'ground' | 'air';
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
    name: 'Attack Helicopters',
    short: 'HEL',
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
  /** FPV and loitering-munition teams: cheap, fragile, see far, kill armor. Fly from sites like air. */
  drone: {
    name: 'Drone Company',
    short: 'UAV',
    movement: 0,
    softAttack: 25,
    hardAttack: 45,
    defense: 10,
    hardness: 0,
    range: 3,
    vision: 5,
    motorized: true,
    ground: false,
    fuelPerMove: 0,
    ammoPerAttack: 25,
    cost: stock(50, 10, 25, 0),
    industry: 35,
    upkeep: stock(2, 2, 0, 0),
    supplyDemand: 4,
  },
  /** A surface action group: destroyers and cruisers. Strikes ships and the coast two hexes out. */
  fleet: {
    name: 'Surface Fleet',
    short: 'FLT',
    movement: 14,
    softAttack: 40,
    hardAttack: 55,
    defense: 45,
    hardness: 80,
    range: 2,
    vision: 4,
    motorized: true,
    ground: false,
    naval: true,
    fuelPerMove: 1,
    ammoPerAttack: 20,
    cost: stock(160, 40, 80, 0),
    industry: 110,
    upkeep: stock(6, 4, 0, 0),
    supplyDemand: 8,
  },
  /** Amphibious lift: carries two ground formations and lands them on a hostile shore. */
  transport: {
    name: 'Amphibious Group',
    short: 'AMP',
    movement: 14,
    softAttack: 0,
    hardAttack: 0,
    defense: 15,
    hardness: 50,
    range: 0,
    vision: 2,
    motorized: true,
    ground: false,
    naval: true,
    capacity: 2,
    carries: 'ground',
    fuelPerMove: 1,
    ammoPerAttack: 0,
    cost: stock(80, 15, 40, 0),
    industry: 60,
    upkeep: stock(3, 2, 0, 0),
    supplyDemand: 4,
  },
  /** A moving airfield: helicopters and drones base on it and strike from wherever it sails. */
  carrier: {
    name: 'Carrier Group',
    short: 'CVN',
    movement: 12,
    softAttack: 10,
    hardAttack: 10,
    defense: 35,
    hardness: 75,
    range: 0,
    vision: 5,
    motorized: true,
    ground: false,
    naval: true,
    capacity: 2,
    carries: 'air',
    fuelPerMove: 1,
    ammoPerAttack: 0,
    cost: stock(220, 60, 120, 0),
    industry: 160,
    upkeep: stock(8, 6, 0, 0),
    supplyDemand: 10,
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

/**
 * A human seat's command edge by campaign difficulty, applied like a government's modifiers. The AI
 * plays at full strength on every level, so this is what makes Easy easy and Normal fair to a
 * commander still learning the war. Hard has none (the AI gets the stockpile bonus instead).
 */
export const DIFFICULTY_EDGE: Record<Difficulty, Modifiers> = {
  easy: { income: { credits: 70, energy: 70, materials: 70, food: 70 }, industry: 60, research: 40, stability: 15, attack: 40, homeDefense: 50, recruitDiscount: 30, supplyCapacity: 30, ranged: 20 },
  normal: { income: { credits: 30, energy: 30, materials: 30, food: 30 }, industry: 30, research: 20, stability: 5, attack: 20, homeDefense: 25, recruitDiscount: 15, supplyCapacity: 10 },
  hard: {},
};

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
    summary: '+20% artillery, helicopter and drone strikes.',
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

// ---------------------------------------------------------------------------
// Facilities: what a nation can build at its sites. One of each per site, up to the site's slots.

export interface FacilityDef {
  name: string;
  summary: string;
  /** Paid in full when the build is ordered (reserved at validation). */
  cost: Stockpile;
  /** Industrial capacity to finish; construction takes industry before the unit queue. */
  industry: number;
  /** Added to the site's yields while it stands. */
  yields: Partial<Yields>;
  upkeep: Stockpile;
  /** Research that must be finished before it can be built. */
  requires: TechId | null;
}

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  farm: {
    name: 'Farm complex',
    summary: '+12 food a turn.',
    cost: stock(70, 0, 30, 0),
    industry: 30,
    yields: { food: 12 },
    upkeep: stock(0, 0, 0, 0),
    requires: null,
  },
  mine: {
    name: 'Mine',
    summary: '+12 materials a turn.',
    cost: stock(90, 0, 20, 0),
    industry: 40,
    yields: { materials: 12 },
    upkeep: stock(0, 1, 0, 0),
    requires: null,
  },
  power_plant: {
    name: 'Power plant',
    summary: '+14 energy a turn.',
    cost: stock(100, 0, 60, 0),
    industry: 45,
    yields: { energy: 14 },
    upkeep: stock(2, 0, 0, 0),
    requires: null,
  },
  factory: {
    name: 'Factory',
    summary: '+12 industrial capacity: units and buildings finish sooner.',
    cost: stock(120, 0, 80, 0),
    industry: 60,
    yields: { industry: 12 },
    upkeep: stock(0, 2, 0, 0),
    requires: 'industrial_automation',
  },
  research_lab: {
    name: 'Research lab',
    summary: '+8 research a turn.',
    cost: stock(140, 0, 40, 0),
    industry: 50,
    yields: { research: 8 },
    upkeep: stock(3, 1, 0, 0),
    requires: 'signals_intelligence',
  },
  fortress: {
    name: 'Fortress',
    summary: 'Your units here are always dug in to at least 60, even after a bombardment.',
    cost: stock(100, 0, 100, 0),
    industry: 60,
    yields: {},
    upkeep: stock(2, 0, 2, 0),
    requires: 'logistics_doctrine',
  },
};

/** Sorted, so iteration never depends on object insertion order. */
export const FACILITY_ORDER: readonly FacilityId[] = (Object.keys(FACILITIES) as FacilityId[]).sort();

/** How many facilities each kind of site can hold. */
export const FACILITY_SLOTS: Record<SiteKind, number> = { capital: 4, city: 3, depot: 2, objective: 2 };

/** Entrenchment a fortress guarantees its owner's formations. */
export const FORTRESS_ENTRENCHMENT = 60;

// ---------------------------------------------------------------------------
// Treaties and victory paths.

export const TREATIES = {
  /** Turns a non-aggression pact binds both sides (no declaration of war either way). */
  nonaggressionTurns: 6,
  /** Turns a trade agreement runs; renew it by proposing again. */
  tradeTurns: 8,
  /** Income each party gains per turn of trade. */
  tradeIncome: stock(14, 0, 6, 0),
  /** Turns an embargo bars trade between the two. */
  embargoTurns: 5,
} as const;

export const VICTORY = {
  /** Domination: percent of all victory points held by one nation. */
  dominationShare: 40,
  /**
   * Coalition: an all-allied bloc of two or more holds `coalitionBase + coalitionPerMember x members`
   * percent of all victory points (two: 60, three: 80). It scales so allies cannot win by signing:
   * three of four powers start with about two thirds of the map between them.
   */
  coalitionBase: 20,
  coalitionPerMember: 20,
  /**
   * Supremacy: average of a nation's percent shares of victory points, army strength and gross
   * income, with stability at least `supremacyStability`, from `supremacyFromTurn` on.
   */
  supremacyShare: 38,
  supremacyStability: 45,
  supremacyFromTurn: 8,
} as const;

/**
 * The bars a campaign is won by, by its length. Up to an epic 60 turns they are `VICTORY`'s; a longer
 * war (Total War) asks for a conquest: 60% of all victory points outright, or 55% standing held from
 * turn 50, so the war is not over while most of it is still to fight.
 */
export function victoryBars(maxTurns: number): { dominationShare: number; supremacyShare: number; supremacyFromTurn: number } {
  if (maxTurns > 60) return { dominationShare: 60, supremacyShare: 55, supremacyFromTurn: 50 };
  return { dominationShare: VICTORY.dominationShare, supremacyShare: VICTORY.supremacyShare, supremacyFromTurn: VICTORY.supremacyFromTurn };
}

/** Turn limits for each campaign length. Every campaign ends at its limit at the latest. */
export const CAMPAIGN_TURNS: Record<CampaignLength, number> = { quick: 20, standard: 30, epic: 45, total: 250 };

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
  /** Stability a nation loses for declaring war on a nation it is at peace or allied with. */
  perfidy: { peace: 10, alliance: 20 },
  /** Entrenchment a formation loses each time an artillery or air strike hits it. */
  strikeEntrenchment: 25,
  /** Defenders whose organization falls to this level break and retreat. */
  breakOrganization: 15,
  /** At or below this strength a formation is destroyed. */
  destroyedStrength: 50,
  /** Strength loss multiplier per point of opposing power. */
  attackerLethality: 4,
  defenderLethality: 5,
  /** Random swing on combat losses, percent either way. */
  combatSwing: 15,
  /** Kept for the view and older callers; equal to `VICTORY.dominationShare`. */
  victoryShare: 40,
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

// ---------------------------------------------------------------------------
// World events: a two-way decision now and then, so every nation's story diverges.

export interface EventEffect {
  /** Added to the stockpile; a cost the nation cannot cover is paid as far as it can. */
  stockpile?: Partial<Stockpile>;
  stability?: number;
  /** Applied to every formation the nation owns. */
  morale?: number;
  /** Added to research progress toward the current (or banked) tech. */
  research?: number;
}

export interface EventOption {
  label: string;
  effect: EventEffect;
}

export interface EventDef {
  title: string;
  text: string;
  /** Option 0 is what happens if the nation does not answer. */
  options: readonly [EventOption, EventOption];
}

export const EVENTS: Record<WorldEventId, EventDef> = {
  oil_strike: {
    title: 'Oil strike',
    text: 'Surveyors hit a deep field in the interior. The ministries want it; so do the majors.',
    options: [
      { label: 'Nationalize it', effect: { stockpile: { energy: 120 }, stability: -4 } },
      { label: 'Lease it out', effect: { stockpile: { credits: 150 } } },
    ],
  },
  harvest_failure: {
    title: 'Harvest failure',
    text: 'Blight in the breadbasket. The cities will feel it by winter.',
    options: [
      { label: 'Ration and endure', effect: { stability: -8 } },
      { label: 'Buy grain abroad', effect: { stockpile: { credits: -120, food: 80 } } },
    ],
  },
  general_strike: {
    title: 'General strike',
    text: 'The rail and dock unions walk out. Freight stops at the yards.',
    options: [
      { label: 'Break the strike', effect: { stockpile: { materials: 40 }, stability: -10 } },
      { label: 'Meet their terms', effect: { stockpile: { credits: -100 }, stability: 5 } },
    ],
  },
  defector: {
    title: 'A defector',
    text: 'A weapons engineer crosses the line with a briefcase and a price.',
    options: [
      { label: 'Debrief the labs', effect: { research: 60 } },
      { label: 'Parade him on air', effect: { stability: 6 } },
    ],
  },
  arms_dealer: {
    title: 'Arms dealer',
    text: 'A broker offers surplus shells and spares, no questions asked.',
    options: [
      { label: 'Pass', effect: {} },
      { label: 'Buy the lot', effect: { stockpile: { credits: -100, materials: 120 } } },
    ],
  },
  war_bonds: {
    title: 'War bonds',
    text: 'Treasury proposes a bond drive. Patriotic, and a lien on the future.',
    options: [
      { label: 'Run the drive', effect: { stockpile: { credits: 160 }, stability: -5 } },
      { label: 'Not now', effect: {} },
    ],
  },
  volunteers: {
    title: 'Volunteers',
    text: 'Recruiting stations are swamped. Morale is high; factories are short of hands.',
    options: [
      { label: 'Send them to the front', effect: { morale: 10 } },
      { label: 'Put them on the lines', effect: { stockpile: { materials: 80 } } },
    ],
  },
  scandal: {
    title: 'Scandal',
    text: 'A procurement minister is caught with a contractor\'s money.',
    options: [
      { label: 'Pay to bury it', effect: { stockpile: { credits: -80 } } },
      { label: 'Public trial', effect: { stockpile: { credits: 40 }, stability: -6 } },
    ],
  },
};

export const EVENT_IDS: readonly WorldEventId[] = Object.keys(EVENTS).sort() as WorldEventId[];

/** Percent chance a nation without a pending event draws one at the end of a turn. */
export const EVENT_CHANCE = 20;
