// Shared data contracts. Everything here is plain JSON-serializable data: no classes,
// no functions, no Maps or Sets, so world state can be hashed, saved and posted to a worker.

export type NationId = string;
export type FormationId = string;
export type SiteId = string;
export type TechId = string;
/** Axial hex coordinate encoded as "q,r". */
export type HexKey = string;

export type Terrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'urban' | 'water';

export type UnitClass = 'infantry' | 'mechanized' | 'armor' | 'artillery' | 'recon' | 'air' | 'drone';

export const UNIT_CLASSES: readonly UnitClass[] = [
  'infantry',
  'mechanized',
  'armor',
  'artillery',
  'recon',
  'air',
  'drone',
];

export type GovernmentId = 'commonwealth' | 'directorate' | 'federation' | 'union';

export type Resource = 'credits' | 'energy' | 'materials' | 'food';

export const RESOURCES: readonly Resource[] = ['credits', 'energy', 'materials', 'food'];

/** Transferable stockpiles. Industrial capacity and research are throughput, not stored here. */
export type Stockpile = Record<Resource, number>;

export interface Yields {
  credits: number;
  energy: number;
  materials: number;
  food: number;
  industry: number;
  research: number;
}

export interface Tile {
  key: HexKey;
  q: number;
  r: number;
  terrain: Terrain;
  river: boolean;
  /** 0..3. Roads and rail; lowers movement and supply cost. */
  infrastructure: number;
  owner: NationId | null;
  siteId: SiteId | null;
}

export type SiteKind = 'capital' | 'city' | 'depot' | 'objective';

export interface Site {
  id: SiteId;
  name: string;
  kind: SiteKind;
  key: HexKey;
  owner: NationId | null;
  originalOwner: NationId | null;
  /** Thousands of people. Drives food demand. */
  population: number;
  victoryPoints: number;
  yields: Yields;
}

export type Relation = 'war' | 'peace' | 'alliance';

export type DiplomaticAction = 'declare_war' | 'propose_peace' | 'propose_alliance';

export interface Proposal {
  from: NationId;
  to: NationId;
  kind: 'peace' | 'alliance';
  turn: number;
}

export interface Budget {
  /** Percent of gross credit income converted to research. */
  research: number;
  /** Percent spent on logistics infrastructure (raises supply capacity). */
  infrastructure: number;
  /** Percent spent on public welfare (raises stability). */
  welfare: number;
}

export interface ProductionItem {
  id: string;
  unitClass: UnitClass;
  siteId: SiteId;
  /** Industrial capacity applied so far. */
  progress: number;
  /** Industrial capacity required. */
  required: number;
}

export interface ResearchState {
  current: TechId | null;
  /** Research points accumulated toward the current tech (or banked when none is set). */
  progress: number;
  unlocked: TechId[];
}

export interface Nation {
  id: NationId;
  name: string;
  color: string;
  government: GovernmentId;
  stockpile: Stockpile;
  /** Thousands; derived from owned sites each turn. */
  population: number;
  /** 0..100. */
  stability: number;
  /** Industrial capacity available last settlement (throughput per turn). */
  industrialCapacity: number;
  /** Research points generated last settlement (throughput per turn). */
  researchOutput: number;
  budget: Budget;
  research: ResearchState;
  productionQueue: ProductionItem[];
  objectives: SiteId[];
  /** Cumulative strength lost; drives war weariness. */
  warLosses: number;
  eliminated: boolean;
  /** A world event awaiting this nation's answer, drawn at the end of `turn`. */
  event?: PendingEvent | null;
}

export type WorldEventId =
  | 'oil_strike'
  | 'harvest_failure'
  | 'general_strike'
  | 'defector'
  | 'arms_dealer'
  | 'war_bonds'
  | 'volunteers'
  | 'scandal';

export interface PendingEvent {
  id: WorldEventId;
  turn: number;
}

export type OrderType = 'hold' | 'move' | 'attack' | 'defend' | 'recon' | 'withdraw';

export type SupplyPriority = 'high' | 'normal' | 'low';

export type FormationOrder =
  | { type: 'hold' }
  | { type: 'defend' }
  | { type: 'move'; path: HexKey[] }
  | { type: 'recon'; path: HexKey[] }
  | { type: 'withdraw'; path: HexKey[] }
  /** Ground: approach along `path`, then assault the adjacent `target`. Ranged: strike `target`. */
  | { type: 'attack'; target: HexKey; path: HexKey[] };

export interface Formation {
  id: FormationId;
  name: string;
  owner: NationId;
  unitClass: UnitClass;
  key: HexKey;
  /** 0..1000, personnel and equipment as tenths of a percent. */
  strength: number;
  organization: number;
  morale: number;
  readiness: number;
  fuel: number;
  ammunition: number;
  experience: number;
  entrenchment: number;
  supplyPriority: SupplyPriority;
  /** 0..100, share of demand met at the last logistics phase. */
  supply: number;
  /** The order this formation executed last turn. */
  lastOrder: OrderType;
}

export interface RecruitOrder {
  siteId: SiteId;
  unitClass: UnitClass;
}

export interface DiplomacyOrder {
  target: NationId;
  action: DiplomaticAction;
}

/**
 * A battle the player fought in the arena. It replaces the dice for that attack when the turn
 * resolves, as long as the defenders in the hex are the ones that were fought.
 */
export interface ArenaBattle {
  target: HexKey;
  /** Own formations that fought: each must hold an attack order on `target`. */
  attackers: FormationId[];
  /** Enemy formations fought. */
  defenders: FormationId[];
  /** Strength each participant kept, permille of what it had when the battle began (0 = destroyed). */
  kept: Record<FormationId, number>;
  /** The attackers took (or cleared) the hex. */
  won: boolean;
}

export interface NationOrders {
  nation: NationId;
  turn: number;
  formations: Record<FormationId, FormationOrder>;
  recruit: RecruitOrder[];
  budget?: Budget;
  research?: TechId | null;
  supplyPriority?: Record<FormationId, SupplyPriority>;
  diplomacy: DiplomacyOrder[];
  /** Answer to the pending world event; unanswered events take option 0. */
  eventChoice?: 0 | 1;
  /** Battles fought in the arena this turn, one per target. */
  battles?: ArenaBattle[];
}

export interface LastKnownContact {
  owner: NationId;
  unitClass: UnitClass;
  key: HexKey;
  strength: number;
  turn: number;
}

/** What one nation knows. Only ever built from what it observed. */
export interface NationIntel {
  /** Turn each hex was last observed. Absent = never observed. */
  observed: Record<HexKey, number>;
  /** Owner of each hex as of its last observation. */
  knownOwner: Record<HexKey, NationId | null>;
  lastKnown: Record<FormationId, LastKnownContact>;
}

export type VictoryReason = 'victory_points' | 'last_standing' | 'turn_limit';

export interface VictoryState {
  winner: NationId;
  reason: VictoryReason;
  turn: number;
}

/**
 * How hard the campaign is for its human seats. Easy: a single-player campaign opens at war with
 * the nearest rival only, the AI never declares war on a human and accepts any peace a human
 * offers, and the human starts with half again the stockpile. Hard: the AI starts with that bonus.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface WorldState {
  schema: 1;
  rulesetVersion: string;
  scenarioId: string;
  /** Number of the next turn to be resolved. Starts at 1. */
  turn: number;
  maxTurns: number;
  seed: number;
  /** Next id for formations and production items. */
  nextId: number;
  tiles: Record<HexKey, Tile>;
  sites: Record<SiteId, Site>;
  nations: Record<NationId, Nation>;
  formations: Record<FormationId, Formation>;
  /** Keyed by `pairKey(a, b)`. */
  relations: Record<string, Relation>;
  proposals: Proposal[];
  intel: Record<NationId, NationIntel>;
  victory: VictoryState | null;
  /** Absent in campaigns made before difficulty existed: they play as normal. */
  difficulty?: Difficulty;
}

// ---------------------------------------------------------------------------
// Events

export interface EngagementParticipant {
  formation: FormationId;
  owner: NationId;
  unitClass: UnitClass;
  role: 'attacker' | 'defender' | 'meeting';
  from: HexKey;
  strengthBefore: number;
  strengthLoss: number;
  organizationLoss: number;
  moraleChange: number;
  ammunitionSpent: number;
}

export interface Ledger {
  income: Stockpile;
  upkeep: Stockpile;
  production: Stockpile;
  logistics: Stockpile;
  /** Budget allocations (research, infrastructure, welfare) and reinforcement materials. */
  spending: Stockpile;
  shortages: Resource[];
  industry: number;
  research: number;
}

export type GameEvent =
  | {
      kind: 'movement';
      formation: FormationId;
      owner: NationId;
      unitClass: UnitClass;
      path: HexKey[];
      halted: 'enemy' | 'contact' | 'contested' | 'stacking' | null;
    }
  | {
      kind: 'engagement';
      id: string;
      location: HexKey;
      type: 'assault' | 'meeting';
      participants: EngagementParticipant[];
      outcome: 'attacker_victory' | 'defender_held' | 'inconclusive';
      retreated: FormationId[];
      destroyed: FormationId[];
      advanced: FormationId | null;
      /** Fought in the arena (true), or an arena result that no longer applied (`'voided'`). */
      arena?: true | 'voided';
    }
  | {
      kind: 'strike';
      source: FormationId;
      owner: NationId;
      unitClass: UnitClass;
      target: HexKey;
      victims: { formation: FormationId; owner: NationId; strengthLoss: number }[];
      sourceLoss: number;
    }
  | { kind: 'retreat'; formation: FormationId; owner: NationId; from: HexKey; to: HexKey }
  | { kind: 'destroyed'; formation: FormationId; owner: NationId; unitClass: UnitClass; at: HexKey }
  | { kind: 'territory'; key: HexKey; from: NationId | null; to: NationId }
  | { kind: 'site_captured'; site: SiteId; key: HexKey; from: NationId | null; to: NationId }
  | {
      kind: 'production';
      nation: NationId;
      formation: FormationId;
      unitClass: UnitClass;
      site: SiteId;
      key: HexKey;
    }
  | { kind: 'production_cancelled'; nation: NationId; item: string; site: SiteId; reason: string }
  | { kind: 'recruitment_queued'; nation: NationId; item: string; unitClass: UnitClass; site: SiteId }
  | { kind: 'economy'; nation: NationId; ledger: Ledger }
  | { kind: 'supply'; nation: NationId; formation: FormationId; key: HexKey; supply: number }
  | { kind: 'intel'; nation: NationId; formation: FormationId; owner: NationId; unitClass: UnitClass; key: HexKey }
  | { kind: 'research'; nation: NationId; tech: TechId }
  /** `broke` is the treaty a declaration of war tore up, if any. */
  | { kind: 'diplomacy'; a: NationId; b: NationId; relation: Relation; proposedBy: NationId; broke?: 'peace' | 'alliance' }
  | { kind: 'proposal'; from: NationId; to: NationId; proposal: 'peace' | 'alliance' }
  | { kind: 'world_event'; nation: NationId; event: WorldEventId; choice: 0 | 1 | null }
  | { kind: 'elimination'; nation: NationId }
  | { kind: 'victory'; winner: NationId; reason: VictoryReason }
  | { kind: 'order_rejected'; nation: NationId; formation: FormationId | null; reason: string };

export interface TurnReport {
  turn: number;
  events: GameEvent[];
  victoryPoints: Record<NationId, number>;
}

// ---------------------------------------------------------------------------
// Views: what a single nation may see. The client and the AI only ever receive these.

export type Visibility = 'visible' | 'observed' | 'unknown';

export interface TileView {
  key: HexKey;
  q: number;
  r: number;
  visibility: Visibility;
  /** Present unless unknown. */
  terrain: Terrain | null;
  river: boolean;
  infrastructure: number;
  /** Current owner when visible, last known owner when observed, null when unknown. */
  owner: NationId | null;
  siteId: SiteId | null;
  lastObserved: number | null;
}

export interface SiteView {
  id: SiteId;
  name: string;
  kind: SiteKind;
  key: HexKey;
  /** As last observed. */
  owner: NationId | null;
  victoryPoints: number;
  population: number;
  yields: Yields;
}

export interface Contact {
  formation: FormationId;
  owner: NationId;
  unitClass: UnitClass;
  key: HexKey;
  /** Exact strength is never shown for enemies; this is a rounded estimate. */
  estimatedStrength: number;
  /** true = observed this turn; false = last known position. */
  confirmed: boolean;
  lastSeen: number;
}

export interface PublicNation {
  id: NationId;
  name: string;
  color: string;
  government: GovernmentId;
  eliminated: boolean;
  victoryPoints: number;
}

export interface NationView {
  scenarioId: string;
  rulesetVersion: string;
  turn: number;
  maxTurns: number;
  self: Nation;
  nations: Record<NationId, PublicNation>;
  relations: Record<NationId, Relation>;
  proposals: Proposal[];
  tiles: Record<HexKey, TileView>;
  sites: Record<SiteId, SiteView>;
  formations: Record<FormationId, Formation>;
  contacts: Record<FormationId, Contact>;
  victoryThreshold: number;
  totalVictoryPoints: number;
  victory: VictoryState | null;
  difficulty: Difficulty;
}

export interface TurnResult {
  world: WorldState;
  events: GameEvent[];
  observations: Record<NationId, NationView>;
  reports: Record<NationId, TurnReport>;
  hash: string;
}

// ---------------------------------------------------------------------------
// Saves

export const SAVE_FORMAT = 'brink-save';
export const SAVE_VERSION = 1;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  saveVersion: number;
  rulesetVersion: string;
  scenarioId: string;
  turn: number;
  playerNation: NationId;
  seed: number;
  /** Wall-clock metadata only; never read by the simulation. */
  savedAt: string;
  label: string;
  world: WorldState;
  /** Per-nation reports for replay, keyed by turn. Player reports only in a single-player save. */
  reports: TurnReport[];
  aiMemory: Record<NationId, AiMemory>;
  hash: string;
  /** Every human seat, `playerNation` first. Absent in single-player saves. */
  humans?: NationId[];
  /** Report history per seat beyond `playerNation`, including seats the AI is holding. */
  histories?: Record<NationId, TurnReport[]>;
  /** A room save: each seat's player callsign, so the room can resume with seats reserved. */
  callsigns?: Record<NationId, string>;
}

/** What an AI nation remembers between turns. Built only from its own views and reports. */
export interface AiMemory {
  /** Running count of enemy formations sighted, by class. */
  enemySightings: Record<UnitClass, number>;
  /** Turn each own site was last attacked or threatened. */
  pressure: Record<SiteId, number>;
  /** Nations that attacked this nation, with the turn of the latest attack. */
  aggressors: Record<NationId, number>;
  /** Turn this nation last captured a site; absent until it does. Measures a stalled war. */
  lastGain?: number;
}
