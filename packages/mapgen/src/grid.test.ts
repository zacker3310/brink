import { describe, expect, it } from 'vitest';
import { validateMap } from '@brink/map';
import { gridToMap, mapToJson } from './grid';

describe('gridToMap', () => {
  const map = gridToMap({
    id: 'strip',
    name: 'Strip',
    grid: ['AA.BB', 'AA.BB'],
    sea: '.',
    regions: { A: 'a', B: 'b' },
    nations: [
      { id: 'a', name: 'A', short: 'A', color: '#000000', government: 'union', role: 'power', capital: 'a-capital' },
      { id: 'b', name: 'B', short: 'B', color: '#ffffff', government: 'union', role: 'power', capital: 'b-capital' },
    ],
    sites: [
      { id: 'a-capital', kind: 'capital', name: 'Acity', at: [0, 0], owner: 'a' },
      { id: 'b-capital', kind: 'capital', name: 'Bcity', at: [4, 1], owner: 'b' },
    ],
    terrain: (col) => (col === 1 ? 'hills' : 'seeded'),
    seaZones: { zones: [{ id: 'gap', name: 'The Gap' }], at: () => 'gap' },
    biome: () => 'temperate',
  });

  it('keeps the grid as the owner layer and derives the others', () => {
    expect(map.layers.owner.rows).toEqual(['AA.BB', 'AA.BB']);
    expect(map.layers.owner.legend).toEqual({ '.': null, A: 'a', B: 'b' });
    expect(map.layers.terrain.rows).toEqual(['*h~**', '*h~**']);
    expect(map.layers.seaZone!.rows).toEqual(['--a--', '--a--']);
    expect(map.layers.biome!.rows).toEqual(['mm~mm', 'mm~mm']);
    expect(validateMap(map)).toEqual([]);
  });

  it('writes JSON that reads back as the same map, a cell to a line', () => {
    const text = mapToJson(map);
    expect(JSON.parse(text)).toEqual(map);
    expect(text).toContain('"at": [0, 0]');
  });

  it('refuses a character that is neither sea nor a region', () => {
    expect(() => gridToMap({ id: 'x', name: 'X', grid: ['A?'], sea: '.', regions: { A: 'a' }, nations: [], sites: [] })).toThrow(/"\?" is not a region/);
  });
});
