import type { Formation, GameEvent, NationId, NationOrders, Stockpile, WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { RULES, STACK_LIMIT, UNITS } from '@brink/game-data';
import { recruitCost, relationOf, zeroStockpile } from './rules';

export function newFormation(world: WorldState, owner: NationId, unitClass: Formation['unitClass'], key: string, name: string): Formation {
  const id = `f${world.nextId++}`;
  const base = RULES.newFormation;
  const f: Formation = {
    id,
    name,
    owner,
    unitClass,
    key,
    strength: base.strength,
    organization: base.organization,
    morale: base.morale,
    readiness: base.readiness,
    fuel: base.fuel,
    ammunition: base.ammunition,
    experience: 0,
    entrenchment: 0,
    supplyPriority: 'normal',
    supply: 100,
    lastOrder: 'hold',
  };
  world.formations[id] = f;
  return f;
}

function formationName(world: WorldState, owner: NationId, unitClass: Formation['unitClass']): string {
  const count = Object.values(world.formations).filter((f) => f.owner === owner && f.unitClass === unitClass).length + 1;
  const n = world.nations[owner]!;
  return `${n.name.split(' ')[0]} ${count}${ordinal(count)} ${UNITS[unitClass].name}`;
}

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/**
 * Phase 3. Resources for new recruits were reserved at validation and are consumed here, when
 * the item enters the queue. Industrial capacity (last settlement's throughput) is then spent
 * down the queue in order. Finished formations appear at their site if it is still held and
 * has room; otherwise they wait.
 */
export function resolveProduction(world: WorldState, nation: NationId, orders: NationOrders, events: GameEvent[]): Stockpile {
  const n = world.nations[nation]!;
  const spent = zeroStockpile();

  n.productionQueue = n.productionQueue.filter((item) => {
    if (world.sites[item.siteId]?.owner === nation) return true;
    events.push({ kind: 'production_cancelled', nation, item: item.id, site: item.siteId, reason: 'site lost' });
    return false;
  });

  for (const r of orders.recruit) {
    const cost = recruitCost(n, r.unitClass);
    if (RESOURCES.some((res) => cost[res] > n.stockpile[res])) {
      throw new Error(`recruitment for ${nation} passed validation without the resources to pay for it`);
    }
    for (const res of RESOURCES) {
      n.stockpile[res] -= cost[res];
      spent[res] += cost[res];
    }
    const id = `p${world.nextId++}`;
    n.productionQueue.push({ id, unitClass: r.unitClass, siteId: r.siteId, progress: 0, required: UNITS[r.unitClass].industry });
    events.push({ kind: 'recruitment_queued', nation, item: id, unitClass: r.unitClass, site: r.siteId });
  }

  let capacity = n.industrialCapacity;
  const done: string[] = [];
  for (const item of n.productionQueue) {
    if (item.progress < item.required) {
      const take = Math.min(capacity, item.required - item.progress);
      item.progress += take;
      capacity -= take;
    }
    if (item.progress < item.required) continue;
    const site = world.sites[item.siteId]!;
    const here = Object.values(world.formations).filter((f) => f.key === site.key);
    if (here.length >= STACK_LIMIT || here.some((f) => relationOf(world.relations, nation, f.owner) !== 'alliance')) continue;
    const f = newFormation(world, nation, item.unitClass, site.key, formationName(world, nation, item.unitClass));
    events.push({ kind: 'production', nation, formation: f.id, unitClass: f.unitClass, site: site.id, key: site.key });
    done.push(item.id);
  }
  n.productionQueue = n.productionQueue.filter((i) => !done.includes(i.id));
  return spent;
}

