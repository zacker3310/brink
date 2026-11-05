import type { NationId } from '@brink/contracts';
import type { Biome, MapFile, MapNation, MapSite, MapTerrain } from '@brink/map';
import { gridToMap, type GridSpec } from './grid';

// The Indo-Pacific South (docs/indopac.md) as a character grid, one character per hex, converted with
// `gridToMap`. Regenerate the file with `pnpm --filter @brink/mapgen map:indopac`; a test checks the
// committed file matches byte for byte.
//
// The grid was traced from approximate longitude-latitude outlines (52 x 36 hexes over 61 E to
// 179.5 E and 37.5 N to 47 S, no external data) and finished by hand: islands widened past real scale
// so each holds ground, narrows kept open as one sea hex (Malacca, Sunda, Lombok, Torres, Bass, Cook,
// the Taiwan and Luzon straits). The lane that drew it traced it with a script outside the repository;
// this is that script's output as source, the grid, sites, zones and straits exactly as it wrote them.
//
// Owners: I India, P Pakistan, C China, D Indonesia, A Australia (the powers); F Afghanistan, N Nepal,
// B Bangladesh, L Sri Lanka, M Myanmar, H Thailand, O Laos, K Cambodia, V Vietnam, Y Malaysia,
// S Singapore, X the Philippines, G Papua New Guinea, Z New Zealand, T Taiwan (minor states); . sea.

export const INDOPAC_GRID: readonly string[] = [
  'FFFFFPPCCCCCCCCCCCCCCCCCCCC.........................', //  0  36 N: the Hindu Kush, the Karakoram, the Kunlun, Beijing
  'FFFPPPIICCCCCCCCCCCCCCCCCC..........................', //  1  34 N: Kabul, Islamabad, Leh
  'FFFFPPIICCCCCCCCCCCCCCCCCCC.........................', //  2  32 N: Lahore, Shanghai
  'PPPPPIIINNNCCCCCCCCCCCCCCCC.........................', //  3  29 N: Delhi, Kathmandu, Lhasa, Chengdu
  'PPPPIIIIIIIIIIIIMCCCCCCCCC..........................', //  4  27 N: the Ganges
  '..PPIIIIIIIIBIMMCCCCCCCCC.T.........................', //  5  25 N: Karachi, Dhaka, Kunming, Xiamen, Taipei
  '...IIIIIIIIIBBMMMCVVCCCC..TT........................', //  6  22 N: Kolkata, Guangzhou, Kaohsiung
  '....IIIIIII..MMMHOOV.C..............................', //  7  20 N: Mumbai, Naypyidaw, Hanoi, Hainan
  '.....IIIII....MMHHOOV.....X.........................', //  8  18 N: Yangon, Vientiane, Luzon
  '.....III.......MHHHOV.C..XX.........................', //  9  15 N: Woody Island, Manila
  '......III.......MHKKVV....XX........................', // 10  13 N: Chennai, Bangkok, Phnom Penh
  '......II.....I..H.KV..C.X.X.........................', // 11  11 N: Port Blair, Saigon, Fiery Cross, Palawan, Cebu
  '.......I.L......HH...V......X.......................', // 12   8 N: the Palk Strait, Sri Lanka, Truong Sa, Mindanao
  '........L........Y.....YY...X.......................', // 13   6 N: Colombo, Penang, Kota Kinabalu
  '...............D.YYY..YYY...........................', // 14   4 N: Medan, Malacca, Kuala Lumpur, Sarawak
  '...............D..S..YDDD.DD.D......................', // 15   1 N: Singapore, Kuching, Sulawesi, Halmahera
  '................DD...DDDD.D....DD...................', // 16   1 S: Pontianak, the Makassar Strait, the Bird's Head
  '.................DD......DD..D.DDDDGG...............', // 17   4 S: Palembang, Makassar, Ambon, Jayapura
  '....................DDDD..........DGGG..............', // 18   6 S: the Sunda Strait, Jakarta, Surabaya, Mount Hagen
  '....................DDD.DD........DG.G..............', // 19   8 S: the Lombok Strait, the Lesser Sundas, Port Moresby
  '...................A.......DD.......................', // 20  11 S: Christmas Island, Timor, the Torres Strait
  '..............................AAA..A................', // 21  13 S: Darwin, Cape York
  '............................AAAAA..AA...............', // 22  15 S: the Kimberley, the Gulf of Carpentaria
  '..........................AAAAAAAAAAAA..............', // 23  18 S: Broome, Townsville
  '........................AAAAAAAAAAAAAAA.............', // 24  20 S: the Pilbara
  '.......................AAAAAAAAAAAAAAAA.............', // 25  22 S
  '.......................AAAAAAAAAAAAAAAAAA...........', // 26  25 S: Alice Springs
  '.......................AAAAAAAAAAAAAAAAAA...........', // 27  27 S: Brisbane
  '........................AAAAAAAAAAAAAAAAA...........', // 28  29 S
  '.......................AAAAAAAAAAAAAAAAA............', // 29  32 S: Perth
  '........................AAAA.....AAAAAAA.........Z..', // 30  34 S: Adelaide, Sydney, Northland
  '..................................AAAAA..........ZZ.', // 31  37 S: Canberra, Auckland
  '...................................AAA............Z.', // 32  39 S: Melbourne
  '................................................Z.Z.', // 33  41 S: the Bass Strait, the Cook Strait, Wellington
  '.....................................AA.........ZZ..', // 34  43 S: Hobart, Christchurch
  '...............................................ZZ...', // 35  46 S
];

const REGIONS: Readonly<Record<string, NationId>> = {
  F: 'afghanistan',
  P: 'pakistan',
  N: 'nepal',
  B: 'bangladesh',
  L: 'srilanka',
  T: 'taiwan',
  C: 'china',
  I: 'india',
  M: 'myanmar',
  O: 'laos',
  K: 'cambodia',
  V: 'vietnam',
  H: 'thailand',
  S: 'singapore',
  Y: 'malaysia',
  X: 'philippines',
  G: 'png',
  A: 'australia',
  Z: 'newzealand',
  D: 'indonesia',
};

const nation = (id: NationId, name: string, short: string, color: string, government: MapNation['government'], role: MapNation['role'], terrainBias: number): MapNation => ({
  id,
  name,
  short,
  color,
  government,
  role,
  capital: `${id}-capital`,
  ...(terrainBias ? { terrainBias } : {}),
});

const NATIONS: MapNation[] = [
  // The five powers.
  nation('india', 'India', 'India', '#e8743b', 'federation', 'power', 0),
  nation('pakistan', 'Pakistan', 'Pakistan', '#2f9e5a', 'directorate', 'power', 15),
  nation('china', 'China', 'China', '#e0b43c', 'union', 'power', 0),
  nation('indonesia', 'Indonesia', 'Indonesia', '#d23c3c', 'union', 'power', 25),
  nation('australia', 'Australia', 'Australia', '#3d7fd6', 'commonwealth', 'power', -30),
  // The minor states between them.
  nation('afghanistan', 'Afghanistan', 'Afghan.', '#9c8458', 'directorate', 'minor', 45),
  nation('nepal', 'Nepal', 'Nepal', '#8f6fb0', 'federation', 'minor', 60),
  nation('bangladesh', 'Bangladesh', 'Bangla.', '#5f9e8f', 'federation', 'minor', -20),
  nation('srilanka', 'Sri Lanka', 'Sri Lanka', '#a35d9e', 'federation', 'minor', 10),
  nation('myanmar', 'Myanmar', 'Myanmar', '#7f9f3a', 'directorate', 'minor', 35),
  nation('thailand', 'Thailand', 'Thailand', '#5a6fbf', 'federation', 'minor', 10),
  nation('laos', 'Laos', 'Laos', '#c49a52', 'union', 'minor', 45),
  nation('cambodia', 'Cambodia', 'Cambodia', '#6e5aa8', 'union', 'minor', 10),
  nation('vietnam', 'Vietnam', 'Vietnam', '#b4486e', 'union', 'minor', 30),
  nation('malaysia', 'Malaysia', 'Malaysia', '#3fa7b5', 'federation', 'minor', 30),
  nation('singapore', 'Singapore', 'Singapore', '#e06fa0', 'commonwealth', 'minor', 0),
  nation('philippines', 'Philippines', 'Phil.', '#4fb3d9', 'federation', 'minor', 30),
  nation('png', 'Papua New Guinea', 'PNG', '#a8744a', 'federation', 'minor', 50),
  nation('newzealand', 'New Zealand', 'N. Zealand', '#bfc6cc', 'commonwealth', 'minor', 30),
  nation('taiwan', 'Taiwan', 'Taiwan', '#c97ab0', 'federation', 'minor', 40),
];

type Extra = Pick<MapSite, 'profile' | 'victoryPoints'>;

/**
 * Owner, kind, name, column, row and anything further. A power's first two cities and first depot hold
 * its opening army; its navy puts to sea off the port the scenario names.
 */
const SITE_TABLE: readonly [NationId, MapSite['kind'], string, number, number, Extra?][] = [
  ['india', 'capital', 'New Delhi', 6, 3],
  ['india', 'city', 'Amritsar', 6, 2],
  ['india', 'city', 'Mumbai', 4, 7],
  ['india', 'city', 'Kolkata', 11, 6],
  ['india', 'city', 'Chennai', 8, 10],
  ['india', 'city', 'Hyderabad', 7, 8],
  ['india', 'depot', 'Leh', 6, 1],
  ['india', 'depot', 'Port Blair', 13, 11, { profile: 'outpost' }],

  ['pakistan', 'capital', 'Islamabad', 4, 1],
  ['pakistan', 'city', 'Lahore', 5, 2],
  ['pakistan', 'city', 'Karachi', 2, 5],
  ['pakistan', 'city', 'Quetta', 2, 3],
  ['pakistan', 'city', 'Multan', 4, 3],
  ['pakistan', 'depot', 'Gilgit', 5, 0],
  ['pakistan', 'depot', 'Gwadar', 0, 4],

  ['china', 'capital', 'Beijing', 24, 0],
  ['china', 'city', 'Guangzhou', 22, 6],
  ['china', 'city', 'Kunming', 17, 5],
  ['china', 'city', 'Shanghai', 26, 2],
  ['china', 'city', 'Chengdu', 18, 3],
  ['china', 'city', 'Xiamen', 24, 5],
  ['china', 'depot', 'Lhasa', 12, 3],
  ['china', 'depot', 'Hotan', 8, 0],
  ['china', 'depot', 'Woody Island', 22, 9, { profile: 'outpost' }],
  ['china', 'depot', 'Fiery Cross Reef', 22, 11, { profile: 'outpost' }],

  ['indonesia', 'capital', 'Jakarta', 20, 18],
  ['indonesia', 'city', 'Pontianak', 21, 16],
  ['indonesia', 'city', 'Medan', 15, 14],
  ['indonesia', 'city', 'Surabaya', 23, 18],
  ['indonesia', 'city', 'Makassar', 25, 17],
  ['indonesia', 'depot', 'Jayapura', 34, 17],
  ['indonesia', 'depot', 'Kupang', 27, 20, { profile: 'outpost' }],
  ['indonesia', 'depot', 'Ambon', 29, 17, { profile: 'outpost' }],

  ['australia', 'capital', 'Canberra', 38, 31],
  ['australia', 'city', 'Darwin', 30, 21],
  ['australia', 'city', 'Brisbane', 40, 27],
  ['australia', 'city', 'Sydney', 39, 30],
  ['australia', 'city', 'Perth', 23, 29],
  ['australia', 'city', 'Melbourne', 37, 32],
  ['australia', 'depot', 'Townsville', 37, 23],
  ['australia', 'depot', 'Alice Springs', 32, 26],
  ['australia', 'depot', 'Hobart', 38, 34],
  ['australia', 'depot', 'Christmas Island', 19, 20, { profile: 'outpost' }],

  ['afghanistan', 'capital', 'Kabul', 2, 1],
  ['afghanistan', 'city', 'Kandahar', 1, 2],
  ['nepal', 'capital', 'Kathmandu', 10, 3],
  ['bangladesh', 'capital', 'Dhaka', 12, 5, { victoryPoints: 7 }],
  ['bangladesh', 'city', 'Chittagong', 13, 6],
  ['srilanka', 'capital', 'Colombo', 8, 13],
  ['myanmar', 'capital', 'Naypyidaw', 14, 7],
  ['myanmar', 'city', 'Yangon', 15, 8],
  ['myanmar', 'city', 'Myitkyina', 15, 5],
  ['thailand', 'capital', 'Bangkok', 17, 10, { victoryPoints: 7 }],
  ['thailand', 'city', 'Chiang Mai', 16, 8],
  ['thailand', 'city', 'Hat Yai', 17, 12],
  ['laos', 'capital', 'Vientiane', 18, 8],
  ['cambodia', 'capital', 'Phnom Penh', 19, 10],
  ['vietnam', 'capital', 'Hanoi', 19, 7, { victoryPoints: 8 }],
  ['vietnam', 'city', 'Da Nang', 20, 9],
  ['vietnam', 'city', 'Ho Chi Minh City', 19, 11],
  ['vietnam', 'depot', 'Truong Sa', 21, 12, { profile: 'outpost' }],
  ['malaysia', 'capital', 'Kuala Lumpur', 18, 14, { victoryPoints: 7 }],
  ['malaysia', 'city', 'George Town', 17, 13],
  ['malaysia', 'city', 'Kuching', 21, 15],
  ['malaysia', 'city', 'Kota Kinabalu', 23, 13],
  ['singapore', 'capital', 'Singapore', 18, 15, { victoryPoints: 9 }],
  ['philippines', 'capital', 'Manila', 25, 9, { victoryPoints: 8 }],
  ['philippines', 'city', 'Cebu', 26, 11],
  ['philippines', 'city', 'Davao', 28, 12],
  ['png', 'capital', 'Port Moresby', 37, 19],
  ['png', 'city', 'Mount Hagen', 36, 18],
  ['newzealand', 'capital', 'Wellington', 50, 33, { victoryPoints: 7 }],
  ['newzealand', 'city', 'Auckland', 49, 31],
  ['newzealand', 'city', 'Christchurch', 49, 34],
  ['taiwan', 'capital', 'Taipei', 26, 5, { victoryPoints: 9 }],
  ['taiwan', 'city', 'Kaohsiung', 26, 6],
];

/** Sites with ids as the Pacific's: `india-capital`, `india-city0`, `india-depot0`. Each must stand on its owner's land. */
function sites(): MapSite[] {
  const counts = new Map<string, number>();
  return SITE_TABLE.map(([owner, kind, name, col, row, extra]) => {
    const ch = INDOPAC_GRID[row]?.[col];
    if (!ch || REGIONS[ch] !== owner) throw new Error(`${name} at ${col},${row} is not on ${owner}'s land`);
    let id = `${owner}-capital`;
    if (kind !== 'capital') {
      const n = counts.get(`${owner}|${kind}`) ?? 0;
      counts.set(`${owner}|${kind}`, n + 1);
      id = `${owner}-${kind}${n}`;
    }
    return { id, kind, name, at: [col, row], owner, ...(extra ?? {}) };
  });
}

const cellSet = (cells: readonly [number, number][]) => new Set(cells.map(([c, r]) => `${c},${r}`));
const range = (from: number, to: number, row: number): [number, number][] => Array.from({ length: to - from }, (_, i) => [from + i, row]);

/** The Himalaya, the Karakoram, the Hindu Kush and the Tibetan plateau's rim: mountains, whatever the seed. */
const MOUNTAINS = cellSet([
  ...range(3, 13, 0),
  ...range(5, 14, 1),
  ...range(7, 16, 2),
  [8, 3], [9, 3], [11, 3], [13, 3], [14, 3], [15, 3], [16, 3], [14, 4], [15, 4], [16, 4],
]);

/** Jungle: the forests of Borneo, New Guinea, Sumatra and the Indochinese hills. */
const JUNGLE = cellSet([
  [22, 15], [23, 15], [24, 15], [22, 16], [23, 16], [24, 14], [31, 16], [32, 16], [31, 17], [32, 17], [33, 17], [35, 17],
  [36, 17], [35, 18], [37, 18], [34, 18], [35, 19], [15, 15], [16, 16], [17, 16], [17, 17], [17, 7], [19, 9], [14, 6], [16, 6],
  [18, 10], [20, 10], [26, 16], [26, 17], [24, 19],
]);

const SITE_CELLS = cellSet(SITE_TABLE.map(([, , , c, r]) => [c, r]));

function terrain(col: number, row: number): MapTerrain {
  const k = `${col},${row}`;
  if (SITE_CELLS.has(k)) return 'seeded';
  if (MOUNTAINS.has(k)) return 'mountains';
  if (JUNGLE.has(k)) return 'forest';
  return 'seeded';
}

function biome(c: number, r: number, owner: NationId | null): Biome {
  if (MOUNTAINS.has(`${c},${r}`)) return 'highland';
  if (owner === 'china' && r <= 3 && c <= 17) return 'highland';
  if (owner === 'afghanistan' || owner === 'nepal') return 'highland';
  if (owner === 'pakistan') return r >= 3 ? 'desert' : 'steppe';
  if (owner === 'india' && r <= 5 && c <= 5) return 'desert';
  if (owner === 'australia') {
    if (r >= 30 || (r >= 29 && c <= 25) || r === 34) return 'temperate';
    if (r <= 23) return 'tropical';
    if (c >= 38) return 'subtropical';
    if (c >= 26 && c <= 36 && r >= 24 && r <= 29) return 'desert';
    return 'steppe';
  }
  if (owner === 'newzealand') return 'temperate';
  if (owner === 'china') return r <= 3 ? 'temperate' : 'subtropical';
  if (owner === 'taiwan' || (owner === 'india' && r <= 6)) return 'subtropical';
  if ((owner === 'bangladesh' || owner === 'myanmar') && r <= 5) return 'subtropical';
  return 'tropical';
}

/** The sea a hex of water lies in. */
function zone(c: number, r: number): string {
  if (r <= 5) return c <= 28 ? 'east-china-sea' : 'philippine-sea';
  if (r <= 14) {
    if (c <= 6) return 'arabian-sea';
    if (c <= 13) return r <= 13 || c >= 7 ? 'bay-of-bengal' : 'indian-ocean';
    if (c <= 16) return r >= 8 ? 'andaman-sea' : 'bay-of-bengal';
    if (r >= 12 && c >= 25 && c <= 27) return 'celebes-banda';
    if (c <= 25) return 'south-china-sea';
    return 'philippine-sea';
  }
  if (r <= 18) {
    if (c <= 15) return 'indian-ocean';
    if (r <= 16 && c <= 20) return 'south-china-sea';
    if (c <= 18) return 'indian-ocean';
    if (c <= 24) return 'java-sea';
    if (r === 18 && c >= 31 && c <= 33) return 'timor-arafura';
    if (c <= 30 || (r >= 17 && c <= 33)) return 'celebes-banda';
    if (c >= 38) return 'coral-sea';
    return 'philippine-sea';
  }
  if (r <= 23) {
    if (c === 23 && r === 19) return 'java-sea';
    if (c <= 23 || (r >= 21 && c <= 25)) return 'indian-ocean';
    if (c <= 34) return 'timor-arafura';
    return 'coral-sea';
  }
  if (r <= 29) {
    if (c <= 30) return 'indian-ocean';
    if (c >= 50) return 'south-pacific';
    return r <= 27 ? 'coral-sea' : 'tasman-sea';
  }
  if (c <= 37) return 'southern-ocean';
  return c >= 50 ? 'south-pacific' : 'tasman-sea';
}

export const INDOPAC_SPEC: GridSpec = {
  id: 'indopac',
  name: 'Indo-Pacific South',
  source: 'Hand-traced lon/lat outlines (61E-179.5E, 37.5N-47S) rasterised to hexes, then hand-finished: islands widened past real scale, narrows kept as one sea hex. No external data.',
  grid: INDOPAC_GRID,
  sea: '.',
  regions: REGIONS,
  nations: NATIONS,
  sites: sites(),
  terrain,
  biome,
  seaZones: {
    zones: [
      { id: 'arabian-sea', name: 'Arabian Sea' },
      { id: 'bay-of-bengal', name: 'Bay of Bengal' },
      { id: 'andaman-sea', name: 'Andaman Sea' },
      { id: 'south-china-sea', name: 'South China Sea' },
      { id: 'east-china-sea', name: 'East China Sea' },
      { id: 'philippine-sea', name: 'Philippine Sea and the Western Pacific' },
      { id: 'celebes-banda', name: 'Celebes and Banda Seas' },
      { id: 'java-sea', name: 'Java Sea' },
      { id: 'indian-ocean', name: 'Indian Ocean' },
      { id: 'timor-arafura', name: 'Timor and Arafura Seas' },
      { id: 'coral-sea', name: 'Coral Sea' },
      { id: 'southern-ocean', name: 'Southern Ocean' },
      { id: 'tasman-sea', name: 'Tasman Sea' },
      { id: 'south-pacific', name: 'South Pacific' },
    ],
    at: zone,
  },
  straits: [
    { id: 'malacca', name: 'Strait of Malacca', kind: 'strait', hexes: [[16, 14], [16, 15], [17, 15]], joins: ['andaman-sea', 'south-china-sea'] },
    { id: 'sunda', name: 'Sunda Strait', kind: 'strait', hexes: [[19, 18]], joins: ['java-sea', 'indian-ocean'] },
    { id: 'lombok', name: 'Lombok Strait', kind: 'strait', hexes: [[23, 19]], joins: ['java-sea', 'indian-ocean'] },
    { id: 'makassar', name: 'Makassar Strait', kind: 'strait', hexes: [[25, 16]], joins: ['celebes-banda', 'java-sea'] },
    { id: 'taiwan-strait', name: 'Taiwan Strait', kind: 'strait', hexes: [[25, 5], [25, 6]], joins: ['east-china-sea', 'south-china-sea'] },
    { id: 'luzon-strait', name: 'Luzon Strait', kind: 'strait', hexes: [[26, 7], [27, 7]], joins: ['south-china-sea', 'philippine-sea'] },
    // The Palk Strait joins no two seas: it is the narrows between India and Sri Lanka.
    { id: 'palk', name: 'Palk Strait', kind: 'strait', hexes: [[8, 12]] },
    { id: 'torres', name: 'Torres Strait', kind: 'strait', hexes: [[35, 20], [36, 20]], joins: ['timor-arafura', 'coral-sea'] },
    { id: 'bass', name: 'Bass Strait', kind: 'strait', hexes: [[36, 33], [37, 33]], joins: ['southern-ocean', 'tasman-sea'] },
    { id: 'cook', name: 'Cook Strait', kind: 'strait', hexes: [[49, 33]], joins: ['tasman-sea', 'south-pacific'] },
  ],
  resources: [
    { kind: 'oil', at: [17, 17], name: 'Sumatran fields' },
    { kind: 'oil', at: [24, 13], name: 'Sabah fields' },
    { kind: 'oil', at: [25, 24], name: 'North West Shelf' },
    { kind: 'oil', at: [0, 3], name: 'Balochistan gas' },
    { kind: 'rare-earths', at: [14, 5], name: 'Kachin mines' },
    { kind: 'rare-earths', at: [27, 28], name: 'Mount Weld' },
    { kind: 'chips', at: [27, 6], name: 'Hsinchu' },
    { kind: 'chips', at: [7, 9], name: 'Bengaluru' },
    { kind: 'chips', at: [18, 15], name: 'Singapore fabs' },
    { kind: 'food', at: [5, 3], name: 'The Punjab' },
    { kind: 'food', at: [17, 9], name: 'The Chao Phraya rice bowl' },
    { kind: 'food', at: [22, 19], name: 'Java rice terraces' },
    { kind: 'food', at: [35, 30], name: 'Murray-Darling Basin' },
  ],
};

export function generateIndoPac(): MapFile {
  return gridToMap(INDOPAC_SPEC);
}
