/// <reference lib="webworker" />
import { MERIDIAN_ID } from '@brink/scenarios';
import { GameSession, parseSave, serializeSave } from '@brink/session';
import { previewAssault, previewStrike } from '@brink/simulation';
import type { Envelope, Request, Response } from './protocol';

let session: GameSession | null = null;

function state(): Response {
  const s = session!;
  return { type: 'state', view: s.view(), report: s.lastReport(), history: s.reports() };
}

function handle(req: Request): Response {
  switch (req.type) {
    case 'new':
      session = GameSession.create(MERIDIAN_ID, req.seed, req.nation);
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
