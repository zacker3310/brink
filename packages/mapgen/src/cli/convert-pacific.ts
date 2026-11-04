import { writeFileSync } from 'node:fs';
import type { NationId } from '@brink/contracts';
import type { Biome, MapNation, MapSite } from '@brink/map';
import { validateMap } from '@brink/map';
import { ALL, GRID, OUTPOSTS, PRIZE, REGION } from '../../../scenarios/src/pacific';
import { gridToMap, mapToJson } from '../grid';

// One-off: the Pacific's inline character grid and nation tables to `pacific.map.json`. Run once
// with `tsx src/cli/convert-pacific.ts <out>`; the scenario then loads the file and the inline grid
// goes. Kept in history (not in the tree) as the record of how the file was made.

const out = process.argv[2];
if (!out) throw new Error('usage: convert-pacific <out.map.json>');

const nations: MapNation[] = ALL.map((n) => ({
  id: n.id,
  name: n.name,
  short: n.short,
  color: n.color,
  government: n.government,
  role: n.minor ? 'minor' : 'power',
  capital: `${n.id}-capital`,
  terrainBias: n.rough,
}));

// The scenario's site order, kept: nation by nation, capital, cities, depots.
const sites: MapSite[] = [];
for (const n of ALL) {
  const add = (id: string, kind: MapSite['kind'], [col, row, name]: readonly [number, number, string], outpost = false) =>
    sites.push({ id, kind, name, at: [col, row], owner: n.id, ...(PRIZE[name] !== undefined ? { victoryPoints: PRIZE[name] } : {}), ...(outpost ? { profile: 'outpost' as const } : {}) });
  add(`${n.id}-capital`, 'capital', n.capital);
  n.cities.forEach((p, i) => add(`${n.id}-city${i}`, 'city', p));
  n.depots.forEach((p, i) => add(`${n.id}-depot${i}`, 'depot', p, OUTPOSTS.has(p[2])));
}

const zone = (col: number, row: number): string => {
  if (col >= 35) return 'atlantic';
  if (row <= 5) return col <= 21 ? 'okhotsk' : 'north-pacific';
  if (row <= 9) return col <= 19 ? 'sea-of-japan' : 'central-pacific';
  if (row <= 12) return col <= 22 ? 'east-china-sea' : 'central-pacific';
  if (col <= 19) return 'south-china-sea';
  return col <= 25 ? 'central-pacific' : 'east-pacific';
};

const biome = (col: number, row: number, owner: NationId | null): Biome => {
  if (owner === 'kazakhstan' || owner === 'mongolia') return 'steppe';
  if (row <= 2) return 'tundra';
  if (row <= 5) return 'boreal';
  if (owner === 'usa' && row === 12 && col <= 24) return 'tropical'; // Hawaii
  if (owner === 'usa' && row === 15 && col <= 22) return 'tropical'; // Guam
  if (owner === 'mexico') return row <= 16 ? 'desert' : 'subtropical';
  if (owner === 'taiwan') return 'subtropical';
  if (owner === 'china' && row >= 13) return 'subtropical';
  if (owner === 'usa' && row >= 12) return 'subtropical';
  return 'temperate';
};

const map = gridToMap({
  id: 'pacific',
  name: 'The Pacific',
  source: 'Hand-drawn character grid (formerly inline in packages/scenarios/src/pacific.ts), converted by packages/mapgen convert-pacific.',
  grid: GRID,
  sea: '.',
  regions: REGION,
  nations,
  sites,
  seaZones: {
    zones: [
      { id: 'okhotsk', name: 'Sea of Okhotsk' },
      { id: 'north-pacific', name: 'North Pacific' },
      { id: 'sea-of-japan', name: 'Sea of Japan' },
      { id: 'east-china-sea', name: 'East China Sea' },
      { id: 'south-china-sea', name: 'South China Sea' },
      { id: 'central-pacific', name: 'Central Pacific' },
      { id: 'east-pacific', name: 'Eastern Pacific' },
      { id: 'atlantic', name: 'Atlantic and the Gulf' },
    ],
    at: zone,
  },
  biome,
  straits: [
    { id: 'taiwan-strait', name: 'Taiwan Strait', kind: 'strait', hexes: [[15, 13], [15, 14]], joins: ['east-china-sea', 'south-china-sea'] },
    { id: 'korea-strait', name: 'Korea Strait', kind: 'strait', hexes: [[19, 8], [19, 9]], joins: ['sea-of-japan', 'east-china-sea'] },
    { id: 'la-perouse', name: 'La Pérouse Strait', kind: 'strait', hexes: [[19, 5], [20, 5]], joins: ['okhotsk', 'sea-of-japan'] },
    { id: 'bering', name: 'Bering crossing', kind: 'land-bridge', hexes: [[25, 0], [26, 0]] },
  ],
  resources: [
    { kind: 'oil', at: [6, 2], name: 'West Siberian fields' },
    { kind: 'oil', at: [28, 1], name: 'Prudhoe Bay' },
    { kind: 'oil', at: [31, 13], name: 'Permian Basin' },
    { kind: 'oil', at: [14, 7], name: 'Daqing' },
    { kind: 'rare-earths', at: [11, 9], name: 'Bayan Obo' },
    { kind: 'chips', at: [16, 14], name: 'Hsinchu' },
    { kind: 'chips', at: [17, 9], name: 'Pyeongtaek' },
    { kind: 'chips', at: [22, 8], name: 'Kumamoto' },
    { kind: 'food', at: [30, 9], name: 'The Corn Belt' },
    { kind: 'food', at: [10, 13], name: 'Sichuan Basin' },
  ],
});

const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}`);
