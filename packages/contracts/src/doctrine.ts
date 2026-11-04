// Doctrine cards: a hand of national cards played with the turn's orders, paid for in Command
// Points. Plain JSON like the rest of the state. Card definitions (names, costs, effects) are
// balance data in `@brink/game-data` (`CARDS`); only ids travel in state and orders.

import type { FormationId, HexKey, NationId } from './index';

/** A card's id in `CARDS` (game-data). Nations may add their own signature cards. */
export type CardId = string;

/** One card played with a turn's orders. `target` for a hex card, `nation` for a card aimed at a power. */
export interface CardPlay {
  card: CardId;
  target?: HexKey;
  nation?: NationId;
}

/** A played card still working: from the turn it was played through `until` (inclusive). */
export interface ActiveEffect {
  card: CardId;
  /** The turn it was played. */
  from: number;
  until: number;
  target?: HexKey;
  nation?: NationId;
}

/**
 * A power's doctrine. `deck` is the pile still to draw, kept sorted: what is in it is known to its
 * owner, never the order (a draw is `roll(seed, turn, 'draw', nation, n)` over it). When the deck
 * runs out the discard is shuffled back in.
 */
export interface DoctrineState {
  /** Command Points banked, 0..`DOCTRINE.cpCap`. */
  cp: number;
  hand: CardId[];
  deck: CardId[];
  discard: CardId[];
  /** Played cards still in force, sorted by card then turn. */
  effects: ActiveEffect[];
}

/** What every power knows of a rival's doctrine: its Command Points and how many cards it holds. */
export interface PublicDoctrine {
  cp: number;
  hand: number;
}

/** A card played: public, like a declaration of war. Victims are filtered like a strike's. */
export interface CardPlayedEvent {
  kind: 'card_played';
  nation: NationId;
  card: CardId;
  target?: HexKey;
  targetNation?: NationId;
  victims?: { formation: FormationId; owner: NationId; strengthLoss: number }[];
}
