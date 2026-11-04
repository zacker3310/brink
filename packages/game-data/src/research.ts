// The technology tree: five branches of research, each technology with its prerequisites, its cost
// in research points and what it gives. Effects are `Modifiers` read where they apply (combat,
// movement, supply, the economy, doctrine cards, city growth), facilities it unlocks (`FACILITIES`
// `requires`), and off-map support it puts over the player's hand-fought battles. The six
// technologies of ruleset 2.0 keep their ids: the arena's battle abilities are keyed on them.

import type { TechId } from '@brink/contracts';
import type { CardSupportAsset } from './doctrine';
import type { Modifiers } from './index';

export type TechBranch = 'economy' | 'armour' | 'air' | 'naval' | 'cyber';

export interface TechBranchDef {
  name: string;
  summary: string;
}

/** Display order of the branches. */
export const TECH_BRANCHES: readonly TechBranch[] = ['economy', 'armour', 'air', 'naval', 'cyber'];

export const BRANCHES: Record<TechBranch, TechBranchDef> = {
  economy: { name: 'Logistics & Economy', summary: 'Supply, industry and growing cities.' },
  armour: { name: 'Armour', summary: 'Tanks and mechanized infantry: tougher, faster, harder-hitting.' },
  air: { name: 'Air & Missiles', summary: 'Strikes from the sky and from far away.' },
  naval: { name: 'Naval', summary: 'Ports, fleets and carriers.' },
  cyber: { name: 'Cyber & Intel', summary: 'Seeing more, planning better, thinking faster.' },
};

/** Off-map support a technology puts over every hand-fought battle (`coastal`: only a battle on the coast). */
export interface TechSupport {
  asset: CardSupportAsset;
  missions: number;
  coastal?: boolean;
}

export interface TechDef {
  name: string;
  /** The effect in rules terms. */
  summary: string;
  /** Plain words for the research screen: what the player gets. */
  gives: string;
  branch: TechBranch;
  /** Depth in its branch, 1..4: the column the research screen draws it in. */
  tier: number;
  cost: number;
  requires: TechId[];
  modifiers: Modifiers;
  /** Support missions in the player's hand-fought battles. */
  support?: TechSupport[];
}

export const TECHS: Record<TechId, TechDef> = {
  // --- Logistics & Economy ---------------------------------------------------------------------
  logistics_doctrine: {
    name: 'Logistics Doctrine',
    summary: '+25% supply capacity, +2 supply range.',
    gives: 'Your units stay supplied further from home. Unlocks the Fortress.',
    branch: 'economy',
    tier: 1,
    cost: 120,
    requires: [],
    modifiers: { supplyCapacity: 25, supplyRange: 2 },
  },
  industrial_automation: {
    name: 'Industrial Automation',
    summary: '+20% industrial capacity.',
    gives: 'Your cities build units 20% faster. Unlocks the Factory.',
    branch: 'economy',
    tier: 1,
    cost: 160,
    requires: [],
    modifiers: { industry: 20 },
  },
  urban_planning: {
    name: 'Urban Planning',
    summary: '+50% city growth, buildings 15% cheaper.',
    gives: 'Cities grow half again as fast and buildings cost less.',
    branch: 'economy',
    tier: 2,
    cost: 200,
    requires: ['industrial_automation'],
    modifiers: { growth: 50, buildDiscount: 15 },
  },
  rail_network: {
    name: 'Rail Network',
    summary: '+20% supply capacity, +2 supply range, +5% materials.',
    gives: 'Railways carry more supply further, and bring in more materials.',
    branch: 'economy',
    tier: 2,
    cost: 220,
    requires: ['logistics_doctrine'],
    modifiers: { supplyCapacity: 20, supplyRange: 2, income: { materials: 5 } },
  },
  war_economy: {
    name: 'War Economy',
    summary: '+15% industry, +10% credits and materials.',
    gives: 'The whole country works for the war: more industry and income.',
    branch: 'economy',
    tier: 3,
    cost: 300,
    requires: ['urban_planning', 'rail_network'],
    modifiers: { industry: 15, income: { credits: 10, materials: 10 } },
  },

  // --- Armour ----------------------------------------------------------------------------------
  combined_arms: {
    name: 'Combined Arms Doctrine',
    summary: '+5% per extra unit class in an assault.',
    gives: 'Attacks with mixed unit types hit harder.',
    branch: 'armour',
    tier: 1,
    cost: 180,
    requires: ['logistics_doctrine'],
    modifiers: { combinedArms: 5 },
  },
  composite_armor: {
    name: 'Composite Armor',
    summary: '+20% defense for armor and mechanized infantry.',
    gives: 'Tanks and IFVs take 20% less damage.',
    branch: 'armour',
    tier: 1,
    cost: 200,
    requires: ['industrial_automation'],
    modifiers: { armorDefense: 20 },
  },
  mobile_warfare: {
    name: 'Mobile Warfare',
    summary: '+1 movement for armor and mechanized infantry.',
    gives: 'Tanks and IFVs move one hex-step further each turn.',
    branch: 'armour',
    tier: 2,
    cost: 240,
    requires: ['combined_arms'],
    modifiers: { armorMove: 1 },
  },
  active_protection: {
    name: 'Active Protection',
    summary: '+15% more defense for armor and mechanized infantry.',
    gives: 'Hard-kill systems swat incoming missiles: tanks and IFVs are tougher still.',
    branch: 'armour',
    tier: 2,
    cost: 260,
    requires: ['composite_armor'],
    modifiers: { armorDefense: 15 },
  },
  heavy_armour: {
    name: 'Next-Generation Armour',
    summary: '+20% attack for armor and mechanized infantry.',
    gives: 'A new tank generation: armoured assaults hit 20% harder.',
    branch: 'armour',
    tier: 3,
    cost: 340,
    requires: ['mobile_warfare', 'active_protection'],
    modifiers: { armorAttack: 20 },
  },

  // --- Air & Missiles --------------------------------------------------------------------------
  air_mobility: {
    name: 'Air Mobility',
    summary: '+5% strikes; a strike sortie in every battle.',
    gives: 'A jet sortie over every battle you fight. Unlocks the Airbase.',
    branch: 'air',
    tier: 1,
    cost: 140,
    requires: [],
    modifiers: { ranged: 5 },
    support: [{ asset: 'strike_jet', missions: 1 }],
  },
  precision_munitions: {
    name: 'Precision Munitions',
    summary: '+20% artillery, helicopter and drone strikes.',
    gives: 'Artillery, helicopters and drones hit 20% harder.',
    branch: 'air',
    tier: 2,
    cost: 200,
    requires: ['signals_intelligence'],
    modifiers: { ranged: 20 },
  },
  loitering_munitions: {
    name: 'Loitering Munitions',
    summary: '+10% strikes; a kamikaze swarm in every battle.',
    gives: 'A swarm of one-way drones in every battle you fight.',
    branch: 'air',
    tier: 2,
    cost: 200,
    requires: ['air_mobility'],
    modifiers: { ranged: 10 },
    support: [{ asset: 'kamikaze', missions: 1 }],
  },
  cruise_missiles: {
    name: 'Cruise Missiles',
    summary: '+5% strikes; a cruise missile in every battle.',
    gives: 'A cruise missile in every battle you fight. Unlocks the Missile battery.',
    branch: 'air',
    tier: 3,
    cost: 260,
    requires: ['precision_munitions'],
    modifiers: { ranged: 5 },
    support: [{ asset: 'cruise_missile', missions: 1 }],
  },
  stealth_airframes: {
    name: 'Stealth Airframes',
    summary: '+15% strikes; another strike sortie in every battle.',
    gives: 'Jets the enemy cannot see: strikes hit harder and another sortie flies.',
    branch: 'air',
    tier: 4,
    cost: 360,
    requires: ['cruise_missiles', 'loitering_munitions'],
    modifiers: { ranged: 15 },
    support: [{ asset: 'strike_jet', missions: 1 }],
  },

  // --- Naval -----------------------------------------------------------------------------------
  naval_engineering: {
    name: 'Naval Engineering',
    summary: '+1 movement for ships.',
    gives: 'Your ships sail further each turn. Unlocks the Naval yard.',
    branch: 'naval',
    tier: 1,
    cost: 140,
    requires: [],
    modifiers: { navalMove: 1 },
  },
  littoral_warfare: {
    name: 'Littoral Warfare',
    summary: '+20% ship attack; naval gunfire in coastal battles.',
    gives: 'Ships hit 20% harder, and your guns offshore join every battle on the coast.',
    branch: 'naval',
    tier: 2,
    cost: 200,
    requires: ['naval_engineering'],
    modifiers: { navalAttack: 20 },
    support: [{ asset: 'naval_gun', missions: 1, coastal: true }],
  },
  carrier_aviation: {
    name: 'Carrier Aviation',
    summary: '+20% ship defense; a strike sortie in coastal battles.',
    gives: 'Ships are 20% tougher, and carrier jets fly over every battle on the coast.',
    branch: 'naval',
    tier: 3,
    cost: 260,
    requires: ['naval_engineering', 'air_mobility'],
    modifiers: { navalDefense: 20 },
    support: [{ asset: 'strike_jet', missions: 1, coastal: true }],
  },
  blue_water_navy: {
    name: 'Blue-Water Navy',
    summary: '+15% ship attack and defense, +1 movement for ships.',
    gives: 'A navy for the open ocean: faster, tougher, harder-hitting ships.',
    branch: 'naval',
    tier: 4,
    cost: 340,
    requires: ['littoral_warfare', 'carrier_aviation'],
    modifiers: { navalAttack: 15, navalDefense: 15, navalMove: 1 },
  },

  // --- Cyber & Intel ---------------------------------------------------------------------------
  signals_intelligence: {
    name: 'Signals Intelligence',
    summary: '+1 vision for every formation.',
    gives: 'Every unit sees one hex further. Unlocks the Research lab.',
    branch: 'cyber',
    tier: 1,
    cost: 140,
    requires: [],
    modifiers: { vision: 1 },
  },
  staff_college: {
    name: 'Staff College',
    summary: '+1 doctrine card in hand.',
    gives: 'Trained staff officers: you hold one more doctrine card.',
    branch: 'cyber',
    tier: 1,
    cost: 150,
    requires: [],
    modifiers: { handSize: 1 },
  },
  electronic_warfare: {
    name: 'Electronic Warfare',
    summary: '+5% attack, +5% defense at home.',
    gives: 'Jam their radios: your attacks and home defense are 5% stronger.',
    branch: 'cyber',
    tier: 2,
    cost: 220,
    requires: ['signals_intelligence'],
    modifiers: { attack: 5, homeDefense: 5 },
  },
  command_networks: {
    name: 'Command Networks',
    summary: '+1 Command Point a turn, +3% combined arms.',
    gives: 'Networked headquarters: one more Command Point every turn.',
    branch: 'cyber',
    tier: 2,
    cost: 260,
    requires: ['staff_college', 'signals_intelligence'],
    modifiers: { commandPoints: 1, combinedArms: 3 },
  },
  quantum_computing: {
    name: 'Quantum Computing',
    summary: '+25% research.',
    gives: 'Every breakthrough after this one comes a quarter faster.',
    branch: 'cyber',
    tier: 3,
    cost: 320,
    requires: ['electronic_warfare', 'command_networks'],
    modifiers: { research: 25 },
  },
};

/** Sorted, so iteration never depends on object insertion order. */
export const TECH_IDS: readonly TechId[] = Object.keys(TECHS).sort();

/** Research points banked while nothing is being researched, at most. */
export const RESEARCH_BANK = 300;
