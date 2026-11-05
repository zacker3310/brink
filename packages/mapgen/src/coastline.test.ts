import { describe, expect, it } from 'vitest';
import { validateMap } from '@brink/map';
import { bakeLand, hexAt, hexCentre, inPolygon, type Polygon, polygonsOf, syntheticCoastline } from './coastline';
import { generateTheatre } from './theatre';

const BOX = { west: 0, east: 100, south: 0, north: 50 };
const square = (w: number, s: number, e: number, n: number): Polygon => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ],
];

describe('coastlines to hexes', () => {
  it('tests points against a polygon with a hole', () => {
    const lake: Polygon = [square(0, 0, 10, 10)[0]!, square(4, 4, 6, 6)[0]!];
    expect(inPolygon([2, 2], lake)).toBe(true);
    expect(inPolygon([5, 5], lake)).toBe(false);
    expect(inPolygon([12, 5], lake)).toBe(false);
  });

  it('finds the hex under a point, the inverse of a hex centre', () => {
    const grid = { cols: 20, rows: 10 };
    for (const [c, r] of [[0, 0], [7, 3], [19, 9], [4, 8]] as const) expect(hexAt(BOX, grid, hexCentre(BOX, grid, c, r))).toEqual([c, r]);
    expect(hexAt(BOX, grid, [-5, 25])).toBeNull();
  });

  it('bakes the land: a continent on the west half, sea on the east', () => {
    const grid = { cols: 20, rows: 10 };
    const mask = bakeLand([square(-1, -1, 50, 51)], BOX, grid);
    for (let r = 0; r < 10; r++) {
      expect(mask[r]![2], `row ${r}`).toBe(true);
      expect(mask[r]![15], `row ${r}`).toBe(false);
    }
  });

  it('keeps an island too small to win a hex', () => {
    const grid = { cols: 20, rows: 10 };
    const islet = square(71, 21, 71.5, 21.5);
    expect(bakeLand([islet], BOX, grid, { keepIslands: false }).flat().filter(Boolean)).toHaveLength(0);
    const mask = bakeLand([islet], BOX, grid);
    expect(mask.flat().filter(Boolean)).toHaveLength(1);
    const at = hexAt(BOX, grid, [71.25, 21.25])!;
    expect(mask[at[1]]![at[0]]).toBe(true);
  });

  it('reads Natural Earth style GeoJSON: features of Polygons and MultiPolygons', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: square(0, 0, 1, 1) } },
        { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [square(2, 2, 3, 3), square(4, 4, 5, 5)] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      ],
    };
    expect(polygonsOf(fc)).toHaveLength(3);
  });

  it('makes the same synthetic coastline for the same seed, and another for another', () => {
    expect(syntheticCoastline(3, BOX, 4)).toEqual(syntheticCoastline(3, BOX, 4));
    expect(syntheticCoastline(3, BOX, 4)).not.toEqual(syntheticCoastline(4, BOX, 4));
  });
});

describe('generateTheatre', () => {
  const nation = (i: number) => ({ id: `n${i}`, name: `Nation ${i}`, short: `N${i}`, color: '#123456', government: 'union' as const });

  it('turns a synthetic coastline into a valid map, from 2 powers to 12', () => {
    for (const [powers, minors, cols, rows] of [
      [2, 1, 32, 16],
      [12, 4, 96, 48],
    ] as const) {
      const box = { west: 0, east: 200, south: -60, north: 60 };
      const map = generateTheatre({
        id: 'synthetic',
        name: 'Synthetic',
        source: 'test',
        seed: 11,
        cols,
        rows,
        box,
        coastline: syntheticCoastline(11, box, 6),
        powers: Array.from({ length: powers }, (_, i) => nation(i)),
        minors: Array.from({ length: minors }, (_, i) => nation(100 + i)),
      });
      expect(validateMap(map), `${powers} powers`).toEqual([]);
      expect(map.nations.filter((n) => n.role === 'power')).toHaveLength(powers);
      expect(map.layers.owner.rows).toHaveLength(rows);
    }
  });
});
