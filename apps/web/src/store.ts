import { create } from 'zustand';
import type {
  Budget,
  Difficulty,
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
import { RESOURCES } from '@brink/contracts';
import { engine } from './engine';
import { idleFormations, netChange, selfLedger } from './insight';
import { recommendedTech, recruitCostFor } from './rules-view';
import { movementAllowance } from '@brink/simulation';
import { UNITS } from '@brink/game-data';
import { useCoach } from './coach';
import { sfx } from './sfx';
import { battleFor, battleRecord, type BattleRequest } from './arena/battle';
import type { BattleOutcome } from './arena/ArenaScreen';
import { recordStars, recordWarWon } from './arena/career';
import type { Mode } from './planning';
import type { Response } from './protocol';
import { AUTOSAVE, listSlots, readPrefs, writePrefs, writeSlot, type SlotInfo } from './saves';

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

/** A touch attack waiting for its confirming tap: the target, and every order the stack would get. */
export interface Armed {
  formation: FormationId;
  target: HexKey;
  order: FormationOrder;
  orders?: Record<FormationId, FormationOrder>;
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
  /** Units ordered together: the selected unit's stack (on a touch screen). The selected unit leads. */
  group: FormationId[];
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
  /** The map's ground: a clean board-game map, or satellite imagery. */
  mapStyle: 'atlas' | 'satellite';
  setMapStyle(style: 'atlas' | 'satellite'): void;
  /** A touch attack waiting for its confirming second tap. */
  armed: Armed | null;
  /** The last resolved turn, kept so it can be replayed again. */
  lastTurn: { before: NationView; events: GameEvent[] } | null;

  newGame(nation: NationId, seed: number, maxTurns?: number, difficulty?: Difficulty, theatre?: string): Promise<void>;
  /** Let the staff draft orders for every unit and city still waiting; the player can change any. */
  autoCommand(): Promise<void>;
  /** Load a save. Seats other players held in an old multiplayer save go to the AI. */
  loadGame(text: string): Promise<boolean>;
  toMenu(): void;
  selectHex(key: HexKey | null): void;
  selectFormation(id: FormationId | null): void;
  /** Select every own unit in a hex (only those without orders, if asked), led by the slowest. */
  selectStack(key: HexKey, idleOnly?: boolean): void;
  /** Add a unit of the selected stack to the group, or take it out. */
  toggleGroup(id: FormationId): void;
  /** Give several units their orders at once (a stack moving or attacking together). */
  issueGroup(orders: Record<FormationId, FormationOrder>): void;
  /** A battle waiting to be fought in the arena (an attack you ordered, or a skirmish). */
  battle: BattleRequest | null;
  /** Order an attack: it goes to the arena when there are enemies to fight, straight to the map when not. */
  attack(target: HexKey, orders: Record<FormationId, FormationOrder>): void;
  /** Open the arena for a battle. */
  fight(req: BattleRequest): void;
  /** The arena closed: fought (its result rides on the turn's orders), resolved by the odds, or backed out of. */
  endBattle(outcome: BattleOutcome): void;
  setMode(mode: Mode): void;
  setTab(tab: Tab): void;
  setHover(key: HexKey | null): void;
  togglePanel(open?: boolean): void;
  /** Select the next own formation without an order, after the current one. */
  nextIdle(): void;
  /** Apply the turn being replayed and open its report. Also used to skip the replay. */
  finishPlayback(): void;
  setAnimate(on: boolean): void;
  /** Give an order from the map or unit panel, then move on to the next unit without orders. */
  issueOrder(id: FormationId, order: FormationOrder): void;
  /** Arm a touch attack: shows the odds; the same tap again confirms. */
  armAttack(a: Armed | null): void;
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
  /** Save to a slot; a quiet save (the autosave) says nothing unless it fails. */
  save(slot: string, quiet?: boolean): Promise<void>;
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
      // A war won opens the next theatre.
      if (r.view.victory?.winner === r.view.self.id) recordWarWon(r.view.scenarioId);
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

  const afterResolve = () => {
    const rejected = get().report?.events.filter((e) => e.kind === 'order_rejected') ?? [];
    if (rejected.length > 0) get().notify(`${rejected.length} order(s) were rejected: see the turn summary`, 'warn');
    // Results arrive as map notifications; the full summary is one click away.
    set({ dismissed: [], selectedFormation: null });
    get().nextIdle();
    // A phone can drop a backgrounded tab at any time: a solo campaign keeps itself after every turn.
    void get().save(AUTOSAVE, true);
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
    group: [],
    battle: null,
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
    mapStyle: readPrefs().mapStyle ?? 'atlas',
    setMapStyle(style) {
      writePrefs({ mapStyle: style });
      set({ mapStyle: style });
    },
    lastTurn: null,
    armed: null,

    async newGame(nation, seed, maxTurns, difficulty, theatre) {
      if (apply(await engine.call({ type: 'new', seed, nation, maxTurns, difficulty, theatre }))) {
        const capital = Object.values(get().view!.sites).find((s) => s.owner === nation && s.kind === 'capital');
        set({ selectedHex: capital?.key ?? null, selectedFormation: null, showReport: false, tab: 'overview', dismissed: [] });
        get().nextIdle();
      }
    },
    async loadGame(text) {
      const r = await engine.call({ type: 'load', text });
      if (r.type !== 'loaded') {
        apply(r);
        return false;
      }
      set({ selectedHex: null, selectedFormation: null, showReport: false, dismissed: [] });
      // Multiplayer is gone: anyone else who sat at the table hands their nation to the AI.
      for (const n of r.humans.slice(1)) await engine.call({ type: 'seat', nation: n, to: 'ai' });
      apply(r.state);
      get().notify(`Loaded turn ${get().view!.turn}`);
      get().nextIdle();
      return true;
    },
    toMenu: () => {
      useCoach.getState().stop();
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
      if (id && id !== get().selectedFormation) sfx.select();
      set({ selectedFormation: id, group: id ? [id] : [], selectedHex: f?.key ?? get().selectedHex, mode: 'move', armed: null, ...(id ? { selectedCity: null } : {}) });
    },
    selectStack(key, idleOnly = false) {
      const { view, draft } = get();
      if (!view) return;
      const here = Object.values(view.formations)
        .filter((f) => f.key === key && (!idleOnly || !draft?.formations[f.id]))
        // Led by the slowest ground unit: its range is where the whole stack can go. Aircraft lead only themselves.
        .sort((a, b) => Number(!UNITS[a.unitClass].ground) - Number(!UNITS[b.unitClass].ground) || movementAllowance(a) - movementAllowance(b) || (a.id < b.id ? -1 : 1));
      const lead = here[0];
      if (!lead) return;
      if (lead.id !== get().selectedFormation) sfx.select();
      set({ selectedFormation: lead.id, group: here.map((f) => f.id), selectedHex: key, mode: 'move', armed: null, selectedCity: null });
    },
    toggleGroup(id) {
      const { group, selectedFormation } = get();
      const next = group.includes(id) ? group.filter((g) => g !== id) : [...group, id];
      if (next.length === 0) return;
      set({ group: next, armed: null, selectedFormation: next.includes(selectedFormation ?? '') ? selectedFormation : next[0]! });
    },
    issueGroup(orders) {
      const ids = Object.keys(orders);
      if (ids.length === 0) return;
      set({ armed: null });
      if (ids.some((id) => orders[id]!.type === 'attack')) sfx.boom();
      else sfx.order();
      editDraft((d) => {
        for (const id of ids) d.formations[id] = orders[id]!;
        return d;
      });
      const lead = get().selectedFormation;
      setTimeout(() => {
        const s = get();
        if (lead && s.selectedFormation === lead && !s.resolving && s.draft?.formations[lead]) s.nextIdle();
      }, 320);
    },
    armAttack: (a) => {
      if (a) sfx.arm();
      set({ armed: a });
    },
    async autoCommand() {
      const { view, draft, resolving } = get();
      if (!view || !draft || resolving) return;
      const r = await engine.call({ type: 'suggest', nation: view.self.id });
      if (r.type !== 'suggested') return;
      const cur = get().draft;
      if (!cur) return;
      const next = structuredClone(cur);
      let n = 0;
      for (const [id, o] of Object.entries(r.orders.formations)) {
        if (next.formations[id] || !view.formations[id]) continue;
        next.formations[id] = o;
        n += 1;
      }
      const busy = new Set([...view.self.productionQueue.map((q) => q.siteId), ...next.recruit.map((x) => x.siteId)]);
      // The staff spends at most half of what is in the bank, and nothing while the treasury is shrinking:
      // a new unit costs upkeep every turn after.
      const ledger = selfLedger(view, get().report);
      const shrinking = ledger ? netChange(ledger).credits < 0 : false;
      const spent = { credits: 0, energy: 0, materials: 0, food: 0 };
      for (const x of next.recruit) for (const res of RESOURCES) spent[res] += recruitCostFor(view, x.unitClass)[res];
      for (const rec of r.orders.recruit) {
        if (busy.has(rec.siteId) || shrinking) continue;
        const cost = recruitCostFor(view, rec.unitClass);
        if (RESOURCES.some((res) => spent[res] + cost[res] > view.self.stockpile[res] / 2)) continue;
        for (const res of RESOURCES) spent[res] += cost[res];
        next.recruit.push(rec);
        busy.add(rec.siteId);
        n += 1;
      }
      if (next.research === undefined && !view.self.research.current && r.orders.research) next.research = r.orders.research;
      set({ draft: next, armed: null, selectedFormation: null });
      void recheck();
      get().notify(n ? `Staff drafted ${n} order${n === 1 ? '' : 's'}. Change any, then end the turn.` : 'Every unit already has orders.');
    },
    setMode: (mode) => set({ mode }),
    setTab: (tab) => set({ tab, panelOpen: true }),
    setHover: (key) => {
      if (get().hoverHex !== key) set({ hoverHex: key });
    },
    togglePanel: (open) => set({ panelOpen: open ?? !get().panelOpen }),
    nextIdle: () => {
      const { view, draft, selectedFormation, group } = get();
      if (!view || !draft) return;
      const idle = idleFormations(view, draft.formations);
      if (idle.length === 0) return;
      const fresh = idle.filter((f) => !group.includes(f.id));
      const next = fresh.find((f) => selectedFormation !== null && f.id > selectedFormation) ?? fresh[0] ?? idle[0]!;
      // The whole idle stack comes up together: one order can move it.
      get().selectStack(next.key, true);
      if (!get().group.includes(next.id)) get().selectFormation(next.id);
      get().focusOn(next.key);
    },
    setOrder: (id, order) =>
      editDraft((d) => {
        if (order) d.formations[id] = order;
        else delete d.formations[id];
        // A unit that no longer attacks there takes its battle's result with it: that fight falls to the odds.
        if (d.battles?.some((b) => b.attackers.includes(id) && !(order?.type === 'attack' && order.target === b.target))) {
          d.battles = d.battles.filter((b) => !b.attackers.includes(id) || (order?.type === 'attack' && order.target === b.target));
          get().notify('Orders changed: that battle will be settled by the odds instead', 'warn');
        }
        return d;
      }),
    attack(target, orders) {
      const view = get().view;
      const req = view ? battleFor(view, target, orders) : null;
      if (req && !useGame.getState().submitted) {
        set({ armed: null });
        get().fight(req);
      } else get().issueGroup(orders);
    },
    fight(req) {
      set({ battle: req, armed: null });
    },
    endBattle(outcome) {
      const req = get().battle;
      set({ battle: null });
      if (!req || req.skirmish || outcome.kind === 'back') {
        if (req?.skirmish && outcome.kind === 'fought') recordStars(req, outcome.result);
        return;
      }
      get().issueGroup(req.orders);
      if (outcome.kind === 'fought') {
        recordStars(req, outcome.result);
        const record = battleRecord(req, outcome.result);
        editDraft((d) => {
          d.battles = [...(d.battles ?? []).filter((b) => b.target !== record.target), record];
          return d;
        });
      }
    },
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
      const { draft: planned, resolving, view } = get();
      if (!planned || resolving) return;
      // Research never sits idle: with nothing chosen, the scientists start the recommended project.
      let draft = planned;
      if (view && draft.research === undefined && !view.self.research.current) {
        const pick = recommendedTech(view);
        if (pick) {
          draft = { ...draft, research: pick };
          set({ draft });
        }
      }
      sfx.endTurn();
      set({ submitted: structuredClone(draft), resolving: true });
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
    issueOrder(id, order) {
      set({ armed: null });
      if (order.type === 'attack') sfx.boom();
      else sfx.order();
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

    async save(slot, quiet = false) {
      const r = await engine.call({ type: 'save', label: slot, savedAt: new Date().toISOString() });
      if (r.type !== 'saved') {
        apply(r);
        return;
      }
      const view = get().view!;
      const ok = writeSlot({ slot, label: `${view.self.name}, turn ${r.turn}`, turn: r.turn, nation: view.self.id, savedAt: new Date().toISOString() }, r.text);
      if (!ok) get().notify('Could not save: browser storage is unavailable or full', 'error');
      else if (!quiet) get().notify(`Saved to ${slot}`);
      set({ slots: listSlots() });
    },

    async exportSave() {
      const r = await engine.call({ type: 'save', label: 'Exported', savedAt: new Date().toISOString(), });
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
