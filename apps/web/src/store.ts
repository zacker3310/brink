import { create } from 'zustand';
import type {
  Budget,
  DiplomaticAction,
  FormationId,
  FormationOrder,
  GameEvent,
  HexKey,
  NationId,
  NationOrders,
  NationView,
  SupplyPriority,
  TechId,
  TurnReport,
  UnitClass,
} from '@brink/contracts';
import { engine } from './engine';
import { idleFormations } from './insight';
import { useNet } from './net/room';
import type { Mode } from './planning';
import type { Response, SeatState } from './protocol';
import { listSlots, readPrefs, writePrefs, writeSlot, type SlotInfo } from './saves';

export type Tab = 'overview' | 'military' | 'economy' | 'research' | 'diplomacy';

export interface Playback {
  /** The view the turn was planned against; the map shows it while the turn replays. */
  before: NationView;
  events: GameEvent[];
  /** The resolved state, applied when the replay ends. */
  result: Extract<Response, { type: 'state' }>;
  phase: 'movement' | 'combat' | 'aftermath';
  /** Watching an already-applied turn again: finishing leaves the current state alone. */
  rewatch?: boolean;
}

export interface Notice {
  id: number;
  tone: 'info' | 'warn' | 'error';
  text: string;
}

interface State {
  screen: 'menu' | 'game';
  view: NationView | null;
  report: TurnReport | null;
  history: TurnReport[];
  /** Orders being planned. Submitted orders are copied out and locked while resolving. */
  draft: NationOrders | null;
  submitted: NationOrders | null;
  resolving: boolean;
  rejected: GameEvent[];
  selectedHex: HexKey | null;
  selectedFormation: FormationId | null;
  mode: Mode;
  tab: Tab;
  showReport: boolean;
  focus: { key: HexKey; n: number } | null;
  notices: Notice[];
  slots: SlotInfo[];
  hoverHex: HexKey | null;
  panelOpen: boolean;
  /** A resolved turn being replayed on the map before its state is applied. */
  playback: Playback | null;
  /** Replay resolved turns on the map. */
  animate: boolean;
  /** City whose production panel is open. */
  selectedCity: string | null;
  /** Notification ids dismissed for the current report. */
  dismissed: string[];
  /** Show where seen enemies could strike next turn. */
  showThreat: boolean;
  /** The last resolved turn, kept so it can be replayed again. */
  lastTurn: { before: NationView; events: GameEvent[] } | null;

  newGame(nation: NationId, seed: number): Promise<void>;
  /** Load a save. A room save reopens its lobby and a hotseat save its curtain; says which. */
  loadGame(text: string): Promise<'single' | 'room' | 'hotseat' | null>;
  toMenu(): void;
  selectHex(key: HexKey | null): void;
  selectFormation(id: FormationId | null): void;
  setMode(mode: Mode): void;
  setTab(tab: Tab): void;
  setHover(key: HexKey | null): void;
  togglePanel(open?: boolean): void;
  /** Select the next own formation without an order, after the current one. */
  nextIdle(): void;
  /** Apply the turn being replayed and open its report. Also used to skip the replay. */
  finishPlayback(): void;
  setAnimate(on: boolean): void;
  /** Show a seat's state as the start of planning (new game, joined room, hotseat seat). */
  enterGame(state: SeatState): void;
  /** A resolved turn arrived for this seat: replay it from `before` (default: the current view). */
  receiveTurn(state: SeatState, before?: NationView): void;
  /** Give an order from the map or unit panel, then move on to the next unit without orders. */
  issueOrder(id: FormationId, order: FormationOrder): void;
  openCity(id: string | null): void;
  dismissNote(id: string): void;
  toggleThreat(): void;
  /** Replay the last resolved turn again. */
  rewatch(): void;
  setOrder(id: FormationId, order: FormationOrder | null): void;
  addRecruit(siteId: string, unitClass: UnitClass): void;
  removeRecruit(index: number): void;
  setBudget(budget: Budget): void;
  setResearch(tech: TechId | null): void;
  setEventChoice(choice: 0 | 1): void;
  setDiplomacy(target: NationId, action: DiplomaticAction | null): void;
  setPriority(id: FormationId, p: SupplyPriority): void;
  submit(): Promise<void>;
  save(slot: string): Promise<void>;
  /** Download the campaign as a save file. */
  exportSave(): Promise<void>;
  focusOn(key: HexKey): void;
  setShowReport(show: boolean): void;
  notify(text: string, tone?: Notice['tone']): void;
  dismiss(id: number): void;
}

let noticeId = 1;

/** Events the map can show. A quiet turn skips the replay. */
function isVisual(e: GameEvent): boolean {
  return (
    (e.kind === 'movement' && e.path.length > 0) ||
    e.kind === 'engagement' ||
    e.kind === 'strike' ||
    e.kind === 'retreat' ||
    e.kind === 'destroyed' ||
    e.kind === 'site_captured'
  );
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A hosted room's seats by callsign, so its save resumes as the same room. */
function roomCallsigns(): Record<NationId, string> | undefined {
  const net = useNet.getState();
  if (net.role !== 'host' || !net.started) return undefined;
  return Object.fromEntries(net.seats.filter((s) => s.player !== null).map((s) => [s.nation, s.player!]));
}

function freshDraft(view: NationView): NationOrders {
  return { nation: view.self.id, turn: view.turn, formations: {}, recruit: [], diplomacy: [] };
}

export const useGame = create<State>((set, get) => {
  const apply = (r: Response): boolean => {
    if (r.type === 'error') {
      get().notify(r.message, 'error');
      return false;
    }
    if (r.type === 'state') {
      set({ view: r.view, report: r.report, history: r.history, draft: freshDraft(r.view), submitted: null, rejected: [], screen: 'game' });
    }
    return true;
  };

  /** Ask the engine what it would reject in the current draft. */
  const recheck = async () => {
    const d = get().draft;
    // A guest has no world to check against; the host validates when the turn resolves.
    if (!d || useNet.getState().role === 'guest') return;
    const r = await engine.call({ type: 'check', orders: d });
    if (r.type === 'checked') set({ rejected: r.rejected });
  };

  const afterResolve = () => {
    const rejected = get().report?.events.filter((e) => e.kind === 'order_rejected') ?? [];
    if (rejected.length > 0) get().notify(`${rejected.length} order(s) were rejected: see the turn summary`, 'warn');
    // Results arrive as map notifications; the full summary is one click away.
    set({ dismissed: [], selectedFormation: null });
    get().nextIdle();
  };

  const editDraft = (fn: (d: NationOrders) => NationOrders) => {
    const d = get().draft;
    if (!d || get().resolving) return;
    set({ draft: fn(structuredClone(d)) });
    void recheck();
  };

  return {
    screen: 'menu',
    view: null,
    report: null,
    history: [],
    draft: null,
    submitted: null,
    resolving: false,
    rejected: [],
    selectedHex: null,
    selectedFormation: null,
    mode: 'move',
    tab: 'overview',
    showReport: false,
    focus: null,
    notices: [],
    slots: listSlots(),
    hoverHex: null,
    panelOpen: false,
    playback: null,
    animate: readPrefs().animate ?? !prefersReducedMotion(),
    selectedCity: null,
    dismissed: [],
    showThreat: false,
    lastTurn: null,

    async newGame(nation, seed) {
      if (apply(await engine.call({ type: 'new', seed, nation }))) {
        const capital = Object.values(get().view!.sites).find((s) => s.owner === nation && s.kind === 'capital');
        set({ selectedHex: capital?.key ?? null, selectedFormation: null, showReport: false, tab: 'overview', dismissed: [] });
        get().nextIdle();
      }
    },
    async loadGame(text) {
      const r = await engine.call({ type: 'load', text });
      if (r.type !== 'loaded') {
        apply(r);
        return null;
      }
      set({ selectedHex: null, selectedFormation: null, showReport: false, dismissed: [] });
      if (r.callsigns) {
        await useNet.getState().resumeRoom(r.humans, r.callsigns, r.state);
        return 'room';
      }
      if (r.humans.length > 1) {
        useNet.getState().resumeHotseat(r.humans, r.state);
        return 'hotseat';
      }
      apply(r.state);
      get().notify(`Loaded turn ${get().view!.turn}`);
      get().nextIdle();
      return 'single';
    },
    toMenu: () => {
      // The engine has already resolved a replaying turn; apply it rather than drop it.
      const pb = get().playback;
      if (pb) {
        set({ playback: null, resolving: false });
        apply(pb.result);
      }
      set({ screen: 'menu', slots: listSlots() });
    },
    selectHex: (key) => set({ selectedHex: key }),
    selectFormation: (id) => {
      const f = id ? get().view?.formations[id] : null;
      set({ selectedFormation: id, selectedHex: f?.key ?? get().selectedHex, mode: 'move', ...(id ? { selectedCity: null } : {}) });
    },
    setMode: (mode) => set({ mode }),
    setTab: (tab) => set({ tab, panelOpen: true }),
    setHover: (key) => {
      if (get().hoverHex !== key) set({ hoverHex: key });
    },
    togglePanel: (open) => set({ panelOpen: open ?? !get().panelOpen }),
    nextIdle: () => {
      const { view, draft, selectedFormation } = get();
      if (!view || !draft) return;
      const idle = idleFormations(view, draft.formations);
      if (idle.length === 0) return;
      const next = idle.find((f) => selectedFormation !== null && f.id > selectedFormation) ?? idle[0]!;
      get().selectFormation(next.id);
      get().focusOn(next.key);
    },
    setOrder: (id, order) =>
      editDraft((d) => {
        if (order) d.formations[id] = order;
        else delete d.formations[id];
        return d;
      }),
    addRecruit: (siteId, unitClass) =>
      editDraft((d) => {
        d.recruit = [...d.recruit.filter((r) => r.siteId !== siteId), { siteId, unitClass }];
        return d;
      }),
    removeRecruit: (i) =>
      editDraft((d) => {
        d.recruit.splice(i, 1);
        return d;
      }),
    setBudget: (budget) => editDraft((d) => ({ ...d, budget })),
    setResearch: (tech) => editDraft((d) => ({ ...d, research: tech })),
    setEventChoice: (choice) => editDraft((d) => ({ ...d, eventChoice: choice })),
    setDiplomacy: (target, action) =>
      editDraft((d) => {
        d.diplomacy = d.diplomacy.filter((x) => x.target !== target);
        if (action) d.diplomacy.push({ target, action });
        return d;
      }),
    setPriority: (id, p) => editDraft((d) => ({ ...d, supplyPriority: { ...(d.supplyPriority ?? {}), [id]: p } })),

    async submit() {
      const { draft, resolving } = get();
      if (!draft || resolving) return;
      set({ submitted: structuredClone(draft), resolving: true });
      // In a room the turn resolves when every seat is in; the result comes back via receiveTurn.
      if (useNet.getState().role) {
        useNet.getState().lockLocal(structuredClone(draft));
        return;
      }
      const r = await engine.call({ type: 'submit', orders: draft });
      const before = get().view;
      if (r.type === 'state' && before && r.report) set({ lastTurn: { before, events: r.report.events } });
      // Replay the turn on the old board first when there is something to see.
      if (r.type === 'state' && before && get().animate && r.report && r.report.events.some(isVisual)) {
        set({ playback: { before, events: r.report.events, result: r, phase: 'movement' } });
        return;
      }
      set({ resolving: false });
      if (apply(r)) afterResolve();
      else set({ submitted: null });
    },
    finishPlayback() {
      const pb = get().playback;
      if (!pb) return;
      set({ playback: null, resolving: false });
      if (pb.rewatch) return;
      apply(pb.result);
      afterResolve();
    },
    enterGame(state) {
      set({ playback: null, resolving: false, showReport: false, selectedFormation: null, selectedCity: null, dismissed: [], panelOpen: false, lastTurn: null });
      apply({ type: 'state', ...state });
      get().nextIdle();
    },
    receiveTurn(state, before) {
      const from = before ?? get().view;
      const result = { type: 'state' as const, ...state };
      if (from && state.report) set({ lastTurn: { before: from, events: state.report.events } });
      if (from && get().animate && state.report && state.report.events.some(isVisual)) {
        // Show the seat's own pre-turn board (hotseat may be coming from another player's).
        set({ view: from, draft: freshDraft(from), submitted: null, selectedFormation: null, selectedCity: null, playback: { before: from, events: state.report.events, result, phase: 'movement' }, resolving: true });
        return;
      }
      set({ resolving: false, playback: null });
      if (apply(result)) afterResolve();
    },
    issueOrder(id, order) {
      get().setOrder(id, order);
      // Civ-style flow: the next unit that needs orders comes up on its own.
      setTimeout(() => {
        const s = get();
        if (s.selectedFormation === id && !s.resolving && s.draft?.formations[id]) s.nextIdle();
      }, 260);
    },
    openCity: (id) => set({ selectedCity: id, ...(id ? { selectedFormation: null, panelOpen: false } : {}) }),
    dismissNote: (id) => set({ dismissed: [...get().dismissed, id] }),
    toggleThreat: () => set({ showThreat: !get().showThreat }),
    rewatch() {
      const { lastTurn, view, report, history, resolving, playback } = get();
      if (!lastTurn || !view || resolving || playback) return;
      set({
        playback: { before: lastTurn.before, events: lastTurn.events, result: { type: 'state', view, report, history }, phase: 'movement', rewatch: true },
        resolving: true,
        showReport: false,
      });
    },
    setAnimate(on) {
      writePrefs({ animate: on });
      set({ animate: on });
    },

    async save(slot) {
      const callsigns = roomCallsigns();
      const r = await engine.call({ type: 'save', label: slot, savedAt: new Date().toISOString(), callsigns });
      if (r.type !== 'saved') {
        apply(r);
        return;
      }
      const view = get().view!;
      const ok = writeSlot({ slot, label: `${view.self.name}, turn ${r.turn}${callsigns ? ' · room' : ''}`, turn: r.turn, nation: view.self.id, savedAt: new Date().toISOString() }, r.text);
      if (ok) get().notify(`Saved to ${slot}`);
      else get().notify('Could not save: browser storage is unavailable or full', 'error');
      set({ slots: listSlots() });
    },

    async exportSave() {
      const r = await engine.call({ type: 'save', label: 'Exported', savedAt: new Date().toISOString(), callsigns: roomCallsigns() });
      if (r.type !== 'saved') {
        apply(r);
        return;
      }
      const view = get().view!;
      try {
        const url = URL.createObjectURL(new Blob([r.text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `brink-${view.self.id}-turn-${r.turn}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        get().notify(`Exported turn ${r.turn} to a file`);
      } catch {
        get().notify('Could not export the save', 'error');
      }
    },

    focusOn: (key) => set({ focus: { key, n: (get().focus?.n ?? 0) + 1 }, selectedHex: key }),
    setShowReport: (show) => set({ showReport: show }),
    notify: (text, tone = 'info') => {
      const n = { id: noticeId++, tone, text };
      set({ notices: [...get().notices.slice(-4), n] });
      setTimeout(() => get().dismiss(n.id), 6000);
    },
    dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  };
});
