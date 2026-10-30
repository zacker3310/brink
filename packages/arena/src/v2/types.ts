import type { GovernmentId, TechId, Terrain, UnitClass } from '@brink/contracts';
import type { PlayerCommand } from './replay';

// Arena v2: the shared contract between the rules engine, the level generator, the roster, the AI,
// the renderer and the war map. Everything here is plain JSON data (docs/arena-v2.md).

// --- Scale -----------------------------------------------------------------------------------------

/** Field size in cells. One cell is 150 m of tactical ground; models are drawn at 10 m a cell. */
export const W = 30;
export const H = 45;
/** Rounds a battle may last (both sides' turns); when they run out the defenders have held. */
export const ROUND_LIMIT = 16;
/** Rounds in a row the attackers must end holding the zone, with no defender in it, to take it. */
export const CAPTURE_ROUNDS = 2;
export const ZONE_RADIUS = 3.5;
/** Highest elevation level. A level is about 4 m of relief at figure scale. */
export const MAX_ELEV = 4;
/** The defender withdraws when its force falls under this share of its starting value. */
export const WITHDRAW_AT = 0.35;
/** The attacker's company breaks (the battle is lost) under this share of its starting value. */
export const BREAK_AT = 0.25;

export interface Point {
  x: number;
  y: number;
}

export type Side = 'blue' | 'red';
/** How hard a battle is: the player's and the enemy's aim, how many they field, how sharp they play (DIFFICULTY in rules.ts). */
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Faction = 'west' | 'east';
/** Equipment pools: Commonwealth (US), Federation (Europe), Directorate (modern Russian), Union (older Russian). */
export type Arsenal = 'us' | 'europe' | 'russia' | 'legacy';
export type Biome = 'temperate' | 'steppe' | 'desert' | 'winter' | 'urban';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'overcast' | 'rain' | 'fog' | 'snow';
export type SiteKind = 'capital' | 'city' | 'objective' | 'depot' | null;

export const ARSENAL_OF: Record<GovernmentId, Arsenal> = { commonwealth: 'us', federation: 'europe', directorate: 'russia', union: 'legacy' };
export const FACTION_OF: Record<Arsenal, Faction> = { us: 'west', europe: 'west', russia: 'east', legacy: 'east' };

// --- The field ---------------------------------------------------------------------------------------

export const OPEN = 0;
/** Faster for wheels; otherwise open ground. */
export const ROAD = 1;
/** Woods: foot only; one tree cell on a line conceals (-10), two block it. */
export const TREES = 2;
/** River: aircraft and amphibious vehicles only. */
export const WATER = 3;
export const BRIDGE = 4;
/** Blocks movement and sight; infantry may garrison it; crumbles to rubble at 0 HP. */
export const BUILDING = 5;
/** Half cover; foot and tracks only (double cost). */
export const RUBBLE = 6;
/** Low wall, hedge, sandbags or Hesco (by `variant`): cover, never blocks a line, wheels cannot cross. */
export const WALL = 7;
/** Boulders and outcrops: full cover, blocks vehicles, low enough to see over from height. */
export const ROCK = 8;

export type Cell = typeof OPEN | typeof ROAD | typeof TREES | typeof WATER | typeof BRIDGE | typeof BUILDING | typeof RUBBLE | typeof WALL | typeof ROCK;

/** What a WALL cell is, from `variant & 3`. Hesco is full cover; the rest half. */
export const WALL_KINDS = ['hedge', 'stone', 'sandbag', 'hesco'] as const;
/** What a BUILDING cell is, from `variant & 3`. */
export const BUILDING_KINDS = ['house', 'apartment', 'industrial', 'shop'] as const;
/** What a TREES cell is, from `variant & 3` (the renderer picks by biome too). */
export const TREE_KINDS = ['broadleaf', 'conifer', 'birch', 'scrub'] as const;

/** Feature height in levels above the ground, for lines of sight. Buildings use their storeys. */
export const FEATURE_HEIGHT: Record<Cell, number> = { 0: 0, 1: 0, 2: 1.5, 3: 0, 4: 0, 5: 0, 6: 0.3, 7: 0.25, 8: 0.8 };
export const SMOKE_HEIGHT = 3.5;
export const BUILDING_HP_PER_STOREY = 40;

export interface MapSetup {
  seed: number;
  terrain: Terrain;
  river: boolean;
  site: SiteKind;
  biome: Biome;
}

export interface BattleMap {
  w: number;
  h: number;
  biome: Biome;
  terrain: Terrain;
  /** Row-major, `y * w + x`. */
  cells: Cell[];
  /** Ground level of each cell, 0..MAX_ELEV (integers). */
  elev: number[];
  /** Buildings: 1..4 storeys; 0 elsewhere. */
  storeys: number[];
  /** Hits left: buildings 40 a storey, trees 2, walls 1; 0 for the rest. */
  hp: number[];
  /** 0..255, picked once by the generator: building, wall and tree kinds, and look. */
  variant: number[];
  /** 1 where a shell crater is (half cover for infantry standing in it). */
  crater: number[];
  mode: 'destroy' | 'capture';
  zone: (Point & { r: number }) | null;
  /** Attacker deployment cells, best first (bottom rows). */
  blueSpawn: Point[];
  /** Defender deployment cells the AI chooses among (top part of the field). */
  redSpawn: Point[];
}

export const at = (map: { w: number }, x: number, y: number) => y * map.w + x;
export const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

// --- Unit types ------------------------------------------------------------------------------------

export type TypeId =
  | 'm1a2' | 'leo2a7' | 'cr3' | 't72b3' | 't90m' | 't80bvm'
  | 'm2a3' | 'bmp3' | 'cv90' | 'stryker'
  | 'm10' | 'sprut' | 'm1134' | 'kornetd'
  | 'ah64e' | 'ka52' | 'mi35' | 'ah6' | 'uh60' | 'mi8'
  | 'squad_w' | 'squad_e' | 'team_w' | 'team_e'
  | 'javelin' | 'kornet' | 'rpg' | 'gustaf' | 'stinger' | 'igla'
  | 'sniper_w' | 'sniper_e' | 'mortar_w' | 'mortar_e' | 'engineer_w' | 'engineer_e' | 'medic_w' | 'medic_e'
  | 'fpv_w' | 'fpv_e' | 'switchblade' | 'lancet'
  | 'gepard' | 'tunguska' | 'paladin' | 'msta' | 'm88' | 'brem'
  | 'raven' | 'orlan';

export type Role =
  | 'mbt' | 'ifv' | 'apc' | 'light_tank' | 'tank_hunter' | 'spaa' | 'spg' | 'arv'
  | 'attack_heli' | 'gunship' | 'scout_heli' | 'transport_heli' | 'recon_drone'
  | 'rifle_squad' | 'fireteam' | 'at_team' | 'aa_team' | 'sniper' | 'mortar' | 'engineer' | 'medic' | 'fpv_team' | 'loiter_team';

export type Mobility = 'tracked' | 'wheeled' | 'foot' | 'heli' | 'drone';

export type WeaponKind = 'cannon' | 'autocannon' | 'mg' | 'small_arms' | 'sniper' | 'grenade' | 'rocket' | 'atgm' | 'manpads' | 'mortar' | 'howitzer' | 'fpv' | 'loiter';

/** Kinetic penetrator, shaped charge, or high explosive (blast penetration only). */
export type RoundType = 'ke' | 'ce' | 'he';

export interface Weapon {
  /** Unique within its unit type. */
  id: string;
  /** As on the card: "120 mm M256 · M829A4". */
  name: string;
  kind: WeaponKind;
  /** For audio: '5.56', '7.62', '12.7', '25', '30', '35', '100', '105', '120', '125', '152', '155', 'atgm', 'rocket', 'manpads', 'fpv'. */
  calibre: string;
  /** Cells. */
  range: number;
  minRange: number;
  /** Base chance to hit, percent, at up to half range in the open. */
  aim: number;
  /** Millimetres RHA equivalent against the armour type `round` attacks. */
  pen: number;
  round: RoundType;
  /** Strikes the top armour. */
  top?: boolean;
  /** Expected casualties a hit causes on troops in the open. */
  lethality: number;
  /** Suppression a hit adds (half on a miss, and to everyone in a blast). */
  supp: number;
  /** Blast radius in cells (Chebyshev); the ring takes half. */
  blast: number;
  /** Building damage a hit does. */
  demo: number;
  /** Shots per battle; null for no limit. */
  ammo: number | null;
  air: 'no' | 'yes' | 'only';
  guidance: 'none' | 'saclos' | 'fnf';
  /** Mortars and howitzers: no line of sight needed, but the cell must be observed to be accurate. */
  indirect?: boolean;
  /** Smoke rounds carried (indirect weapons). */
  smoke?: number;
  /** Missiles a shot spends on one target (a salvo leaves an APS one interceptor short). */
  salvo?: number;
  /** Cannot fire after moving (tripods, baseplates). */
  setup?: boolean;
  /** A hit is exactly one casualty (snipers). */
  precise?: boolean;
  /** Rounds drawn per shot by the film. */
  burst: number;
}

/** [KE, CE] in millimetres RHA equivalent. */
export type ArmourValue = [number, number];

export interface Armour {
  /** Turret front. */
  tf: ArmourValue;
  /** Hull front. */
  hf: ArmourValue;
  side: ArmourValue;
  rear: ArmourValue;
  top: ArmourValue;
}

export type Stowage = 'carousel' | 'basket' | 'bustle' | 'hull' | 'light';

export type SoldierRole = 'leader' | 'team_leader' | 'rifleman' | 'auto_rifleman' | 'grenadier' | 'gunner' | 'at' | 'assistant' | 'marksman' | 'sniper' | 'spotter' | 'medic' | 'sapper' | 'operator';

/** Eye, centre and top heights above the ground, in levels, by body. */
export type Profile = 'mbt' | 'light' | 'foot' | 'heli' | 'drone';
export const PROFILE: Record<Profile, { eye: number; centre: number; top: number }> = {
  mbt: { eye: 0.7, centre: 0.3, top: 0.75 },
  light: { eye: 0.6, centre: 0.25, top: 0.6 },
  foot: { eye: 0.45, centre: 0.25, top: 0.45 },
  heli: { eye: 2.5, centre: 2.5, top: 2.7 },
  drone: { eye: 6, centre: 6, top: 6 },
};

export interface UnitType {
  id: TypeId;
  /** Full designation: "M1A2 SEPv3 Abrams". */
  name: string;
  /** For tight labels: "Abrams". */
  short: string;
  role: Role;
  faction: Faction;
  mobility: Mobility;
  /** Vehicle and aircraft crew; 0 for foot and drones. */
  crew: number;
  /** Foot units: who is in it, leader first. */
  men?: SoldierRole[];
  /** Null for foot units and drones. */
  armour: Armour | null;
  stowage: Stowage;
  /** Movement points per turn in cells (straight steps). */
  move: number;
  /** Day sight in cells (see the conditions table for night, fog, rain). */
  sight: number;
  thermal: boolean;
  nvg?: boolean;
  weapons: Weapon[];
  /** Passenger seats, in soldiers. */
  seats: number;
  amphibious?: boolean;
  aps?: { name: string; charges: number; chance: number };
  /** Smoke grenade salvos. */
  smoke: number;
  flares?: boolean;
  /** Called-fire observer quality it gives the cells it sees. */
  spotter?: 'spotter' | 'laser';
  /** Search radar: sees aircraft within this many cells along a clear line, any light or weather. */
  radar?: number;
  /** Stabilised guns: -5 instead of -10 after moving. */
  stabilised: boolean;
  /** Recovery vehicle: repairs. */
  repair?: boolean;
  /** Medic team: treats. */
  treat?: boolean;
  /** Engineers: breach, mines, smoke pots. */
  engineer?: boolean;
  /** Points, for results and balance. */
  value: number;
  profile: Profile;
  engine: 'turbine' | 'diesel' | 'heli' | 'drone' | 'none';
  /** Real specifications for the card. */
  specs: { origin: string; weight: string; speed: string; note?: string };
  /** Real size in metres (length, width, height), for the model. */
  dims: [number, number, number];
}

// --- Units in battle -------------------------------------------------------------------------------

export interface Soldier {
  role: SoldierRole;
  state: 'fit' | 'wounded' | 'dead';
}

export type UnitStatus = 'ok' | 'destroyed' | 'knocked_out' | 'shot_down' | 'landed' | 'wiped' | 'expended';

export interface Unit {
  id: string;
  type: TypeId;
  side: Side;
  /** The war-map formation it belongs to (results fold back per formation). */
  formation: string;
  name: string;
  /** 0 Recruit .. 3 Ace. */
  rank: number;
  x: number;
  y: number;
  /** Hull heading, radians; 0 faces +x, +pi/2 faces +y (down the field). */
  facing: number;
  /** Turret or weapon heading. */
  aim: number;
  alive: boolean;
  status: UnitStatus;
  /** Vehicles and aircraft. */
  crew: number;
  mobilityKill: boolean;
  firepowerKill: boolean;
  optics: boolean;
  /** Foot units. */
  men: Soldier[];
  /** 0..100. */
  supp: number;
  moved: boolean;
  acted: boolean;
  dashed: boolean;
  overwatch: boolean;
  hunker: boolean;
  /** Popped smoke this turn: it may still move, but takes no other action. */
  smoked: boolean;
  /** Shots left per limited weapon id. */
  ammo: Record<string, number>;
  /** Smoke rounds left per indirect weapon id, and grenade salvos under 'grenades'. */
  smoke: Record<string, number>;
  aps: number;
  /** Inside this carrier (then x, y follow it). */
  carrier: string | null;
  passengers: string[];
  /** Split from this squad. */
  parent: string | null;
  /** Seen by the other side until this turn index, because it fired. */
  revealed: number;
  /** Value at the start of the battle (type value x condition). */
  startValue: number;
}

// --- The battle --------------------------------------------------------------------------------------

export type AbilityId = 'repair' | 'sweep' | 'mines' | 'airstrike' | 'missiles' | 'armor';

export interface Smoke extends Point {
  side: Side;
  /** Clears when this turn index begins. */
  until: number;
}

export interface Mine extends Point {
  side: Side;
}

export interface Wreck extends Point {
  unit: string;
  type: TypeId;
  /** Turns of fire left. */
  burning: number;
}

/** A last known position. */
export interface Ghost extends Point {
  unit: string;
  type: TypeId;
  /** Turn index it was last seen. */
  turn: number;
  /** Seen at the latest update. */
  now: boolean;
}

export interface SupportAsset {
  id: 'himars' | 'tornado';
  side: Side;
  missions: number;
}

export interface Conditions {
  biome: Biome;
  time: TimeOfDay;
  weather: Weather;
}

export interface Battle {
  version: 2;
  seed: number;
  map: BattleMap;
  units: Unit[];
  conditions: Conditions;
  /** 1-based. A round is the attacker's turn, then the defender's. */
  round: number;
  turn: Side;
  /** Counts every side turn from 0. */
  turnIndex: number;
  ended: 'won' | 'lost' | null;
  endReason: 'destroyed' | 'captured' | 'withdrew' | 'retreat' | 'time' | 'wiped' | null;
  /** Enemy decision quality, 0..1, after the difficulty's offset. */
  skill: number;
  difficulty: Difficulty;
  abilities: Partial<Record<AbilityId, 'ready' | 'used'>>;
  support: SupportAsset[];
  /** Precision rounds left (blue). */
  precision: number;
  /** SIGINT: red is revealed to blue until this turn index. */
  sweepUntil: number;
  smoke: Smoke[];
  mines: Mine[];
  wrecks: Wreck[];
  /** Rounds in a row the attackers have ended holding the zone. */
  capture: number;
  /** Each side's last known enemy positions. */
  intel: Record<Side, Record<string, Ghost>>;
  /** Append-only: the renderer plays it from where it last read. */
  events: BattleEvent[];
  stats: Record<Side, { shots: number; hits: number; kills: number; lost: number }>;
  /** The seeded stream's state (`draw`). */
  stream: number;
  /** The player's accepted commands in order (`submit` in replay.ts); absent in older saves. */
  commands?: PlayerCommand[];
}

// --- Setup and result --------------------------------------------------------------------------------

/** One war-map formation in the battle (or a skirmish detachment with an explicit roster). */
export interface UnitSpec {
  id: string;
  cls: UnitClass;
  /** 0..1000, as on the war map. */
  strength: number;
  name: string;
  color: string;
  /** 0 Recruit .. 3 Ace. */
  rank: number;
  /** Explicit unit types (skirmishes); otherwise the class template for the side's arsenal. */
  types?: TypeId[];
}

export interface ArenaSetup {
  seed: number;
  terrain: Terrain;
  river: boolean;
  site: SiteKind;
  /** The player's side: they fight their way in from the bottom edge. */
  attackers: UnitSpec[];
  defenders: UnitSpec[];
  arsenal: { blue: Arsenal; red: Arsenal };
  /** Enemy skill, 0 (raw) to 1 (sharp), before the difficulty's offset. */
  skill: number;
  /** Absent: 'normal'. */
  difficulty?: Difficulty;
  abilities: AbilityId[];
  /** Drawn from the seed, terrain and theatre when absent. */
  biome?: Biome;
  time?: TimeOfDay;
  weather?: Weather;
  /** War-map theatre id, for the biome. */
  theatre?: string;
}

export interface ArenaResult {
  won: boolean;
  /** Strength each formation kept, permille of what it had when the battle began. */
  kept: Record<string, number>;
  rounds: number;
  stars: 0 | 1 | 2 | 3;
  stats: Battle['stats'];
}

// --- Actions -----------------------------------------------------------------------------------------

export type Action =
  | { type: 'move'; unit: string; to: Point; dash?: boolean }
  | { type: 'face'; unit: string; facing: number }
  | { type: 'fire'; unit: string; target: string; weapon: string }
  /** Indirect fire, or a drone strike on a cell (`smoke` for smoke rounds). */
  | { type: 'strike'; unit: string; at: Point; weapon: string; smoke?: boolean }
  /** Off-map rockets (HIMARS, Tornado-G), called by any unit's side. */
  | { type: 'support'; asset: SupportAsset['id']; at: Point }
  | { type: 'overwatch'; unit: string }
  | { type: 'hunker'; unit: string }
  /** Done for this turn as it stands: no roll, no event (so End Turn does not count it as waiting). */
  | { type: 'hold'; unit: string }
  /** Vehicle smoke grenades (a screen ahead) or engineer smoke pots (`at`: an adjacent cell). */
  | { type: 'smoke'; unit: string; at?: Point }
  | { type: 'embark'; unit: string; carrier: string }
  | { type: 'dismount'; unit: string }
  | { type: 'split'; unit: string }
  | { type: 'merge'; unit: string; with: string }
  | { type: 'treat'; unit: string; target: string }
  | { type: 'repair'; unit: string; target: string }
  | { type: 'breach'; unit: string; at: Point }
  | { type: 'mine'; unit: string; at: Point }
  | { type: 'ability'; id: AbilityId; unit?: string; at?: Point };

// --- Events (the film) ---------------------------------------------------------------------------

export type Facing = 'front' | 'side' | 'rear' | 'top';
export type Effect = 'catastrophic' | 'firepower' | 'mobility' | 'crew' | 'knocked_out' | 'none' | 'bounce' | 'tracks' | 'optics' | 'forced_landing' | 'shot_down';
export type RadioCall = 'contact' | 'destroyed' | 'taking_fire' | 'man_down' | 'smoke' | 'splash' | 'vehicle_hit' | 'air_threat' | 'moving' | 'dismount';

/**
 * `seen` on an event: whether the attacker (blue, the player) could see it happen. The renderer
 * plays only what the player saw; the AI never reads events.
 */
export type BattleEvent =
  | { type: 'turn'; side: Side; round: number }
  | { type: 'move'; unit: string; path: Point[]; seen: boolean[]; dash: boolean }
  | { type: 'face'; unit: string; facing: number; seen: boolean }
  /** `seen`: blue sees the shot (either end), so the film shows it. `shooterSeen`: blue sees the shooter, so the film may show it and where it fired from. */
  | { type: 'fire'; unit: string; weapon: string; kind: WeaponKind; calibre: string; from: Point; to: Point; target: string | null; hit: boolean; chance: number; overwatch: boolean; seen: boolean; shooterSeen: boolean }
  | { type: 'intercept'; unit: string; by: string; x: number; y: number; seen: boolean }
  | { type: 'impact'; unit: string; facing: Facing; pen: boolean; effect: Effect; x: number; y: number; seen: boolean }
  | { type: 'casualties'; unit: string; killed: number; wounded: number; x: number; y: number; seen: boolean }
  | { type: 'suppressed'; unit: string; level: 'steady' | 'suppressed' | 'pinned' | 'broken'; seen: boolean }
  | { type: 'destroyed'; unit: string; how: UnitStatus; x: number; y: number; seen: boolean }
  | { type: 'boom'; x: number; y: number; size: number; kind: 'he' | 'smoke' | 'rockets' | 'bombs' | 'mine'; seen: boolean }
  | { type: 'smoke'; cells: Point[]; side: Side }
  | { type: 'crater'; x: number; y: number }
  | { type: 'terrain'; x: number; y: number; cell: Cell }
  | { type: 'embark'; unit: string; carrier: string; seen: boolean }
  | { type: 'dismount'; carrier: string; units: { id: string; x: number; y: number }[]; seen: boolean }
  | { type: 'split'; unit: string; into: string[] }
  | { type: 'merge'; unit: string; with: string }
  | { type: 'treat'; unit: string; target: string; restored: number }
  | { type: 'repair'; unit: string; target: string; fixed: 'mobility' | 'firepower' }
  | { type: 'mine'; x: number; y: number; side: Side; laid: boolean }
  | { type: 'spotted'; side: Side; unit: string; x: number; y: number }
  | { type: 'lost'; side: Side; unit: string }
  | { type: 'ability'; id: AbilityId; x: number; y: number }
  | { type: 'radio'; side: Side; call: RadioCall; unit: string }
  | { type: 'capture'; rounds: number }
  | { type: 'end'; won: boolean; reason: NonNullable<Battle['endReason']> };

// --- Abilities ---------------------------------------------------------------------------------------

export interface AbilityDef {
  name: string;
  text: string;
  /** Needs a cell picked on the field. */
  targeted: boolean;
  /** Needs a unit selected. */
  needsUnit: boolean;
  /** Always on: no button. */
  passive: boolean;
  tech: TechId;
}
