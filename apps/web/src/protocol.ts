import type { DealTerms, Difficulty, GameEvent, NationId, NationOrders, NationView, ProposalKind, SiteId, TurnReport } from '@brink/contracts';
import type { Verdict } from '@brink/ai';
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
  /** `others` are further human seats; every other nation is AI. `theatre` picks the map, `crisis` the opening. */
  | { type: 'new'; seed: number; nation: NationId; others?: NationId[]; maxTurns?: number; difficulty?: Difficulty; theatre?: string; crisis?: string; /** The Black Files toggle. */ blackFiles?: boolean }
  /** What the AI would order for this seat now (the Auto button). */
  /** `target`: the site of the operation the player launched; the staff plans toward it. */
  | { type: 'suggest'; nation: NationId; target?: SiteId }
  | { type: 'stateFor'; nation: NationId }
  /** Resolve the turn with every human seat's orders; returns each human seat's new state. */
  | { type: 'resolve'; orders: NationOrders[] }
  /** Hand a human seat to the AI, or give it back to a returning player. */
  | { type: 'seat'; nation: NationId; to: 'ai' | 'human' }
  | { type: 'load'; text: string }
  | { type: 'check'; orders: NationOrders }
  /** Put an offer to an AI power's leader: they answer now, as they will when the turn resolves. */
  | { type: 'negotiate'; from: NationId; to: NationId; kind: ProposalKind; terms?: DealTerms }
  | { type: 'previewAssault'; attackers: string[]; target: string }
  | { type: 'previewStrike'; source: string; target: string }
  | { type: 'submit'; orders: NationOrders }
  /** `callsigns` marks a room save so it can resume as a room. */
  | { type: 'save'; label: string; savedAt: string; callsigns?: Record<NationId, string> };

export type Response =
  | ({ type: 'state' } & SeatState)
  /** A loaded save: the local seat's state and who else sat at the table. */
  /** `migratedFrom`: the older ruleset the save was upgraded from, if it was. */
  | { type: 'loaded'; state: { type: 'state' } & SeatState; humans: NationId[]; callsigns: Record<NationId, string> | null; migratedFrom: string | null }
  | { type: 'resolved'; states: Record<NationId, SeatState> }
  | { type: 'ok' }
  | { type: 'checked'; rejected: GameEvent[] }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'suggested'; orders: NationOrders }
  | { type: 'assault'; preview: AssaultPreview | null }
  | { type: 'strike'; preview: StrikePreview | null }
  | { type: 'saved'; text: string; turn: number }
  | { type: 'error'; message: string };

export interface Envelope<T> {
  id: number;
  body: T;
}
