import { describe, expect, it } from 'vitest';
import { slotOffsets } from './counters';

describe('slotOffsets', () => {
  it('gives a slot to every unit in a hex, however many share it', () => {
    // A port holds three land units and three ships; passengers ride along in a replay.
    for (let n = 1; n <= 9; n++) {
      const slots = slotOffsets(n);
      expect(slots, `${n}`).toHaveLength(n);
      for (const s of slots) expect(Number.isFinite(s.x) && Number.isFinite(s.y) && s.scale > 0).toBe(true);
    }
  });
});
