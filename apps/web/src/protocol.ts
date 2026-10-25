import type { GameEvent, NationId, NationOrders, NationView, TurnReport } from '@brink/contracts';
import type { AssaultPreview, StrikePreview } from '@brink/simulation';

// Messages between the UI and the engine worker. The worker holds the authoritative world;
// nothing that crosses this boundary is ever more than the player's own NationView.

/** One seat's slice of the world: all a player, local or remote, ever receives. */
export interface SeatState {
  view: NationView;
  report: TurnReport | null;
  history: TurnReport[];
}

export type Request =
  /** `others` are further human seats (multiplayer and hotseat); every other nation is AI. */
  | { type: 'new'; seed: number; nation: NationId; others?: NationId[] }
  | { type: 'stateFor'; nation: NationId }
  /** Resolve the turn with every human seat's orders; returns each human seat's new state. */
  | { type: 'resolve'; orders: NationOrders[] }
  /** Hand a human seat to the AI, or give it back to a returning player. */
  | { type: 'seat'; nation: NationId; to: 'ai' | 'human' }
  | { type: 'load'; text: string }
  | { type: 'check'; orders: NationOrders }
  | { type: 'previewAssault'; attackers: string[]; target: string }
  | { type: 'previewStrike'; source: string; target: string }
  | { type: 'submit'; orders: NationOrders }
  | { type: 'save'; label: string; savedAt: string };

export type Response =
  | ({ type: 'state' } & SeatState)
  | { type: 'resolved'; states: Record<NationId, SeatState> }
  | { type: 'ok' }
  | { type: 'checked'; rejected: GameEvent[] }
  | { type: 'assault'; preview: AssaultPreview | null }
  | { type: 'strike'; preview: StrikePreview | null }
  | { type: 'saved'; text: string; turn: number }
  | { type: 'error'; message: string };

export interface Envelope<T> {
  id: number;
  body: T;
}
