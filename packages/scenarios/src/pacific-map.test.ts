import { describe, expect, it } from 'vitest';
import { hashState } from '@brink/simulation';
import { createScenario } from './index';
import { PACIFIC_ID } from './pacific';

/**
 * The Pacific's turn-1 world, hashed, for seeds 1 to 20, as the inline character grid built it
 * (int-staff 3af72e8), re-pinned for ruleset 2.13.0: the four new theatres (Europe, the Middle East and
 * Africa, the Indo-Pacific South, the Americas) merged onto the Black Files, with victory bars that
 * scale with a map's powers. Only the version stamp moved: every 2.13.0 world here, its stamp set back
 * to '2.12.0', hashes to the 2.12.0 pin for its seed (all twenty checked when these were re-pinned). The
 * Pacific's four powers keep `VICTORY`'s bars exactly, and a world of four powers carries no
 * `barPowers`; Canada and Mexico, minor states here, field no deck or generals at turn 1. Loading the
 * theatre from `maps/pacific.map.json` must build the very same world, so no saved or replayed campaign
 * can tell the difference. A change to the Pacific's ground or its opening is a ruleset change: bump
 * RULESET_VERSION and re-pin these.
 */
const PINNED: readonly (readonly [seed: number, hash: string])[] = [
  [1, 'c29d62a390dbc0d6'],
  [2, '4d748c971ecf6ac4'],
  [3, 'a84c29f1a58655b8'],
  [4, '327a3aa6f4bf1957'],
  [5, '97e9727e833b0039'],
  [6, '2106b643fd28d438'],
  [7, '217284a3e713565e'],
  [8, 'e9451f8cc9fb6e81'],
  [9, '9df8f40f8ccd8112'],
  [10, '793d18578e93ff2c'],
  [11, '9879fcdd28f513dc'],
  [12, '3569cb08cf987b01'],
  [13, '8039424e3a5fd1b9'],
  [14, 'c82bbe22a1b11f0f'],
  [15, '2ba39b84e2a3e13b'],
  [16, '7280942fa366acfc'],
  [17, '1652352ced122ae7'],
  [18, 'f0a25c5c1c71ff09'],
  [19, '955759816a78604c'],
  [20, '23504605f15cc0b0'],
];

describe('the Pacific from its map file', () => {
  it('builds the same turn-1 world as the inline grid did, seed for seed', () => {
    // The world as built, version stamp and all: no stamp is put back. Twenty worlds built and
    // hashed take seconds on a loaded runner beside the other theatres' tests: the budget changes
    // nothing the test asserts.
    for (const [seed, hash] of PINNED) expect(hashState(createScenario(PACIFIC_ID, seed)), `seed ${seed}`).toBe(hash);
  }, 60_000);

  it('carries no Black Files of its own: they come only with the setup toggle', () => {
    for (const [seed] of PINNED.slice(0, 3)) {
      const w = createScenario(PACIFIC_ID, seed);
      expect(w.blackFiles).toBeUndefined();
      expect(Object.values(w.sites).some((s) => s.anomaly)).toBe(false);
    }
  });
});
