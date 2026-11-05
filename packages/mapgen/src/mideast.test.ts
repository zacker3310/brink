import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMap } from '@brink/map';
import { mapToJson } from './grid';
import { mideastMap } from './mideast';

describe('the Middle East and Africa map', () => {
  it('is valid, and the committed file is what its grid writes, byte for byte', () => {
    const map = mideastMap();
    expect(validateMap(map)).toEqual([]);
    const committed = readFileSync(new URL('../../scenarios/src/maps/mideast.map.json', import.meta.url), 'utf8');
    expect(mapToJson(map)).toBe(committed);
  });

  it('keeps the grid square-ish and the owner layer the grid itself: one character a hex', () => {
    const map = mideastMap();
    expect([map.cols, map.rows]).toEqual([44, 44]);
    for (const row of map.layers.owner.rows) expect(row).toHaveLength(44);
    expect(map.layers.owner.legend['+']).toBeNull();
    expect(map.layers.owner.legend['~']).toBeNull();
  });
});
