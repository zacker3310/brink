import type { Formation, FormationId, GameEvent, HexKey, NationId, NationOrders, WorldState } from '@brink/contracts';
import { STACK_LIMIT, UNITS } from '@brink/game-data';
import { neighborKeys } from '@brink/map';
import { enterCost, movementAllowance, relationOf, sortedKeys } from './rules';

type Halt = 'enemy' | 'contact' | 'contested' | 'stacking';

interface Mover {
  f: Formation;
  steps: HexKey[];
  /** Arrival time of each step, in thousandths of a turn. */
  times: number[];
  i: number;
  done: boolean;
  halted: Halt | null;
  traveled: HexKey[];
  /** Recon and withdraw orders keep going after making contact. */
  ignoresContact: boolean;
}

export interface MovementResult {
  events: GameEvent[];
  /** Opposing formations that tried to swap hexes: they meet head-on. Pairs sorted, list sorted. */
  meetings: [FormationId, FormationId][];
  moved: Set<FormationId>;
}

function pathOf(order: NationOrders['formations'][string]): HexKey[] {
  switch (order.type) {
    case 'move':
    case 'recon':
    case 'withdraw':
    case 'attack':
      return order.path;
    default:
      return [];
  }
}

/**
 * Phase 7. All ground movement happens on one clock. Each step has an arrival time, the
 * cumulative cost over the formation's allowance, so a fast formation covers ground sooner
 * than a slow one. Steps arriving at the same instant are judged together against the same
 * snapshot, which makes head-on, swap and contested-hex conflicts symmetric: no nation and no
 * formation id moves "first".
 */
export function resolveMovement(world: WorldState, orders: Record<NationId, NationOrders>): MovementResult {
  const events: GameEvent[] = [];
  const meetings: [FormationId, FormationId][] = [];
  const moved = new Set<FormationId>();
  const movers: Mover[] = [];
  const rel = (a: NationId, b: NationId) => relationOf(world.relations, a, b);

  for (const nation of sortedKeys(orders)) {
    for (const id of sortedKeys(orders[nation]!.formations)) {
      const order = orders[nation]!.formations[id]!;
      const f = world.formations[id];
      if (!f) continue;
      const path = pathOf(order);
      if (path.length === 0) continue;
      if (!UNITS[f.unitClass].ground) {
        // Air rebases at the end of the phase; it does not contest ground.
        continue;
      }
      if (order.type === 'attack' && UNITS[f.unitClass].range > 0) continue;
      const allowance = movementAllowance(f);
      const steps: HexKey[] = [];
      const times: number[] = [];
      let cum = 0;
      for (const k of path) {
        const c = enterCost(world.tiles[k], f.unitClass);
        if (c === null || cum + c > allowance) break;
        cum += c;
        steps.push(k);
        times.push(Math.floor((cum * 1000) / allowance));
      }
      movers.push({
        f,
        steps,
        times,
        i: 0,
        done: steps.length === 0,
        halted: null,
        traveled: [],
        ignoresContact: order.type === 'recon' || order.type === 'withdraw',
      });
    }
  }

  for (;;) {
    const active = movers.filter((m) => !m.done);
    if (active.length === 0) break;
    const t = Math.min(...active.map((m) => m.times[m.i]!));
    const group = active.filter((m) => m.times[m.i] === t);

    // Snapshot of who stands where at this instant, before anyone in the group moves.
    const at = new Map<HexKey, Formation[]>();
    for (const id of sortedKeys(world.formations)) {
      // Air on its base counts: the hex is held until the base is cleared by assault.
      const f = world.formations[id]!;
      at.set(f.key, [...(at.get(f.key) ?? []), f]);
    }
    const target = (m: Mover) => m.steps[m.i]!;
    const halt = (m: Mover, why: Halt) => {
      if (!m.halted) m.halted = why;
    };

    // Head-on swaps between enemies: neither passes; they meet.
    for (const m of group) {
      for (const n of group) {
        if (m.f.id >= n.f.id || rel(m.f.owner, n.f.owner) !== 'war') continue;
        if (target(m) === n.f.key && target(n) === m.f.key) {
          halt(m, 'enemy');
          halt(n, 'enemy');
          meetings.push([m.f.id, n.f.id]);
        }
      }
    }

    // Occupied by an enemy, or by / inside a nation this one is at peace with.
    for (const m of group) {
      if (m.halted) continue;
      const occupants = at.get(target(m)) ?? [];
      if (occupants.some((o) => rel(m.f.owner, o.owner) === 'war')) halt(m, 'enemy');
      else if (occupants.some((o) => rel(m.f.owner, o.owner) === 'peace')) halt(m, 'contact');
      else {
        const owner = world.tiles[target(m)]!.owner;
        if (owner && rel(m.f.owner, owner) === 'peace') halt(m, 'contact');
      }
    }

    // Opposing nations entering the same hex at the same instant: nobody gets it.
    const entering = new Map<HexKey, Mover[]>();
    for (const m of group) if (!m.halted) entering.set(target(m), [...(entering.get(target(m)) ?? []), m]);
    for (const [, list] of entering) {
      const contested = list.some((a) => list.some((b) => rel(a.f.owner, b.f.owner) !== 'alliance'));
      if (contested) for (const m of list) halt(m, 'contested');
    }

    // Stacking. Only friendly formations remain per hex here, so the tie-break by id never
    // ranks one nation above another.
    for (const [key, list] of entering) {
      const ok = list.filter((m) => !m.halted).sort((a, b) => (a.f.id < b.f.id ? -1 : 1));
      let count = (at.get(key) ?? []).length;
      for (const m of ok) {
        if (count >= STACK_LIMIT) halt(m, 'stacking');
        else count++;
      }
    }

    for (const m of group) {
      if (m.halted) {
        m.done = true;
        continue;
      }
      const k = target(m);
      m.f.key = k;
      m.f.fuel = Math.max(0, m.f.fuel - UNITS[m.f.unitClass].fuelPerMove);
      m.f.entrenchment = 0;
      m.traveled.push(k);
      moved.add(m.f.id);
      m.i++;
      if (m.i >= m.steps.length) m.done = true;
    }

    // Contact: entering a hex next to the enemy ends the move, judged after the instant
    // so both sides of a new contact see each other.
    const after = new Map<HexKey, NationId[]>();
    for (const id of sortedKeys(world.formations)) {
      const o = world.formations[id]!;
      if (UNITS[o.unitClass].ground) after.set(o.key, [...(after.get(o.key) ?? []), o.owner]);
    }
    const hostileNear = (f: Formation) =>
      neighborKeys(f.key).some((k) => (after.get(k) ?? []).some((owner) => rel(f.owner, owner) === 'war'));
    for (const m of group) {
      if (m.done || m.halted || m.ignoresContact) continue;
      if (hostileNear(m.f)) {
        m.halted = 'contact';
        m.done = true;
      }
    }
  }

  for (const m of movers) {
    events.push({
      kind: 'movement',
      formation: m.f.id,
      owner: m.f.owner,
      unitClass: m.f.unitClass,
      path: m.traveled,
      halted: m.traveled.length < m.steps.length ? m.halted : null,
    });
  }

  // Air rebasing.
  for (const nation of sortedKeys(orders)) {
    for (const id of sortedKeys(orders[nation]!.formations)) {
      const order = orders[nation]!.formations[id]!;
      const f = world.formations[id];
      if (!f || UNITS[f.unitClass].ground || order.type !== 'move') continue;
      const dest = order.path[0]!;
      const siteId = world.tiles[dest]?.siteId;
      const there = Object.values(world.formations).filter((o) => o.key === dest);
      const room = there.length < STACK_LIMIT;
      // The base may have been overrun during movement.
      const overrun = there.some((o) => rel(f.owner, o.owner) !== 'alliance');
      if (overrun) events.push({ kind: 'movement', formation: id, owner: f.owner, unitClass: f.unitClass, path: [], halted: 'enemy' });
      else if (!room) events.push({ kind: 'movement', formation: id, owner: f.owner, unitClass: f.unitClass, path: [], halted: 'stacking' });
      else if (siteId && world.sites[siteId]!.owner === f.owner) {
        f.key = dest;
        moved.add(id);
        events.push({ kind: 'movement', formation: id, owner: f.owner, unitClass: f.unitClass, path: [dest], halted: null });
      }
    }
  }

  meetings.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return { events, meetings, moved };
}
