import type { Formation, FormationId, FormationOrder, HexKey, NationOrders, NationView, SiteId, SiteView, Stockpile } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { AIRBORNE, FACILITIES, STACK_LIMIT, TERRAIN, UNITS } from '@brink/game-data';
import { findPath, keyDistance, neighborKeys, reachable, type Reach } from '@brink/map';
import {
  airliftCost,
  airliftOrigin,
  canDrop,
  checkAirlift,
  enterCost,
  interceptChance,
  isNaval,
  liftContextOfView,
  movementAllowance,
  previewAssault,
  recruitCost,
  sortedKeys,
  viewThreats,
  type AirliftOrigin,
} from '@brink/simulation';
import { landmasses } from './land';

// The airborne operation, the staff's and the rivals' (ruleset 2.9.0): for a prize no march can
// reach and no landing can reach soon, troops fly. From the deck, a carrier group and the loaded
// amphibious groups sail to a sea hex within the carrier's reach of a drop zone beside the prize
// (stage), the troops aboard fly in, two a carrier a turn (drop), hold the zone until enough are down
// (hold), then storm the prize (assault). From an airfield, light troops gather at an own Airbase or
// capital in range and fly from there. Every order is checked as the engine checks it.

/** A beach this close to the prize makes a landing the better way in: the rivals do not jump. */
const BEACH_NEAR = 2;

/** The army this many hexes or more from the prize by land: too far to march, a job for the air. */
const FAR_MARCH = 10;

/** Drop zone heat: a seen hostile ground formation next to it counts as this much risk. */
const HEAT_PER_CONTACT = 40;

/** The rivals jump only when the lift's interception risk is under this (the staff goes when ordered). */
const RIVAL_RISK = 35;

/** Troops on the ground before an assault is made on poor odds while more are coming. */
const ENOUGH_DOWN = 3;

export interface AirbornePlan {
  site: SiteView;
  /** Drop zones, best first: open land beside the prize (or the prize itself, seen empty). */
  zones: HexKey[];
  route: 'carrier' | 'airfield';
  /** The sea hex the carrier group sails to, within the deck's reach of the best zone. */
  stage?: HexKey;
  carrier?: Formation;
  /** Amphibious groups with light troops aboard, nearest the stage first (room for two beside the carrier). */
  transports: Formation[];
  /** The airfield the troops fly from. */
  field?: SiteView;
  /** Light formations that will fly: aboard the transports, or at (or bound for) the airfield. */
  troops: Formation[];
  /** Own ground formations already down within two hexes of the prize. */
  down: Formation[];
  /** Interception risk on the way into the best zone, percent, from what the view knows. */
  risk: number;
}

const light = (f: Formation) => canDrop(f.unitClass);

/** Seen hostile ground formations by hex. */
function hostileGround(view: NationView): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
  for (const id of sortedKeys(view.contacts)) {
    const c = view.contacts[id]!;
    if (view.relations[c.owner] !== 'war' || UNITS[c.unitClass].naval || view.turn - c.lastSeen > 2) continue;
    out.set(c.key, (out.get(c.key) ?? 0) + c.estimatedStrength);
  }
  return out;
}

/** Where each own formation is planned to end the turn, counted per hex: the land layer (with aircraft) or the ships. */
function endsOf(view: NationView, orders: Record<FormationId, FormationOrder>, naval: boolean): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
  for (const id of sortedKeys(view.formations)) {
    const f = view.formations[id]!;
    if (isNaval(f.unitClass) !== naval) continue;
    const end = endOfOrder(f, orders[id]);
    if (end) out.set(end, (out.get(end) ?? 0) + 1);
  }
  return out;
}

/** Drop zones beside `site`, best first: the quietest, best-covered open ground the lift may land on. */
function dropZones(view: NationView, site: SiteView, hostile: Map<HexKey, number>): HexKey[] {
  const seenAt = (k: HexKey) => hostile.has(k);
  const cands = neighborKeys(site.key).filter((k) => {
    const t = view.tiles[k];
    if (!t || enterCost(t, 'infantry') === null || seenAt(k)) return false;
    // A hostile city or base beside the prize is held whether or not its garrison is seen.
    if (t.siteId && t.owner && t.owner !== view.self.id && view.relations[t.owner] === 'war') return false;
    return !(t.owner && t.owner !== view.self.id && view.relations[t.owner] === 'peace');
  });
  // The prize itself, when it is seen in open country and nobody holds it: take it from the air.
  // (A garrison among buildings or trees is out of sight: a drop onto it would be a storm.)
  const tile = view.tiles[site.key];
  if (tile?.visibility === 'visible' && tile.terrain && !TERRAIN[tile.terrain].concealing && !seenAt(site.key)) cands.unshift(site.key);
  const heat = (k: HexKey) => neighborKeys(k).filter((n) => n !== site.key).reduce((a, n) => a + (hostile.get(n) ?? 0), 0);
  const score = (k: HexKey) => (k === site.key ? -1_000_000 : 0) + Math.floor((heat(k) * HEAT_PER_CONTACT) / 1000) - Math.floor(TERRAIN[view.tiles[k]!.terrain!].defense / 10);
  return cands.sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1));
}

/**
 * Whether the army is far from the prize by land (no fighting formation of ours within `FAR_MARCH`
 * hexes of it on its landmass, the troops already down beside it apart), and how near its nearest beach is.
 */
function geography(view: NationView, site: SiteView): { far: boolean; beach: number } {
  const land = landmasses(view);
  const goal = land.get(site.key);
  let nearest = Infinity;
  for (const id of sortedKeys(view.formations)) {
    const f = view.formations[id]!;
    if (!UNITS[f.unitClass].ground || f.aboard || f.unitClass === 'artillery' || land.get(f.key) !== goal) continue;
    const d = keyDistance(f.key, site.key);
    if (d > 2) nearest = Math.min(nearest, d);
  }
  let beach = Infinity;
  for (const k of sortedKeys(view.tiles)) {
    if (land.get(k) !== goal) continue;
    if (!neighborKeys(k).some((n) => view.tiles[n]?.terrain === 'water')) continue;
    beach = Math.min(beach, keyDistance(k, site.key));
  }
  return { far: goal !== undefined && nearest >= FAR_MARCH, beach };
}

/**
 * The airborne operation against `site`, or null when it is no job for one: the army must be far
 * from it by land (across the sea, or across a continent: the Bering crossing joins the United
 * States to Asia), and there must be a way to fly: a carrier with loaded amphibious groups, or an own
 * airfield in reach with light troops near it, and no beach near the prize (a landing does as well
 * there: the amphibious operation is the staff's choice). The staff, the rivals and the Operations
 * sheet all judge by this one function, so an operation launched airborne is carried out airborne.
 */
export function airbornePlan(view: NationView, site: SiteView): AirbornePlan | null {
  if (view.self.minor || site.owner === view.self.id || (site.owner !== null && view.relations[site.owner] !== 'war')) return null;
  if (view.tiles[site.key]?.terrain == null) return null;
  const geo = geography(view, site);
  if (!geo.far || geo.beach <= BEACH_NEAR) return null;
  const hostile = hostileGround(view);
  const zones = dropZones(view, site, hostile);
  if (zones.length === 0) return null;
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
  const land = landmasses(view);
  const goal = land.get(site.key);
  const down = own.filter((f) => UNITS[f.unitClass].ground && !f.aboard && land.get(f.key) === goal && keyDistance(f.key, site.key) <= 2);
  const threats = viewThreats(view);
  const zone = zones[0]!;

  // An airfield in reach of the best zone, with light troops there or on its landmass.
  const fields = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => {
      if (s.owner !== view.self.id) return false;
      const kind = s.facilities.includes('airbase') ? 'airbase' : s.kind === 'capital' ? 'capital' : null;
      return !!kind && keyDistance(s.key, zone) <= AIRBORNE.origins[kind].range && s.key !== site.key;
    })
    .sort((a, b) => keyDistance(a.key, zone) - keyDistance(b.key, zone) || (a.id < b.id ? -1 : 1));
  const fieldTroops = (s: SiteView) => own.filter((f) => light(f) && !f.aboard && land.get(f.key) === land.get(s.key) && !down.includes(f) && keyDistance(f.key, s.key) <= 8);
  const field = fields.find((s) => fieldTroops(s).length > 0);

  {
    // From the deck: a carrier and the loaded amphibious groups.
    const carriers = own.filter((f) => UNITS[f.unitClass].carries === 'air');
    const loaded = own.filter((t) => UNITS[t.unitClass].carries === 'ground' && own.some((p) => p.aboard === t.id && light(p)));
    if (carriers.length > 0 && (loaded.length > 0 || down.length > 0)) {
      const range = AIRBORNE.origins.carrier.range;
      const lead = [...carriers].sort((a, b) => keyDistance(a.key, zone) - keyDistance(b.key, zone) || (a.id < b.id ? -1 : 1))[0]!;
      // Around hostile ships, not through them: a hex next to one costs dear, its own is shut.
      const ships = new Set(Object.values(view.contacts).filter((c) => view.relations[c.owner] === 'war' && isNaval(c.unitClass)).map((c) => c.key));
      const near = (k: HexKey) => neighborKeys(k).some((n) => ships.has(n));
      const step = (b: HexKey) => {
        const c = ships.has(b) ? null : seaCost(view, b);
        return c === null ? null : c + (near(b) ? 6 : 0);
      };
      // The stage: a sea hex within the deck's reach of a drop zone, soonest reached by the carrier
      // and the nearest loaded group together, the least exposed, with the quietest way in.
      const ferry = [...loaded].sort((a, b) => keyDistance(a.key, lead.key) - keyDistance(b.key, lead.key) || (a.id < b.id ? -1 : 1))[0];
      // One flood fill over the sea per ship and view (the Operations sheet judges every prize).
      const turnsTo = (ship: Formation, k: HexKey) => {
        if (ship.key === k) return 0;
        const r = seaReach(view, ship, step)[k];
        return r ? Math.ceil(r.cost / Math.max(1, movementAllowance(ship))) : null;
      };
      const zoneScore = (st: HexKey) => {
        let best: number | null = null;
        zones.forEach((z, i) => {
          if (keyDistance(st, z) > range) return;
          const v = i * 4 + Math.floor(interceptChance(threats, st, z).chance / 3);
          if (best === null || v < best) best = v;
        });
        return best;
      };
      const stages = sortedKeys(view.tiles)
        .filter((k) => view.tiles[k]?.terrain === 'water' && !ships.has(k) && zones.some((z) => keyDistance(k, z) <= range))
        .map((k) => {
          const a = turnsTo(lead, k);
          const b = ferry ? turnsTo(ferry, k) : 0;
          const z = zoneScore(k);
          return { k, score: a === null || b === null || z === null ? null : Math.max(a, b) * 25 + stageDanger(view, k) * 8 + z };
        })
        .filter((x): x is { k: HexKey; score: number } => x.score !== null)
        .sort((a, b) => a.score - b.score || (a.k < b.k ? -1 : 1));
      const stage = stages[0]?.k;
      if (stage) {
        const transports = [...loaded].sort((a, b) => keyDistance(a.key, stage) - keyDistance(b.key, stage) || (a.id < b.id ? -1 : 1)).slice(0, STACK_LIMIT - 1);
        const troops = own.filter((p) => !!p.aboard && transports.some((t) => t.id === p.aboard) && light(p));
        const inReach = zones.filter((z) => keyDistance(stage, z) <= range);
        const risk = Math.min(...inReach.map((z) => interceptChance(threats, stage, z).chance));
        return { site, zones: inReach, route: 'carrier', stage, carrier: lead, transports, troops, down, risk };
      }
    }
  }
  // From an airfield.
  if (field) return { site, zones, route: 'airfield', field, transports: [], troops: fieldTroops(field), down, risk: interceptChance(threats, field.key, zone).chance };
  return null;
}

/**
 * How exposed a sea hex is to waiting ships: seen hostile aircraft, drones and guns in range of it,
 * fleets that can close and fire, and hostile great-power sites near enough to fly from.
 */
function stageDanger(view: NationView, k: HexKey): number {
  let n = 0;
  for (const c of Object.values(view.contacts)) {
    if (view.relations[c.owner] !== 'war' || view.turn - c.lastSeen > 2) continue;
    const d = keyDistance(c.key, k);
    const reach = c.unitClass === 'fleet' ? UNITS.fleet.range + 1 : UNITS[c.unitClass].range;
    if (reach > 0 && d <= reach) n++;
  }
  for (const s of Object.values(view.sites)) {
    if (s.owner && view.relations[s.owner] === 'war' && !view.nations[s.owner]?.minor && keyDistance(s.key, k) <= UNITS.air.range) n++;
  }
  return n;
}

const seaMemo = new WeakMap<NationView, Map<string, Record<HexKey, Reach>>>();

/** Cheapest sea route cost from `ship` to every sea hex it can reach, worked out once per view and ship. */
function seaReach(view: NationView, ship: Formation, step: (k: HexKey) => number | null): Record<HexKey, Reach> {
  let byShip = seaMemo.get(view);
  if (!byShip) {
    byShip = new Map();
    seaMemo.set(view, byShip);
  }
  const key = `${ship.id}@${ship.key}`;
  let r = byShip.get(key);
  if (!r) {
    r = reachable(ship.key, 1000, (_a, b) => step(b));
    byShip.set(key, r);
  }
  return r;
}

function seaCost(view: NationView, k: HexKey): number | null {
  const t = view.tiles[k];
  if (!t || t.terrain !== 'water') return null;
  return enterCost(t, 'carrier');
}

/** A sea path for `ship` toward `dest`, cut to this turn's allowance, never ending in a full hex. */
function sail(view: NationView, ship: Formation, dest: HexKey, seaEnds: Map<HexKey, number>, avoid: ReadonlySet<HexKey>, shut: ReadonlySet<HexKey>): HexKey[] {
  if (ship.key === dest) return [];
  // Clear of hostile ships if there is a way; else past them, never into one.
  const res =
    findPath(ship.key, dest, (_a, b) => (avoid.has(b) && b !== dest ? null : seaCost(view, b))) ??
    findPath(ship.key, dest, (_a, b) => (shut.has(b) ? null : seaCost(view, b)));
  if (!res) return [];
  const allowance = movementAllowance(ship);
  const out: HexKey[] = [];
  let cost = 0;
  for (const k of res.path) {
    const c = seaCost(view, k)!;
    if (cost + c > allowance) break;
    cost += c;
    out.push(k);
  }
  while (out.length > 0 && (seaEnds.get(out.at(-1)!) ?? 0) >= STACK_LIMIT) out.pop();
  return out;
}

/**
 * Carry out the airborne operation on `site` this turn, overriding the orders the rest of the
 * planner gave the ships and troops it needs. Returns whether it ran.
 */
export function planAirborne(view: NationView, site: SiteView | null, forced: boolean, orders: Record<FormationId, FormationOrder>): boolean {
  if (!site) return false;
  const plan = airbornePlan(view, site);
  if (!plan) return false;
  if (!forced && plan.risk >= RIVAL_RISK) return false;
  const ctx = liftContextOfView(view);
  const ends = endsOf(view, orders, false);
  const room = (k: HexKey) => STACK_LIMIT - (ends.get(k) ?? 0);
  const used = new Map<string, number>();
  const threats = viewThreats(view);
  const fly = (f: Formation, origin: AirliftOrigin): boolean => {
    if ((used.get(origin.id) ?? 0) >= origin.capacity) return false;
    const risk = (z: HexKey) => interceptChance(threats, origin.key, z).chance;
    const zone = plan.zones
      .map((z, i) => ({ z, v: Math.floor(risk(z) / 3) + i * 4 }))
      .sort((a, b) => a.v - b.v || (a.z < b.z ? -1 : 1))
      .map((x) => x.z)
      .find((z) => room(z) > 0 && !checkAirlift(ctx, f, z) && (forced || risk(z) < RIVAL_RISK));
    if (!zone) return false;
    // Undo where the planner had it ending, then land it.
    const was = endOfOrder(f, orders[f.id]);
    if (was) ends.set(was, (ends.get(was) ?? 1) - 1);
    orders[f.id] = { type: 'airlift', target: zone };
    ends.set(zone, (ends.get(zone) ?? 0) + 1);
    used.set(origin.id, (used.get(origin.id) ?? 0) + 1);
    return true;
  };
  let flying = 0;
  if (plan.route === 'carrier' && plan.stage && plan.carrier) {
    const stage = plan.stage;
    const seaEnds = endsOf(view, orders, true);
    const avoid = new Set<HexKey>();
    const shut = new Set<HexKey>();
    for (const c of Object.values(view.contacts)) {
      if (view.relations[c.owner] !== 'war' || !isNaval(c.unitClass)) continue;
      shut.add(c.key);
      for (const n of [c.key, ...neighborKeys(c.key)]) avoid.add(n);
    }
    const ships = [plan.carrier, ...plan.transports];
    // Free the stage of our own other ships' plans first: the group needs the room.
    for (const s of ships) {
      const was = endOfOrder(s, orders[s.id]);
      if (was) seaEnds.set(was, (seaEnds.get(was) ?? 1) - 1);
    }
    for (const s of ships) {
      if (s.key === stage) {
        orders[s.id] = { type: 'hold' };
        seaEnds.set(stage, (seaEnds.get(stage) ?? 0) + 1);
        continue;
      }
      const path = sail(view, s, stage, seaEnds, avoid, shut);
      orders[s.id] = path.length ? { type: 'move', path } : { type: 'hold' };
      const end = path.at(-1) ?? s.key;
      seaEnds.set(end, (seaEnds.get(end) ?? 0) + 1);
    }
    // Staged: the troops aboard fly in, the carriers' capacity a turn.
    for (const t of plan.transports) {
      for (const p of plan.troops.filter((x) => x.aboard === t.id)) {
        const origin = airliftOrigin(ctx, p);
        if (origin && t.key === stage && fly(p, origin)) flying++;
        else orders[p.id] = { type: 'hold' };
      }
    }
  } else if (plan.route === 'airfield' && plan.field) {
    const field = plan.field;
    for (const f of plan.troops) {
      const origin = f.key === field.key ? airliftOrigin(ctx, f) : null;
      if (origin && fly(f, origin)) {
        flying++;
        continue;
      }
      if (f.key === field.key) continue;
      // Gather at the airfield, unless the planner has it fighting.
      if (orders[f.id]?.type === 'attack') continue;
      const p = findPath(f.key, field.key, (_a, b) => enterCost(view.tiles[b], f.unitClass));
      if (!p) continue;
      const allowance = movementAllowance(f);
      const path: HexKey[] = [];
      let cost = 0;
      for (const k of p.path) {
        const c = enterCost(view.tiles[k], f.unitClass)!;
        if (cost + c > allowance) break;
        cost += c;
        path.push(k);
      }
      while (path.length > 0 && room(path.at(-1)!) <= 0) path.pop();
      if (path.length === 0) continue;
      const was = endOfOrder(f, orders[f.id]);
      if (was) ends.set(was, (ends.get(was) ?? 1) - 1);
      orders[f.id] = { type: 'move', path };
      ends.set(path.at(-1)!, (ends.get(path.at(-1)!) ?? 0) + 1);
    }
  }
  // Hold the drop zone while more are coming and the odds are poor: storming with too few only
  // throws away what landed.
  const coming = flying > 0 || plan.troops.some((f) => !!f.aboard);
  const stormers = plan.down.filter((f) => orders[f.id]?.type === 'attack' && (orders[f.id] as { target: HexKey }).target === site.key);
  if (coming && stormers.length > 0 && plan.down.length < ENOUGH_DOWN) {
    const p = previewAssault(view, stormers.map((f) => f.id), site.key);
    // A garrison out of sight among the buildings is no empty city: a blind estimate counts for nothing.
    const share = p && p.defenders > 0 ? Math.floor((p.share[0] + p.share[1]) / 2) : 0;
    if (share < 500) for (const f of stormers) orders[f.id] = { type: 'defend' };
  }
  return true;
}

/** Where `f` ends the turn under `o`, or null for a passenger staying aboard (it takes no room). */
function endOfOrder(f: Formation, o: FormationOrder | undefined): HexKey | null {
  if (o?.type === 'airlift') return o.target;
  const path = o && (o.type === 'move' || o.type === 'recon' || o.type === 'withdraw' || o.type === 'attack') ? o.path : [];
  if (path.length > 0) return path.at(-1)!;
  return f.aboard ? null : f.key;
}

/**
 * An airborne operation ordered on `target` makes no peace (nor truce, nor pact) with a power at the
 * prize's gates: one holding a site beside it or with troops seen within two hexes. The troops come
 * down among them, and a peace signed now hands them the prize the turn they walk in (China took
 * Ulaanbaatar from beside Beijing on turn 1 of every campaign, the day the staff made peace with it).
 */
export function holdTheGates(view: NationView, orders: NationOrders, target: SiteId | undefined): NationOrders {
  const site = target ? view.sites[target] : undefined;
  if (!site || !airbornePlan(view, site)) return orders;
  const gate = new Set<string>();
  for (const k of neighborKeys(site.key)) {
    const t = view.tiles[k];
    if (t?.siteId && t.owner && t.owner !== view.self.id) gate.add(t.owner);
  }
  for (const c of Object.values(view.contacts)) if (keyDistance(c.key, site.key) <= 2 && !view.nations[c.owner]?.minor) gate.add(c.owner);
  if (site.owner) gate.add(site.owner);
  const soft = new Set(['propose_peace', 'propose_ceasefire', 'propose_nonaggression']);
  const diplomacy = orders.diplomacy.filter((d) => !(gate.has(d.target) && soft.has(d.action)));
  return diplomacy.length === orders.diplomacy.length ? orders : { ...orders, diplomacy };
}

/**
 * The lifts' fuel, reserved after recruits, buildings and deals as the validator reserves it: make
 * room by dropping recruits and then buildings, and as a last resort ground the lifts, the last first.
 */
export function fundAirlifts(view: NationView, orders: NationOrders): NationOrders {
  const lifts = sortedKeys(orders.formations).filter((id) => orders.formations[id]!.type === 'airlift');
  if (lifts.length === 0) return orders;
  const out: NationOrders = { ...orders, formations: { ...orders.formations }, recruit: [...orders.recruit], ...(orders.build ? { build: [...orders.build] } : {}) };
  const need = (n: number): Stockpile => {
    const r: Stockpile = airliftCost(n);
    for (const x of out.recruit) for (const res of RESOURCES) r[res] += recruitCost(view.self, x.unitClass)[res];
    for (const b of out.build ?? []) for (const res of RESOURCES) r[res] += FACILITIES[b.facility].cost[res];
    for (const d of out.diplomacy) if (d.action === 'propose_exchange' || d.action === 'pay_tribute') for (const res of RESOURCES) r[res] += d.terms?.give?.[res] ?? 0;
    return r;
  };
  const fits = (n: number) => RESOURCES.every((r) => need(n)[r] <= view.self.stockpile[r]);
  let n = lifts.length;
  while (!fits(n) && (out.recruit.length > 0 || (out.build?.length ?? 0) > 0)) {
    if (out.recruit.length > 0) out.recruit.pop();
    else out.build!.pop();
  }
  if (out.build && out.build.length === 0) delete out.build;
  while (n > 0 && !fits(n)) {
    n--;
    out.formations[lifts[n]!] = { type: 'hold' };
  }
  return out;
}
