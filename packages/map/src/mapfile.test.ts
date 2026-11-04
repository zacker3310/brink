import { describe, expect, it } from 'vitest';
import { cellKey, cellNeighbors, layerAt, MAP_VERSION, type MapFile, MapFormatError, parseMap, validateMap } from './mapfile';
import { keyOf, offsetToAxial } from './hex';

/** A small valid map: two powers and a minor on a 6 x 4 island chain. */
function tiny(): MapFile {
  return {
    format: 'brink-map',
    version: 1,
    id: 'tiny',
    name: 'Tiny',
    cols: 6,
    rows: 4,
    layout: 'odd-r',
    layers: {
      owner: { legend: { '.': null, A: 'alpha', B: 'beta', m: 'minor', '-': null }, rows: ['AA..BB', 'AA..BB', '-...mm', '......'] },
      terrain: { legend: { '~': 'water', '*': 'seeded', h: 'hills' }, rows: ['**~~**', '*h~~**', '*~~~**', '~~~~~~'] },
      seaZone: { legend: { '-': null, n: 'north', s: 'south' }, rows: ['--nn--', '--nn--', '-nss--', 'ssssss'] },
      biome: { legend: { '~': 'sea', t: 'temperate', d: 'desert' }, rows: ['tt~~dd', 'tt~~dd', 't~~~dd', '~~~~~~'] },
    },
    nations: [
      { id: 'alpha', name: 'Alpha', short: 'A', color: '#112233', government: 'union', role: 'power', capital: 'alpha-capital', terrainBias: 10 },
      { id: 'beta', name: 'Beta', short: 'B', color: '#445566', government: 'federation', role: 'power', capital: 'beta-capital' },
      { id: 'minor', name: 'Minoria', short: 'Min', color: '#778899', government: 'commonwealth', role: 'minor', capital: 'minor-capital' },
    ],
    sites: [
      { id: 'alpha-capital', kind: 'capital', name: 'Alphaville', at: [0, 0], owner: 'alpha' },
      { id: 'alpha-depot0', kind: 'depot', name: 'Outpost', at: [1, 1], owner: 'alpha', profile: 'outpost' },
      { id: 'beta-capital', kind: 'capital', name: 'Betatown', at: [5, 0], owner: 'beta', victoryPoints: 12 },
      { id: 'minor-capital', kind: 'capital', name: 'Minor City', at: [5, 2], owner: 'minor' },
    ],
    seaZones: [
      { id: 'north', name: 'North Sound' },
      { id: 'south', name: 'South Sea' },
    ],
    straits: [
      { id: 'narrows', name: 'The Narrows', kind: 'strait', hexes: [[2, 1]], joins: ['north', 'south'] },
      { id: 'causeway', name: 'Causeway', kind: 'land-bridge', hexes: [[0, 2]] },
    ],
    resources: [{ kind: 'oil', at: [4, 1], name: 'Beta field' }],
  };
}

const paths = (m: unknown) => validateMap(m).map((e) => e.path);
const messages = (m: unknown) => validateMap(m).map((e) => `${e.path}: ${e.message}`);

describe('the map format', () => {
  it('accepts a valid map and reads its layers', () => {
    const m = tiny();
    expect(validateMap(m)).toEqual([]);
    expect(parseMap(m)).toBe(m);
    expect(layerAt(m.layers.owner, 4, 0)).toBe('beta');
    expect(layerAt(m.layers.terrain, 1, 1)).toBe('hills');
    expect(cellKey([3, 1])).toBe(keyOf(offsetToAxial(3, 1)));
  });

  it('refuses what is not a map at all, without throwing', () => {
    for (const v of [null, 3, 'map', [], { format: 'brink-map' }]) expect(validateMap(v).length).toBeGreaterThan(0);
    expect(() => parseMap(null, 'x.json')).toThrow(MapFormatError);
  });

  it('names a wrong format, a newer version and an unknown field', () => {
    expect(messages({ ...tiny(), format: 'other' })).toContain('format: must be "brink-map", not "other"');
    expect(messages({ ...tiny(), version: MAP_VERSION + 1 })).toContain(`version: ${MAP_VERSION + 1} is newer than this build reads (${MAP_VERSION})`);
    expect(paths({ ...tiny(), colour: 'red' })).toContain('colour');
  });

  it('points at the row and column of a bad layer cell', () => {
    const m = tiny();
    m.layers.owner.rows[2] = '-..Q.m';
    m.layers.terrain.rows[0] = '**~~*';
    expect(messages(m)).toEqual(expect.arrayContaining(['layers.owner.rows[2]: col 3: "Q" is not in the legend', 'layers.terrain.rows[0]: is 5 wide, not 6']));
  });

  it('keeps the layers in agreement: no owned sea, every sea in a zone, no sea zone on land, sea biome on sea', () => {
    const m = tiny();
    m.layers.owner.rows[3] = 'A.....';
    m.layers.seaZone!.rows[3] = '-sssss';
    m.layers.seaZone!.rows[0] = 'n-nn--';
    m.layers.biome!.rows[0] = '~t~~dd';
    expect(messages(m)).toEqual(
      expect.arrayContaining([
        'layers.owner.rows[3]: col 0: sea cannot be owned (held by alpha)',
        'layers.seaZone.rows[3]: col 0: open sea belongs to no sea zone',
        'layers.seaZone.rows[0]: col 0: land cannot be in sea zone north',
        'layers.biome.rows[0]: col 0: land cannot have the sea biome',
      ]),
    );
  });

  it('puts every site on its owner\'s dry ground, one to a hex, and every nation one capital', () => {
    const m = tiny();
    m.sites.push({ id: 'beta-city0', kind: 'city', name: 'Wet', at: [2, 0], owner: 'beta' });
    m.sites.push({ id: 'beta-city1', kind: 'city', name: 'Wrong', at: [0, 1], owner: 'beta' });
    m.sites.push({ id: 'beta-city2', kind: 'city', name: 'Twin', at: [5, 0], owner: 'beta' });
    m.sites.push({ id: 'beta-city3', kind: 'city', name: 'Far', at: [9, 0], owner: 'beta' });
    m.sites.push({ id: 'beta-capital', kind: 'capital', name: 'Again', at: [4, 1], owner: 'beta' });
    expect(messages(m)).toEqual(
      expect.arrayContaining([
        'sites[4].at: Wet at [2, 0] is at sea',
        'sites[5].at: Wrong at [0, 1] stands on alpha ground, not beta',
        'sites[6].at: Twin shares [5, 0] with Betatown',
        'sites[7].at: [9, 0] is off the 6 x 4 map',
        'sites[8].id: "beta-capital" is already a site',
      ]),
    );
    const n = tiny();
    n.nations[0]!.capital = 'beta-capital';
    expect(messages(n)).toContain('nations[0].capital: "beta-capital" is not a capital held by alpha');
  });

  it('checks the nations: ids, colours, governments, and 2 to 12 powers', () => {
    const m = tiny();
    m.nations[1]!.color = 'blue';
    m.nations[1]!.government = 'empire' as never;
    m.nations[1]!.role = 'minor';
    expect(paths(m)).toEqual(expect.arrayContaining(['nations[1].color', 'nations[1].government', 'nations']));
    expect(messages(m)).toContain('nations: has 1 powers; a map needs 2 to 12');
  });

  it('checks straits and resources: sea straits that touch the zones they join, resources ashore', () => {
    const m = tiny();
    m.straits![0]!.hexes = [[0, 0]];
    m.straits![1]!.hexes = [[3, 3]];
    m.straits!.push({ id: 'nowhere', name: 'Nowhere', kind: 'strait', hexes: [[5, 3]], joins: ['north', 'east'] });
    m.resources!.push({ kind: 'oil', at: [3, 3] });
    m.resources!.push({ kind: 'gold' as never, at: [0, 0] });
    expect(messages(m)).toEqual(
      expect.arrayContaining([
        'straits[0].hexes[0]: [0, 0] is land; a strait is sea',
        'straits[1].hexes[0]: [3, 3] is sea; a land bridge is land',
        'straits[2].joins[0]: "north" does not touch the strait',
        'straits[2].joins[1]: "east" is not a sea zone',
        'resources[1].at: [3, 3] is at sea',
        'resources[2].kind: must be one of oil, rare-earths, chips, food',
      ]),
    );
  });

  it('finds the neighbours of a cell that are on the map', () => {
    const m = tiny();
    expect(cellNeighbors(m, [0, 0]).sort()).toEqual([[0, 1], [1, 0]]);
    expect(cellNeighbors(m, [2, 1])).toHaveLength(6);
  });
});
