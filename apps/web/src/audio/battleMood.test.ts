import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '@brink/arena/v2';
import { COOLING, feedMood, moodIntensity, nearness, newMood } from './battleMood';

const units = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, side: 'blue' as const, alive: true })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, side: 'red' as const, alive: true })),
];
const fire = (): BattleEvent =>
  ({ type: 'fire', unit: 'b0', weapon: 'w', kind: 'gun', calibre: '120', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, target: 'r0', hit: true, chance: 50, overwatch: false, seen: true, shooterSeen: true }) as unknown as BattleEvent;
const destroyed = (unit: string): BattleEvent => ({ type: 'destroyed', unit, how: 'destroyed', x: 0, y: 0, seen: true });

describe('battle mood', () => {
  it('starts quiet, rises on contact and with the shooting, cools after', () => {
    const m = newMood(units, 0);
    const before = moodIntensity(m, 0);
    expect(before).toBeLessThan(0.15);
    feedMood(m, Array.from({ length: 10 }, fire), 1);
    const hot = moodIntensity(m, 1);
    expect(hot).toBeGreaterThan(0.45);
    const cooled = moodIntensity(m, 1 + COOLING * 4);
    expect(cooled).toBeLessThan(hot);
    // Contact made stays made: never back to the quiet before it.
    expect(cooled).toBeGreaterThanOrEqual(0.3);
  });

  it('a side worn down has the battle nearly decided, whichever side it is', () => {
    const red = newMood(units, 0);
    feedMood(red, ['r0', 'r1', 'r2', 'r3'].map(destroyed), 0);
    expect(nearness(red)).toBe(1);
    expect(moodIntensity(red, 30)).toBeGreaterThanOrEqual(0.9);
    const blue = newMood(units, 0);
    feedMood(blue, ['b0', 'b1', 'b2'].map(destroyed), 0);
    expect(nearness(blue)).toBeGreaterThan(0);
    expect(moodIntensity(blue, 30)).toBeGreaterThanOrEqual(0.7);
    const even = newMood(units, 0);
    feedMood(even, [destroyed('b0'), destroyed('r0')], 0);
    expect(nearness(even)).toBe(0);
  });

  it('holding the zone is near a win; letting it go is not', () => {
    const m = newMood(units, 0);
    feedMood(m, [{ type: 'turn', side: 'red', round: 1 }, { type: 'capture', rounds: 1 }, { type: 'turn', side: 'blue', round: 2 }], 0);
    expect(m.capture).toBe(1);
    expect(nearness(m)).toBeGreaterThanOrEqual(0.8);
    feedMood(m, [{ type: 'turn', side: 'red', round: 2 }, { type: 'turn', side: 'blue', round: 3 }], 1);
    expect(m.capture).toBe(0);
    expect(nearness(m)).toBe(0);
  });

  it('split units keep their side; an ended battle settles', () => {
    const m = newMood(units, 0);
    feedMood(m, [{ type: 'split', unit: 'r0', into: ['r0a', 'r0b'] }, destroyed('r0a')], 0);
    expect(m.lost.red).toBe(1);
    m.ended = 'won';
    expect(moodIntensity(m, 0)).toBeLessThan(0.2);
  });

  it('units dead from the start count as lost already', () => {
    const m = newMood([...units, { id: 'r9', side: 'red', alive: false }], 0);
    expect(m.start.red).toBe(6);
    expect(m.lost.red).toBe(1);
  });
});
