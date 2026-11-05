import { describe, expect, it } from 'vitest';
import { INDOPAC_ID, INDOPAC_NATIONS } from '@brink/scenarios';
import { GameSession } from './session';

// The Indo-Pacific South, played: five AI powers and fifteen minor states on 52 x 36 hexes, an
// archipelago war. The long run is the soak (tests/soak/indopac.soak.test.ts); this keeps a short one
// in the unit suite.

describe('the Indo-Pacific South, AI against AI', () => {
  it('plays eight turns with no rejected order, and the war moves', { timeout: 300_000 }, () => {
    const s = GameSession.create(INDOPAC_ID, 4, null);
    let rejected = 0;
    let moves = 0;
    for (let t = 0; t < 8 && !s.over; t++) {
      const r = s.advance();
      rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
      moves += r.events.filter((e) => e.kind === 'movement').length;
    }
    expect(s.turn).toBe(9);
    expect(rejected).toBe(0);
    expect(moves).toBeGreaterThan(50);
  });

  it('opens a campaign for each of its powers, with the classic war and no Pacific crisis', () => {
    for (const n of INDOPAC_NATIONS) {
      const s = GameSession.create(INDOPAC_ID, 2, n.id, [], { difficulty: 'easy' });
      expect(s.snapshot().scenarioId).toBe(INDOPAC_ID);
      expect(s.snapshot().crisis).toBeUndefined();
    }
    // The Pacific's crises edit the Pacific's map: asked for here, the campaign is refused.
    expect(() => GameSession.create(INDOPAC_ID, 2, 'india', [], { crisis: 'cold-peace' })).toThrow(/not one of indopac/);
  });
});
