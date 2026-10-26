import type { GameEvent, NationId, NationOrders, WorldEventId, WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { EVENT_CHANCE, EVENT_IDS, EVENTS } from '@brink/game-data';
import { roll } from './rng';
import { clamp, sortedKeys } from './rules';

/** Whether `nation` draws a world event at the end of `turn`. Keyed, so order never matters. */
export function drawsEvent(seed: number, turn: number, nation: NationId): boolean {
  return roll(seed, turn, 'event', nation) % 100 < EVENT_CHANCE;
}

/** Apply one option of an event. Costs are paid as far as they can be; nothing goes below zero. */
export function applyEvent(world: WorldState, nation: NationId, id: WorldEventId, choice: 0 | 1): void {
  const n = world.nations[nation]!;
  const e = EVENTS[id].options[choice].effect;
  for (const r of RESOURCES) n.stockpile[r] = Math.max(0, n.stockpile[r] + (e.stockpile?.[r] ?? 0));
  if (e.stability) n.stability = clamp(n.stability + e.stability, 0, 100);
  if (e.research) n.research.progress += e.research;
  if (e.morale) {
    for (const fid of sortedKeys(world.formations)) {
      const f = world.formations[fid]!;
      if (f.owner === nation) f.morale = clamp(f.morale + e.morale, 0, 100);
    }
  }
}

/**
 * Phase 10b, after the economy settles. A pending event from an earlier turn resolves with the
 * submitted answer (option 0 if none); a nation that answered nothing this turn may draw a new one.
 */
export function resolveWorldEvents(world: WorldState, orders: Record<NationId, NationOrders>, events: GameEvent[]): void {
  for (const nation of sortedKeys(orders)) {
    const n = world.nations[nation]!;
    if (n.eliminated) continue;
    if (n.event && n.event.turn < world.turn) {
      const choice = orders[nation]!.eventChoice ?? 0;
      applyEvent(world, nation, n.event.id, choice);
      events.push({ kind: 'world_event', nation, event: n.event.id, choice });
      n.event = null;
      continue;
    }
    if (n.event || world.turn >= world.maxTurns || !drawsEvent(world.seed, world.turn, nation)) continue;
    const id = EVENT_IDS[roll(world.seed, world.turn, 'event-kind', nation) % EVENT_IDS.length]!;
    n.event = { id, turn: world.turn };
    events.push({ kind: 'world_event', nation, event: id, choice: null });
  }
}
