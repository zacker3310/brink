// Leaders and their memory: who runs each power, what they remember of the others, and how they
// feel about them now. Plain JSON, like the rest of the contracts.

import type { NationId, SiteId, Stockpile } from './index';

/** A head of government in game-data `LEADERS`. Every one is fictional. */
export type LeaderId = string;

/** How a leader plays the game: a hawk reaches for the sword, a dove for the pen, an opportunist for whatever pays. */
export type Temperament = 'hawk' | 'dove' | 'opportunist';

/**
 * What a leader cares about beyond the war, read from public facts:
 * - balance: fears whoever leads the race;
 * - commerce: loves a trading partner, hates an embargo;
 * - honour: a treaty kept is everything, a broken one unforgivable;
 * - strength: respects the strong and despises the weak;
 * - homeland: wants back every city it ever lost.
 */
export type AgendaId = 'balance' | 'commerce' | 'honour' | 'strength' | 'homeland';

/** Something a leader remembers another power doing. Weights and how long each lasts: game-data `LEADER_TUNING`. */
export type MemoryKind =
  /** Declared war on us while at peace or allied with us. */
  | 'betrayed'
  /** Declared war on us. */
  | 'declared_war'
  /** Took one of our cities or bases. */
  | 'took_city'
  /** Made peace (or a ceasefire) with us. */
  | 'made_peace'
  /** Signed a treaty or a deal with us. */
  | 'dealt'
  /** Forced tribute out of us. */
  | 'extorted'
  /** Paid us tribute when we demanded it. */
  | 'paid_us'
  /** Let our demand lapse without paying. */
  | 'defied'
  /** Took the prize of a joint operation with us. */
  | 'comrades';

export interface LeaderMemory {
  about: NationId;
  kind: MemoryKind;
  /** The turn it happened. */
  turn: number;
}

/** One line of a leader's mood, Civ-style: why they feel as they do and by how much. */
export type MoodReasonId =
  | 'temperament'
  | 'at_war'
  | 'allied'
  | 'trade'
  | 'pact'
  | 'ceasefire'
  | 'joint_op'
  | 'embargo'
  | 'common_enemy'
  | 'feared'
  | 'agenda_balance'
  | 'agenda_commerce'
  | 'agenda_honour'
  | 'agenda_strength_respect'
  | 'agenda_strength_contempt'
  | 'agenda_homeland'
  | MemoryKind;

export interface MoodReason {
  id: MoodReasonId;
  /** Signed contribution to the mood. */
  value: number;
  /** For a memory: how many such things it remembers. */
  count?: number;
}

/** Hostile below -40, wary below -10, neutral to 15, cordial to 40, friendly above (`LEADER_TUNING.stances`). */
export type Stance = 'hostile' | 'wary' | 'neutral' | 'cordial' | 'friendly';

/** How one leader feels about another power: -100..100 with its reasons, largest first. */
export interface Attitude {
  leader: LeaderId;
  mood: number;
  stance: Stance;
  reasons: MoodReason[];
}

/**
 * The terms of a deal. `give` is what the proposer hands over, `get` what it asks for in return;
 * an answer mirrors them. `against` names the common enemy of an alliance, `site` the prize of a
 * joint operation.
 */
export interface DealTerms {
  give?: Partial<Stockpile>;
  get?: Partial<Stockpile>;
  against?: NationId;
  site?: SiteId;
}
