import type { GameEvent, NationId, NationOrders, NationView, TurnReport } from '@brink/contracts';
import type { AssaultPreview, StrikePreview } from '@brink/simulation';

// Messages between the UI and the engine worker. The worker holds the authoritative world;
// nothing that crosses this boundary is ever more than the player's own NationView.

export type Request =
  | { type: 'new'; seed: number; nation: NationId }
  | { type: 'load'; text: string }
  | { type: 'check'; orders: NationOrders }
  | { type: 'previewAssault'; attackers: string[]; target: string }
  | { type: 'previewStrike'; source: string; target: string }
  | { type: 'submit'; orders: NationOrders }
  | { type: 'save'; label: string; savedAt: string };

export type Response =
  | { type: 'state'; view: NationView; report: TurnReport | null; history: TurnReport[] }
  | { type: 'checked'; rejected: GameEvent[] }
  | { type: 'assault'; preview: AssaultPreview | null }
  | { type: 'strike'; preview: StrikePreview | null }
  | { type: 'saved'; text: string; turn: number }
  | { type: 'error'; message: string };

export interface Envelope<T> {
  id: number;
  body: T;
}
