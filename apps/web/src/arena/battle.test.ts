import { describe, expect, it } from 'vitest';
import type { Contact, Formation, NationView, UnitClass } from '@brink/contracts';
import { createPacificScenario } from '@brink/scenarios';
import { buildView } from '@brink/simulation';
import { battleFor, supportFor } from './battle';

// The war map around a battle is what it brings: ships offshore, carriers and air wings, drones.

function scene(): NationView {
  const view = buildView(createPacificScenario(1), 'japan');
  const template = Object.values(view.formations)[0]!;
  const own = (id: string, unitClass: UnitClass, key: string, aboard?: string): Formation => ({ ...template, id, name: id, unitClass, key, ...(aboard ? { aboard } : {}) });
  const foe = (formation: string, unitClass: UnitClass, key: string, confirmed = true): Contact => ({ formation, owner: 'china', unitClass, key, estimatedStrength: 800, confirmed, lastSeen: view.turn });
  view.relations = { ...view.relations, china: 'war' };
  view.formations = Object.fromEntries(
    [
      own('inf', 'infantry', '10,11'),
      own('fleet1', 'fleet', '11,10'),
      own('fleetFar', 'fleet', '14,10'),
      own('cv', 'carrier', '13,10'),
      own('wingAboard', 'air', '13,10', 'cv'),
      own('wing', 'air', '12,10'),
      own('wingFar', 'air', '20,10'),
      own('uav', 'drone', '12,10'),
      own('lift', 'transport', '11,9'),
      own('marines', 'infantry', '11,9', 'lift'),
    ].map((f) => [f.id, f]),
  );
  view.contacts = Object.fromEntries(
    [foe('garrison', 'infantry', '10,10'), foe('redAir', 'air', '10,10'), foe('redFleet', 'fleet', '9,10'), foe('redJets', 'air', '8,10'), foe('ghost', 'drone', '9,9', false)].map((c) => [c.formation, c]),
  );
  return view;
}

describe('supportFor', () => {
  it('adds what research and nearby airbases and missile batteries bring', () => {
    const view = scene();
    const base = supportFor(view, '10,10', ['inf']);
    view.self.research = { ...view.self.research, unlocked: [...view.self.research.unlocked, 'air_mobility', 'loitering_munitions'].sort() };
    const site = Object.values(view.sites).find((x) => x.owner === 'japan')!;
    site.key = '11,11';
    site.facilities = ['missile_battery'];
    const s = supportFor(view, '10,10', ['inf']);
    const of = (list: typeof s.blue, id: string) => list.find((x) => x.id === id)?.missions ?? 0;
    expect(of(s.blue, 'strike_jet')).toBe(of(base.blue, 'strike_jet') + 1);
    expect(of(s.blue, 'kamikaze')).toBe(of(base.blue, 'kamikaze') + 1);
    expect(of(s.blue, 'cruise_missile')).toBe(of(base.blue, 'cruise_missile') + 1);
    expect(s.red).toEqual(base.red);
  });

  it('counts fleets, carriers, wings in range or on a deck nearby, and drones, for both sides', () => {
    const s = supportFor(scene(), '10,10', ['inf']);
    expect(s.blue).toEqual([
      { id: 'naval_gun', missions: 2 },
      { id: 'cruise_missile', missions: 1 },
      // The carrier's two, the wing on its deck, the wing ashore in range; not the one far away.
      { id: 'strike_jet', missions: 4 },
      { id: 'kamikaze', missions: 1 },
    ]);
    // Red: the fleet offshore and the jets nearby; the garrison's own aircraft and a stale sighting do not count.
    expect(s.red).toEqual([
      { id: 'naval_gun', missions: 2 },
      { id: 'cruise_missile', missions: 1 },
      { id: 'strike_jet', missions: 1 },
    ]);
  });

  it('does not count a formation that fights in the battle itself', () => {
    const s = supportFor(scene(), '10,10', ['wing', 'uav']);
    expect(s.blue.find((x) => x.id === 'strike_jet')?.missions).toBe(3);
    expect(s.blue.find((x) => x.id === 'kamikaze')).toBeUndefined();
  });

  it('rides into the battle setup', () => {
    const req = battleFor(scene(), '10,10', { inf: { type: 'attack', target: '10,10', path: [] } })!;
    expect(req.setup.support?.map((x) => x.id)).toEqual(['naval_gun', 'cruise_missile', 'strike_jet', 'kamikaze']);
    expect(req.setup.redSupport?.map((x) => x.id)).toEqual(['naval_gun', 'cruise_missile', 'strike_jet']);
  });

  it('adds what doctrine cards bring: played this turn, or still in force from an earlier one', () => {
    const view = scene();
    const orders = { inf: { type: 'attack' as const, target: '10,10', path: [] } };
    const jets = (req: ReturnType<typeof battleFor>) => req!.setup.support?.find((x) => x.id === 'strike_jet')?.missions;
    const kamikaze = (req: ReturnType<typeof battleFor>) => req!.setup.support?.find((x) => x.id === 'kamikaze')?.missions;
    expect(jets(battleFor(view, '10,10', orders))).toBe(4);
    expect(jets(battleFor(view, '10,10', orders, [{ card: 'air_superiority' }]))).toBe(6);
    expect(kamikaze(battleFor(view, '10,10', orders, [{ card: 'kamikaze_swarm' }]))).toBe(3);
    // A Kamikaze Swarm played on an earlier turn and lasting through this one.
    view.self.doctrine = { cp: 0, hand: [], deck: [], discard: [], effects: [{ card: 'kamikaze_swarm', from: view.turn - 1, until: view.turn }] };
    expect(kamikaze(battleFor(view, '10,10', orders))).toBe(3);
    view.self.doctrine.effects[0]!.until = view.turn - 1;
    expect(kamikaze(battleFor(view, '10,10', orders))).toBe(1);
    // Red never gets blue's cards.
    expect(battleFor(view, '10,10', orders, [{ card: 'air_superiority' }])!.setup.redSupport?.find((x) => x.id === 'strike_jet')?.missions).toBe(1);
  });
});
