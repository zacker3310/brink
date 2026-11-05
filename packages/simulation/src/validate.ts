import type {
  ArenaBattle,
  BuildOrder,
  Budget,
  CardPlay,
  DealTerms,
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
import { AIR_REBASE_RANGE, FACILITIES, TECHS, UNITS } from '@brink/game-data';
import { areAdjacent, keyDistance } from '@brink/map';
import { checkAirlift, liftContext, lockAirlifts } from './airborne';
import { lockCommanderOrders } from './commanders';
import { bindingTreaty, canPropose, cleanTerms, PROPOSAL_OF, termsProblem, type DiplomacyWorld } from './diplomacy';
import { checkPlays, marchBonus } from './doctrine';
import { hasPassage } from './passage';
import { buildBlocker, facilityCost } from './progression';
import { alongside, enterCost, isAir, isNaval, movementAllowance, passengersOf, pathCost, recruitCost, relationOf, sortedKeys, treatyIn } from './rules';

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

/** Why `order` is illegal for formation `id`, or null if it is legal. `plays`: the cards played with it (a Forced March counts). */
export function checkFormationOrder(world: WorldState, nation: NationId, id: string, order: FormationOrder, plays: readonly CardPlay[] = []): string | null {
  const f = world.formations[id];
  if (!f) return 'no such formation';
  if (f.owner !== nation) return 'formation belongs to another nation';
  const def = UNITS[f.unitClass];
  const allowance = movementAllowance(f) + marchBonus(world.nations[nation], world.turn, f, plays);
  const o = order as unknown as Record<string, unknown>;
  switch (order.type) {
    case 'hold':
    case 'defend':
      return null;
    case 'move':
    case 'recon':
    case 'withdraw': {
      if (!isStringArray(o.path) || order.path.length === 0) return 'path is empty';
      if (isAir(f.unitClass)) {
        if (order.type !== 'move') return 'air formations can only rebase';
        if (order.path.length !== 1) return 'air rebase takes a single destination';
        const dest = order.path[0]!;
        const site = world.tiles[dest]?.siteId ? world.sites[world.tiles[dest]!.siteId!] : undefined;
        const deck = carrierAt(world, nation, dest, 'air');
        if ((!site || (site.owner !== nation && !hasPassage(world, nation, site.owner))) && !deck) return 'air formations rebase only to own sites, a passage partner\'s and carriers';
        if (keyDistance(f.key, dest) > AIR_REBASE_RANGE) return 'rebase destination out of range';
        return null;
      }
      if (isNaval(f.unitClass) && order.type !== 'move') return 'ships can only move';
      const cost = pathCost(world.tiles, f.unitClass, f.key, order.path);
      if (cost === null) return 'path is not contiguous or crosses impassable terrain';
      if (cost > allowance) return 'path exceeds movement allowance';
      return null;
    }
    case 'attack': {
      if (typeof o.target !== 'string' || !world.tiles[order.target]) return 'no such target hex';
      if (!isStringArray(o.path)) return 'path is malformed';
      if (f.ammunition < def.ammoPerAttack) return 'not enough ammunition';
      if (def.range > 0) {
        if (f.aboard && UNITS[f.unitClass].ground) return 'guns cannot fire from the hold';
        if (order.path.length > 0) return 'ranged formations strike from position';
        const d = keyDistance(f.key, order.target);
        if (d < 1 || d > def.range) return 'target out of range';
        return null;
      }
      if (isNaval(f.unitClass)) return 'this ship does not fight';
      // From a ship, the only approach is the beach: storm a hex next to the ship.
      if (f.aboard && order.path.length > 0) return 'an amphibious assault goes straight from the ship';
      const cost = pathCost(world.tiles, f.unitClass, f.key, order.path);
      if (cost === null) return 'approach is not contiguous or crosses impassable terrain';
      if (cost > allowance) return 'approach exceeds movement allowance';
      const end = order.path.at(-1) ?? f.key;
      if (!areAdjacent(end, order.target)) return 'target is not adjacent to the end of the approach';
      if (enterCost(world.tiles[order.target], f.unitClass) === null) return 'target hex is impassable';
      return null;
    }
    case 'embark': {
      if (typeof o.carrier !== 'string') return 'no carrier named';
      if (f.aboard) return 'already aboard';
      const c = world.formations[order.carrier];
      if (!c || c.owner !== nation) return 'no such ship of yours';
      if (!alongside(world, f, c)) return 'the ship is not in this hex or lying off this port';
      const kind = UNITS[c.unitClass].carries;
      if (!kind || (kind === 'ground') !== def.ground || isNaval(f.unitClass)) return `${UNITS[c.unitClass].name} cannot carry ${def.name}`;
      if (passengersOf(world, c.id).length >= (UNITS[c.unitClass].capacity ?? 0)) return `${UNITS[c.unitClass].name} is full`;
      return null;
    }
    case 'airlift':
      return checkAirlift(liftContext(world, nation), f, o.target);
    default:
      return 'unknown order type';
  }
}

/** An own ship in `key` that carries `kind` and has room. */
export function carrierAt(world: Pick<WorldState, 'formations'>, nation: NationId, key: string, kind: 'ground' | 'air') {
  return sortedKeys(world.formations)
    .map((id) => world.formations[id]!)
    .find((c) => c.owner === nation && c.key === key && UNITS[c.unitClass].carries === kind && passengersOf(world, c.id).length < (UNITS[c.unitClass].capacity ?? 0));
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
    else if (UNITS[r.unitClass].naval && !world.tiles[site.key]?.port) reject(`${site.name} is not a port`);
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

/**
 * Why `nation` may not take `action` toward `target` this turn, or null. Works on a world or on a
 * view's public facts (`rules-view` in the client, the AI's own checks). Affordability of a deal
 * is checked by `lockOrders` against the stockpile left after recruits and buildings.
 */
export function checkDiplomacy(
  world: DiplomacyWorld & { nations: Record<NationId, { name: string; eliminated: boolean; minor?: boolean }> },
  nation: NationId,
  target: NationId,
  action: DiplomaticAction,
  terms?: DealTerms,
): string | null {
  const t = world.nations[target]!;
  const rel = relationOf(world.relations, nation, target);
  const malformed = termsProblem(action, terms);
  if (malformed) return malformed;
  switch (action) {
    case 'declare_war': {
      if (rel === 'war') return `already at war with ${t.name}`;
      const pact = treatyIn(world.treaties, 'nonaggression', nation, target, world.turn);
      if (pact) return `bound by a non-aggression pact with ${t.name} through turn ${pact.until}`;
      const truce = treatyIn(world.treaties, 'ceasefire', nation, target, world.turn);
      if (truce) return `bound by a ceasefire with ${t.name} through turn ${truce.until}`;
      return null;
    }
    case 'propose_peace':
    case 'propose_ceasefire':
      return rel === 'war' ? null : `not at war with ${t.name}`;
    case 'propose_alliance': {
      const x = terms?.against;
      if (x === undefined) return rel === 'peace' ? null : `must be at peace with ${t.name} to ally`;
      const foe = world.nations[x];
      if (!foe || x === nation || x === target) return 'an alliance against whom?';
      if (foe.eliminated || foe.minor) return `${foe.name} is no power to ally against`;
      if (rel === 'war') return `at war with ${t.name}`;
      if (bindingTreaty(world, nation, x)) return `bound by a treaty with ${foe.name}`;
      if (bindingTreaty(world, target, x)) return `${t.name} is bound by a treaty with ${foe.name}`;
      return null;
    }
    case 'propose_nonaggression':
      if (rel !== 'peace') return `a non-aggression pact needs peace with ${t.name}`;
      return canPropose(world, nation, target, 'nonaggression') ? null : `a pact with ${t.name} is already in force`;
    case 'propose_trade':
      if (rel === 'war') return `no trade with ${t.name} while at war`;
      if (treatyIn(world.treaties, 'embargo', nation, target, world.turn)) return `an embargo bars trade with ${t.name}`;
      return canPropose(world, nation, target, 'trade') ? null : `trade with ${t.name} is already running`;
    case 'propose_exchange':
      if (rel === 'war') return `no exchange with ${t.name} while at war`;
      return canPropose(world, nation, target, 'exchange', terms) ? null : `an embargo bars trade with ${t.name}`;
    case 'demand_tribute':
    case 'pay_tribute':
      return rel === 'peace' ? null : 'tribute passes only between powers at peace';
    case 'propose_joint_op': {
      const site = world.sites?.[terms!.site!];
      if (!site) return 'no such prize';
      const seen = world.tiles?.[site.key]?.visibility;
      if (seen !== undefined && seen !== 'visible') return 'you cannot see that prize now: who holds it may have changed';
      if (!site.owner || site.owner === nation || site.owner === target) return 'a joint operation is against a third power';
      if (rel === 'war') return `at war with ${t.name}`;
      if (relationOf(world.relations, nation, site.owner) !== 'war') return 'a joint operation needs you at war with its holder';
      return canPropose(world, nation, target, 'joint_op', terms) ? null : `a joint operation with ${t.name} is already under way`;
    }
    case 'propose_passage': {
      if (rel !== 'peace') return rel === 'war' ? `at war with ${t.name}` : `${t.name} is an ally: its ground is already open to you`;
      const x = terms?.against;
      if (x !== undefined && (!world.nations[x] || x === nation || x === target)) return 'passage toward whom?';
      return canPropose(world, nation, target, 'passage') ? null : `passage through ${t.name} is already granted`;
    }
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
  return buildBlocker(world, world.nations[nation]!, siteId, facility);
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
    const cost = facilityCost(n, b.facility);
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

    // Cards first: a Forced March played now lengthens this turn's moves.
    if (sub.play !== undefined) {
      const cards = checkPlays(world, nation, n.doctrine, Array.isArray(sub.play) ? sub.play : []);
      for (const why of cards.rejected) reject(why);
      if (cards.accepted.length > 0) locked.play = cards.accepted;
    }

    const fOrders = sub.formations && typeof sub.formations === 'object' ? sub.formations : {};
    for (const id of Object.keys(fOrders).sort()) {
      const order = fOrders[id]!;
      const why = checkFormationOrder(world, nation, id, order, locked.play);
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
      else if (n.minor) reject('a minor state makes no treaties');
      else if (t.minor) reject(`${t.name} is a minor state: it makes no treaties`);
      else {
        const terms = PROPOSAL_OF[d.action] ? d.terms : undefined;
        const why = checkDiplomacy(world, nation, d.target, d.action, terms);
        const clean = why ? undefined : cleanTerms(d.action, terms);
        // What a deal hands over is reserved like a recruit's cost: it must fit what is left.
        const gives = d.action === 'propose_exchange' || d.action === 'pay_tribute' ? (clean?.give ?? {}) : {};
        if (why) reject(why);
        else if (RESOURCES.some((r) => reserved[r] + (gives[r] ?? 0) > n.stockpile[r])) reject(`not enough in the stockpile for the deal with ${t.name}`);
        else {
          for (const r of RESOURCES) reserved[r] += gives[r] ?? 0;
          locked.diplomacy.push({ target: d.target, action: d.action, ...(clean ? { terms: clean } : {}) });
        }
      }
    }

    // Lifts last: each origin's capacity, and fuel from what recruits, buildings and deals left.
    lockAirlifts(world, nation, locked, reject, reserved);

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

    if (sub.commanders !== undefined) {
      const c = lockCommanderOrders(world, nation, sub.commanders, reject);
      if (c) locked.commanders = c;
    }
  }
  return { orders, rejected };
}
