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
}

export interface ChatLine {
  from: string;
  nation: NationId | null;
  text: string;
  at: number;
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
  | { t: 'lobby'; seats: Seat[]; seed: number; started: boolean; you: string }
  | { t: 'start'; nation: NationId; state: SeatState }
  | { t: 'turn'; state: SeatState }
  | { t: 'status'; locked: NationId[] }
  | { t: 'denied'; reason: string };
