import type { NationId, NationOrders } from '@brink/contracts';
import type { SeatState } from '../protocol';

// Wire messages between a host and its guests. The host holds the only authoritative world; a
// guest only ever receives its own seat's state (its fog-of-war view and reports).

export interface Seat {
  nation: NationId;
  /** Display name of the human in this seat, or null when the AI plays it. */
  player: string | null;
  host: boolean;
  connected: boolean;
  /** The AI is holding this seat for a player who dropped. */
  ai?: boolean;
}

export interface ChatLine {
  from: string;
  nation: NationId | null;
  text: string;
  at: number;
  /** A private line for one nation's player; absent for the whole room. */
  to?: NationId | null;
}

export type NetMessage =
  // guest -> host
  | { t: 'hello'; name: string }
  | { t: 'claim'; nation: NationId | null }
  | { t: 'orders'; orders: NationOrders }
  // either way (the host relays guests' lines to everyone)
  | { t: 'chat'; line: ChatLine }
  // host -> guest
  /** `you` is the name the host gave this guest (made unique within the room). */
  | { t: 'lobby'; seats: Seat[]; seed: number; started: boolean; you: string; turnSeconds: number; resumeTurn: number | null }
  | { t: 'start'; nation: NationId; state: SeatState }
  | { t: 'turn'; state: SeatState }
  /** `remaining` is milliseconds left on the planning timer, or null when there is none. */
  | { t: 'status'; locked: NationId[]; remaining: number | null }
  | { t: 'denied'; reason: string };
