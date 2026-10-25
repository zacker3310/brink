import { describe, expect, it } from 'vitest';
import { hexKey, keyDistance } from '@brink/map';
import { buildView } from './fog';
import { makeWorld, setRelation, unit } from './fixture.test-util';
import { threatZones } from './threat';

const k = hexKey;

describe('threat zones', () => {
  it('marks where a seen enemy could assault or strike next turn, and nothing it could not', () => {
    const w = makeWorld(12, 8, ['a', 'b']);
    unit(w, 'a1', 'a', 'recon', k(4, 4));
    unit(w, 'b1', 'b', 'infantry', k(6, 4));
    unit(w, 'b2', 'b', 'artillery', k(7, 2));
    const view = buildView(w, 'a');
    const zones = threatZones(view);
    // Infantry: everything it can reach plus one hex to assault.
    expect(zones.get(k(5, 4))).toBeGreaterThanOrEqual(1);
    expect(zones.has(k(6, 4))).toBe(true);
    // Artillery: its strike radius, from where it stands.
    expect(zones.get(k(7, 4))).toBeGreaterThanOrEqual(2);
    // Far away: safe.
    expect(zones.has(k(0, 0))).toBe(false);
    for (const key of zones.keys()) expect(Math.min(keyDistance(key, k(6, 4)), keyDistance(key, k(7, 2)))).toBeLessThanOrEqual(5);
  });

  it('can be narrowed to particular contacts', () => {
    const w = makeWorld(12, 8, ['a', 'b']);
    unit(w, 'a1', 'a', 'recon', k(4, 4));
    unit(w, 'b1', 'b', 'infantry', k(6, 4));
    unit(w, 'b2', 'b', 'artillery', k(7, 2));
    const view = buildView(w, 'a');
    const art = threatZones(view, new Set(['b2']));
    expect(art.has(k(7, 4))).toBe(true);
    expect(art.has(k(5, 5))).toBe(false);
    expect([...art.values()].every((n) => n === 1)).toBe(true);
  });

  it('ignores nations at peace and contacts it cannot see', () => {
    const w = makeWorld(12, 8, ['a', 'b']);
    setRelation(w, 'a', 'b', 'peace');
    unit(w, 'a1', 'a', 'recon', k(4, 4));
    unit(w, 'b1', 'b', 'infantry', k(6, 4));
    expect(threatZones(buildView(w, 'a')).size).toBe(0);
    const unseen = makeWorld(12, 8, ['a', 'b']);
    unit(unseen, 'b1', 'b', 'infantry', k(11, 7));
    expect(threatZones(buildView(unseen, 'a')).size).toBe(0);
  });
});
