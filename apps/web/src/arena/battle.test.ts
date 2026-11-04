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
});
