import type { NetMessage } from './messages';

// How players reach each other. Online play uses WebRTC data channels brokered by PeerJS's public
// signalling server; `?net=local` uses a BroadcastChannel so several tabs on one machine can play
// (and so the end-to-end test can seat two humans without the internet).

export interface Link {
  /** The remote side's id. */
  readonly id: string;
  send(msg: NetMessage): void;
  close(): void;
}

export interface LinkEvents {
  onMessage(link: Link, msg: NetMessage): void;
  onClose(link: Link): void;
}

export interface HostTransport {
  readonly code: string;
  close(): void;
}

export type Net = 'online' | 'local';

export function netMode(): Net {
  try {
    return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'online';
  } catch {
    return 'online';
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short room code that reads well aloud: no 0/O or 1/I. */
export function roomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

const peerId = (code: string) => `brink-room-${code.toLowerCase()}`;

/* ---------------- Local (BroadcastChannel) ---------------- */

type LocalFrame = { kind: 'hello' | 'msg' | 'bye'; from: string; to: string; msg?: NetMessage };

function localHost(code: string, ev: LinkEvents & { onConnect(link: Link): void }): HostTransport {
  const ch = new BroadcastChannel(`brink-${code}`);
  const links = new Map<string, Link>();
  const make = (id: string): Link => ({
    id,
    send: (msg) => ch.postMessage({ kind: 'msg', from: 'host', to: id, msg } satisfies LocalFrame),
    close: () => ch.postMessage({ kind: 'bye', from: 'host', to: id } satisfies LocalFrame),
  });
  ch.onmessage = (e: MessageEvent<LocalFrame>) => {
    const f = e.data;
    if (f.to !== 'host') return;
    if (f.kind === 'hello') {
      const link = make(f.from);
      links.set(f.from, link);
      ev.onConnect(link);
    } else if (f.kind === 'msg' && f.msg) {
      const link = links.get(f.from);
      if (link) ev.onMessage(link, f.msg);
    } else if (f.kind === 'bye') {
      const link = links.get(f.from);
      links.delete(f.from);
      if (link) ev.onClose(link);
    }
  };
  return { code, close: () => ch.close() };
}

function localJoin(code: string, ev: LinkEvents): Promise<Link> {
  const ch = new BroadcastChannel(`brink-${code}`);
  const me = `guest-${Math.random().toString(36).slice(2, 10)}`;
  const link: Link = {
    id: 'host',
    send: (msg) => ch.postMessage({ kind: 'msg', from: me, to: 'host', msg } satisfies LocalFrame),
    close: () => {
      ch.postMessage({ kind: 'bye', from: me, to: 'host' } satisfies LocalFrame);
      ch.close();
    },
  };
  ch.onmessage = (e: MessageEvent<LocalFrame>) => {
    const f = e.data;
    if (f.to !== me) return;
    if (f.kind === 'msg' && f.msg) ev.onMessage(link, f.msg);
    if (f.kind === 'bye') ev.onClose(link);
  };
  ch.postMessage({ kind: 'hello', from: me, to: 'host' } satisfies LocalFrame);
  window.addEventListener('beforeunload', () => link.close());
  return Promise.resolve(link);
}

/* ---------------- Online (PeerJS / WebRTC) ---------------- */

async function onlineHost(code: string, ev: LinkEvents & { onConnect(link: Link): void }): Promise<HostTransport> {
  const { Peer } = await import('peerjs');
  const peer = new Peer(peerId(code), { debug: 0 });
  await new Promise<void>((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', (e) => reject(new Error(e.type === 'unavailable-id' ? 'That room code is taken; try again' : `Could not open a room: ${e.message}`)));
  });
  peer.on('connection', (conn) => {
    const link: Link = { id: conn.peer, send: (msg) => conn.open && void conn.send(msg), close: () => conn.close() };
    conn.on('open', () => ev.onConnect(link));
    conn.on('data', (d) => ev.onMessage(link, d as NetMessage));
    conn.on('close', () => ev.onClose(link));
    conn.on('error', () => ev.onClose(link));
  });
  return { code, close: () => peer.destroy() };
}

async function onlineJoin(code: string, ev: LinkEvents): Promise<Link> {
  const { Peer } = await import('peerjs');
  const peer = new Peer({ debug: 0 });
  await new Promise<void>((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', (e) => reject(new Error(`Could not reach the matchmaking server: ${e.message}`)));
  });
  const conn = peer.connect(peerId(code), { reliable: true, serialization: 'json' });
  const link: Link = { id: 'host', send: (msg) => conn.open && void conn.send(msg), close: () => peer.destroy() };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No game found with code ${code}`)), 12000);
    conn.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.once('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.type === 'peer-unavailable' ? `No game found with code ${code}` : e.message));
    });
  });
  conn.on('data', (d) => ev.onMessage(link, d as NetMessage));
  conn.on('close', () => ev.onClose(link));
  return link;
}

export function openHost(code: string, ev: LinkEvents & { onConnect(link: Link): void }): Promise<HostTransport> {
  return netMode() === 'local' ? Promise.resolve(localHost(code, ev)) : onlineHost(code, ev);
}

export function joinHost(code: string, ev: LinkEvents): Promise<Link> {
  return netMode() === 'local' ? localJoin(code, ev) : onlineJoin(code, ev);
}
