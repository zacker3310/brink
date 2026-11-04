import type { CardPlay, Contact, Formation, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { AIR_REBASE_RANGE, UNITS } from '@brink/game-data';
import { areAdjacent, findPath, keyDistance, neighborKeys, pathFromReach, reachable, type Reach } from '@brink/map';
import { alongside, enterCost, isAir, isNaval, marchBonus, movementAllowance } from '@brink/simulation';
import { hexLabel } from './insight';

export type Mode = 'move' | 'attack' | 'recon' | 'withdraw';

export function hostilesAt(view: NationView, key: HexKey): Contact[] {
  return Object.values(view.contacts).filter((c) => c.key === key && view.relations[c.owner] === 'war');
}

/**
 * Hexes the formation can reach this turn over terrain its nation knows, avoiding known enemies.
 * Ships sail the sea and put in at ports; troops aboard a ship reach the shore beside it and beyond.
 */
export function reachFor(view: NationView, f: Formation, plays: readonly CardPlay[] = []): Record<HexKey, Reach> {
  if (isAir(f.unitClass)) return { [f.key]: { cost: 0, prev: null } };
  const blocked = new Set(Object.values(view.contacts).filter((c) => c.confirmed && view.relations[c.owner] === 'war').map((c) => c.key));
  // A Forced March in force, or played in this turn's draft, goes further: the validator counts it too.
  const mp = movementAllowance(f) + marchBonus(view.self, view.turn, f, plays);
  return reachable(f.key, mp, (_from, to) => (blocked.has(to) ? null : enterCost(view.tiles[to], f.unitClass)));
}

export interface Planned {
  order: FormationOrder;
  label: string;
}

/** The order a click on `key` means for formation `f` in `mode`, or a reason it means nothing. */
export function orderForClick(view: NationView, f: Formation, key: HexKey, mode: Mode, reach: Record<HexKey, Reach>): Planned | { error: string } {
  const def = UNITS[f.unitClass];
  const hostile = hostilesAt(view, key).length > 0;

  if (def.range > 0 && (hostile || mode === 'attack')) {
    const d = keyDistance(f.key, key);
    if (d < 1 || d > def.range) return { error: `Target is out of range (${def.range} hexes)` };
    if (f.ammunition < def.ammoPerAttack) return { error: 'Not enough ammunition to strike' };
    return { order: { type: 'attack', target: key, path: [] }, label: `Strike ${key}` };
  }

  if (isAir(f.unitClass)) {
    const site = view.tiles[key]?.siteId ? view.sites[view.tiles[key]!.siteId!] : undefined;
    const deck = Object.values(view.formations).find((c) => c.key === key && UNITS[c.unitClass].carries === 'air' && c.id !== f.aboard && passengers(view, c.id) < (UNITS[c.unitClass].capacity ?? 0));
    if (keyDistance(f.key, key) > AIR_REBASE_RANGE) return { error: `Rebase range is ${AIR_REBASE_RANGE} hexes` };
    if (deck) return { order: { type: 'move', path: [key] }, label: `Land on ${deck.name}` };
    if (!site || site.owner !== view.self.id) return { error: 'Air wings rebase only to your own cities, depots and carriers' };
    return { order: { type: 'move', path: [key] }, label: `Rebase to ${site.name}` };
  }

  if (isNaval(f.unitClass) && (hostile || mode === 'attack')) return { error: `${def.name} does not fight: a fleet does` };

  if (hostile || mode === 'attack') {
    if (f.ammunition < def.ammoPerAttack) return { error: 'Not enough ammunition to attack' };
    if (f.aboard && !areAdjacent(f.key, key)) return { error: 'From a ship, storm a beach next to it' };
    if (enterCost(view.tiles[key], f.unitClass) === null) return { error: 'Cannot assault impassable terrain' };
    if (areAdjacent(f.key, key)) return { order: { type: 'attack', target: key, path: [] }, label: `Assault ${key}` };
    const approach = neighborKeys(key)
      .filter((k) => reach[k] && k !== key)
      .sort((a, b) => reach[a]!.cost - reach[b]!.cost || (a < b ? -1 : 1))[0];
    if (!approach) return { error: 'No approach to that hex within movement range' };
    return { order: { type: 'attack', target: key, path: pathFromReach(reach, approach) ?? [] }, label: `Advance and assault ${key}` };
  }

  if (key === f.key) return { error: 'Already here' };
  if (!reach[key]) {
    if (view.tiles[key]?.terrain == null) return { error: 'Unknown terrain: scout it first' };
    // Land troops tapping a shore they cannot walk to: the sea is in the way.
    if (UNITS[f.unitClass].ground && !f.aboard && enterCost(view.tiles[key], f.unitClass) !== null && !findPath(f.key, key, (_a, b) => enterCost(view.tiles[b], f.unitClass))) {
      return { error: 'Across the sea: board a transport in a port, then sail it there' };
    }
    return { error: 'Out of movement range this turn' };
  }
  const path = pathFromReach(reach, key) ?? [];
  const label = mode === 'recon' ? `Recon to ${key}` : mode === 'withdraw' ? `Withdraw to ${key}` : `Move to ${key}`;
  return { order: { type: mode, path }, label };
}

/** Plain-language order text; with a view, targets are named by place instead of coordinates. */
export function describeOrder(order: FormationOrder | undefined, view?: NationView): string {
  const place = (k: HexKey) => (view ? hexLabel(view, k) : k);
  if (!order) return 'Hold (default)';
  switch (order.type) {
    case 'hold':
      return 'Hold';
    case 'defend':
      return 'Defend and dig in';
    case 'move':
      return `Move ${order.path.length} hex${order.path.length === 1 ? '' : 'es'}`;
    case 'recon':
      return `Recon ${order.path.length} hex${order.path.length === 1 ? '' : 'es'}`;
    case 'withdraw':
      return `Withdraw ${order.path.length} hex${order.path.length === 1 ? '' : 'es'}`;
    case 'attack':
      return order.path.length > 0 ? `Advance ${order.path.length}, assault ${place(order.target)}` : `Attack ${place(order.target)}`;
    case 'embark':
      return `Board ${view?.formations[order.carrier]?.name ?? 'ship'}`;
  }
}

function passengers(view: NationView, carrier: string): number {
  return Object.values(view.formations).filter((p) => p.aboard === carrier).length;
}

/**
 * Own ships `f` can board now, with room for it: in its hex, or lying off the port it stands in.
 * Ground formations board transports, aircraft carriers.
 */
export function shipsAlongside(view: NationView, f: Formation): Formation[] {
  if (f.aboard || isNaval(f.unitClass)) return [];
  const kind = UNITS[f.unitClass].ground ? 'ground' : 'air';
  return Object.values(view.formations)
    .filter((c) => UNITS[c.unitClass].carries === kind && alongside(view, f, c) && passengers(view, c.id) < (UNITS[c.unitClass].capacity ?? 0))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Board orders for a group: each formation takes the first ship with room, until they are full. */
export function boardOrders(view: NationView, group: Formation[]): Record<string, FormationOrder> {
  const room = new Map<string, number>();
  const out: Record<string, FormationOrder> = {};
  for (const f of group) {
    const ship = shipsAlongside(view, f).find((c) => {
      const left = room.get(c.id) ?? (UNITS[c.unitClass].capacity ?? 0) - passengers(view, c.id);
      return left > 0;
    });
    if (!ship) continue;
    room.set(ship.id, (room.get(ship.id) ?? (UNITS[ship.unitClass].capacity ?? 0) - passengers(view, ship.id)) - 1);
    out[f.id] = { type: 'embark', carrier: ship.id };
  }
  return out;
}

/** The order a right-click, a tap (or a click in the current mode) on `key` means for `f`. */
export function contextualOrder(view: NationView, f: Formation, key: HexKey, mode: Mode, reach: Record<HexKey, Reach>, rightClick: boolean): Planned | { error: string } {
  const m: Mode = hostilesAt(view, key).length > 0 ? 'attack' : rightClick && mode === 'attack' ? 'move' : mode;
  return orderForClick(view, f, key, m, reach);
}

/**
 * Load a ship from the port it lies in or off: own formations of the kind it carries, not yet
 * aboard and not already given another order this turn, until it is full.
 */
export function loadOrders(view: NationView, ship: Formation, drafted: Record<string, FormationOrder> = {}): Record<string, FormationOrder> {
  const kind = UNITS[ship.unitClass].carries;
  if (!kind) return {};
  let room = (UNITS[ship.unitClass].capacity ?? 0) - passengers(view, ship.id);
  const out: Record<string, FormationOrder> = {};
  const candidates = Object.values(view.formations)
    .filter((f) => !f.aboard && !isNaval(f.unitClass) && (kind === 'ground') === UNITS[f.unitClass].ground && alongside(view, f, ship))
    .filter((f) => !drafted[f.id] || drafted[f.id]!.type === 'hold' || drafted[f.id]!.type === 'defend')
    // Fighting troops first: infantry and armour before guns and scouts.
    .sort((a, b) => rankForLift(a) - rankForLift(b) || (a.id < b.id ? -1 : 1));
  for (const f of candidates) {
    if (room <= 0) break;
    out[f.id] = { type: 'embark', carrier: ship.id };
    room--;
  }
  return out;
}

/**
 * Load the whole fleet at once: every transport and carrier takes what fits from the port it lies
 * in or off, fighting troops first. Orders in `replaceable` (the staff's plan) give way; the
 * player's own orders do not.
 */
export function fleetLoadOrders(view: NationView, drafted: Record<string, FormationOrder>, replaceable: readonly string[] = []): Record<string, FormationOrder> {
  const free = new Set(replaceable);
  const taken: Record<string, FormationOrder> = {};
  for (const [id, o] of Object.entries(drafted)) if (!free.has(id)) taken[id] = o;
  const out: Record<string, FormationOrder> = {};
  const ships = Object.values(view.formations)
    .filter((c) => UNITS[c.unitClass].carries && (UNITS[c.unitClass].capacity ?? 0) > passengers(view, c.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const ship of ships) {
    const orders = loadOrders(view, ship, { ...taken, ...out });
    Object.assign(out, orders);
  }
  return out;
}

function rankForLift(f: Formation): number {
  return ['infantry', 'mechanized', 'armor', 'air', 'drone', 'recon', 'artillery'].indexOf(f.unitClass);
}

/**
 * Put a transport's troops ashore in one go: each takes the open beach beside the ship nearest
 * `toward` (the goal), one it can reach this turn, with room in the hex. Enemy-held beaches are
 * left for a deliberate assault.
 */
export function landOrders(view: NationView, ship: Formation, toward: HexKey | null): Record<string, FormationOrder> {
  const aboard = Object.values(view.formations).filter((p) => p.aboard === ship.id && UNITS[p.unitClass].ground);
  if (aboard.length === 0) return {};
  const held = new Map<HexKey, number>();
  for (const f of Object.values(view.formations)) if (!f.aboard && !isNaval(f.unitClass)) held.set(f.key, (held.get(f.key) ?? 0) + 1);
  // A shore that leads somewhere: on the goal's landmass, or (with no goal) not your own soil.
  const leads = (k: HexKey) =>
    toward ? findPath(k, toward, (_a, b) => enterCost(view.tiles[b], 'infantry')) !== null : view.tiles[k]!.owner !== view.self.id;
  const shore = neighborKeys(ship.key)
    .filter((k) => view.tiles[k]?.terrain && view.tiles[k]!.terrain !== 'water' && hostilesAt(view, k).length === 0 && leads(k))
    .filter((k) => {
      const owner = view.tiles[k]!.owner;
      return !owner || owner === view.self.id || view.relations[owner] !== 'peace';
    })
    .sort((a, b) => (toward ? keyDistance(a, toward) - keyDistance(b, toward) : 0) || (a < b ? -1 : 1));
  const out: Record<string, FormationOrder> = {};
  for (const p of aboard) {
    const k = shore.find((x) => (held.get(x) ?? 0) < 3 && (enterCost(view.tiles[x], p.unitClass) ?? Infinity) <= movementAllowance(p));
    if (!k) continue;
    out[p.id] = { type: 'move', path: [k] };
    held.set(k, (held.get(k) ?? 0) + 1);
  }
  return out;
}
