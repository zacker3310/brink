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
import type { Mode } from './planning';
import type { Response } from './protocol';
import { listSlots, writeSlot, type SlotInfo } from './saves';

export type Tab = 'overview' | 'military' | 'economy' | 'research' | 'diplomacy';

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

  newGame(nation: NationId, seed: number): Promise<void>;
  loadGame(text: string): Promise<void>;
  toMenu(): void;
  selectHex(key: HexKey | null): void;
  selectFormation(id: FormationId | null): void;
  setMode(mode: Mode): void;
  setTab(tab: Tab): void;
  setHover(key: HexKey | null): void;
  togglePanel(open?: boolean): void;
  /** Select the next own formation without an order, after the current one. */
  nextIdle(): void;
  setOrder(id: FormationId, order: FormationOrder | null): void;
  addRecruit(siteId: string, unitClass: UnitClass): void;
  removeRecruit(index: number): void;
  setBudget(budget: Budget): void;
  setResearch(tech: TechId | null): void;
  setDiplomacy(target: NationId, action: DiplomaticAction | null): void;
  setPriority(id: FormationId, p: SupplyPriority): void;
  submit(): Promise<void>;
  save(slot: string): Promise<void>;
  focusOn(key: HexKey): void;
  setShowReport(show: boolean): void;
  notify(text: string, tone?: Notice['tone']): void;
  dismiss(id: number): void;
}

let noticeId = 1;

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
    if (!d) return;
    const r = await engine.call({ type: 'check', orders: d });
    if (r.type === 'checked') set({ rejected: r.rejected });
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
    panelOpen: true,

    async newGame(nation, seed) {
      if (apply(await engine.call({ type: 'new', seed, nation }))) {
        const capital = Object.values(get().view!.sites).find((s) => s.owner === nation && s.kind === 'capital');
        set({ selectedHex: capital?.key ?? null, selectedFormation: null, showReport: false, tab: 'overview' });
        if (capital) get().focusOn(capital.key);
      }
    },
    async loadGame(text) {
      if (apply(await engine.call({ type: 'load', text }))) {
        set({ selectedHex: null, selectedFormation: null, showReport: false });
        get().notify(`Loaded turn ${get().view!.turn}`);
      }
    },
    toMenu: () => set({ screen: 'menu', slots: listSlots() }),
    selectHex: (key) => set({ selectedHex: key }),
    selectFormation: (id) => {
      const f = id ? get().view?.formations[id] : null;
      set({ selectedFormation: id, selectedHex: f?.key ?? get().selectedHex, mode: 'move' });
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
      const r = await engine.call({ type: 'submit', orders: draft });
      set({ resolving: false });
      if (apply(r)) {
        const report = get().report;
        const rejected = report?.events.filter((e) => e.kind === 'order_rejected') ?? [];
        if (rejected.length > 0) get().notify(`${rejected.length} order(s) were rejected: see the report`, 'warn');
        set({ showReport: true });
      } else {
        set({ submitted: null });
      }
    },

    async save(slot) {
      const r = await engine.call({ type: 'save', label: slot, savedAt: new Date().toISOString() });
      if (r.type !== 'saved') {
        apply(r);
        return;
      }
      const view = get().view!;
      const ok = writeSlot({ slot, label: `${view.self.name}, turn ${r.turn}`, turn: r.turn, nation: view.self.id, savedAt: new Date().toISOString() }, r.text);
      if (ok) get().notify(`Saved to ${slot}`);
      else get().notify('Could not save: browser storage is unavailable or full', 'error');
      set({ slots: listSlots() });
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
