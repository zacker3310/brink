import type {
  Budget,
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
import { AIR_REBASE_RANGE, TECHS, UNITS } from '@brink/game-data';
import { areAdjacent, keyDistance } from '@brink/map';
import { enterCost, movementAllowance, pathCost, recruitCost, relationOf, sortedKeys } from './rules';

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
  const reserved: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
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

/**
 * Phase 1. Checks every submission against the start-of-turn world and returns exactly one
 * locked order set per living nation. Anything illegal is dropped with an `order_rejected`
 * event; a formation without a legal order holds. Nothing here depends on the order in
 * which submissions arrived.
 */
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

    locked.recruit = lockRecruits(world, nation, Array.isArray(sub.recruit) ? sub.recruit : [], reject);

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
      const rel = t ? relationOf(world.relations, nation, d.target) : null;
      if (!t || d.target === nation) reject('no such nation');
      else if (perTarget.get(d.target)! > 1) reject(`more than one diplomatic action toward ${t.name}`);
      else if (t.eliminated) reject(`${t.name} has been eliminated`);
      else if (d.action === 'declare_war' && rel === 'war') reject(`already at war with ${t.name}`);
      else if (d.action === 'propose_peace' && rel !== 'war') reject(`not at war with ${t.name}`);
      else if (d.action === 'propose_alliance' && rel !== 'peace') reject(`must be at peace with ${t.name} to ally`);
      else if (!['declare_war', 'propose_peace', 'propose_alliance'].includes(d.action)) reject('unknown diplomatic action');
      else locked.diplomacy.push({ target: d.target, action: d.action });
    }
  }
  return { orders, rejected };
}
