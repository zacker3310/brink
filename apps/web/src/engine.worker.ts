/// <reference lib="webworker" />
import { MERIDIAN_ID } from '@brink/scenarios';
import { GameSession, parseSave, serializeSave } from '@brink/session';
import { previewAssault, previewStrike } from '@brink/simulation';
import type { Envelope, Request, Response, SeatState } from './protocol';

let session: GameSession | null = null;

function seat(nation: string | null = session!.playerNation): SeatState {
  const s = session!;
  return { view: s.view(nation), report: s.lastReport(nation), history: s.reports(nation) };
}

function state(nation?: string): Response {
  return { type: 'state', ...seat(nation) };
}

function handle(req: Request): Response {
  switch (req.type) {
    case 'new':
      session = GameSession.create(MERIDIAN_ID, req.seed, req.nation, req.others ?? []);
      return state();
    case 'load':
      session = GameSession.fromSave(parseSave(req.text));
      return state();
  }
  if (!session) return { type: 'error', message: 'no game in progress' };
  switch (req.type) {
    case 'check':
      return { type: 'checked', rejected: session.check(req.orders) };
    case 'previewAssault':
      return { type: 'assault', preview: previewAssault(session.view(), req.attackers, req.target) };
    case 'previewStrike':
      return { type: 'strike', preview: previewStrike(session.view(), req.source, req.target) };
    case 'submit':
      session.advance(req.orders);
      return state();
    case 'stateFor':
      return state(req.nation);
    case 'resolve': {
      session.advance(req.orders);
      const s = session;
      return { type: 'resolved', states: Object.fromEntries(s.humans.map((n) => [n, seat(n)])) };
    }
    case 'save':
      return { type: 'saved', text: serializeSave(session.toSave(req.label, req.savedAt)), turn: session.turn };
  }
}

self.onmessage = (e: MessageEvent<Envelope<Request>>) => {
  let body: Response;
  try {
    body = handle(e.data.body);
  } catch (err) {
    body = { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage({ id: e.data.id, body } satisfies Envelope<Response>);
};
