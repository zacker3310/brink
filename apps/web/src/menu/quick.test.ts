import { describe, expect, it } from 'vitest';
import { quickPick } from './quick';

describe('quickPick', () => {
  it('opens on First Blood for a new commander', () => {
    expect(quickPick({ stars: 0, best: {} }).id).toBe('first-blood');
  });
  it('moves on to the easiest open battle with the fewest stars on it', () => {
    expect(quickPick({ stars: 3, best: { 'first-blood': 3 } }).id).toBe('bank-shot');
    expect(quickPick({ stars: 5, best: { 'first-blood': 3, 'bank-shot': 1 } }).id).toBe('desert-raid');
  });
  it('never offers a battle the stars have not opened', () => {
    const s = quickPick({ stars: 2, best: { 'first-blood': 3, 'bank-shot': 3 } });
    expect(s.stars).toBeLessThanOrEqual(2);
  });
});
