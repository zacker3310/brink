import { describe, expect, it } from 'vitest';
import {
  areAdjacent,
  axialToOffset,
  distance,
  hexKey,
  hexToPixel,
  neighborKeys,
  offsetToAxial,
  parseKey,
  pixelToHex,
  range,
  roundAxial,
} from './hex';

describe('hex math', () => {
  it('round-trips keys, including negative and zero coordinates', () => {
    for (const [q, r] of [[0, 0], [-3, 7], [12, -5], [-0, -0]] as const) {
      expect(parseKey(hexKey(q, r))).toEqual({ q: q === 0 ? 0 : q, r: r === 0 ? 0 : r });
    }
    expect(hexKey(-0, 0)).toBe('0,0');
  });

  it('rejects malformed keys', () => {
    expect(() => parseKey('nope')).toThrow();
    expect(() => parseKey('1.5,2')).toThrow();
  });

  it('measures distance symmetrically', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(distance({ q: 3, r: -1 }, { q: 0, r: 0 })).toBe(3);
    expect(distance({ q: -2, r: 4 }, { q: 2, r: -1 })).toBe(5);
  });

  it('has six distinct adjacent neighbors', () => {
    const n = neighborKeys('2,3');
    expect(new Set(n).size).toBe(6);
    for (const k of n) expect(areAdjacent('2,3', k)).toBe(true);
  });

  it('counts hexes in a range', () => {
    expect(range({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(range({ q: 0, r: 0 }, 1)).toHaveLength(7);
    expect(range({ q: 5, r: 5 }, 3)).toHaveLength(37);
  });

  it('round-trips offset coordinates', () => {
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        expect(axialToOffset(offsetToAxial(col, row))).toEqual({ col, row });
      }
    }
  });

  it('round-trips pixel conversion at hex centers and near-center points', () => {
    for (const a of range({ q: 0, r: 0 }, 4)) {
      const p = hexToPixel(a, 30);
      expect(pixelToHex(p, 30)).toEqual(roundAxial(a.q, a.r));
      expect(pixelToHex({ x: p.x + 8, y: p.y - 8 }, 30)).toEqual(roundAxial(a.q, a.r));
    }
  });
});
