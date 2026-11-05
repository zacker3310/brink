import { describe, expect, it } from 'vitest';
import { hashState } from '@brink/simulation';
import { createScenario } from './index';
import { PACIFIC_ID } from './pacific';

/**
 * The Pacific's turn-1 world, hashed, for seeds 1 to 20, as the inline character grid built it
 * (int-staff 3af72e8), re-pinned for ruleset 2.11.0 (diplomacy merged with airborne warfare and right of passage:
 * `maps/pacific.map.json` and `pacific.ts` are unchanged by the merge, and only the version stamp moves each
 * hash). Loading the theatre from `maps/pacific.map.json` must build the very same
 * world, so no saved or replayed campaign can tell the difference. A change to the Pacific's ground
 * or its opening is a ruleset change: bump RULESET_VERSION and re-pin these.
 */
const PINNED: readonly (readonly [seed: number, hash: string])[] = [
  [1, '8aa0049db05f9548'],
  [2, '5e761c15afbd0b2a'],
  [3, '582d30dfba17b16e'],
  [4, 'd036e09cc7dbb49d'],
  [5, '252921d4a5d7715f'],
  [6, 'ff10896da53f301a'],
  [7, '0780625592743018'],
  [8, '98bc7e4a14482a27'],
  [9, 'e58c925563b2a190'],
  [10, '7d4547513f1f20b6'],
  [11, '0ba259d3013fa242'],
  [12, 'd79bcdd619034b0f'],
  [13, 'c7f53c644c723bf7'],
  [14, '19e5ea2cf8b79719'],
  [15, '0df7a27ef658ab2d'],
  [16, 'e5dac5e97b2d1466'],
  [17, '3d5268e210c28395'],
  [18, '0254f63a188c5017'],
  [19, 'f63f757fd2f84ec2'],
  [20, 'bddeaa4f8d83698a'],
];

describe('the Pacific from its map file', () => {
  it('builds the same turn-1 world as the inline grid did, seed for seed', () => {
    for (const [seed, hash] of PINNED) expect(hashState(createScenario(PACIFIC_ID, seed)), `seed ${seed}`).toBe(hash);
  });
});
