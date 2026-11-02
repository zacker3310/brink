import { describe, expect, it } from 'vitest';
import { UNITS } from '@brink/game-data';
import { createPacificScenario } from '@brink/scenarios';
import { buildView } from '@brink/simulation';
import { fleetLoadOrders } from './planning';

describe('fleetLoadOrders', () => {
  // Japan's transports, emptied in Tokyo harbour: the marines stand in the port, the ships lie off it.
  const world = createPacificScenario(1);
  const tokyo = world.sites['japan-capital']!.key;
  for (const f of Object.values(world.formations)) {
    if (f.owner !== 'japan' || !f.aboard) continue;
    if (UNITS[world.formations[f.aboard]!.unitClass].carries !== 'ground') continue;
    delete f.aboard;
    f.key = tokyo;
  }
  const view = buildView(world, 'japan');
  const ships = Object.values(view.formations).filter((f) => UNITS[f.unitClass].carries === 'ground');

  it('fills every transport alongside in one go, fighting troops first, never past capacity', () => {
    const orders = fleetLoadOrders(view, {});
    const per = new Map<string, number>();
    for (const o of Object.values(orders)) if (o.type === 'embark') per.set(o.carrier, (per.get(o.carrier) ?? 0) + 1);
    expect(ships.length).toBe(2);
    for (const s of ships) expect(per.get(s.id), s.id).toBe(UNITS[s.unitClass].capacity);
    for (const id of Object.keys(orders)) expect(UNITS[view.formations[id]!.unitClass].ground).toBe(true);
  });

  it('lets the staff plan give way, never the player\'s own orders', () => {
    const all = fleetLoadOrders(view, {});
    const [mine, staff] = Object.keys(all);
    // Both have a move drafted; only the staff's is listed as replaceable.
    const next = fleetLoadOrders(view, { [mine!]: { type: 'move', path: [] }, [staff!]: { type: 'move', path: [] } }, [staff!]);
    expect(next[mine!]).toBeUndefined();
    expect(next[staff!]).toEqual(all[staff!]);
  });
});
