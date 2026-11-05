import type { Point, Side, Unit } from './types';

// Command of the battle (docs/arena-v2.md, section 16): groups, the deployment phase, and reserves
// called in with Command Points. These are the plain-JSON shapes the battle carries for them; the
// rules live in groups.ts, deploy.ts and reserves.ts, the AI's use of them in staff.ts.

// --- Groups ------------------------------------------------------------------------------------------

/** How a group's ground units form up on the point it is sent to. Aircraft always fly a spaced stack. */
export type Formation = 'column' | 'line' | 'wedge';
export const FORMATIONS: readonly Formation[] = ['column', 'line', 'wedge'];

/**
 * One order for a whole group. It expands into ordinary unit actions (move, fire, overwatch, hold),
 * each checked and resolved by the same rules as if it were given by hand.
 * - move: every unit heads for its slot of the formation around `to` (`dash` for a dash).
 * - assault: an attack-move: head for the slot around `to`, then fire on `target` (an enemy id) if
 *   it can, else on the best enemy it sees.
 * - overwatch: (head for the slot around `to`, when given, then) go on overwatch.
 * - screen: a wide line (two cells apart) across `to`, facing the enemy, every unit on overwatch.
 * - hold: every unit holds where it is.
 */
export type GroupOrder =
  | { kind: 'move'; to: Point; dash?: boolean }
  | { kind: 'assault'; to: Point; target?: string }
  | { kind: 'overwatch'; to?: Point }
  | { kind: 'screen'; to: Point }
  | { kind: 'hold' };
export const GROUP_ORDERS: readonly GroupOrder['kind'][] = ['move', 'assault', 'overwatch', 'screen', 'hold'];

export interface Group {
  /** `${side}:g${n}`, n from 1 in the order groups are formed. */
  id: string;
  side: Side;
  /** Unit ids, in the order they were given. A unit that dies or is merged away leaves the group. */
  units: string[];
  formation: Formation;
  /** The last order it was given, which an `order` action without one repeats (a standing order). */
  order: GroupOrder | null;
  /** The reserve wave it came on as, for a group the arrival formed. */
  wave?: string;
  /** Turn index it was last given an order in: one order a group a turn. */
  ordered?: number;
}

// --- Deployment zones ----------------------------------------------------------------------------------

/**
 * What a zone is for. `edge`: the attack edge (anyone; reserves come on here). `lz`: helicopter landing
 * zone (aircraft, and foot set down by them; their reserves fast-rope in, onto roofs too). `beach`:
 * an amphibious landing (ground units). `drop`: a drop zone, only with air superiority (foot only).
 * `position`: the defender's prepared positions (deployment only, never an entry for reserves).
 */
export type ZoneKind = 'edge' | 'lz' | 'beach' | 'drop' | 'position';
export const ZONE_KINDS: readonly ZoneKind[] = ['edge', 'lz', 'beach', 'drop', 'position'];

/** A zone resolved on the field: its cells, best first. */
export interface DeployZone {
  /** `${side}:${kind}` and a number for the second and later of a kind (`blue:lz2`). */
  id: string;
  kind: ZoneKind;
  cells: Point[];
}

export type Edge = 'south' | 'north' | 'west' | 'east';

/**
 * A zone as the war map asks for it. Edges by direction (the attacker's flank edges run along its own
 * half); landing and drop zones around a point (`at`, radius `r`, 2 by default); a beach along water
 * nearest `at` (or the attack edge where there is none); explicit `cells` are taken as given (inside
 * the field and passable for someone). Zones are clipped to the side's own part of the field, away
 * from the other side's deployment band.
 */
export interface ZoneSpec {
  kind: ZoneKind;
  edge?: Edge;
  at?: Point;
  r?: number;
  cells?: Point[];
}

export interface SideDeployment {
  zones?: ZoneSpec[];
  /** Holds the air over the battle: a `drop` zone is honoured only with it. */
  airSuperiority?: boolean;
}

/** From the war map. Absent: the attack edge (the map's blue deployment cells) and the defender's positions. */
export interface DeploymentSetup {
  /** The player places the company before round 1 (a deployment phase); otherwise it is placed for them. */
  manual?: boolean;
  blue?: SideDeployment;
  red?: SideDeployment;
}

export interface Deployment {
  /** Blue's deployment phase is open: only placing, grouping and Begin are allowed. */
  open: boolean;
  zones: Record<Side, DeployZone[]>;
}

// --- Reserves and Command Points --------------------------------------------------------------------

/** What feeds a side's Command Points for the battle. */
export interface CommandSetup {
  /** The general's level at the head of the force (0 for none). */
  general?: number;
  /** Doctrine cards in play for it. */
  doctrine?: number;
  /** Command-and-control technologies researched. */
  tech?: number;
  /** An explicit total, instead of the sum. */
  points?: number;
}

/** Which part of a side's company starts off the field. */
export interface ReserveSetup {
  /** War-map formation ids held back whole. */
  formations?: string[];
  /** Or a share of the company, permille (0..700), taken from the back of each formation. */
  share?: number;
}

/** A reserve wave: units held off the field, called in together at one entry zone. */
export interface Wave {
  /** `${side}:w${n}`. */
  id: string;
  /** The units, with any passengers aboard their carriers, as they will arrive. */
  units: Unit[];
  /** Command Points the whole wave costs. */
  cost: number;
  /** Entry zone kinds it may use. */
  via: ZoneKind[];
  /** Turn index a call left some of it behind for want of room: not called again that turn. */
  blocked?: number;
}

export interface SideReserves {
  /** Command Points left this battle. */
  cp: number;
  /** Command Points the side started the battle with. */
  start: number;
  waves: Wave[];
  /** Turn index of the side's last unit action (reserves are called before any, at the start of its turn). */
  acted: number;
}
