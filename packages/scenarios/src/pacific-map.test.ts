import { describe, expect, it } from 'vitest';
import { hashState } from '@brink/simulation';
import { createScenario } from './index';
import { PACIFIC_ID } from './pacific';

/**
 * The Pacific's turn-1 world, hashed, for seeds 1 to 20, as the inline character grid built it
 * (int-staff 3af72e8), re-pinned for ruleset 2.9.0 (balance: new data, the same map). Loading the theatre from `maps/pacific.map.json` must build the very same
 * world, so no saved or replayed campaign can tell the difference. A change to the Pacific's ground
 * or its opening is a ruleset change: bump RULESET_VERSION and re-pin these.
 */
const PINNED: readonly (readonly [seed: number, hash: string])[] = [
  [1, '3e9a08ceac4935f1'],
  [2, '6218feb46055ee99'],
  [3, 'db4ad404656ca7e3'],
  [4, 'fd31abc7bd1cdc94'],
  [5, 'd9b379c5a68f0bfc'],
  [6, '62d1c1b065dcd721'],
  [7, 'b02105dad29b8959'],
  [8, '8d75d5059546daea'],
  [9, 'af51f8e67ad2a991'],
  [10, '16d2f668b6a0c661'],
  [11, 'f24e3cb4325c1d37'],
  [12, '10a831655012bcd6'],
  [13, '548eb82de7d170cc'],
  [14, '0c72e9c3ab277b94'],
  [15, '1bae5fbba444d15a'],
  [16, '13b1f18ce6db8db5'],
  [17, '1a8853f39c1347ba'],
  [18, '0fdc1929ec78dee6'],
  [19, 'ff7ed1544eb6a883'],
  [20, '67073ff4fb710c5f'],
];

describe('the Pacific from its map file', () => {
  it('builds the same turn-1 world as the inline grid did, seed for seed', () => {
    for (const [seed, hash] of PINNED) expect(hashState(createScenario(PACIFIC_ID, seed)), `seed ${seed}`).toBe(hash);
    // Twenty worlds built and hashed: about 3 s alone, past the default 5 s beside the second
    // theatre's tests on a loaded runner. The budget changes nothing the test asserts.
  }, 60_000);
});
