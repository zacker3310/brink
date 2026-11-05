import { describe, expect, it } from 'vitest';
import { hashState } from '@brink/simulation';
import { createScenario } from './index';
import { PACIFIC_ID } from './pacific';

/**
 * The Pacific's turn-1 world, hashed, for seeds 1 to 20, as the inline character grid built it
 * (int-staff 3af72e8), re-pinned for ruleset 2.10.0 (diplomacy; the same map and opening: with the version set back to
 * 2.9.0 every hash is the 2.9.0 one). Loading the theatre from `maps/pacific.map.json` must build the very same
 * world, so no saved or replayed campaign can tell the difference. A change to the Pacific's ground
 * or its opening is a ruleset change: bump RULESET_VERSION and re-pin these.
 */
const PINNED: readonly (readonly [seed: number, hash: string])[] = [
  [1, 'cc9c74582929d7cd'],
  [2, '2d57d8ba970ab345'],
  [3, 'ccf1b74289f10f3b'],
  [4, '6ee828d5b4b37504'],
  [5, 'bb0ba37b41fe6f48'],
  [6, '537b801a50d4396d'],
  [7, '1e386994ebff22e9'],
  [8, '1cf345dbb4e97e76'],
  [9, 'ba058acc67c2fae9'],
  [10, '9bbb80eae198399d'],
  [11, '501e596240f529b3'],
  [12, '6aa362e32a36ab12'],
  [13, 'f55fc723d94f23e8'],
  [14, 'd5fad7cdd5972e48'],
  [15, '77138a05ad126186'],
  [16, '1261315ec6dbe211'],
  [17, '68624041bee5ff76'],
  [18, '46f4a70f714ad102'],
  [19, 'aa266f4a84a3a857'],
  [20, '5912d65e40aab82b'],
];

describe('the Pacific from its map file', () => {
  it('builds the same turn-1 world as the inline grid did, seed for seed', () => {
    for (const [seed, hash] of PINNED) expect(hashState(createScenario(PACIFIC_ID, seed)), `seed ${seed}`).toBe(hash);
  });
});
