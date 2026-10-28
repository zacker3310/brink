import type {
  ArenaBattle,
  BuildOrder,
  Budget,
  DiplomaticAction,
  FacilityId,
  FormationOrder,
  GameEvent,
  NationId,
  NationOrders,
  RecruitOrder,
  Stockpile,
  SupplyPriority,
  UnitClass,
  WorldState,
} from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { AIR_REBASE_RANGE, FACILITIES, FACILITY_SLOTS, TECHS, UNITS } from '@brink/game-data';
import { areAdjacent, keyDistance } from '@brink/map';
import { canPropose } from './diplomacy';
import { enterCost, movementAllowance, pathCost, recruitCost, relationOf, sortedKeys, treatyIn } from './rules';

export interface LockedOrders {
  /** One entry per living nation, sorted by nation id. Every own formation has an order. */
  orders: Record<NationId, NationOrders>;
  rejected: GameEvent[];
}

const PRIORITIES: readonly SupplyPriority[] = ['high', 'normal', 'low'];

export function emptyOrders(nation: NationId, turn: number): NationOrders {
  return { nation, turn, formations: {}, recruit: [], diplomacy: [] };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

/** Why `order` is illegal for formation `id`, or null if it is legal. */
export function checkFormationOrder(world: WorldState, nation: NationId, id: string, order: FormationOrder): string | null {
  const f = world.formations[id];
  if (!f) return 'no such formation';
  if (f.owner !== nation) return 'formation belongs to another nation';
  const def = UNITS[f.unitClass];
  const o = order as unknown as Record<string, unknown>;
  switch (order.type) {
    case 'hold':
    case 'defend':
      return null;
    case 'move':
    case 'recon':
    case 'withdraw': {
      if (!isStringArray(o.path) || order.path.length === 0) return 'path is empty';
      if (!def.ground) {
        if (order.type !== 'move') return 'air formations can only rebase';
        if (order.path.length !== 1) return 'air rebase takes a single destination';
        const dest = order.path[0]!;
        const site = world.tiles[dest]?.siteId ? world.sites[world.tiles[dest]!.siteId!] : undefined;
        if (!site || site.owner !== nation) return 'air formations rebase only to own sites';
        if (keyDistance(f.key, dest) > AIR_REBASE_RANGE) return 'rebase destination out of range';
        return null;
      }
      const cost = pathCost(world.tiles, f.unitClass, f.key, order.path);
      if (cost === null) return 'path is not contiguous or crosses impassable terrain';
      if (cost > movementAllowance(f)) return 'path exceeds movement allowance';
      return null;
    }
    case 'attack': {
      if (typeof o.target !== 'string' || !world.tiles[order.target]) return 'no such target hex';
      if (!isStringArray(o.path)) return 'path is malformed';
      if (f.ammunition < def.ammoPerAttack) return 'not enough ammunition';
      if (def.range > 0) {
        if (order.path.length > 0) return 'ranged formations strike from position';
        const d = keyDistance(f.key, order.target);
        if (d < 1 || d > def.range) return 'target out of range';
        return null;
      }
      const cost = pathCost(world.tiles, f.unitClass, f.key, order.path);
      if (cost === null) return 'approach is not contiguous or crosses impassable terrain';
      if (cost > movementAllowance(f)) return 'approach exceeds movement allowance';
      const end = order.path.at(-1) ?? f.key;
      if (!areAdjacent(end, order.target)) return 'target is not adjacent to the end of the approach';
      if (enterCost(world.tiles[order.target], f.unitClass) === null) return 'target hex is impassable';
      return null;
    }
    default:
      return 'unknown order type';
  }
}

function checkBudget(b: Budget): string | null {
  const parts = [b.research, b.infrastructure, b.welfare];
  if (!parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 50)) return 'budget shares must be 0..50';
  if (parts.reduce((a, c) => a + c, 0) > 60) return 'budget shares exceed 60% of income';
  return null;
}

export function checkResearch(world: WorldState, nation: NationId, tech: string | null): string | null {
  if (tech === null) return null;
  const def = TECHS[tech];
  if (!def) return 'no such technology';
  const unlocked = world.nations[nation]!.research.unlocked;
  if (unlocked.includes(tech)) return 'technology already researched';
  if (!def.requires.every((r) => unlocked.includes(r))) return 'prerequisites not met';
  return null;
}

/** Recruits accepted in site order while their combined cost fits the stockpile. */
function lockRecruits(
  world: WorldState,
  nation: NationId,
  recruits: RecruitOrder[],
  reject: (reason: string) => void,
  reserved: Stockpile,
): RecruitOrder[] {
  const n = world.nations[nation]!;
  const bySite = new Map<string, RecruitOrder[]>();
  for (const r of recruits) {
    if (!r || typeof r.siteId !== 'string') {
      reject('malformed recruitment order');
      continue;
    }
    bySite.set(r.siteId, [...(bySite.get(r.siteId) ?? []), r]);
  }
  const out: RecruitOrder[] = [];
  for (const siteId of [...bySite.keys()].sort()) {
    const list = bySite.get(siteId)!;
    if (list.length > 1) {
      reject(`more than one recruitment at ${siteId}`);
      continue;
    }
    const r = list[0]!;
    const site = world.sites[siteId];
    if (!site) reject('no such site');
    else if (site.owner !== nation) reject(`${site.name} is not under your control`);
    else if (site.kind !== 'capital' && site.kind !== 'city') reject(`${site.name} cannot recruit`);
    else if (!UNIT_CLASSES.includes(r.unitClass as UnitClass)) reject('unknown unit class');
    else {
      const cost = recruitCost(n, r.unitClass);
      if (RESOURCES.some((res) => reserved[res] + cost[res] > n.stockpile[res])) {
        reject(`insufficient resources for ${UNITS[r.unitClass].name} at ${site.name}`);
        continue;
      }
      for (const res of RESOURCES) reserved[res] += cost[res];
      out.push({ siteId, unitClass: r.unitClass });
    }
  }
  return out;
}

/** Why `nation` may not take `action` toward `target` this turn, or null. */
export function checkDiplomacy(
  world: Pick<WorldState, 'relations' | 'treaties' | 'turn'> & { nations: Record<NationId, { name: string }> },
  nation: NationId,
  target: NationId,
  action: DiplomaticAction,
): string | null {
  const t = world.nations[target]!;
  const rel = relationOf(world.relations, nation, target);
  switch (action) {
    case 'declare_war': {
      if (rel === 'war') return `already at war with ${t.name}`;
      const pact = treatyIn(world.treaties, 'nonaggression', nation, target, world.turn);
      if (pact) return `bound by a non-aggression pact with ${t.name} through turn ${pact.until}`;
      return null;
    }
    case 'propose_peace':
      return rel === 'war' ? null : `not at war with ${t.name}`;
    case 'propose_alliance':
      return rel === 'peace' ? null : `must be at peace with ${t.name} to ally`;
    case 'propose_nonaggression':
      if (rel !== 'peace') return `a non-aggression pact needs peace with ${t.name}`;
      return canPropose(world, nation, target, 'nonaggression') ? null : `a pact with ${t.name} is already in force`;
    case 'propose_trade':
      if (rel === 'war') return `no trade with ${t.name} while at war`;
      if (treatyIn(world.treaties, 'embargo', nation, target, world.turn)) return `an embargo bars trade with ${t.name}`;
      return canPropose(world, nation, target, 'trade') ? null : `trade with ${t.name} is already running`;
    case 'embargo': {
      const e = treatyIn(world.treaties, 'embargo', nation, target, world.turn);
      return e && e.until > world.turn ? `an embargo on ${t.name} is already in force` : null;
    }
    default:
      return 'unknown diplomatic action';
  }
}

/** Why `nation` cannot start `facility` at `siteId` now, ignoring cost, or null. */
export function checkBuild(world: WorldState, nation: NationId, siteId: string, facility: FacilityId): string | null {
  const site = world.sites[siteId];
  const def = FACILITIES[facility];
  if (!site) return 'no such site';
  if (!def) return 'unknown facility';
  if (site.owner !== nation) return `${site.name} is not under your control`;
  const building = world.nations[nation]!.construction.filter((c) => c.siteId === siteId);
  if (site.facilities.includes(facility) || building.some((c) => c.facility === facility)) return `${site.name} already has a ${def.name.toLowerCase()}`;
  if (site.facilities.length + building.length >= FACILITY_SLOTS[site.kind]) return `${site.name} has no room for another facility`;
  if (def.requires && !world.nations[nation]!.research.unlocked.includes(def.requires)) return `${def.name} needs ${TECHS[def.requires]?.name ?? def.requires}`;
  return null;
}

/** Builds accepted in site order, one per site, while they fit what recruits left of the stockpile. */
function lockBuilds(world: WorldState, nation: NationId, builds: BuildOrder[], reject: (reason: string) => void, reserved: Stockpile): BuildOrder[] {
  const n = world.nations[nation]!;
  const out: BuildOrder[] = [];
  const seen = new Set<string>();
  const valid = builds.filter((b) => b && typeof b.siteId === 'string' && typeof b.facility === 'string');
  if (valid.length !== builds.length) reject('malformed build order');
  for (const b of [...valid].sort((x, y) => (x.siteId < y.siteId ? -1 : x.siteId > y.siteId ? 1 : 0))) {
    if (seen.has(b.siteId)) {
      reject(`more than one build at ${b.siteId}`);
      continue;
    }
    seen.add(b.siteId);
    const why = checkBuild(world, nation, b.siteId, b.facility);
    if (why) {
      reject(why);
      continue;
    }
    const cost = FACILITIES[b.facility].cost;
    if (RESOURCES.some((r) => reserved[r] + cost[r] > n.stockpile[r])) {
      reject(`insufficient resources for a ${FACILITIES[b.facility].name.toLowerCase()} at ${world.sites[b.siteId]!.name}`);
      continue;
    }
    for (const r of RESOURCES) reserved[r] += cost[r];
    out.push({ siteId: b.siteId, facility: b.facility });
  }
  return out;
}

/**
 * Phase 1. Checks every submission against the start-of-turn world and returns exactly one
 * locked order set per living nation. Anything illegal is dropped with an `order_rejected`
 * event; a formation without a legal order holds. Nothing here depends on the order in
 * which submissions arrived.
 */
/** An arena result must name a hex, attackers holding attack orders on it, and kept strengths 0..1000. */
function checkBattle(world: WorldState, locked: NationOrders, b: ArenaBattle, seen: Set<string>): string | null {
  if (!b || typeof b.target !== 'string' || !world.tiles[b.target]) return 'battle on an unknown hex';
  if (seen.has(b.target)) return 'more than one battle on one hex';
  if (!Array.isArray(b.attackers) || !Array.isArray(b.defenders) || b.attackers.length === 0) return 'battle without attackers';
  for (const id of b.attackers) {
    const o = locked.formations[id];
    if (!o || o.type !== 'attack' || o.target !== b.target) return 'battle attacker without an attack order on that hex';
  }
  if (typeof b.won !== 'boolean' || !b.kept || typeof b.kept !== 'object') return 'malformed battle result';
  for (const [id, k] of Object.entries(b.kept)) {
    if (!b.attackers.includes(id) && !b.defenders.includes(id)) return 'battle result for a formation that did not fight';
    if (!Number.isInteger(k) || k < 0 || k > 1000) return 'battle result out of range';
  }
  return null;
}

export function lockOrders(world: WorldState, submissions: readonly NationOrders[]): LockedOrders {
  const rejected: GameEvent[] = [];
  const byNation = new Map<NationId, NationOrders[]>();
  for (const s of submissions) {
    if (!s || typeof s.nation !== 'string') continue;
    byNation.set(s.nation, [...(byNation.get(s.nation) ?? []), s]);
  }

  const orders: Record<NationId, NationOrders> = {};
  for (const nation of sortedKeys(world.nations)) {
    const n = world.nations[nation]!;
    if (n.eliminated) continue;
    const reject = (reason: string, formation: string | null = null) =>
      rejected.push({ kind: 'order_rejected', nation, formation, reason });
    const locked = emptyOrders(nation, world.turn);
    orders[nation] = locked;
    const own = sortedKeys(world.formations).filter((id) => world.formations[id]!.owner === nation);
    for (const id of own) locked.formations[id] = { type: 'hold' };

    const subs = byNation.get(nation) ?? [];
    if (subs.length === 0) continue;
    if (subs.length > 1) {
      reject('more than one order set submitted; all were discarded');
      continue;
    }
    const sub = subs[0]!;
    if (sub.turn !== world.turn) {
      reject(`orders were for turn ${sub.turn}, not ${world.turn}`);
      continue;
    }

    const fOrders = sub.formations && typeof sub.formations === 'object' ? sub.formations : {};
    for (const id of Object.keys(fOrders).sort()) {
      const order = fOrders[id]!;
      const why = checkFormationOrder(world, nation, id, order);
      if (why) reject(why, id);
      else locked.formations[id] = order;
    }

    // Recruits reserve first, then buildings, from one shared reservation: nothing is overspent.
    const reserved: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
    locked.recruit = lockRecruits(world, nation, Array.isArray(sub.recruit) ? sub.recruit : [], reject, reserved);
    if (sub.build !== undefined) locked.build = lockBuilds(world, nation, Array.isArray(sub.build) ? sub.build : [], reject, reserved);

    if (sub.budget) {
      const why = checkBudget(sub.budget);
      if (why) reject(why);
      else locked.budget = { research: sub.budget.research, infrastructure: sub.budget.infrastructure, welfare: sub.budget.welfare };
    }

    if (sub.research !== undefined) {
      const why = checkResearch(world, nation, sub.research);
      if (why) reject(why);
      else locked.research = sub.research;
    }

    if (sub.eventChoice !== undefined) {
      if (!n.event) reject('no world event is waiting for an answer');
      else if (sub.eventChoice !== 0 && sub.eventChoice !== 1) reject('unknown event option');
      else locked.eventChoice = sub.eventChoice;
    }

    if (sub.supplyPriority) {
      const pri: Record<string, SupplyPriority> = {};
      for (const id of Object.keys(sub.supplyPriority).sort()) {
        const p = sub.supplyPriority[id]!;
        if (world.formations[id]?.owner !== nation) reject('supply priority for a formation you do not command', id);
        else if (!PRIORITIES.includes(p)) reject('unknown supply priority', id);
        else pri[id] = p;
      }
      locked.supplyPriority = pri;
    }

    const dip = Array.isArray(sub.diplomacy) ? sub.diplomacy : [];
    const perTarget = new Map<NationId, number>();
    for (const d of dip) perTarget.set(d.target, (perTarget.get(d.target) ?? 0) + 1);
    for (const d of [...dip].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))) {
      const t = world.nations[d.target];
      if (!t || d.target === nation) reject('no such nation');
      else if (perTarget.get(d.target)! > 1) reject(`more than one diplomatic action toward ${t.name}`);
      else if (t.eliminated) reject(`${t.name} has been eliminated`);
      else {
        const why = checkDiplomacy(world, nation, d.target, d.action);
        if (why) reject(why);
        else locked.diplomacy.push({ target: d.target, action: d.action });
      }
    }

    if (sub.battles !== undefined) {
      const battles = Array.isArray(sub.battles) ? sub.battles : [];
      const seen = new Set<string>();
      for (const b of battles) {
        const why = checkBattle(world, locked, b, seen);
        if (why) reject(why);
        else {
          seen.add(b.target);
          (locked.battles ??= []).push({ target: b.target, attackers: [...b.attackers].sort(), defenders: [...b.defenders].sort(), kept: { ...b.kept }, won: b.won });
        }
      }
    }
  }
  return { orders, rejected };
}
