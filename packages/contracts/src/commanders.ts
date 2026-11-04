// Commanders: named generals a nation grows over a campaign. Plain JSON like the rest of the
// contracts. Traits and perks are data ids; their effects live in game-data `COMMANDER_TRAITS`
// and `PERKS`.

import type { FormationId, NationId } from './index';

export type CommanderId = string;
/** A signature trait (game-data `COMMANDER_TRAITS`). */
export type CommanderTraitId = string;
/** A perk chosen on a level-up (game-data `PERKS`). */
export type PerkId = string;

export type CommanderStatus = 'active' | 'wounded' | 'killed';

/** Two perks offered on a level-up; the nation answers with an index. Unanswered: option 0. */
export interface PerkOffer {
  options: [PerkId, PerkId];
  /** The turn it was offered at the end of. */
  turn: number;
  /** The level it was earned at. */
  level: number;
}

export interface Commander {
  id: CommanderId;
  name: string;
  nation: NationId;
  /** The badge drawn for the general: two initials (no image assets). */
  portrait: string;
  /** Signature traits; one from the roster today. */
  traits: CommanderTraitId[];
  /** 1..5. */
  level: number;
  xp: number;
  /** Chosen perks, in the order chosen. */
  perks: PerkId[];
  /** The formation the general leads, or null when in reserve. */
  formation: FormationId | null;
  status: CommanderStatus;
  /** Turns until a wounded general can take a command again; 0 otherwise. */
  woundedTurns: number;
  /** A level-up waiting for the nation's choice. */
  offer: PerkOffer | null;
  /** Engagements and strikes fought in command. */
  battles: number;
}

/** Give a general a formation to lead, or (null) call them back to the reserve. */
export interface CommandAssignment {
  commander: CommanderId;
  formation: FormationId | null;
}

/** A nation's commander orders for one turn. */
export interface CommanderOrders {
  assign?: CommandAssignment[];
  /** Answers to pending level-ups: which of the two offered perks. */
  perks?: Record<CommanderId, 0 | 1>;
}

/** What a nation may know of a foreign general leading a contact it sees now. */
export interface CommanderSighting {
  name: string;
  level: number;
  nation: NationId;
}

export type CommanderChange = 'assigned' | 'relieved' | 'level_up' | 'perk' | 'wounded' | 'killed' | 'recovered';

export interface CommanderEvent {
  kind: 'commander';
  nation: NationId;
  commander: CommanderId;
  name: string;
  change: CommanderChange;
  formation?: FormationId;
  level?: number;
  perk?: PerkId;
}
