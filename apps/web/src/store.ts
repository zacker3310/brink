import { create } from 'zustand';
import type {
  Budget,
  Difficulty,
  DiplomaticAction,
  FacilityId,
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
import { withPosting } from './generals';
import { idleFormations, netChange, selfLedger, wonCampaign } from './insight';
import { recommendedTech, recruitCostFor } from './rules-view';
import { movementAllowance } from '@brink/simulation';
import { UNITS } from '@brink/game-data';
import { useCoach } from './coach';
import { sfx } from './sfx';
import { battleFor, battleRecord, type BattleRequest } from './arena/battle';
import type { BattleOutcome } from './arena/ArenaScreen';
import { recordStars, recordWarWon } from './arena/career';
import { warRequest, warSaveFor } from './arena/resume';
import type { Mode } from './planning';
import type { Response } from './protocol';
import { AUTOSAVE, listSlots, readPrefs, writePrefs, writeSlot, type ActiveOperation, type MapStyle, type SlotInfo } from './saves';
import { operationById, type Operation } from '@brink/ai';

export type Tab = 'overview' | 'military' | 'economy' | 'research' | 'diplomacy' | 'generals';

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
  mapStyle: MapStyle;
  setMapStyle(style: MapStyle): void;
  /** A touch attack waiting for its confirming second tap. */
  armed: Armed | null;
  /** The last resolved turn, kept so it can be replayed again. */
  lastTurn: { before: NationView; events: GameEvent[] } | null;

  newGame(nation: NationId, seed: number, maxTurns?: number, difficulty?: Difficulty, theatre?: string, crisis?: string): Promise<void>;
  /** Let the staff draft orders for every unit and city still waiting; the player can change any. */
  autoCommand(auto?: boolean): Promise<void>;
  /** Staff plan mode: the staff drafts a plan at the start of every turn. */
  staffPlan: boolean;
  setStaffPlan(on: boolean): void;
  /** Units whose orders are the staff's and the player has not touched this turn. */
  planned: FormationId[];
  /** Take back every order the staff drafted that the player has not touched. */
  clearPlan(): void;
  /** The operation the staff is running: every turn it drafts orders toward its prize. */
  operation: ActiveOperation | null;
  /** Launch an operation: the staff's plan is redrawn around it now and every turn after. */
  launchOperation(op: Operation): void;
  cancelOperation(): void;
  /** The Operations sheet is open. */
  opsOpen: boolean;
  setOpsOpen(open: boolean): void;
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
  /** Start (or, with null, cancel) this turn's building at a site. */
  setBuild(siteId: string, facility: FacilityId | null): void;
  setBudget(budget: Budget): void;
  setResearch(tech: TechId | null): void;
  setEventChoice(choice: 0 | 1): void;
  /** Post a general to a formation (null: the reserve) when the turn resolves. */
  setPosting(commander: string, formation: FormationId | null): void;
  /** Answer a general's promotion: which of the two perks. */
  setPerkChoice(commander: string, choice: 0 | 1): void;
  setDiplomacy(target: NationId, action: DiplomaticAction | null): void;
  setPriority(id: FormationId, p: SupplyPriority): void;
  submit(): Promise<void>;
  /** The order review is open: End Turn shows it, Commit submits. */
  review: boolean;
  openReview(): void;
  closeReview(): void;
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

const opKey = (view: NationView) => `${view.scenarioId}|${view.self.id}`;

function readOperation(view: NationView): ActiveOperation | null {
  return readPrefs().operations?.[opKey(view)] ?? null;
}

function writeOperation(view: NationView, op: ActiveOperation | null): void {
  writePrefs({ operations: { ...(readPrefs().operations ?? {}), [opKey(view)]: op } });
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
      set({ view: r.view, report: r.report, history: r.history, draft: freshDraft(r.view), planned: [], submitted: null, rejected: [], screen: 'game' });
      // The operation for this seat, and whether it is over: the prize taken, or out of reach.
      const op = readOperation(r.view);
      if (op && !operationById(r.view, op.id, op.kind)) {
        const site = r.view.sites[op.id.slice(5)];
        get().notify(site?.owner === r.view.self.id ? `${op.codename} complete: ${site.name} is yours` : `${op.codename} called off: ${op.name.replace('Take ', '')} is out of reach`);
        writeOperation(r.view, null);
        set({ operation: null });
      } else set({ operation: op });
      // Staff plan mode (or a running operation): every turn opens with the staff's plan drafted; the player changes what they like.
      if ((get().staffPlan || get().operation) && !r.view.victory) void get().autoCommand(true);
      // A war won opens the next theatre.
      if (wonCampaign(r.view)) recordWarWon(r.view.scenarioId);
      // A battle the page was closed in on this turn waits for the same attack (arena/resume.ts).
      const saved = warSaveFor(r.view);
      if (saved) get().notify(`${saved.request.title} was saved mid-battle: order the same attack again to pick it up`);
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
    review: false,
    openReview: () => {
      const { draft, resolving, view } = get();
      if (!draft || resolving || !view || view.victory) return;
      set({ review: true, armed: null });
      void recheck();
    },
    closeReview: () => set({ review: false }),
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
    mapStyle: readPrefs().mapStyle ?? 'painted',
    setMapStyle(style) {
      writePrefs({ mapStyle: style });
      set({ mapStyle: style });
    },
    lastTurn: null,
    armed: null,

    async newGame(nation, seed, maxTurns, difficulty, theatre, crisis) {
      if (apply(await engine.call({ type: 'new', seed, nation, maxTurns, difficulty, theatre, crisis }))) {
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
      get().notify(r.migratedFrom ? `Loaded turn ${get().view!.turn}, upgraded from rules ${r.migratedFrom} to the current rules` : `Loaded turn ${get().view!.turn}`);
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
      // Passengers are cargo, not a stack: a ship's card lists them. A hex has two layers, ships and
      // everything else; a tap takes the land layer if there is one, else the ships.
      const standing = Object.values(view.formations).filter((f) => f.key === key && !f.aboard && (!idleOnly || !draft?.formations[f.id]));
      const landLayer = standing.filter((f) => !UNITS[f.unitClass].naval);
      const here = (landLayer.length > 0 ? landLayer : standing)
        // Led by the slowest ground unit: its range is where the whole stack can go. Aircraft lead only themselves.
        .sort((a, b) => Number(!UNITS[a.unitClass].ground) - Number(!UNITS[b.unitClass].ground) || movementAllowance(a) - movementAllowance(b) || (a.id < b.id ? -1 : 1));
      const lead = here[0];
      if (!lead) return;
      // A carrier's air wing is its weapon: selected with it, it strikes from the deck and rides
      // along when the carrier sails.
      const wings = Object.values(view.formations).filter((p) => p.aboard && here.some((c) => c.id === p.aboard && UNITS[c.unitClass].carries === 'air') && (!idleOnly || !draft?.formations[p.id]));
      if (lead.id !== get().selectedFormation) sfx.select();
      set({ selectedFormation: lead.id, group: [...here, ...wings].map((f) => f.id), selectedHex: key, mode: 'move', armed: null, selectedCity: null });
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
      if (get().planned.some((p) => ids.includes(p))) set({ planned: get().planned.filter((p) => !ids.includes(p)) });
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
    staffPlan: readPrefs().staffPlan ?? true,
    setStaffPlan(on) {
      writePrefs({ staffPlan: on });
      set({ staffPlan: on });
      if (on) void get().autoCommand(true);
    },
    operation: null,
    launchOperation(op) {
      const view = get().view;
      if (!view) return;
      const active: ActiveOperation = { id: op.id, kind: op.kind, codename: op.codename, name: op.name };
      writeOperation(view, active);
      // The staff's old plan gives way to the operation's; the player's own orders stay.
      const { planned } = get();
      editDraft((d) => {
        for (const id of planned) delete d.formations[id];
        // A missing transport is put on order where it can be built, when nothing is building there.
        if (op.needs && !d.recruit.some((x) => x.siteId === op.needs!.siteId) && !view.self.productionQueue.some((q) => q.siteId === op.needs!.siteId)) {
          d.recruit.push({ siteId: op.needs.siteId, unitClass: op.needs.unitClass });
        }
        return d;
      });
      set({ operation: active, planned: [], opsOpen: false });
      get().notify(`${op.codename} launched: ${op.name}. The staff has drafted this turn's orders; check them, then end the turn.`);
      void get().autoCommand(true);
    },
    cancelOperation() {
      const { view, operation, planned } = get();
      if (!view || !operation) return;
      writeOperation(view, null);
      editDraft((d) => {
        for (const id of planned) delete d.formations[id];
        return d;
      });
      set({ operation: null, planned: [] });
      get().notify(`${operation.codename} called off`);
      if (get().staffPlan) void get().autoCommand(true);
    },
    opsOpen: false,
    setOpsOpen(open) {
      set({ opsOpen: open });
    },
    planned: [],
    clearPlan() {
      const { planned } = get();
      if (planned.length === 0) return;
      editDraft((d) => {
        for (const id of planned) delete d.formations[id];
        return d;
      });
      set({ planned: [] });
      get().notify('Plan cleared: every unit waits for your orders');
    },
    async autoCommand(auto = false) {
      const { view, draft, resolving } = get();
      if (!view || !draft || resolving) return;
      const op = get().operation;
      const r = await engine.call({ type: 'suggest', nation: view.self.id, ...(op ? { target: op.id.slice(5) } : {}) });
      if (r.type !== 'suggested') return;
      const cur = get().draft;
      if (!cur) return;
      const next = structuredClone(cur);
      let n = 0;
      const planned = [...get().planned];
      for (const [id, o] of Object.entries(r.orders.formations)) {
        if (next.formations[id] || !view.formations[id]) continue;
        next.formations[id] = o;
        planned.push(id);
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
      // A turn that moved on while the staff was thinking keeps the new turn's draft. The guided
      // first match teaches giving orders by hand: no plan while the coach is on.
      if (get().view !== view || (auto && useCoach.getState().active)) return;
      // The plan is the picture: nothing selected, so every arrow on the map is the staff's.
      set({ draft: next, planned, armed: null, selectedFormation: null, ...(auto ? { group: [], selectedHex: null } : {}) });
      void recheck();
      if (!auto) get().notify(n ? `Staff drafted ${n} order${n === 1 ? '' : 's'}. Change any, then execute.` : 'Every unit already has orders.');
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
    setOrder: (id, order) => {
      if (get().planned.includes(id)) set({ planned: get().planned.filter((p) => p !== id) });
      editDraft((d) => {
        if (order) d.formations[id] = order;
        else delete d.formations[id];
        // A unit that no longer attacks there takes its battle's result with it: that fight falls to the odds.
        if (d.battles?.some((b) => b.attackers.includes(id) && !(order?.type === 'attack' && order.target === b.target))) {
          d.battles = d.battles.filter((b) => !b.attackers.includes(id) || (order?.type === 'attack' && order.target === b.target));
          get().notify('Orders changed: that battle will be settled by the odds instead', 'warn');
        }
        return d;
      });
    },
    attack(target, orders) {
      const view = get().view;
      const req = view ? battleFor(view, target, orders) : null;
      if (req && !useGame.getState().submitted) {
        set({ armed: null });
        get().fight(req);
      } else get().issueGroup(orders);
    },
    fight(req) {
      const view = get().view;
      // A war-map attack picks up its battle if the page was closed during it (arena/resume.ts).
      set({ battle: !req.skirmish && view ? warRequest(req, view.turn, view.self.id) : req, armed: null });
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
    setBuild: (siteId, facility) =>
      editDraft((d) => {
        const rest = (d.build ?? []).filter((b) => b.siteId !== siteId);
        d.build = facility ? [...rest, { siteId, facility }] : rest;
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
    setPosting: (commander, formation) => {
      const view = get().view;
      if (view) editDraft((d) => ({ ...d, commanders: { ...d.commanders, assign: withPosting(view, d, commander, formation) } }));
    },
    setPerkChoice: (commander, choice) => editDraft((d) => ({ ...d, commanders: { ...d.commanders, perks: { ...d.commanders?.perks, [commander]: choice } } })),
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
      set({ submitted: structuredClone(draft), resolving: true, review: false });
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
