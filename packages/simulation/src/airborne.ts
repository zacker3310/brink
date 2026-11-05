import type {
  AirliftMode,
  FacilityId,
  Formation,
  FormationId,
  GameEvent,
  HexKey,
  NationId,
  NationOrders,
  NationView,
  Relation,
  SiteId,
  SiteKind,
  Stockpile,
  Terrain,
  FormationClass,
  Treaty,
  WorldState,
} from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { AIRBORNE, STACK_LIMIT, UNITS } from '@brink/game-data';
import { keyDistance, neighborKeys } from '@brink/map';
import { removeDestroyed } from './engagements';
import { hasPassage } from './passage';
import { roll } from './rng';
import { clamp, enterCost, isNaval, relationOf, sortedKeys, zeroStockpile } from './rules';

// Airborne warfare (ruleset 2.9.0). A light formation flies from an airfield (an own site with an
// Airbase, or an own capital-class site) or from a carrier's deck (aboard an amphibious group lying
// with an own carrier) to a land hex in range. Onto an own or allied site (or a passage partner's) it
// air-lands in good order; anywhere else it drops, scattered (organization and readiness lost), and
// onto a hex the enemy holds it comes down beside it and storms it at once at a heavy penalty.
//
// The lift flies at the start of the movement phase (7a), after the strikes and before anything
// walks: every interception, landing and conflict is computed from one snapshot, then committed.
// Interception is a roll per formation, `roll(seed, turn, 'airlift', id)`, against a chance summed
// from the hostile aircraft, ships and missile batteries near the flight and the landing hex. A
// dropped formation is supplied only by the ordinary rules (supply never flies), so off its own
// lines it is out of supply until it links up or takes a site. Numbers: game-data `AIRBORNE`.

type OriginKind = keyof typeof AIRBORNE.origins;

export interface AirliftOrigin {
  kind: OriginKind;
  /** The capacity pool: a site id, or `sea:<hex>` for the carriers in a hex. */
  id: string;
  key: HexKey;
  name: string;
  range: number;
  /** Formations it can lift this turn. */
  capacity: number;
}

/** What the airlift rules read: a world from one nation's chair, or a view. */
export interface LiftContext {
  nation: NationId;
  turn: number;
  treaties: readonly Treaty[];
  tiles: Record<HexKey, { terrain: Terrain | null; owner: NationId | null; siteId: SiteId | null } | undefined>;
  sites: Record<SiteId, { owner: NationId | null; kind: SiteKind; key: HexKey; name: string; facilities: readonly FacilityId[] } | undefined>;
  /** Formations the rules may count: all of them in a world, the nation's own in a view. */
  formations: Record<FormationId, Formation>;
  relation: (other: NationId) => Relation;
}

export function liftContext(world: WorldState, nation: NationId): LiftContext {
  return { nation, turn: world.turn, treaties: world.treaties, tiles: world.tiles, sites: world.sites, formations: world.formations, relation: (o) => relationOf(world.relations, nation, o) };
}

export function liftContextOfView(view: NationView): LiftContext {
  return {
    nation: view.self.id,
    turn: view.turn,
    treaties: view.treaties,
    tiles: view.tiles,
    sites: view.sites,
    formations: view.formations,
    relation: (o) => (o === view.self.id ? 'alliance' : (view.relations[o] ?? 'peace')),
  };
}

/** Ground that welcomes the lift: own, allied or a passage partner's. */
function friendlyOwner(ctx: LiftContext, owner: NationId | null | undefined): boolean {
  if (!owner) return false;
  return owner === ctx.nation || ctx.relation(owner) === 'alliance' || hasPassage(ctx, ctx.nation, owner);
}

/** Ground no lift may enter: a power at peace with the nation that has granted it no passage. */
function forbidden(ctx: LiftContext, owner: NationId | null | undefined): boolean {
  return !!owner && owner !== ctx.nation && ctx.relation(owner) === 'peace' && !hasPassage(ctx, ctx.nation, owner);
}

/** Where `f` could fly from this turn, or null: its airfield, or the carrier deck it lies beside. */
export function airliftOrigin(ctx: LiftContext, f: Formation): AirliftOrigin | null {
  if (f.aboard) {
    const ship = ctx.formations[f.aboard];
    if (!ship || ship.owner !== f.owner || UNITS[ship.unitClass].carries !== 'ground') return null;
    const decks = sortedKeys(ctx.formations).filter((id) => {
      const c = ctx.formations[id]!;
      return c.owner === f.owner && c.key === ship.key && UNITS[c.unitClass].carries === 'air';
    }).length;
    if (decks === 0) return null;
    const def = AIRBORNE.origins.carrier;
    return { kind: 'carrier', id: `sea:${ship.key}`, key: ship.key, name: def.name, range: def.range, capacity: def.capacity * decks };
  }
  const siteId = ctx.tiles[f.key]?.siteId;
  const site = siteId ? ctx.sites[siteId] : undefined;
  if (!site || site.owner !== f.owner || !siteId) return null;
  const kind: OriginKind | null = site.facilities.includes('airbase') ? 'airbase' : site.kind === 'capital' ? 'capital' : null;
  if (!kind) return null;
  const def = AIRBORNE.origins[kind];
  return { kind, id: siteId, key: site.key, name: `${def.name} at ${site.name}`, range: def.range, capacity: def.capacity };
}

/** Whether `cls` can fly at all, and whether it can drop (or only air-land). */
// A Visitors' formation (Black Files) is never flown in: only the classes listed lift.
export const canAirlift = (cls: FormationClass): boolean => (AIRBORNE.land as readonly FormationClass[]).includes(cls);
export const canDrop = (cls: FormationClass): boolean => (AIRBORNE.drop as readonly FormationClass[]).includes(cls);

/** How a lift onto `target` comes down, given whether a hostile holds it. */
export function airliftMode(ctx: LiftContext, target: HexKey, held: boolean): AirliftMode {
  if (held) return 'assault';
  const id = ctx.tiles[target]?.siteId;
  const site = id ? ctx.sites[id] : undefined;
  return site && friendlyOwner(ctx, site.owner) ? 'airland' : 'drop';
}

/** Own formations standing (not aboard) in `key` that count against the stacking limit on land. */
function landStack(ctx: LiftContext, key: HexKey): number {
  return sortedKeys(ctx.formations).filter((id) => {
    const o = ctx.formations[id]!;
    return o.key === key && !o.aboard && !isNaval(o.unitClass) && (o.owner === ctx.nation || ctx.relation(o.owner) === 'alliance');
  }).length;
}

/**
 * Why `f` may not fly to `target`, or null. The engine's check (phase 1) and the client's and the
 * AI's own, on a view: nothing here reads what the nation cannot see. Who holds the ground now is
 * not checked here (a view may only know who held it): a lift into a neutral power's land turns back
 * when it gets there, as a march stops at its border.
 */
export function checkAirlift(ctx: LiftContext, f: Formation, target: unknown): string | null {
  const def = UNITS[f.unitClass];
  if (!canAirlift(f.unitClass)) return `${def.name} cannot be flown in`;
  if (typeof target !== 'string' || !ctx.tiles[target]) return 'no such landing hex';
  const origin = airliftOrigin(ctx, f);
  if (!origin) return f.aboard ? 'an air assault from the sea needs an amphibious group lying with one of your carriers' : 'no airfield here: fly from an own Airbase, a capital or a carrier';
  if (f.unitClass === 'mechanized' && origin.kind === 'carrier') return 'mechanized infantry flies only from an airfield';
  const tile = ctx.tiles[target]!;
  if (enterCost(tile.terrain === null ? undefined : { terrain: tile.terrain, river: false, infrastructure: 0 }, f.unitClass) === null) return 'nowhere to land there';
  const d = keyDistance(origin.key, target);
  if (d < 1) return 'already there';
  if (d > origin.range) return `out of range: the ${origin.kind === 'carrier' ? 'deck' : 'airfield'} reaches ${origin.range} hexes`;
  if (airliftMode(ctx, target, false) !== 'airland' && !canDrop(f.unitClass)) return `${def.name} only air-lands, at an own or allied airfield`;
  if (landStack(ctx, target) >= STACK_LIMIT) return 'the landing zone is full';
  return null;
}

/** Hostile aircraft, ships and missile batteries a lift can meet, from the lifting nation's chair. */
export interface LiftThreat {
  owner: NationId;
  kind: 'air' | 'drone' | 'fleet' | 'carrier' | 'battery';
  key: HexKey;
}

function threatReach(t: LiftThreat): number {
  const I = AIRBORNE.intercept;
  return t.kind === 'air' || t.kind === 'drone' ? UNITS[t.kind].range : t.kind === 'battery' ? I.batteryRange : I.shipRange;
}

/**
 * Percent chance a lift from `from` to `to` is hit, and who could hit it. A threat covers the flight
 * when it reaches some hex of it: integer geometry, a threat within its reach of the straight
 * corridor between the two (`d(t, from) + d(t, to) <= d(from, to) + 2 x reach`) or of the landing hex.
 */
export function interceptChance(threats: readonly LiftThreat[], from: HexKey, to: HexKey): { chance: number; by: NationId[] } {
  const I = AIRBORNE.intercept;
  const span = keyDistance(from, to);
  let chance = 0;
  const by = new Set<NationId>();
  for (const t of threats) {
    const reach = threatReach(t);
    const covers = keyDistance(t.key, to) <= reach || keyDistance(t.key, from) + keyDistance(t.key, to) <= span + 2 * reach;
    if (!covers) continue;
    chance += I[t.kind];
    by.add(t.owner);
  }
  return { chance: Math.min(I.max, chance), by: [...by].sort() };
}

/** Every threat to `nation`'s lifts in the world: its enemies' aircraft (on decks too), ships and batteries. */
export function liftThreats(world: WorldState, nation: NationId): LiftThreat[] {
  const out: LiftThreat[] = [];
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (relationOf(world.relations, nation, f.owner) !== 'war') continue;
    if (f.unitClass === 'air' || f.unitClass === 'drone' || f.unitClass === 'fleet' || f.unitClass === 'carrier') out.push({ owner: f.owner, kind: f.unitClass, key: f.key });
  }
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (s.owner && relationOf(world.relations, nation, s.owner) === 'war' && s.facilities.includes('missile_battery')) out.push({ owner: s.owner, kind: 'battery', key: s.key });
  }
  return out;
}

/** The threats a view knows of: hostile contacts seen in the last two turns, and batteries at sites it sees. */
export function viewThreats(view: NationView): LiftThreat[] {
  const out: LiftThreat[] = [];
  for (const id of sortedKeys(view.contacts)) {
    const c = view.contacts[id]!;
    if (view.relations[c.owner] !== 'war' || view.turn - c.lastSeen > 2) continue;
    if (c.unitClass === 'air' || c.unitClass === 'drone' || c.unitClass === 'fleet' || c.unitClass === 'carrier') out.push({ owner: c.owner, kind: c.unitClass, key: c.key });
  }
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner && view.relations[s.owner] === 'war' && s.facilities.includes('missile_battery')) out.push({ owner: s.owner, kind: 'battery', key: s.key });
  }
  return out;
}

/** Hexes `f` could fly to this turn, each with how it would come down and the interception risk the view knows of. */
export function airliftTargets(view: NationView, f: Formation): { key: HexKey; mode: AirliftMode; chance: number }[] {
  const ctx = liftContextOfView(view);
  const origin = airliftOrigin(ctx, f);
  if (!origin || !canAirlift(f.unitClass)) return [];
  const threats = viewThreats(view);
  const seen = new Set(Object.values(view.contacts).filter((c) => view.relations[c.owner] === 'war' && c.confirmed && !UNITS[c.unitClass].naval).map((c) => c.key));
  const out: { key: HexKey; mode: AirliftMode; chance: number }[] = [];
  for (const key of sortedKeys(view.tiles)) {
    if (keyDistance(origin.key, key) > origin.range || checkAirlift(ctx, f, key) || forbidden(ctx, view.tiles[key]?.owner)) continue;
    const mode = airliftMode(ctx, key, seen.has(key));
    if (mode === 'assault' && !canDrop(f.unitClass)) continue;
    out.push({ key, mode, chance: interceptChance(threats, origin.key, key).chance });
  }
  return out;
}

/** Airlift orders of `orders`, by formation id. */
function liftsOf(orders: NationOrders): [FormationId, HexKey][] {
  const out: [FormationId, HexKey][] = [];
  for (const id of sortedKeys(orders.formations)) {
    const o = orders.formations[id]!;
    if (o.type === 'airlift') out.push([id, o.target]);
  }
  return out;
}

/**
 * Phase 1, after the formation orders and deals: each origin lifts at most its capacity (formations
 * in id order), and every lift's cost is reserved like a recruit's, after recruits, buildings and
 * what deals hand over. A lift refused here holds.
 */
export function lockAirlifts(world: WorldState, nation: NationId, locked: NationOrders, reject: (reason: string, formation?: string | null) => void, reserved: Stockpile): void {
  const n = world.nations[nation]!;
  const ctx = liftContext(world, nation);
  const used = new Map<string, number>();
  for (const [id] of liftsOf(locked)) {
    const f = world.formations[id]!;
    const origin = airliftOrigin(ctx, f)!;
    const count = used.get(origin.id) ?? 0;
    if (count >= origin.capacity) {
      reject(`${origin.name} lifts ${origin.capacity} a turn`, id);
      locked.formations[id] = { type: 'hold' };
      continue;
    }
    if (RESOURCES.some((r) => reserved[r] + AIRBORNE.cost[r] > n.stockpile[r])) {
      reject('not enough credits in the stockpile for the lift', id);
      locked.formations[id] = { type: 'hold' };
      continue;
    }
    used.set(origin.id, count + 1);
    for (const r of RESOURCES) reserved[r] += AIRBORNE.cost[r];
  }
}

/**
 * Phase 3b: every locked lift is paid for (reserved at validation; a deal settled since may leave
 * less: it pays what it can), and burns its fuel from the energy there is.
 */
export function payAirlifts(world: WorldState, nation: NationId, orders: NationOrders): Stockpile {
  const spent = zeroStockpile();
  const n = world.nations[nation]!;
  const lifts = liftsOf(orders).length;
  const due = airliftCost(lifts);
  due.energy += AIRBORNE.fuel * lifts;
  for (const r of RESOURCES) {
    spent[r] = Math.min(due[r], n.stockpile[r]);
    n.stockpile[r] -= spent[r];
  }
  return spent;
}

interface Lift {
  nation: NationId;
  f: Formation;
  target: HexKey;
  origin: AirliftOrigin | null;
  mode: AirliftMode;
  landed: HexKey;
  chance: number;
  hit: boolean;
  by: NationId[];
  aborted?: string;
}

export interface AirborneResult {
  /** Formations that flew and came down this turn. */
  lifted: Set<FormationId>;
  /** Of those, the ones that dropped beside a held hex and storm it this turn (attack at a penalty). */
  assault: Set<FormationId>;
}

/**
 * Phase 7a. Every lift is judged against one snapshot (origins, who holds each landing hex, the
 * threats), conflicts between nations are settled symmetrically (two nations not allied coming down
 * in one hex: both turn back), then everything is committed together.
 */
export function resolveAirborne(world: WorldState, orders: Record<NationId, NationOrders>, seed: number, events: GameEvent[]): AirborneResult {
  const lifted = new Set<FormationId>();
  const assault = new Set<FormationId>();
  const lifts: Lift[] = [];
  for (const nation of sortedKeys(orders)) {
    const ctx = liftContext(world, nation);
    const threats = liftThreats(world, nation);
    const hostile = (key: HexKey) => Object.values(world.formations).filter((o) => o.key === key && ctx.relation(o.owner) === 'war');
    const neutral = (key: HexKey) => Object.values(world.formations).some((o) => o.key === key && o.owner !== nation && ctx.relation(o.owner) === 'peace' && !hasPassage(world, nation, o.owner));
    for (const [id, target] of liftsOf(orders[nation]!)) {
      const f = world.formations[id];
      if (!f) continue;
      const origin = airliftOrigin(ctx, f);
      const lift: Lift = { nation, f, target, origin, mode: 'drop', landed: f.key, chance: 0, hit: false, by: [] };
      lifts.push(lift);
      if (!origin) {
        lift.aborted = 'its airfield or carrier is gone';
        continue;
      }
      if (neutral(target)) {
        lift.aborted = 'neutral troops hold the landing zone';
        continue;
      }
      if (forbidden(ctx, world.tiles[target]?.owner)) {
        lift.aborted = 'a power at peace holds that ground: no landing without passage';
        continue;
      }
      const held = hostile(target).length > 0;
      lift.mode = airliftMode(ctx, target, held);
      if (held && !canDrop(f.unitClass)) {
        lift.aborted = 'the airfield is in enemy hands';
        continue;
      }
      if (held) {
        // Come down beside it: open ground nobody hostile or neutral holds, the quietest first,
        // then the nearest to where the lift came from.
        const beside = neighborKeys(target)
          .filter((k) => {
            const t = world.tiles[k];
            return !!t && enterCost(t, f.unitClass) !== null && !forbidden(ctx, t.owner) && hostile(k).length === 0 && !neutral(k);
          })
          .map((k) => ({ k, heat: neighborKeys(k).reduce((a, n) => a + hostile(n).length, 0) }))
          .sort((a, b) => a.heat - b.heat || keyDistance(origin.key, a.k) - keyDistance(origin.key, b.k) || (a.k < b.k ? -1 : 1))[0];
        if (!beside) {
          lift.aborted = 'nowhere to come down beside it';
          continue;
        }
        lift.landed = beside.k;
      } else lift.landed = target;
      const ic = interceptChance(threats, origin.key, lift.landed);
      lift.chance = ic.chance;
      lift.hit = ic.chance > 0 && roll(seed, world.turn, 'airlift', id) % 100 < ic.chance;
      lift.by = lift.hit ? ic.by : [];
    }
  }

  // Two nations not allied coming down in one hex: neither gets it.
  const into = new Map<HexKey, Lift[]>();
  for (const l of lifts) if (!l.aborted) into.set(l.landed, [...(into.get(l.landed) ?? []), l]);
  for (const [, list] of into) {
    if (list.some((a) => list.some((b) => relationOf(world.relations, a.nation, b.nation) !== 'alliance'))) for (const l of list) l.aborted = 'another power came down in the landing zone';
  }
  // Stacking: what stands there now and the lifts before it (one side only remains, so ids never rank nations).
  for (const key of [...into.keys()].sort()) {
    const list = into.get(key)!.filter((l) => !l.aborted).sort((a, b) => (a.f.id < b.f.id ? -1 : 1));
    if (list.length === 0) continue;
    let count = landStack(liftContext(world, list[0]!.nation), key);
    for (const l of list) {
      if (count >= STACK_LIMIT) l.aborted = 'the landing zone is full';
      else count++;
    }
  }

  for (const l of lifts) {
    const f = l.f;
    const from = f.key;
    if (l.aborted) {
      events.push({ kind: 'airlift', formation: f.id, owner: l.nation, unitClass: f.unitClass, from, to: l.target, landed: from, mode: l.mode, chance: l.chance, hit: false, strengthLoss: 0, by: [], aborted: l.aborted });
      continue;
    }
    const loss = l.hit ? Math.min(f.strength, AIRBORNE.interceptLoss) : 0;
    f.strength -= loss;
    world.nations[l.nation]!.warLosses += loss;
    if (l.hit) f.organization = clamp(f.organization - AIRBORNE.interceptOrganization, 0, 100);
    if (l.mode !== 'airland') {
      f.organization = clamp(f.organization - AIRBORNE.dropOrganization, 0, 100);
      f.readiness = clamp(f.readiness - AIRBORNE.dropReadiness, 0, 100);
    }
    delete f.aboard;
    f.key = l.landed;
    f.entrenchment = 0;
    lifted.add(f.id);
    if (l.mode === 'assault') {
      orders[l.nation]!.formations[f.id] = { type: 'attack', target: l.target, path: [] };
      assault.add(f.id);
    }
    events.push({ kind: 'airlift', formation: f.id, owner: l.nation, unitClass: f.unitClass, from, to: l.target, landed: l.landed, mode: l.mode, chance: l.chance, hit: l.hit, strengthLoss: loss, by: l.by });
  }
  const gone: GameEvent[] = [];
  removeDestroyed(world, gone);
  for (const e of gone) {
    if (e.kind !== 'destroyed') continue;
    const a = events.find((x) => x.kind === 'airlift' && x.formation === e.formation && !x.aborted);
    if (a && a.kind === 'airlift') a.destroyed = true;
    lifted.delete(e.formation);
    assault.delete(e.formation);
  }
  events.push(...gone);
  return { lifted, assault };
}

/** What lifting `count` formations costs. */
export function airliftCost(count: number): Stockpile {
  const out = zeroStockpile();
  for (const r of RESOURCES) out[r] = AIRBORNE.cost[r] * count;
  return out;
}
