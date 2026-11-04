import type { CommandSetup, DeployZone, ReserveSetup, SideReserves, Wave, ZoneKind } from './command';
import { cellFits, zonesOf } from './deploy';
import { unitAt } from './engine';
import { addGroup, formationFor } from './groups';
import { typeOf } from './roster';
import { blueSees } from './combat';
import { dist, isFlying, updateIntel } from './sight';
import { inside, type Action, type ArenaSetup, type Battle, type Point, type Role, type Side, type Unit, type UnitType } from './types';

// Reserves and Command Points (docs/arena-v2.md, section 16.3). Part of a company can start off the
// field, in waves; a side spends Command Points, a per-battle pool fed by its general, doctrine and
// technology, to bring a wave on at an entry zone (its attack edge, a landing zone, the beach, a
// drop zone) at the start of its turn, before any of its units act. The wave arrives fresh, as a
// group, and fights that turn: helicopters landing at a landing zone put their squads down there,
// on a roof if that is where the zone is.

/** Command Points every side starts from, before its general, doctrine and technology. */
export const BASE_CP = 6;
/** The most Command Points a side can have in a battle. */
export const MAX_CP = 30;
/** Most lifts (a unit with whoever rides in it) in one wave. */
export const WAVE_LIFTS = 4;
/** The largest share of a company the setup may hold back, permille. */
export const MAX_RESERVE_SHARE = 700;
/** Lifts that always start on the field, whatever the setup holds back. */
export const MIN_ON_FIELD = 2;

/** Command Points a unit costs to bring on, by role (a passenger costs its own). */
export const CP_COST: Record<Role, number> = {
  mbt: 2, attack_heli: 2, gunship: 2, spg: 2, ifv: 2, light_tank: 2, tank_hunter: 2, transport_heli: 2,
  apc: 1, spaa: 1, scout_heli: 1, arv: 1, recon_drone: 1, rifle_squad: 1, fireteam: 1, at_team: 1, aa_team: 1, sniper: 1, mortar: 1, engineer: 1, medic: 1, fpv_team: 1, loiter_team: 1,
};

const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo);

/** A side's Command Points for the battle: an explicit total, or 6 + 2 a general's level + doctrine + technology. */
export function commandPoints(c: CommandSetup | undefined): number {
  if (!c || typeof c !== 'object') return BASE_CP;
  if (c.points !== undefined && Number.isFinite(c.points)) return int(c.points, 0, MAX_CP);
  return Math.min(MAX_CP, BASE_CP + 2 * int(c.general, 0, 10) + int(c.doctrine, 0, 10) + int(c.tech, 0, 10));
}

export const unitCost = (u: Unit): number => CP_COST[typeOf(u.type).role] ?? 1;

/** A unit and the units aboard it. */
type Lift = Unit[];

function liftsOf(units: Unit[]): Lift[] {
  const byCarrier = new Map<string, Unit[]>();
  for (const u of units) if (u.carrier) byCarrier.set(u.carrier, [...(byCarrier.get(u.carrier) ?? []), u]);
  return units.filter((u) => !u.carrier).map((h) => [h, ...(byCarrier.get(h.id) ?? [])]);
}

/** The entry zone kinds a wave may use: every head must fit (helicopters and drones a landing zone, ground the beach, foot a drop zone). */
export function waveVia(units: Unit[]): ZoneKind[] {
  const heads = units.filter((u) => !u.carrier).map((u) => typeOf(u.type));
  const all = (f: (t: UnitType) => boolean) => heads.length > 0 && heads.every(f);
  const via: ZoneKind[] = ['edge'];
  if (all(isFlying)) via.push('lz');
  if (all((t) => !isFlying(t))) via.push('beach');
  if (all((t) => t.mobility === 'foot')) via.push('drop');
  return via;
}

const seqOf = (id: string) => Number(id.slice(id.lastIndexOf(':') + 1)) || 0;

/** Which lifts a side holds back: whole formations, or a share from the back of each. */
function heldBack(lifts: Lift[], r: ReserveSetup): Lift[] {
  const listed = new Set(Array.isArray(r.formations) ? r.formations.filter((f) => typeof f === 'string') : []);
  const share = int(r.share, 0, MAX_RESERVE_SHARE);
  const held: Lift[] = [];
  const byFormation = new Map<string, Lift[]>();
  for (const l of lifts) byFormation.set(l[0]!.formation, [...(byFormation.get(l[0]!.formation) ?? []), l]);
  for (const f of [...byFormation.keys()].sort()) {
    const ls = byFormation.get(f)!.sort((p, q) => seqOf(p[0]!.id) - seqOf(q[0]!.id) || (p[0]!.id < q[0]!.id ? -1 : 1));
    if (listed.has(f)) held.push(...ls);
    else if (share > 0) held.push(...ls.slice(ls.length - Math.round((ls.length * share) / 1000)));
  }
  // Someone always starts on the field: the first lifts held back go back on it.
  const keep = Math.min(MIN_ON_FIELD, lifts.length);
  const order = lifts.filter((l) => held.includes(l));
  while (lifts.length - order.length < keep && order.length) order.shift();
  return order;
}

function makeWave(side: Side, n: number, units: Unit[]): Wave {
  return { id: `${side}:w${n}`, units, cost: units.reduce((s, u) => s + unitCost(u), 0), via: waveVia(units) };
}

/**
 * Take the reserves out of a new battle's units into waves (by formation, at most WAVE_LIFTS lifts
 * each) and give each side its Command Points. Nothing is stored when the setup asks for neither.
 */
export function setupReserves(b: Battle, setup: ArenaSetup): void {
  if (!setup.reserves && !setup.command) return;
  const state = {} as Record<Side, SideReserves>;
  for (const side of ['blue', 'red'] as const) {
    const cp = commandPoints(setup.command?.[side]);
    const r = setup.reserves?.[side];
    const waves: Wave[] = [];
    if (r && typeof r === 'object') {
      const held = heldBack(liftsOf(b.units.filter((u) => u.side === side)), r);
      const gone = new Set(held.flat().map((u) => u.id));
      b.units = b.units.filter((u) => !gone.has(u.id));
      let chunk: Lift[] = [];
      const flush = () => {
        if (chunk.length) waves.push(makeWave(side, waves.length + 1, chunk.flat()));
        chunk = [];
      };
      for (const l of held) {
        if (chunk.length && (chunk.length >= WAVE_LIFTS || chunk[0]![0]!.formation !== l[0]!.formation)) flush();
        chunk.push(l);
      }
      flush();
    }
    state[side] = { cp, start: cp, waves, acted: -1 };
  }
  b.reserves = state;
}

/** Every unit of a side still off the field. */
export function reserveUnits(b: Battle, side?: Side): Unit[] {
  if (!b.reserves) return [];
  return (side ? [side] : (['blue', 'red'] as const)).flatMap((s) => b.reserves![s].waves.flatMap((w) => w.units));
}

/** Entry zones a wave may come on at (never the defender's positions). */
export function entriesFor(b: Battle, side: Side, wave: Wave): DeployZone[] {
  return zonesOf(b, side).filter((z) => z.kind !== 'position' && wave.via.includes(z.kind) && z.cells.length > 0);
}

/** Actions that leave the start of a turn open for reserves: they place, group or call, and roll nothing. */
export const COMMAND_ACTIONS: ReadonlySet<Action['type']> = new Set(['place', 'deployed', 'group', 'ungroup', 'formation', 'reserve']);

/** The side has acted with a unit this turn: its reserves wait for its next one. */
export function noteAction(b: Battle, side: Side, a: Action): void {
  if (b.reserves && !COMMAND_ACTIONS.has(a.type)) b.reserves[side].acted = b.turnIndex;
}

/** Why a reserve call cannot be made now, or null. Reads nothing the side cannot know. */
export function whyNotReserve(b: Battle, a: Extract<Action, { type: 'reserve' }>, side: Side): string | null {
  const r = b.reserves?.[side];
  const wave = r?.waves.find((w) => w.id === a.wave);
  if (!r || !wave) return 'No such reserve';
  if (!entriesFor(b, side, wave).some((z) => z.id === a.zone)) return 'Cannot come on there';
  if (r.acted === b.turnIndex) return 'Reserves come on at the start of the turn';
  if (wave.blocked === b.turnIndex) return 'No room for them this turn';
  if (r.cp < wave.cost) return 'Not enough Command Points';
  return null;
}

/** Cells to try for a lift: the zone's, best first, then out to three cells around its best one. */
function candidates(zone: DeployZone): Point[] {
  const out = [...zone.cells];
  const seen = new Set(out.map((p) => `${p.x},${p.y}`));
  const c = zone.cells[0]!;
  const ring: Point[] = [];
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const p = { x: c.x + dx, y: c.y + dy };
      if (inside(p.x, p.y) && !seen.has(`${p.x},${p.y}`)) ring.push(p);
    }
  ring.sort((p, q) => dist(p, c) - dist(q, c) || p.y - q.y || p.x - q.x);
  return [...out, ...ring];
}

/**
 * A free cell for a unit of this type: a cell its side knows to be empty on its layer. An enemy
 * hidden there is found (revealed, as a move bumping into it would) and the next cell is tried.
 */
function freeFor(b: Battle, side: Side, t: UnitType, cells: Point[], claimed: Set<string>): Point | null {
  const air = isFlying(t);
  for (const p of cells) {
    const k = `${air ? 'a' : 'g'}${p.x},${p.y}`;
    if (claimed.has(k) || !cellFits(b, t, p)) continue;
    const there = unitAt(b, p.x, p.y, air);
    if (there) {
      if (there.side !== side) there.revealed = Math.max(there.revealed, b.turnIndex);
      continue;
    }
    claimed.add(k);
    return p;
  }
  return null;
}

function arrive(b: Battle, u: Unit, p: Point): void {
  u.x = p.x;
  u.y = p.y;
  u.facing = u.side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  u.aim = u.facing;
  u.moved = false;
  u.acted = false;
  u.dashed = false;
  u.overwatch = false;
  u.hunker = false;
  u.smoked = false;
  b.units.push(u);
}

/**
 * Bring a wave on (checked by whyNotReserve). Each lift takes the best free cell of the zone it can
 * stand on; a helicopter at a landing zone sets its squad down on the zone's cells (a roof too). A
 * lift with nowhere to go stays in reserve, and only what came on is paid for. Those who came on
 * form a group.
 */
export function callReserve(b: Battle, a: Extract<Action, { type: 'reserve' }>, side: Side): void {
  const r = b.reserves![side];
  const wave = r.waves.find((w) => w.id === a.wave)!;
  const zone = entriesFor(b, side, wave).find((z) => z.id === a.zone)!;
  const cells = candidates(zone);
  const claimed = new Set<string>();
  const left: Unit[] = [];
  const came: Unit[] = [];
  let spent = 0;
  for (const lift of liftsOf(wave.units)) {
    const head = lift[0]!;
    const t = typeOf(head.type);
    const p = freeFor(b, side, t, cells, claimed);
    if (!p) {
      left.push(...lift);
      continue;
    }
    for (const u of lift) arrive(b, u, p);
    spent += lift.reduce((s, u) => s + unitCost(u), 0);
    came.push(head);
    // Fast-roping onto the landing zone: the squad is down on the cells around the helicopter.
    if (zone.kind === 'lz' && t.mobility === 'heli') {
      const near = [...cells].sort((m, n) => dist(m, p) - dist(n, p) || m.y - n.y || m.x - n.x);
      for (const q of lift.slice(1)) {
        const spot = freeFor(b, side, typeOf(q.type), near, claimed);
        if (!spot) continue;
        q.carrier = null;
        q.x = spot.x;
        q.y = spot.y;
        head.passengers = head.passengers.filter((id) => id !== q.id);
        came.push(q);
      }
    }
  }
  r.cp -= spent;
  if (left.length) {
    wave.units = left;
    wave.cost = left.reduce((s, u) => s + unitCost(u), 0);
    wave.via = waveVia(left);
    wave.blocked = b.turnIndex;
  } else r.waves = r.waves.filter((w) => w !== wave);
  for (const u of came) b.events.push({ type: 'reinforce', side, unit: u.id, wave: wave.id, zone: zone.id, x: u.x, y: u.y, seen: blueSees(b, u) });
  if (came.length) addGroup(b, side, came.map((u) => u.id), formationFor(b, came), wave.id);
  updateIntel(b);
}

/** Can the side call any wave now (for a screen's reserve bar)? */
export function callable(b: Battle, side: Side): { wave: string; zone: string }[] {
  const r = b.reserves?.[side];
  if (!r) return [];
  const out: { wave: string; zone: string }[] = [];
  for (const w of r.waves) for (const z of entriesFor(b, side, w)) if (whyNotReserve(b, { type: 'reserve', wave: w.id, zone: z.id }, side) === null) out.push({ wave: w.id, zone: z.id });
  return out;
}

/** The reserves a side may know of: its own waves in full; of the enemy's, nothing. */
export function knownReserves(b: Battle, side: Side): SideReserves | null {
  const r = b.reserves?.[side];
  return r ? (JSON.parse(JSON.stringify(r)) as SideReserves) : null;
}

/** Units of a side, on the field or not, for results (a unit never called keeps all it had). */
export function allUnits(b: Battle): Unit[] {
  return [...b.units, ...reserveUnits(b)];
}

