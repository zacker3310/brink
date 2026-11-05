import { describe, expect, it } from 'vitest';
import { hashState } from '@brink/simulation';
import { createScenario } from './index';
import { PACIFIC_ID } from './pacific';

/**
 * The Pacific's turn-1 world, hashed, for seeds 1 to 20, as the inline character grid built it
 * (int-staff 3af72e8). Loading the theatre from `maps/pacific.map.json` must build the very same
 * world, so no saved or replayed campaign can tell the difference. A change to the Pacific's ground
 * or its opening is a ruleset change: bump RULESET_VERSION and re-pin these.
 */
const PINNED: readonly (readonly [seed: number, hash: string])[] = [
  [1, 'b50d718b0b54a52c'],
  [2, '5eb765b759c2827e'],
  [3, 'b819a2396b105676'],
  [4, 'be3f9bfeb57042ad'],
  [5, '48727d3e3d535ea3'],
  [6, 'b804d57b59b69afe'],
  [7, '8b5b28a331069f48'],
  [8, '774bee6c4ad73ffb'],
  [9, 'd9dad1773dd6cfb8'],
  [10, 'a463281f6e490dba'],
  [11, '74114195c703a7d6'],
  [12, 'e105e9e8e31a51e3'],
  [13, '51a4c6160f4d8b2b'],
  [14, '77087ca22ed21fb5'],
  [15, '3f00a7cc1c874a81'],
  [16, '5c4467879e69f58a'],
  [17, 'c2d6f7ccfda7bcf9'],
  [18, '0136fd6444a38e1b'],
  [19, '28213d81064060ae'],
  [20, 'fbb236a5847b3b6e'],
];

describe('the Pacific from its map file', () => {
  it('builds the same turn-1 world as the inline grid did, seed for seed', () => {
    for (const [seed, hash] of PINNED) expect(hashState(createScenario(PACIFIC_ID, seed)), `seed ${seed}`).toBe(hash);
  });
});
