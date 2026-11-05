import { describe, expect, it } from 'vitest';
import { hashState } from '@brink/simulation';
import { createScenario } from './index';
import { PACIFIC_ID } from './pacific';

/**
 * The Pacific's turn-1 world, hashed, for seeds 1 to 20, as the inline character grid built it
 * (int-staff 3af72e8), re-pinned for ruleset 2.12.0: the Black Files merged with diplomacy, airborne
 * warfare and right of passage. Those merges left `maps/pacific.map.json` and `pacific.ts` untouched
 * (`git diff c99e404 -- packages/scenarios/src/maps/pacific.map.json packages/scenarios/src/pacific.ts`
 * is empty), and `build.ts` gained only a site's optional `anomaly`, which no Pacific site has; the
 * Black Files are seeded into a Pacific campaign only by its setup toggle, after this world is built.
 * So every pin moved with the version stamp alone. Loading the theatre from `maps/pacific.map.json`
 * must build the very same world, so no saved or replayed campaign can tell the difference. A change
 * to the Pacific's ground or its opening is a ruleset change: bump RULESET_VERSION and re-pin these.
 */
const PINNED: readonly (readonly [seed: number, hash: string])[] = [
  [1, '044068a6af7faa53'],
  [2, '8df42f1443699e07'],
  [3, 'b2cd36fc6286adcd'],
  [4, '60c38e4fd26b1fce'],
  [5, '90a9f805a2d27bb2'],
  [6, 'ab65243872ca6643'],
  [7, '463861da5781edf7'],
  [8, '05b15ba5e2513858'],
  [9, '0e16909e321766d3'],
  [10, 'b20dd6e0250055c3'],
  [11, 'c67b9bfca0b882bd'],
  [12, '8f94d305ca5a92b4'],
  [13, '082b62a5e7d05f92'],
  [14, '5d962b4337f7d75e'],
  [15, '2b75945305f6294c'],
  [16, '26cb2f54493706b7'],
  [17, '0443ca5379cf3d60'],
  [18, '1f8e59e18c29ab44'],
  [19, '6cb4ed54bccd32f9'],
  [20, '8e5c10d40ecc1151'],
];

describe('the Pacific from its map file', () => {
  it('builds the same turn-1 world as the inline grid did, seed for seed', () => {
    // The world as built, version stamp and all: no stamp is put back.
    for (const [seed, hash] of PINNED) expect(hashState(createScenario(PACIFIC_ID, seed)), `seed ${seed}`).toBe(hash);
  });

  it('carries no Black Files of its own: they come only with the setup toggle', () => {
    for (const [seed] of PINNED.slice(0, 3)) {
      const w = createScenario(PACIFIC_ID, seed);
      expect(w.blackFiles).toBeUndefined();
      expect(Object.values(w.sites).some((s) => s.anomaly)).toBe(false);
    }
  });
});
