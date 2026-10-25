import type { GameEvent, HexKey, NationId, NationOrders, Stockpile, SupplyPriority, WorldState } from '@brink/contracts';
import { RULES, SITE_SUPPLY, TERRAIN, UNITS } from '@brink/game-data';
import { neighborKeys } from '@brink/map';
import { clamp, nationModifiers, pct, relationOf, sortedKeys, zeroStockpile } from './rules';

/** Hexes holding a formation of a nation at war with `nation`, from one shared snapshot. */
function hostileHexes(world: WorldState, nation: NationId): Set<HexKey> {
  const out = new Set<HexKey>();
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (relationOf(world.relations, nation, f.owner) === 'war') out.add(f.key);
  }
  return out;
}

/**
 * Cheapest supply route cost from any of `nation`'s supply sources to every hex it can supply.
 * Routes run through own or allied territory, or through hexes its formations hold; enemy-held
 * hexes block them and hexes next to the enemy cost extra (interdiction).
 */
export function supplyDistances(world: WorldState, nation: NationId): Map<HexKey, number> {
  const hostile = hostileHexes(world, nation);
  const held = new Set<HexKey>();
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (relationOf(world.relations, nation, f.owner) === 'alliance') held.add(f.key);
  }
  const permitted = (key: HexKey): boolean => {
    const t = world.tiles[key];
    if (!t || t.terrain === 'water' || hostile.has(key)) return false;
    return held.has(key) || (t.owner !== null && relationOf(world.relations, nation, t.owner) === 'alliance');
  };
  const interdicted = (key: HexKey): boolean => neighborKeys(key).some((k) => hostile.has(k));

  const dist = new Map<HexKey, number>();
  const frontier: [number, HexKey][] = [];
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (s.owner === nation && SITE_SUPPLY[s.kind] > 0 && !hostile.has(s.key)) {
      dist.set(s.key, 0);
      frontier.push([0, s.key]);
    }
  }
  // Small graphs: a sorted array is a fine priority queue and keeps ties deterministic.
  while (frontier.length > 0) {
    frontier.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const [d, key] = frontier.shift()!;
    if (d > (dist.get(key) ?? Infinity)) continue;
    for (const next of neighborKeys(key)) {
      if (!permitted(next)) continue;
      const t = world.tiles[next]!;
      const step = Math.max(1, TERRAIN[t.terrain].supplyCost - t.infrastructure) + (interdicted(next) ? RULES.interdictionCost : 0);
      const nd = d + step;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        frontier.push([nd, next]);
      }
    }
  }
  return dist;
}

export function supplyCapacity(world: WorldState, nation: NationId): number {
  const n = world.nations[nation]!;
  const mods = nationModifiers(n);
  let cap = 0;
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (s.owner === nation) cap += SITE_SUPPLY[s.kind];
  }
  return pct(cap, 100 + mods.supplyCapacity + n.budget.infrastructure);
}

/** Delivery efficiency in percent for a route of the given cost. */
export function deliveryEfficiency(routeCost: number | undefined, extraRange: number): number {
  if (routeCost === undefined) return 0;
  const over = Math.max(0, routeCost - RULES.supplyRange - extraRange * 2);
  return clamp(100 - over * RULES.supplyFalloff, 10, 100);
}

const TIERS: readonly SupplyPriority[] = ['high', 'normal', 'low'];

/**
 * Phase 4. Shares `nation`'s supply capacity between its formations by priority tier, then
 * refills fuel and ammunition, paying energy and materials from the stockpile. Reads enemy
 * positions from the shared snapshot and writes only this nation's formations, so nations can
 * be processed in any order.
 */
export function allocateLogistics(world: WorldState, nation: NationId, orders: NationOrders, events: GameEvent[]): Stockpile {
  const n = world.nations[nation]!;
  const mods = nationModifiers(n);
  const dist = supplyDistances(world, nation);
  let capacity = supplyCapacity(world, nation);
  const own = sortedKeys(world.formations)
    .map((id) => world.formations[id]!)
    .filter((f) => f.owner === nation);

  for (const f of own) {
    const p = orders.supplyPriority?.[f.id];
    if (p) f.supplyPriority = p;
  }

  const allocated = new Map<string, number>();
  for (const tier of TIERS) {
    const members = own.filter((f) => f.supplyPriority === tier && dist.has(f.key));
    const demand = members.reduce((a, f) => a + UNITS[f.unitClass].supplyDemand, 0);
    if (demand === 0) continue;
    const give = Math.min(capacity, demand);
    // Proportional within a tier, so no formation id outranks another.
    for (const f of members) allocated.set(f.id, Math.floor((UNITS[f.unitClass].supplyDemand * give) / demand));
    capacity -= give;
  }

  const fuelWant = new Map<string, number>();
  const ammoWant = new Map<string, number>();
  for (const f of own) {
    const demand = UNITS[f.unitClass].supplyDemand;
    const eff = deliveryEfficiency(dist.get(f.key), mods.supplyRange);
    f.supply = clamp(Math.floor(((allocated.get(f.id) ?? 0) * eff) / demand), 0, 100);
    const s = f.supply;
    f.readiness = clamp(f.readiness + (s >= 80 ? 10 : s >= 50 ? 4 : s >= 25 ? -4 : -10), 0, 100);
    if (s < 25) f.strength = Math.max(0, f.strength - 10);
    fuelWant.set(f.id, UNITS[f.unitClass].motorized ? pct(100 - f.fuel, s) : 0);
    ammoWant.set(f.id, pct(100 - f.ammunition, s));
    if (s < 50) events.push({ kind: 'supply', nation, formation: f.id, key: f.key, supply: s });
  }

  const scaled = (want: Map<string, number>, available: number): Map<string, number> => {
    const total = [...want.values()].reduce((a, v) => a + v, 0);
    const cost = Math.ceil(total / 10) * RULES.logisticsPer10;
    const scale = cost === 0 ? 100 : Math.min(100, Math.floor((available * 100) / cost));
    const out = new Map<string, number>();
    for (const [id, v] of want) out.set(id, pct(v, scale));
    return out;
  };
  const fuel = scaled(fuelWant, n.stockpile.energy);
  const ammo = scaled(ammoWant, n.stockpile.materials);

  const spent = zeroStockpile();
  let fuelTotal = 0;
  let ammoTotal = 0;
  for (const f of own) {
    const fa = fuel.get(f.id) ?? 0;
    const aa = ammo.get(f.id) ?? 0;
    f.fuel = clamp(f.fuel + fa, 0, 100);
    f.ammunition = clamp(f.ammunition + aa, 0, 100);
    fuelTotal += fa;
    ammoTotal += aa;
  }
  spent.energy = Math.ceil(fuelTotal / 10) * RULES.logisticsPer10;
  spent.materials = Math.ceil(ammoTotal / 10) * RULES.logisticsPer10;
  n.stockpile.energy -= spent.energy;
  n.stockpile.materials -= spent.materials;
  if (n.stockpile.energy < 0 || n.stockpile.materials < 0) throw new Error(`logistics overdrew ${nation}`);
  return spent;
}

