import { create } from 'zustand';
import type { NationId, NationOrders, NationView } from '@brink/contracts';
import { NATIONS } from '@brink/scenarios';
import { engine } from '../engine';
import type { SeatState } from '../protocol';
import { readPrefs, writePrefs } from '../saves';
import { useGame } from '../store';
import type { ChatLine, NetMessage, Seat } from './messages';
import { joinHost, openHost, roomCode, type HostTransport, type Link } from './transport';

// Multiplayer rooms. The host's browser is the server: its engine worker holds the world, it
// collects every human seat's orders, resolves the turn when all are in, and sends each guest
// only that guest's state. Hotseat runs the same seats on one device behind a curtain.

export type Role = 'host' | 'guest' | 'hotseat';

interface Guest {
  link: Link;
  name: string;
}

interface NetState {
  role: Role | null;
  code: string | null;
  name: string;
  /** The name this player holds in the room (the host may have made it unique). */
  me: string | null;
  seats: Seat[];
  seed: number;
  started: boolean;
  /** Human seats whose orders are in for this turn. */
  locked: NationId[];
  chat: ChatLine[];
  unread: number;
  error: string | null;
  busy: boolean;
  /** Hotseat: the seat waiting behind the curtain, or null when someone is playing. */
  curtain: NationId | null;

  setName(name: string): void;
  host(): Promise<void>;
  join(code: string): Promise<void>;
  claim(nation: NationId | null): void;
  setSeed(seed: number): void;
  start(): Promise<void>;
  /** Called by the game store when the local player locks orders in a room. */
  lockLocal(orders: NationOrders): void;
  /** Host only: resolve without seats that have not locked (they hold). */
  forceResolve(): void;
  say(text: string): void;
  readChat(): void;
  leave(): void;
  startHotseat(humans: NationId[], seed: number): Promise<void>;
  reveal(): void;
}

const emptySeats = (): Seat[] => NATIONS.map((n) => ({ nation: n.id, player: null, host: false, connected: false }));

// Host-only state that never needs to re-render anything.
let transport: HostTransport | null = null;
let hostLink: Link | null = null;
const guests = new Map<string, Guest>();
const pending = new Map<NationId, NationOrders>();
// Hotseat bookkeeping.
let hotseatOrder: NationId[] = [];
let hotseatIndex = 0;
const hotseatStash = new Map<NationId, SeatState>();
const hotseatBefore = new Map<NationId, NationView>();
const hotseatResolved = new Map<NationId, SeatState>();

export const useNet = create<NetState>((set, get) => {
  const humanSeats = () => get().seats.filter((s) => s.player !== null);
  const seatOf = (name: string) => get().seats.find((s) => s.player === name && !s.host);

  const broadcast = (msg: NetMessage) => {
    for (const g of guests.values()) g.link.send(msg);
  };
  const pushLobby = () => {
    for (const g of guests.values()) g.link.send({ t: 'lobby', seats: get().seats, seed: get().seed, started: get().started, you: g.name });
  };
  const uniqueName = (wanted: string, linkId: string) => {
    const base = wanted.trim().slice(0, 24) || 'Commander';
    const used = new Set([get().me ?? '', ...[...guests.entries()].filter(([id]) => id !== linkId).map(([, g]) => g.name)]);
    // A rejoining player keeps the name their seat holds.
    if (get().started && seatOf(base)) return base;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base} ${i}`;
    return name;
  };
  const pushStatus = () => {
    const locked = [...pending.keys()].sort();
    set({ locked });
    broadcast({ t: 'status', locked });
  };
  const addChat = (line: ChatLine) => set({ chat: [...get().chat.slice(-60), line], unread: get().unread + 1 });

  const resolve = async () => {
    const orders = [...pending.values()];
    pending.clear();
    const r = await engine.call({ type: 'resolve', orders });
    if (r.type !== 'resolved') {
      useGame.getState().notify(r.type === 'error' ? r.message : 'Could not resolve the turn', 'error');
      return;
    }
    for (const g of guests.values()) {
      const seat = seatOf(g.name);
      const state = seat && r.states[seat.nation];
      // The guest already has its history; send only the new report to keep messages small.
      if (state) g.link.send({ t: 'turn', state: { ...state, history: [] } });
    }
    pushStatus();
    const mine = get().seats.find((s) => s.host)?.nation;
    if (mine && r.states[mine]) useGame.getState().receiveTurn(r.states[mine]!);
  };

  const maybeResolve = () => {
    // Every human seat with someone connected must be in; disconnected seats hold.
    const waiting = humanSeats().filter((s) => s.connected && !pending.has(s.nation));
    if (waiting.length === 0) void resolve();
  };

  const onHostMessage = (link: Link, msg: NetMessage) => {
    const g = guests.get(link.id);
    switch (msg.t) {
      case 'hello': {
        const name = uniqueName(msg.name, link.id);
        guests.set(link.id, { link, name });
        const seat = seatOf(name);
        if (get().started) {
          // Rejoining: hand back the seat this name held.
          if (!seat) {
            link.send({ t: 'denied', reason: 'The campaign has already started' });
            return;
          }
          set({ seats: get().seats.map((s) => (s === seat ? { ...s, connected: true } : s)) });
          void engine.call({ type: 'stateFor', nation: seat.nation }).then((r) => {
            if (r.type === 'state') link.send({ t: 'start', nation: seat.nation, state: r });
            link.send({ t: 'status', locked: get().locked });
          });
        } else if (seat) {
          set({ seats: get().seats.map((s) => (s === seat ? { ...s, connected: true } : s)) });
        }
        addChat({ from: 'Room', nation: null, text: `${name} joined`, at: Date.now() });
        pushLobby();
        break;
      }
      case 'claim': {
        if (!g || get().started) return;
        const target = msg.nation;
        if (target && get().seats.some((s) => s.nation === target && s.player !== null && s.player !== g.name)) return;
        set({
          seats: get().seats.map((s) => {
            if (s.player === g.name && !s.host) return { ...s, player: null, connected: false };
            if (s.nation === target) return { ...s, player: g.name, host: false, connected: true };
            return s;
          }),
        });
        pushLobby();
        break;
      }
      case 'orders': {
        if (!g) return;
        const seat = seatOf(g.name);
        if (!seat || msg.orders.nation !== seat.nation) return;
        pending.set(seat.nation, msg.orders);
        pushStatus();
        maybeResolve();
        break;
      }
      case 'chat':
        if (!g) return;
        {
          const line = { from: g.name, nation: seatOf(g.name)?.nation ?? null, text: msg.line.text.slice(0, 280), at: Date.now() };
          addChat(line);
          broadcast({ t: 'chat', line });
        }
        break;
    }
  };

  const onHostClose = (link: Link) => {
    const g = guests.get(link.id);
    guests.delete(link.id);
    if (!g) return;
    addChat({ from: 'Room', nation: null, text: `${g.name} left`, at: Date.now() });
    const started = get().started;
    set({
      seats: get().seats.map((s) => (s.player === g.name && !s.host ? (started ? { ...s, connected: false } : { ...s, player: null, connected: false }) : s)),
    });
    pushLobby();
    if (started) maybeResolve();
  };

  const onGuestMessage = (_link: Link, msg: NetMessage) => {
    switch (msg.t) {
      case 'lobby':
        set({ seats: msg.seats, seed: msg.seed, started: msg.started, me: msg.you });
        break;
      case 'start':
        set({ started: true, locked: [] });
        useGame.getState().enterGame(msg.state);
        break;
      case 'turn': {
        const history = msg.state.report ? [...useGame.getState().history, msg.state.report] : useGame.getState().history;
        useGame.getState().receiveTurn({ ...msg.state, history });
        break;
      }
      case 'status':
        set({ locked: msg.locked });
        break;
      case 'chat':
        addChat(msg.line);
        break;
      case 'denied':
        set({ error: msg.reason });
        break;
    }
  };

  const reset = () => {
    transport?.close();
    hostLink?.close();
    transport = null;
    hostLink = null;
    guests.clear();
    pending.clear();
    hotseatStash.clear();
    hotseatBefore.clear();
    hotseatResolved.clear();
    hotseatOrder = [];
    hotseatIndex = 0;
  };

  const showSeat = (n: NationId) => set({ curtain: n });

  return {
    role: null,
    code: null,
    name: readPrefs().name ?? '',
    me: null,
    seats: emptySeats(),
    seed: 1 + Math.floor(Math.random() * 99999),
    started: false,
    locked: [],
    chat: [],
    unread: 0,
    error: null,
    busy: false,
    curtain: null,

    setName(name) {
      writePrefs({ name });
      set({ name });
    },

    async host() {
      reset();
      set({ busy: true, error: null });
      const code = roomCode();
      try {
        transport = await openHost(code, {
          onConnect: () => {},
          onMessage: onHostMessage,
          onClose: onHostClose,
        });
        const me = get().name.trim() || 'Host';
        const seats = emptySeats();
        seats[0] = { ...seats[0]!, player: me, host: true, connected: true };
        set({ role: 'host', code, me, seats, started: false, locked: [], chat: [], unread: 0, busy: false });
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    async join(code) {
      reset();
      const c = code.trim().toUpperCase();
      set({ busy: true, error: null });
      try {
        hostLink = await joinHost(c, { onMessage: onGuestMessage, onClose: () => set({ error: 'Lost connection to the host' }) });
        set({ role: 'guest', code: c, seats: emptySeats(), started: false, locked: [], chat: [], unread: 0, busy: false });
        hostLink.send({ t: 'hello', name: get().name.trim() || 'Commander' });
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    claim(nation) {
      const s = get();
      if (s.started) return;
      if (s.role === 'guest') {
        hostLink?.send({ t: 'claim', nation });
        return;
      }
      if (s.role !== 'host' || !nation) return;
      if (s.seats.some((x) => x.nation === nation && x.player !== null && !x.host)) return;
      const me = s.seats.find((x) => x.host)!;
      set({
        seats: s.seats.map((x) => (x.host ? { ...x, player: null, host: false, connected: false } : x.nation === nation ? { ...x, player: me.player, host: true, connected: true } : x)),
      });
      pushLobby();
    },

    setSeed(seed) {
      if (get().role !== 'host') return;
      set({ seed });
      pushLobby();
    },

    async start() {
      const s = get();
      if (s.role !== 'host' || s.started) return;
      const mine = s.seats.find((x) => x.host);
      if (!mine) return;
      const others = s.seats.filter((x) => x.player !== null && !x.host).map((x) => x.nation);
      set({ busy: true });
      const r = await engine.call({ type: 'new', seed: s.seed, nation: mine.nation, others });
      if (r.type !== 'state') {
        set({ busy: false, error: r.type === 'error' ? r.message : 'Could not start' });
        return;
      }
      set({ started: true, busy: false, locked: [] });
      pushLobby();
      for (const g of guests.values()) {
        const seat = seatOf(g.name);
        if (!seat) continue;
        const st = await engine.call({ type: 'stateFor', nation: seat.nation });
        if (st.type === 'state') g.link.send({ t: 'start', nation: seat.nation, state: st });
      }
      useGame.getState().enterGame(r);
    },

    lockLocal(orders) {
      const role = get().role;
      if (role === 'guest') {
        hostLink?.send({ t: 'orders', orders });
        set({ locked: [...new Set([...get().locked, orders.nation])].sort() });
      } else if (role === 'host') {
        pending.set(orders.nation, orders);
        pushStatus();
        maybeResolve();
      } else if (role === 'hotseat') {
        pending.set(orders.nation, orders);
        hotseatIndex += 1;
        const last = hotseatIndex >= hotseatOrder.length;
        const next = hotseatOrder[last ? 0 : hotseatIndex]!;
        // Hide the board the moment orders lock; the curtain opens once the next seat is ready.
        set({ curtain: next, busy: true });
        if (!last) {
          // A seat still holding an unseen replay keeps it; otherwise fetch where it stands now.
          if (hotseatResolved.has(next)) set({ busy: false });
          else
            void engine.call({ type: 'stateFor', nation: next }).then((r) => {
              if (r.type === 'state') hotseatStash.set(next, r);
              set({ busy: false });
            });
        } else {
          const all = [...pending.values()];
          pending.clear();
          void engine.call({ type: 'resolve', orders: all }).then((r) => {
            if (r.type === 'resolved') for (const [n, st] of Object.entries(r.states)) hotseatResolved.set(n, st);
            hotseatIndex = 0;
            set({ busy: false });
          });
        }
      }
    },

    forceResolve() {
      if (get().role === 'host' && get().started) void resolve();
    },

    say(text) {
      const t = text.trim();
      if (!t) return;
      const s = get();
      const nation = s.seats.find((x) => (s.role === 'host' ? x.host : x.player === s.me))?.nation ?? null;
      const line = { from: s.me ?? (s.name.trim() || 'Commander'), nation, text: t.slice(0, 280), at: Date.now() };
      if (s.role === 'guest') hostLink?.send({ t: 'chat', line });
      else {
        set({ chat: [...s.chat.slice(-60), line] });
        broadcast({ t: 'chat', line });
      }
    },

    readChat: () => set({ unread: 0 }),

    leave() {
      reset();
      set({ role: null, code: null, me: null, seats: emptySeats(), started: false, locked: [], chat: [], unread: 0, error: null, curtain: null, busy: false });
    },

    async startHotseat(humans, seed) {
      reset();
      if (humans.length < 2) return;
      hotseatOrder = [...humans];
      const r = await engine.call({ type: 'new', seed, nation: humans[0]!, others: humans.slice(1) });
      if (r.type !== 'state') return;
      hotseatStash.set(humans[0]!, r);
      set({
        role: 'hotseat',
        code: null,
        seed,
        started: true,
        seats: NATIONS.map((n) => ({ nation: n.id, player: humans.includes(n.id) ? n.name : null, host: false, connected: humans.includes(n.id) })),
        locked: [],
      });
      useGame.getState().enterGame(r);
      showSeat(humans[0]!);
    },

    reveal() {
      const n = get().curtain;
      if (!n) return;
      set({ curtain: null });
      const resolved = hotseatResolved.get(n);
      if (resolved) {
        // Replay from the board this seat planned against, never the previous player's.
        const before = hotseatBefore.get(n);
        hotseatResolved.delete(n);
        hotseatStash.set(n, resolved);
        hotseatBefore.set(n, resolved.view);
        useGame.getState().receiveTurn(resolved, before);
        return;
      }
      const st = hotseatStash.get(n);
      if (st) {
        hotseatBefore.set(n, st.view);
        useGame.getState().enterGame(st);
      }
    },
  };
});
