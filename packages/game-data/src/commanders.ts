// Commanders: the generals, their signature traits, the perks they earn, and the rosters a power
// starts with. Integers only, like every balance number. Changing one is a ruleset change.

import type { CommanderTraitId, GovernmentId, NationId, PerkId } from '@brink/contracts';
import { ROSTER as china } from './nations/china';
import { ROSTER as russia } from './nations/russia';
import { ROSTER as japan } from './nations/japan';
import { ROSTER as usa } from './nations/usa';
import { ROSTER as canada } from './nations/canada';
import { ROSTER as mexico } from './nations/mexico';
import { ROSTER as colombia } from './nations/colombia';
import { ROSTER as brazil } from './nations/brazil';
import { ROSTER as argentina } from './nations/argentina';

/**
 * What a general (a trait, a perk, or simply being there) does for the formation they lead.
 * Every field is an integer; absent means 0.
 */
export interface CommanderEffect {
  /** Percent added to the formation's assault power (and in head-on meetings). */
  attack?: number;
  /** Percent added to its defence. */
  defense?: number;
  /** Percent added to its artillery or air strikes. */
  strike?: number;
  /** Percent of the amphibious assault penalty removed (100 removes it). */
  amphibious?: number;
  /** Entrenchment gained each turn it holds or digs in. */
  entrench?: number;
  /** Supply points added after logistics, to at most 100. */
  supply?: number;
  /** Morale regained each turn. */
  morale?: number;
  /** Readiness regained each turn (readiness is speed and fighting trim). */
  readiness?: number;
  /** Hexes of sight. */
  vision?: number;
  /** Battle rank in a hand-fought arena battle. */
  rank?: number;
  /** Percent more experience the general earns. */
  xp?: number;
  /** Percent off the chance of the general being wounded or killed. */
  survival?: number;
}

export const COMMANDER_EFFECT_KEYS = ['attack', 'defense', 'strike', 'amphibious', 'entrench', 'supply', 'morale', 'readiness', 'vision', 'rank', 'xp', 'survival'] as const satisfies readonly (keyof CommanderEffect)[];

export interface CommanderTraitDef {
  name: string;
  summary: string;
  effect: CommanderEffect;
}

export const COMMANDER_TRAITS: Record<CommanderTraitId, CommanderTraitDef> = {
  firebrand: { name: 'Firebrand', summary: '+5% assault power', effect: { attack: 5 } },
  ironside: { name: 'Ironside', summary: '+5% defence', effect: { defense: 5 } },
  gunner: { name: 'Old Gunner', summary: '+10% strike damage', effect: { strike: 10 } },
  marine: { name: 'Marine', summary: 'Half the beach-landing penalty', effect: { amphibious: 50 } },
  quartermaster: { name: 'Quartermaster', summary: '+10 supply', effect: { supply: 10 } },
  beloved: { name: 'Beloved', summary: '+3 morale a turn', effect: { morale: 3 } },
  sapper: { name: 'Sapper', summary: '+5 entrenchment a turn when holding', effect: { entrench: 5 } },
  scholar: { name: 'Scholar of War', summary: '+25% experience', effect: { xp: 25 } },
  lucky: { name: 'Lucky', summary: 'Half the risk of wounds', effect: { survival: 50 } },
};

export interface PerkDef {
  name: string;
  /** One line, as printed on the card. */
  summary: string;
  effect: CommanderEffect;
}

export const PERKS: Record<PerkId, PerkDef> = {
  shock_assault: { name: 'Shock Assault', summary: '+10% assault power', effect: { attack: 10 } },
  hold_the_line: { name: 'Hold the Line', summary: '+10% defence', effect: { defense: 10 } },
  fire_plan: { name: 'Fire Plan', summary: '+15% strike damage', effect: { strike: 15 } },
  beachmaster: { name: 'Beachmaster', summary: 'No beach-landing penalty', effect: { amphibious: 100 } },
  dig_deep: { name: 'Dig Deep', summary: '+10 entrenchment a turn when holding', effect: { entrench: 10 } },
  iron_supply: { name: 'Iron Supply', summary: '+20 supply', effect: { supply: 20 } },
  rally: { name: 'Rally', summary: '+5 morale a turn', effect: { morale: 5 } },
  forced_march: { name: 'Forced March', summary: '+8 readiness a turn', effect: { readiness: 8 } },
  eyes_forward: { name: 'Eyes Forward', summary: '+1 hex of sight', effect: { vision: 1 } },
  veteran_cadre: { name: 'Veteran Cadre', summary: '+1 battle rank in the arena', effect: { rank: 1 } },
  charmed_life: { name: 'Charmed Life', summary: '60% less risk of wounds', effect: { survival: 60 } },
};

export const PERK_IDS: readonly PerkId[] = Object.keys(PERKS).sort();

/** Titles by level, 1..5. */
export const COMMANDER_RANKS = ['Brigadier', 'Major General', 'Lieutenant General', 'General', 'Marshal'] as const;

export const COMMANDER_RULES = {
  /** Generals each power starts with. Minor states have none. */
  perNation: 3,
  maxLevel: 5,
  /** Experience needed for each level, 1..5. */
  levelXp: [0, 6, 18, 36, 60],
  /** What any general in command adds, before traits and perks. */
  base: { attack: 5, defense: 5 } satisfies CommanderEffect,
  /** Experience earned in command. */
  xp: { battle: 3, victory: 2, strike: 2, capture: 4 },
  /** Percent chances when the formation is destroyed: killed, else wounded, else the general escapes. */
  destroyed: { killed: 35, wounded: 50 },
  /** Percent chance of a wound when the formation is beaten back. */
  retreatWound: 10,
  /** Turns a wound keeps a general out of command. */
  woundTurns: { destroyed: 4, retreat: 2 },
} as const;

/** The level `xp` earns, 1..5. */
export function levelForXp(xp: number): number {
  let level = 1;
  COMMANDER_RULES.levelXp.forEach((need, i) => {
    if (xp >= need) level = i + 1;
  });
  return level;
}

// ---------------------------------------------------------------------------
// Rosters

export interface GeneralDef {
  name: string;
  trait: CommanderTraitId;
}

/** Fictional generals by government, for any power without a roster of its own. */
export const GENERIC_ROSTER: Record<GovernmentId, readonly GeneralDef[]> = {
  commonwealth: [
    { name: 'Eleanor Ashby', trait: 'quartermaster' },
    { name: 'Rupert Vane', trait: 'ironside' },
    { name: 'Miriam Holt', trait: 'scholar' },
  ],
  directorate: [
    { name: 'Anton Kessel', trait: 'firebrand' },
    { name: 'Ilse Varga', trait: 'gunner' },
    { name: 'Bohdan Rusk', trait: 'sapper' },
  ],
  federation: [
    { name: 'Lena Moreau', trait: 'marine' },
    { name: 'Tobias Quill', trait: 'gunner' },
    { name: 'Aiko Brandt', trait: 'lucky' },
  ],
  union: [
    { name: 'Grigor Halloway', trait: 'beloved' },
    { name: 'Dara Okonkwo', trait: 'ironside' },
    { name: 'Pavel Strand', trait: 'firebrand' },
  ],
};

/**
 * Per-country rosters, overriding the generic one. A country file (`nations/<id>.ts`) exports its
 * `ROSTER: GeneralDef[]`; registering it is one import and one entry here, e.g.
 * `import { ROSTER as usa } from './nations/usa';` and `usa,` below.
 */
export const NATION_ROSTERS: Record<NationId, readonly GeneralDef[]> = {
  china,
  russia,
  japan,
  usa,
  canada,
  mexico,
  colombia,
  brazil,
  argentina,
};

/** The generals `nation` fields: its own roster, else its government's. */
export function rosterFor(nation: NationId, government: GovernmentId): readonly GeneralDef[] {
  return NATION_ROSTERS[nation] ?? GENERIC_ROSTER[government];
}
