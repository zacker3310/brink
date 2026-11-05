import type { NationId } from '@brink/contracts';
import type { Biome, MapFile, MapNation, MapSite, MapTerrain } from '@brink/map';
import { gridToMap, type GridSpec } from './grid';

// The Americas (docs/americas.md): Alaska and the Canadian Arctic to Tierra del Fuego, drawn by hand
// as a character grid, one character per hex, and converted with `gridToMap`. Regenerate the file
// with `pnpm --filter @brink/mapgen map:americas`; a test checks the committed file matches.
//
// The projection is a plain longitude-latitude box, about 4.5 degrees of longitude to a column and
// 3.3 degrees of latitude to a row, from 72 N to 60 S. South America sits one column east of true,
// and Central America and the Antilles are stretched a little, so that the isthmus is a corridor of
// hexes and the Florida Strait, the Windward Passage and the Yucatan Channel are open water.
//
// Owners: U United States, K Canada, M Mexico, B Brazil, A Argentina, C Colombia (the powers);
// G Guatemala, N Nicaragua, P Panama, Q Cuba, H Haiti, D the Dominican
// Republic, V Venezuela, Y Guyana, E Ecuador, R Peru, L Bolivia, X Chile, Z Paraguay, W Uruguay
// (minor states); # unowned land (Greenland, the Falklands); . sea.

export const AMERICAS_GRID: readonly string[] = [
  '...UUU...KKKKKK.....KK...#######', //  0  72 N: the North Slope, the Arctic islands, Baffin, Greenland
  'UUUUUUKKKKKKKKKKKKK.KKKK.#######', //  1
  'UUUUUUKKKKKKKKKKK.....KK..####..', //  2  Foxe Basin; Baffin's south coast
  'UUUUUUKKKKKKKKKK..........#.....', //  3  Hudson Strait; Cape Farewell
  '.UU...UUKKKKKKKKK...KKKK........', //  4  the Gulf of Alaska; Hudson Bay; Ungava
  '.U.....UKKKKKKKKK...KKKK........', //  5  the Alaska Peninsula and the Panhandle
  '.........KKKKKKKKKK.KKKK.K......', //  6  James Bay; Newfoundland
  '.........KKKKKKKKKKKKKK.K.......', //  7  the 49th parallel; the Gulf of St Lawrence
  '..........UUUUUUUUUKKKUK........', //  8  Seattle to Detroit; Ontario and Quebec; Maine; Nova Scotia
  '..........UUUUUUUUUUUU..........', //  9
  '..........UUUUUUUUUUU...........', // 10  San Francisco, Denver, Washington
  '...........UUUUUUUUUU...........', // 11
  '...........MMMUUUUUU............', // 12  Baja and Sonora; Texas to Georgia
  '...........M.MMUU..U............', // 13  the Gulf of California; Houston; Florida
  '............M.MM................', // 14  the Florida Strait
  '..U..........MMM..QQQ...........', // 15  Hawaii; Cuba
  '..............MMMM....HD.U......', // 16  Guadalajara to Yucatan; Hispaniola; Puerto Rico
  '..............MMMGN.............', // 17  Chiapas; the Peten and the Mosquito Coast
  '.................GNP............', // 18  Guatemala City, Managua, Chiriqui
  '...................PPCCVVV......', // 19  Panama and the canal; the Spanish Main
  '.....................CCCVVYY....', // 20  the Guianas
  '.....................CCCVBBB....', // 21
  '....................EECCCBBBB...', // 22  the equator; the mouth of the Amazon
  '....................ERCBBBBBBB..', // 23  Leticia; Manaus
  '....................RRRBBBBBBBB.', // 24  Recife
  '....................RRRLBBBBBB..', // 25  Lima
  '.....................RRLLBBBBB..', // 26
  '.....................RLLLBBBBB..', // 27  La Paz; Brasilia
  '......................XLLZBBBB..', // 28  the Atacama
  '......................XAZZBBB...', // 29  Asuncion; Sao Paulo and Rio
  '......................XAAABB....', // 30
  '......................XAAWB.....', // 31  Cordoba; Porto Alegre
  '......................XAAAW.....', // 32  Santiago, Mendoza, Buenos Aires, Montevideo
  '......................XAA.......', // 33
  '......................XAA.......', // 34
  '......................XA........', // 35  Patagonia
  '......................XA........', // 36
  '......................XA.#......', // 37  the Falklands
  '................................', // 38  the Strait of Magellan
  '......................XA........', // 39  Tierra del Fuego
  '................................', // 40  the Drake Passage
];

const REGIONS: Readonly<Record<string, NationId | null>> = {
  U: 'usa',
  K: 'canada',
  M: 'mexico',
  B: 'brazil',
  A: 'argentina',
  C: 'colombia',
  G: 'guatemala',
  N: 'nicaragua',
  P: 'panama',
  Q: 'cuba',
  H: 'haiti',
  D: 'dominican',
  V: 'venezuela',
  Y: 'guyana',
  E: 'ecuador',
  R: 'peru',
  L: 'bolivia',
  X: 'chile',
  Z: 'paraguay',
  W: 'uruguay',
  '#': null,
};

const power = (id: string, name: string, short: string, color: string, government: MapNation['government'], terrainBias: number): MapNation => ({ id, name, short, color, government, role: 'power', capital: `${id}-capital`, terrainBias });
const minor = (id: string, name: string, short: string, color: string, government: MapNation['government'], terrainBias: number): MapNation => ({ id, name, short, color, government, role: 'minor', capital: `${id}-capital`, terrainBias });

/**
 * Six powers and fourteen minor states. The colours and governments of the United States, Canada and
 * Mexico are the Pacific's: one nation, one look, whichever theatre it fights in.
 */
const NATIONS: MapNation[] = [
  power('usa', 'United States', 'USA', '#4f8fe0', 'commonwealth', 10),
  power('canada', 'Canada', 'Canada', '#b9424f', 'commonwealth', 25),
  power('mexico', 'Mexico', 'Mexico', '#3e9a62', 'union', 10),
  power('brazil', 'Brazil', 'Brazil', '#e0b43c', 'union', 0),
  power('argentina', 'Argentina', 'Argentina', '#7fc4e8', 'federation', -10),
  power('colombia', 'Colombia', 'Colombia', '#e8873a', 'directorate', 30),
  minor('guatemala', 'Guatemala', 'Guat.', '#5f8f8a', 'federation', 30),
  minor('nicaragua', 'Nicaragua', 'Nic.', '#9a6e9e', 'directorate', 20),
  minor('panama', 'Panama', 'Panama', '#c94f7c', 'commonwealth', 15),
  minor('cuba', 'Cuba', 'Cuba', '#a83a3a', 'directorate', 10),
  minor('haiti', 'Haiti', 'Haiti', '#5a6fd0', 'federation', 30),
  minor('dominican', 'Dominican Republic', 'Dom. Rep.', '#c46d4e', 'federation', 25),
  minor('venezuela', 'Venezuela', 'Venez.', '#8a5ab8', 'directorate', 10),
  minor('guyana', 'Guyana', 'Guyana', '#6fa04a', 'commonwealth', 20),
  minor('ecuador', 'Ecuador', 'Ecuador', '#d3a24a', 'federation', 40),
  minor('peru', 'Peru', 'Peru', '#c97ab0', 'federation', 40),
  minor('bolivia', 'Bolivia', 'Bolivia', '#8fae3a', 'union', 40),
  minor('chile', 'Chile', 'Chile', '#3fa7b5', 'federation', 45),
  minor('paraguay', 'Paraguay', 'Para.', '#a8744a', 'union', -10),
  minor('uruguay', 'Uruguay', 'Uruguay', '#9fb4c8', 'commonwealth', -15),
];

type Kind = MapSite['kind'];
const s = (owner: NationId, id: string, kind: Kind, name: string, at: [number, number], extra: Partial<MapSite> = {}): MapSite => ({ id: `${owner}-${id}`, kind, name, at, owner, ...extra });

/**
 * The real capitals and great cities. A power's first two cities hold its opening army on its front
 * (`build.ts`): the United States and Canada face each other at New York and Toronto, Seattle and
 * Vancouver, Mexico faces north at Monterrey and Tijuana, Brazil faces Argentina at Porto Alegre
 * and Colombia at Manaus, Argentina faces Brazil at Corrientes and Chile at Mendoza, Colombia faces
 * Panama at Cartagena and Venezuela at Cucuta.
 */
const SITES: MapSite[] = [
  s('usa', 'capital', 'capital', 'Washington', [20, 10]),
  s('usa', 'city0', 'city', 'New York', [20, 9]),
  s('usa', 'city1', 'city', 'Seattle', [10, 8]),
  s('usa', 'city2', 'city', 'Houston', [16, 13]),
  s('usa', 'city3', 'city', 'Los Angeles', [11, 11]),
  s('usa', 'city4', 'city', 'Chicago', [17, 9]),
  s('usa', 'city5', 'city', 'Miami', [19, 13]),
  s('usa', 'city6', 'city', 'Honolulu', [2, 15], { victoryPoints: 4 }),
  s('usa', 'depot0', 'depot', 'Detroit', [18, 8]),
  s('usa', 'depot1', 'depot', 'Anchorage', [3, 3]),
  s('usa', 'depot2', 'depot', 'San Juan', [25, 16], { profile: 'outpost' }),

  s('canada', 'capital', 'capital', 'Ottawa', [20, 7]),
  s('canada', 'city0', 'city', 'Toronto', [19, 8]),
  s('canada', 'city1', 'city', 'Vancouver', [9, 7]),
  s('canada', 'city2', 'city', 'Montreal', [21, 8]),
  s('canada', 'city3', 'city', 'Calgary', [12, 6]),
  s('canada', 'city4', 'city', 'Winnipeg', [15, 7]),
  s('canada', 'depot0', 'depot', 'Halifax', [23, 8]),
  s('canada', 'depot1', 'depot', 'Whitehorse', [7, 3]),
  s('canada', 'depot2', 'depot', 'Iqaluit', [22, 2], { profile: 'outpost' }),

  s('mexico', 'capital', 'capital', 'Mexico City', [15, 16]),
  s('mexico', 'city0', 'city', 'Monterrey', [15, 14]),
  s('mexico', 'city1', 'city', 'Tijuana', [11, 12]),
  s('mexico', 'city2', 'city', 'Guadalajara', [14, 16]),
  s('mexico', 'city3', 'city', 'Veracruz', [16, 16]),
  s('mexico', 'city4', 'city', 'Hermosillo', [12, 12]),
  s('mexico', 'depot0', 'depot', 'Chihuahua', [13, 13]),
  s('mexico', 'depot1', 'depot', 'Merida', [17, 16]),

  s('brazil', 'capital', 'capital', 'Brasilia', [27, 27]),
  s('brazil', 'city0', 'city', 'Porto Alegre', [26, 31]),
  s('brazil', 'city1', 'city', 'Manaus', [24, 23]),
  s('brazil', 'city2', 'city', 'Sao Paulo', [27, 29]),
  s('brazil', 'city3', 'city', 'Rio de Janeiro', [28, 29]),
  s('brazil', 'city4', 'city', 'Salvador', [29, 26]),
  s('brazil', 'city5', 'city', 'Recife', [30, 24]),
  s('brazil', 'city6', 'city', 'Belem', [28, 22]),
  s('brazil', 'depot0', 'depot', 'Campo Grande', [26, 28]),
  s('brazil', 'depot1', 'depot', 'Cuiaba', [25, 26]),

  s('argentina', 'capital', 'capital', 'Buenos Aires', [25, 32]),
  s('argentina', 'city0', 'city', 'Corrientes', [25, 30]),
  s('argentina', 'city1', 'city', 'Mendoza', [23, 32]),
  s('argentina', 'city2', 'city', 'Cordoba', [24, 31]),
  s('argentina', 'city3', 'city', 'Salta', [23, 29]),
  s('argentina', 'city4', 'city', 'Bahia Blanca', [24, 34]),
  s('argentina', 'depot0', 'depot', 'Neuquen', [23, 34]),
  s('argentina', 'depot1', 'depot', 'Comodoro Rivadavia', [23, 36]),
  s('argentina', 'depot2', 'depot', 'Ushuaia', [23, 39], { profile: 'outpost' }),

  s('colombia', 'capital', 'capital', 'Bogota', [22, 20]),
  s('colombia', 'city0', 'city', 'Cartagena', [21, 19]),
  s('colombia', 'city1', 'city', 'Cucuta', [23, 20]),
  s('colombia', 'city2', 'city', 'Medellin', [22, 21]),
  s('colombia', 'city3', 'city', 'Cali', [21, 21]),
  s('colombia', 'city4', 'city', 'Barranquilla', [22, 19]),
  s('colombia', 'city5', 'city', 'Villavicencio', [23, 21]),
  s('colombia', 'depot0', 'depot', 'Leticia', [22, 23]),

  // The minor states. Panama City holds the canal: it is worth what the canal is worth.
  s('guatemala', 'capital', 'capital', 'Guatemala City', [17, 18]),
  s('nicaragua', 'capital', 'capital', 'Managua', [18, 18]),
  s('panama', 'capital', 'capital', 'Panama City', [19, 19], { victoryPoints: 8 }),
  s('cuba', 'capital', 'capital', 'Havana', [18, 15], { victoryPoints: 8 }),
  s('cuba', 'city0', 'city', 'Santiago de Cuba', [20, 15]),
  s('haiti', 'capital', 'capital', 'Port-au-Prince', [22, 16]),
  s('dominican', 'capital', 'capital', 'Santo Domingo', [23, 16]),
  s('venezuela', 'capital', 'capital', 'Caracas', [24, 19]),
  s('venezuela', 'city0', 'city', 'Maracaibo', [23, 19]),
  s('venezuela', 'city1', 'city', 'Ciudad Guayana', [25, 20]),
  s('guyana', 'capital', 'capital', 'Georgetown', [26, 20]),
  s('guyana', 'city0', 'city', 'Paramaribo', [27, 20]),
  s('ecuador', 'capital', 'capital', 'Quito', [21, 22]),
  s('ecuador', 'city0', 'city', 'Guayaquil', [20, 22]),
  s('peru', 'capital', 'capital', 'Lima', [20, 25]),
  s('peru', 'city0', 'city', 'Iquitos', [21, 23]),
  s('peru', 'city1', 'city', 'Arequipa', [21, 27]),
  s('bolivia', 'capital', 'capital', 'La Paz', [22, 27]),
  s('bolivia', 'city0', 'city', 'Santa Cruz', [24, 27]),
  s('chile', 'capital', 'capital', 'Santiago', [22, 32], { victoryPoints: 8 }),
  s('chile', 'city0', 'city', 'Antofagasta', [22, 29]),
  s('chile', 'city1', 'city', 'Concepcion', [22, 33]),
  s('chile', 'city2', 'city', 'Punta Arenas', [22, 37]),
  s('paraguay', 'capital', 'capital', 'Asuncion', [25, 29]),
  s('uruguay', 'capital', 'capital', 'Montevideo', [26, 32]),
];

const cells = (list: string): Set<string> => new Set(list.split(' ').filter(Boolean));

/** The Rockies, the Alaska Range, the Sierra Madre and the Andes: mountains the seed never flattens. */
const MOUNTAINS = cells('3,2 4,3 6,3 8,4 10,6 11,6 10,7 11,7 12,8 12,9 13,9 12,10 13,10 13,11 14,15 20,23 21,24 21,25 22,26 23,26 23,28 22,28 22,30 22,31 22,34 22,35 22,36 23,30 21,26 22,24 22,25 23,27 24,28');
/** The Appalachians and the Laurentian shield's hills, the Brazilian highlands. */
const HILLS = cells('18,10 19,11 22,6 21,6 26,27 28,27 28,28');
/** The Amazon, the Darien and the boreal forest. */
const FOREST = cells('25,21 26,21 27,21 23,22 24,22 25,22 26,22 27,22 22,22 23,22 23,23 25,23 26,23 27,23 28,23 22,24 23,24 24,24 25,24 26,24 27,24 24,25 25,25 26,25 23,25 24,21 20,19 9,4 10,4 11,4 12,4 13,4 14,4 15,4 9,5 10,5 11,5 12,5 13,5 14,5 15,5 16,5 20,5 21,5 22,5 23,5 20,4 21,4');
/** The Great Plains, the prairies, the Pampas and Patagonia; the tundra and the ice. */
const PLAINS = cells('14,8 15,8 16,8 14,9 15,9 16,9 15,10 16,10 15,11 16,11 15,12 13,6 14,6 13,7 14,7 23,31 24,32 23,33 24,33 23,35 23,37 3,0 4,0 5,0 0,1 1,1 2,1 9,0 10,0 11,0 12,0 13,0 14,0 20,0 21,0 20,1 21,1 22,1 23,1');

function terrain(col: number, row: number, owner: NationId | null): MapTerrain {
  const k = `${col},${row}`;
  // Greenland's ice cap and the Falklands' moor: open ground, nobody's.
  if (owner === null) return 'plains';
  if (MOUNTAINS.has(k)) return 'mountains';
  if (HILLS.has(k)) return 'hills';
  if (FOREST.has(k)) return 'forest';
  if (PLAINS.has(k)) return 'plains';
  return 'seeded';
}

function biome(col: number, row: number, owner: NationId | null): Biome {
  const k = `${col},${row}`;
  if (owner === null) return row < 10 ? 'ice' : 'tundra';
  if (MOUNTAINS.has(k) && row >= 19) return 'highland';
  switch (owner) {
    case 'usa':
      if (row <= 3) return 'tundra';
      if (row <= 7) return 'boreal';
      if (row >= 15) return 'tropical';
      if (row >= 12 || (row === 11 && col >= 17) || (row === 13 && col === 19)) return 'subtropical';
      if (col >= 11 && col <= 13 && row >= 10) return col === 11 ? 'subtropical' : 'desert';
      if (col >= 14 && col <= 16) return 'steppe';
      return 'temperate';
    case 'canada':
      if (row <= 3) return 'tundra';
      if (row >= 6 && col >= 12 && col <= 15) return 'steppe';
      if (row >= 7 && (col <= 9 || col >= 19)) return 'temperate';
      return 'boreal';
    case 'mexico':
      if (row <= 14) return 'desert';
      if (col === 15 && row === 16) return 'highland';
      return row >= 17 || col >= 16 ? 'tropical' : 'subtropical';
    case 'chile':
      if (row <= 30) return 'desert';
      if (row <= 34) return 'temperate';
      return row >= 37 ? 'tundra' : 'boreal';
    case 'argentina':
      if (row <= 30) return 'subtropical';
      if (row <= 33) return 'temperate';
      return row >= 39 ? 'tundra' : 'steppe';
    case 'uruguay':
      return 'temperate';
    case 'paraguay':
      return 'subtropical';
    case 'brazil':
      return row >= 27 ? 'subtropical' : 'tropical';
    case 'bolivia':
      return col >= 24 ? 'tropical' : 'highland';
    case 'peru':
      if (col === 20 || (col === 21 && row >= 26)) return 'desert';
      return row === 23 ? 'tropical' : 'highland';
    case 'ecuador':
      return col === 20 && row === 22 ? 'tropical' : 'highland';
    case 'colombia':
      return col === 22 && row === 20 ? 'highland' : 'tropical';
    default:
      return 'tropical';
  }
}

/**
 * The seas, by the ocean they open on. The Pacific and the Atlantic meet only round Cape Horn and
 * through the canal (which is land: Panama City's port), so a flood of the sea north of the Strait of
 * Magellan tells one from the other; the Arctic's landlocked pockets are their own zone.
 */
function seaZones(grid: readonly string[]): (col: number, row: number) => string {
  const rows = grid.length;
  const cols = grid[0]!.length;
  const sea = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && grid[r]![c] === '.';
  const ocean = new Map<string, 'pacific' | 'atlantic' | 'arctic'>();
  const flood = (c0: number, r0: number, name: 'pacific' | 'atlantic') => {
    const todo: [number, number][] = [[c0, r0]];
    while (todo.length) {
      const [c, r] = todo.pop()!;
      const k = `${c},${r}`;
      if (!sea(c, r) || r >= 38 || ocean.has(k)) continue;
      ocean.set(k, name);
      const odd = r % 2 === 1;
      const near: [number, number][] = odd
        ? [[c - 1, r], [c + 1, r], [c, r - 1], [c + 1, r - 1], [c, r + 1], [c + 1, r + 1]]
        : [[c - 1, r], [c + 1, r], [c - 1, r - 1], [c, r - 1], [c - 1, r + 1], [c, r + 1]];
      todo.push(...near);
    }
  };
  flood(0, 20, 'pacific');
  flood(31, 10, 'atlantic');
  return (c, r) => {
    if (r >= 38) return c <= 22 ? 'south-pacific' : 'south-atlantic';
    const o = ocean.get(`${c},${r}`) ?? 'arctic';
    if (o === 'arctic') return 'arctic';
    if (o === 'pacific') return r <= 12 ? 'north-pacific' : r <= 23 ? 'east-pacific' : 'south-pacific';
    if (r >= 2 && r <= 6 && c >= 16 && c <= 21) return 'hudson-bay';
    if (r <= 2) return 'arctic';
    if (r >= 13 && r <= 15 && c >= 15 && c <= 18) return 'gulf-of-mexico';
    if (r >= 16 && r <= 18 && c >= 17 && c <= 26) return 'caribbean';
    return r <= 18 ? 'north-atlantic' : 'south-atlantic';
  };
}

export const AMERICAS_SPEC: GridSpec = {
  id: 'americas',
  name: 'The Americas',
  source: 'Hand-drawn character grid (packages/mapgen/src/americas.ts), converted by gridToMap. Coastlines after public-domain Natural Earth outlines, by eye.',
  grid: AMERICAS_GRID,
  sea: '.',
  regions: REGIONS,
  nations: NATIONS,
  sites: SITES,
  terrain,
  biome,
  seaZones: {
    zones: [
      { id: 'arctic', name: 'Arctic Ocean' },
      { id: 'north-pacific', name: 'North Pacific' },
      { id: 'east-pacific', name: 'Eastern Pacific' },
      { id: 'south-pacific', name: 'South Pacific' },
      { id: 'hudson-bay', name: 'Hudson Bay' },
      { id: 'north-atlantic', name: 'North Atlantic' },
      { id: 'gulf-of-mexico', name: 'Gulf of Mexico' },
      { id: 'caribbean', name: 'Caribbean Sea' },
      { id: 'south-atlantic', name: 'South Atlantic' },
    ],
    at: seaZones(AMERICAS_GRID),
  },
  straits: [
    // The canal is land: Panama City is a port on a one-hex isthmus, so a ship passes from the
    // Caribbean to the Pacific through it, and whoever holds the city holds the canal (docs/americas.md).
    { id: 'panama-canal', name: 'Panama Canal', kind: 'canal', hexes: [[19, 19]], joins: ['caribbean', 'east-pacific'] },
    { id: 'florida-strait', name: 'Florida Strait', kind: 'strait', hexes: [[19, 14], [20, 14]], joins: ['gulf-of-mexico', 'north-atlantic'] },
    { id: 'yucatan-channel', name: 'Yucatan Channel', kind: 'strait', hexes: [[17, 15], [18, 16]], joins: ['gulf-of-mexico', 'caribbean'] },
    { id: 'magellan', name: 'Strait of Magellan', kind: 'strait', hexes: [[22, 38], [23, 38]], joins: ['south-pacific', 'south-atlantic'] },
    { id: 'drake-passage', name: 'Drake Passage', kind: 'strait', hexes: [[20, 40], [21, 40], [22, 40], [23, 40], [24, 40], [25, 40]], joins: ['south-pacific', 'south-atlantic'] },
  ],
  resources: [
    { kind: 'oil', at: [4, 1], name: 'Prudhoe Bay' },
    { kind: 'oil', at: [12, 5], name: 'Athabasca oil sands' },
    { kind: 'oil', at: [15, 12], name: 'Permian Basin' },
    { kind: 'oil', at: [24, 20], name: 'Orinoco Belt' },
    { kind: 'oil', at: [23, 33], name: 'Vaca Muerta' },
    { kind: 'oil', at: [26, 29], name: 'Santos Basin' },
    { kind: 'chips', at: [11, 10], name: 'Silicon Valley' },
    { kind: 'chips', at: [13, 11], name: 'Phoenix fabs' },
    { kind: 'rare-earths', at: [12, 11], name: 'Mountain Pass' },
    { kind: 'rare-earths', at: [23, 28], name: 'Salar de Uyuni lithium' },
    { kind: 'food', at: [16, 9], name: 'The Corn Belt' },
    { kind: 'food', at: [14, 7], name: 'The Prairies' },
    { kind: 'food', at: [24, 33], name: 'The Pampas' },
    { kind: 'food', at: [26, 25], name: 'Mato Grosso soy' },
  ],
};

export function generateAmericas(): MapFile {
  return gridToMap(AMERICAS_SPEC);
}
