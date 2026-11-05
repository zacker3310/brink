import type { GovernmentId, NationId } from '@brink/contracts';
import type { Biome, Cell, MapFile, MapNation, MapResource, MapSeaZone, MapSite, MapStrait } from '@brink/map';
import { cellNeighbors } from '@brink/map';
import { gridToMap } from './grid';

// The European theatre (docs/europe.md): from the Atlantic to the Urals, from Svalbard and the Kola
// peninsula to North Africa and the Levant, on 56 x 32 hexes. One character per hex: `.` is sea,
// every other character a nation. The grid was baked from Natural Earth's 1:50m admin-0 countries
// (public domain) over the box 25W to 60E, 29.5N to 74N, equirectangular, a hex being land where four
// of its seven samples are, then finished by hand: Svalbard put in at the top edge, the Channel, the
// Gulf of Finland, the Turkish Straits and Gibraltar opened, Kaliningrad, Corsica, Sicily, Crete and
// Cyprus placed, Crimea drawn as Ukraine's. Regenerate the file with
// `pnpm --filter @brink/mapgen map:europe`; a test checks the committed file matches.

export const EUROPE_GRID: readonly string[] = [
  '..........................NN........................RR..',
  '...................................................RR...',
  '................................NNNNN...................',
  '............................NNNNNffRRRRR................',
  '..........................NNNSSSffffRRRRRRRR..R..RRRRRRR',
  '...iii...................NSSSSSSffffRRR.....RRRRRRRRRRRR',
  '..iiiii.................NNSSSSS..fffRRRR.R.RRRRRRRRRRRRR',
  '..iii.................NNSSSSS..ffffffRRRRRRRRRRRRRRRRRRR',
  '....................NNNNNSSS...ffffffRRRRRRRRRRRRRRRRRRR',
  '...................NNNNNSSSS..fffffRRRRRRRRRRRRRRRRRRRRR',
  '....................NNNNSSSSS......RRRRRRRRRRRRRRRRRRRRR',
  '.............U..........SSS.....xxRRRRRRRRRRRRRRRRRRRRRR',
  '.............UU.......DD.SS....vLLLRRRRRRRRRRRRRRRRRRRRR',
  '...........U.UU.......DD......RvvvQQQRRRRRRRRRRRRRRRRRRR',
  '..........eee.UUU.....GGGGPPPPPPQQQQQQRRRRRRRRRRRRRRRRRR',
  '..........ee.UUUU..BBGGGGGPPPPPPQQQQQRRRRRRRRRRRRRRRRRRR',
  '..............UUU.BBBGGGGGGPPPPPPKKKKKKKRRRRRRRRRzzzzRRR',
  '.................FFFGGGGCCCCPPPKKKKKKKKKKKRRRRRzzzzzzzzz',
  '..............FFFFFFFFGGGAAAkkhKKKKKKKKKKKKRRRRRzzzzzzzz',
  '...............FFFFFHHHIAAAhhhOOOOOMKKKKKRRRRRRRRz.zzzzz',
  '................FFFFFIIII.WWWWOOOOOMK..K..RRRRRRR...zzzz',
  '...............FFFFFFI.I..WWWWWOOOOO..K...RRRRR...zzzzzz',
  '...........EEEEEEFF.....II...WWWbbbb........jjjR...zzzzz',
  '..........ppEEEEEE....F..II..WWggTT.TTTTT...TjZZZ...zzzz',
  '...........pEEEEE..........I..gg....TTTTTTTTTTrZZZ..zzzz',
  '..........pEEEEE......I.......gg..TTTTTTTTTTTTnnZ...zzzz',
  '...........pEEE..........II....g...TTTTTTTTTTqnnnn..nnnn',
  '................aaaaaat.........g.......ssssqqqnnnnnnnnn',
  '............mmmaaaaaaat...............c.ssssqqqnnnnnnnnn',
  '..........mmmmmaaaaaattt...............lsJqqqqqnnnnnnnnn',
  '..........mmmmaaaaaaaaatyyy...yyyYYYY..lJJJJqqqqnnnnnnnn',
  '..........mmmaaaaaaaaayyyyyyyyyyyYYYYYYJJJJJJqqqnnnnnnnn',
];

interface NationRow {
  ch: string;
  id: NationId;
  name: string;
  short: string;
  color: string;
  government: GovernmentId;
  bias: number;
}

const power = (ch: string, id: NationId, name: string, short: string, color: string, government: GovernmentId, bias: number): NationRow & { role: 'power' } => ({ ch, id, name, short, color, government, bias, role: 'power' });
const minor = (ch: string, id: NationId, name: string, short: string, color: string, government: GovernmentId, bias: number): NationRow & { role: 'minor' } => ({ ch, id, name, short, color, government, bias, role: 'minor' });

/** The six powers, then the minor states, west to east and north to south. */
const NATIONS = [
  power('U', 'uk', 'United Kingdom', 'UK', '#4f7fe0', 'commonwealth', 10),
  power('F', 'france', 'France', 'France', '#46b8c8', 'federation', 5),
  power('G', 'germany', 'Germany', 'Germany', '#d4b03a', 'commonwealth', 0),
  power('P', 'poland', 'Poland', 'Poland', '#c75aa6', 'union', -10),
  power('R', 'russia', 'Russia', 'Russia', '#d0543e', 'directorate', 15),
  power('T', 'turkey', 'Turkey', 'Turkey', '#e58a35', 'directorate', 25),
  minor('i', 'iceland', 'Iceland', 'Iceland', '#9fb8c8', 'federation', 30),
  minor('e', 'ireland', 'Ireland', 'Ireland', '#3e9a62', 'commonwealth', 0),
  minor('N', 'norway', 'Norway', 'Norway', '#b9424f', 'commonwealth', 40),
  minor('S', 'sweden', 'Sweden', 'Sweden', '#5a8fb8', 'federation', 20),
  minor('f', 'finland', 'Finland', 'Finland', '#e8e8ee', 'federation', 20),
  minor('D', 'denmark', 'Denmark', 'Denmark', '#c86a6a', 'commonwealth', -20),
  minor('B', 'benelux', 'Benelux', 'Benelux', '#e09a5a', 'commonwealth', -25),
  minor('p', 'portugal', 'Portugal', 'Portugal', '#4f9a52', 'commonwealth', 10),
  minor('E', 'spain', 'Spain', 'Spain', '#e0c45a', 'commonwealth', 20),
  minor('I', 'italy', 'Italy', 'Italy', '#5ab87a', 'federation', 25),
  minor('H', 'switzerland', 'Switzerland', 'Swiss', '#e05050', 'federation', 60),
  minor('A', 'austria', 'Austria', 'Austria', '#e8a0a0', 'federation', 45),
  minor('C', 'czechia', 'Czechia', 'Czechia', '#6a7ac8', 'federation', 15),
  minor('k', 'slovakia', 'Slovakia', 'Slovakia', '#7aa0d8', 'union', 30),
  minor('h', 'hungary', 'Hungary', 'Hungary', '#7ab05a', 'union', -20),
  minor('W', 'balkans', 'Western Balkans', 'W. Balkans', '#a8744a', 'union', 40),
  minor('O', 'romania', 'Romania', 'Romania', '#e0d06a', 'union', 20),
  minor('M', 'moldova', 'Moldova', 'Moldova', '#c8b06a', 'union', 0),
  minor('b', 'bulgaria', 'Bulgaria', 'Bulgaria', '#6ab89a', 'union', 30),
  minor('g', 'greece', 'Greece', 'Greece', '#6aa8e0', 'commonwealth', 35),
  minor('c', 'cyprus', 'Cyprus', 'Cyprus', '#d8b080', 'commonwealth', 10),
  minor('K', 'ukraine', 'Ukraine', 'Ukraine', '#5a9ae0', 'union', -25),
  minor('Q', 'belarus', 'Belarus', 'Belarus', '#8a5ab8', 'directorate', 0),
  minor('x', 'estonia', 'Estonia', 'Estonia', '#4a8ac0', 'federation', 10),
  minor('L', 'latvia', 'Latvia', 'Latvia', '#a04a5a', 'federation', 10),
  minor('v', 'lithuania', 'Lithuania', 'Lithuania', '#b8a03a', 'federation', 5),
  minor('j', 'georgia', 'Georgia', 'Georgia', '#c84a4a', 'union', 55),
  minor('r', 'armenia', 'Armenia', 'Armenia', '#d88a3a', 'union', 55),
  minor('Z', 'azerbaijan', 'Azerbaijan', 'Azerb.', '#3fa7b5', 'directorate', 30),
  minor('z', 'kazakhstan', 'Kazakhstan', 'Kazakh.', '#8fae3a', 'directorate', -15),
  minor('n', 'iran', 'Iran', 'Iran', '#4aa05a', 'directorate', 45),
  minor('q', 'iraq', 'Iraq', 'Iraq', '#b0905a', 'directorate', -10),
  minor('s', 'syria', 'Syria', 'Syria', '#a85a6a', 'directorate', 15),
  minor('l', 'israel', 'Israel', 'Israel', '#7ab8e8', 'federation', 10),
  minor('J', 'jordan', 'Jordan', 'Jordan', '#9a8a6a', 'commonwealth', 10),
  minor('Y', 'egypt', 'Egypt', 'Egypt', '#d0a05a', 'directorate', -20),
  minor('y', 'libya', 'Libya', 'Libya', '#7a9a4a', 'directorate', -15),
  minor('t', 'tunisia', 'Tunisia', 'Tunisia', '#c86a8a', 'union', 0),
  minor('a', 'algeria', 'Algeria', 'Algeria', '#5aa07a', 'directorate', 0),
  minor('m', 'morocco', 'Morocco', 'Morocco', '#c0603a', 'union', 25),
];

type Kind = MapSite['kind'];
type SiteRow = [owner: NationId, kind: Kind, name: string, col: number, row: number, extra?: Pick<MapSite, 'victoryPoints' | 'profile'>];

/**
 * Every site, in each nation's order: the capital, then the cities (a power's first two hold its
 * field army: city0 its mechanized spearhead and drones, city1 its guns), then the depots (the first
 * holds the recon screen).
 */
const SITES: readonly SiteRow[] = [
  // The United Kingdom: London, the fleet at Portsmouth, the north, Northern Ireland.
  ['uk', 'capital', 'London', 16, 16],
  ['uk', 'city', 'Portsmouth', 14, 16],
  ['uk', 'city', 'Manchester', 15, 14],
  ['uk', 'city', 'Glasgow', 13, 12],
  ['uk', 'city', 'Belfast', 11, 13],
  ['uk', 'city', 'Birmingham', 14, 15],
  ['uk', 'city', 'Edinburgh', 14, 12],
  ['uk', 'depot', 'Rosyth', 14, 13],
  // France: the Rhine front, Lyon, the Mediterranean fleet at Toulon, the Atlantic at Brest.
  ['france', 'capital', 'Paris', 18, 18],
  ['france', 'city', 'Strasbourg', 21, 18],
  ['france', 'city', 'Lyon', 19, 20],
  ['france', 'city', 'Toulon', 20, 21],
  ['france', 'city', 'Brest', 14, 18],
  ['france', 'city', 'Bordeaux', 16, 20],
  ['france', 'depot', 'Verdun', 20, 18],
  ['france', 'depot', 'Ajaccio', 22, 23, { profile: 'outpost' }],
  // Germany: Berlin on the Oder, the west at Frankfurt, Bavaria, the ports.
  ['germany', 'capital', 'Berlin', 25, 15],
  ['germany', 'city', 'Frankfurt', 22, 17],
  ['germany', 'city', 'Munich', 23, 18],
  ['germany', 'city', 'Hamburg', 22, 14],
  ['germany', 'city', 'Kiel', 24, 14],
  ['germany', 'city', 'Cologne', 21, 16],
  ['germany', 'city', 'Dresden', 26, 16],
  ['germany', 'city', 'Stuttgart', 21, 17],
  ['germany', 'depot', 'Leipzig', 24, 16],
  // Poland: Warsaw, Gdansk facing Kaliningrad, Krakow, Poznan, Lublin; the Suwalki depot.
  ['poland', 'capital', 'Warsaw', 30, 15],
  ['poland', 'city', 'Gdansk', 29, 14],
  ['poland', 'city', 'Krakow', 29, 17],
  ['poland', 'city', 'Poznan', 27, 15],
  ['poland', 'city', 'Lublin', 32, 16],
  ['poland', 'city', 'Szczecin', 26, 14],
  ['poland', 'city', 'Wroclaw', 28, 16],
  ['poland', 'city', 'Bialystok', 31, 15],
  ['poland', 'depot', 'Suwalki', 31, 14],
  // Russia: Moscow, the north-western front, Kaliningrad, the Northern and Black Sea fleets, the Volga.
  ['russia', 'capital', 'Moscow', 41, 13],
  ['russia', 'city', 'St Petersburg', 35, 10],
  ['russia', 'city', 'Smolensk', 37, 13],
  ['russia', 'city', 'Kaliningrad', 30, 13],
  ['russia', 'city', 'Murmansk', 38, 3],
  ['russia', 'city', 'Novorossiysk', 42, 21],
  ['russia', 'city', 'Rostov', 42, 19],
  ['russia', 'city', 'Volgograd', 46, 18],
  ['russia', 'city', 'Kazan', 48, 13],
  ['russia', 'depot', 'Pskov', 35, 12],
  ['russia', 'depot', 'Voronezh', 42, 16],
  ['russia', 'depot', 'Arkhangelsk', 43, 6],
  // Turkey: Ankara, Istanbul on the European shore of the Bosphorus, Izmir on the Aegean.
  ['turkey', 'capital', 'Ankara', 38, 24],
  ['turkey', 'city', 'Istanbul', 34, 23],
  ['turkey', 'city', 'Izmir', 34, 25],
  ['turkey', 'city', 'Adana', 40, 26],
  ['turkey', 'city', 'Trabzon', 42, 24],
  ['turkey', 'depot', 'Edirne', 33, 23],
  ['turkey', 'depot', 'Erzurum', 44, 24],
  // The minor states.
  ['iceland', 'capital', 'Reykjavik', 2, 7, { victoryPoints: 4 }],
  ['ireland', 'capital', 'Dublin', 12, 14],
  ['ireland', 'city', 'Cork', 10, 15],
  ['norway', 'capital', 'Oslo', 23, 10],
  ['norway', 'city', 'Bergen', 19, 9],
  ['norway', 'city', 'Tromso', 28, 3],
  ['norway', 'depot', 'Longyearbyen', 26, 0, { profile: 'outpost' }],
  ['sweden', 'capital', 'Stockholm', 28, 10],
  ['sweden', 'city', 'Gothenburg', 24, 11],
  ['sweden', 'city', 'Umea', 30, 6],
  ['finland', 'capital', 'Helsinki', 32, 9],
  ['finland', 'city', 'Oulu', 33, 6],
  ['denmark', 'capital', 'Copenhagen', 23, 13],
  ['denmark', 'city', 'Aarhus', 22, 12],
  ['benelux', 'capital', 'Brussels', 19, 16, { victoryPoints: 8 }],
  ['benelux', 'city', 'Amsterdam', 19, 15],
  ['portugal', 'capital', 'Lisbon', 10, 25],
  ['portugal', 'city', 'Porto', 10, 23],
  ['spain', 'capital', 'Madrid', 14, 24, { victoryPoints: 8 }],
  ['spain', 'city', 'Barcelona', 17, 23],
  ['spain', 'city', 'Seville', 12, 26],
  ['spain', 'city', 'Bilbao', 14, 22],
  ['italy', 'capital', 'Rome', 24, 22, { victoryPoints: 8 }],
  ['italy', 'city', 'Milan', 22, 20],
  ['italy', 'city', 'Naples', 25, 23],
  ['italy', 'city', 'Palermo', 25, 26],
  ['switzerland', 'capital', 'Bern', 21, 19],
  ['austria', 'capital', 'Vienna', 27, 18],
  ['austria', 'city', 'Graz', 25, 19],
  ['czechia', 'capital', 'Prague', 25, 17],
  ['czechia', 'city', 'Brno', 27, 17],
  ['slovakia', 'capital', 'Bratislava', 28, 18, { victoryPoints: 4 }],
  ['hungary', 'capital', 'Budapest', 28, 19],
  ['hungary', 'city', 'Debrecen', 30, 18],
  ['balkans', 'capital', 'Belgrade', 29, 21],
  ['balkans', 'city', 'Zagreb', 27, 20],
  ['balkans', 'city', 'Tirana', 29, 23],
  ['romania', 'capital', 'Bucharest', 33, 21],
  ['romania', 'city', 'Cluj', 31, 19],
  ['romania', 'city', 'Constanta', 35, 21],
  ['moldova', 'capital', 'Chisinau', 35, 19, { victoryPoints: 4 }],
  ['bulgaria', 'capital', 'Sofia', 32, 22],
  ['bulgaria', 'city', 'Varna', 35, 22],
  ['greece', 'capital', 'Athens', 31, 25],
  ['greece', 'city', 'Thessaloniki', 31, 23],
  ['greece', 'city', 'Heraklion', 32, 27],
  ['cyprus', 'capital', 'Nicosia', 38, 28, { victoryPoints: 4 }],
  ['ukraine', 'capital', 'Kyiv', 36, 16, { victoryPoints: 9 }],
  ['ukraine', 'city', 'Kharkiv', 40, 17],
  ['ukraine', 'city', 'Odesa', 36, 19],
  ['ukraine', 'city', 'Lviv', 32, 17],
  ['ukraine', 'city', 'Sevastopol', 38, 21],
  ['belarus', 'capital', 'Minsk', 34, 14],
  ['belarus', 'city', 'Gomel', 36, 15],
  ['estonia', 'capital', 'Tallinn', 33, 11, { victoryPoints: 5 }],
  ['latvia', 'capital', 'Riga', 32, 12, { victoryPoints: 5 }],
  ['lithuania', 'capital', 'Vilnius', 33, 13, { victoryPoints: 5 }],
  ['georgia', 'capital', 'Tbilisi', 45, 23],
  ['armenia', 'capital', 'Yerevan', 46, 24, { victoryPoints: 4 }],
  ['azerbaijan', 'capital', 'Baku', 49, 24],
  ['kazakhstan', 'capital', 'Aktobe', 54, 17],
  ['kazakhstan', 'city', 'Atyrau', 51, 19],
  ['iran', 'capital', 'Tehran', 50, 27],
  ['iran', 'city', 'Tabriz', 46, 25],
  ['iran', 'city', 'Mashhad', 55, 27],
  ['iraq', 'capital', 'Baghdad', 45, 29],
  ['iraq', 'city', 'Mosul', 44, 27],
  ['iraq', 'city', 'Basra', 47, 31],
  ['syria', 'capital', 'Damascus', 40, 29],
  ['syria', 'city', 'Aleppo', 41, 27],
  ['israel', 'capital', 'Jerusalem', 39, 30],
  ['israel', 'city', 'Haifa', 39, 29],
  ['jordan', 'capital', 'Amman', 41, 30],
  ['egypt', 'capital', 'Cairo', 36, 31],
  ['egypt', 'city', 'Alexandria', 35, 30],
  ['libya', 'capital', 'Tripoli', 24, 30],
  ['libya', 'city', 'Benghazi', 30, 30],
  ['tunisia', 'capital', 'Tunis', 22, 27],
  ['algeria', 'capital', 'Algiers', 18, 27],
  ['algeria', 'city', 'Oran', 16, 27],
  ['morocco', 'capital', 'Rabat', 12, 28],
  ['morocco', 'city', 'Casablanca', 10, 30],
];

const ZONES: readonly (MapSeaZone & { seeds: Cell[] })[] = [
  { id: 'north-atlantic', name: 'North Atlantic', seeds: [[4, 18], [8, 11], [13, 14]] },
  { id: 'norwegian-sea', name: 'Norwegian Sea', seeds: [[14, 5], [6, 2]] },
  { id: 'barents', name: 'Barents and White Seas', seeds: [[42, 1]] },
  { id: 'north-sea', name: 'North Sea', seeds: [[18, 12]] },
  { id: 'baltic', name: 'Baltic Sea', seeds: [[27, 12]] },
  { id: 'western-med', name: 'Western Mediterranean', seeds: [[18, 24]] },
  { id: 'central-med', name: 'Central Mediterranean', seeds: [[27, 27]] },
  { id: 'aegean', name: 'Aegean Sea', seeds: [[32, 25]] },
  { id: 'marmara', name: 'Sea of Marmara', seeds: [[35, 24]] },
  { id: 'levant', name: 'Eastern Mediterranean', seeds: [[36, 28]] },
  { id: 'black-sea', name: 'Black Sea', seeds: [[39, 22]] },
  { id: 'caspian', name: 'Caspian Sea', seeds: [[49, 21]] },
];

/** Sea hexes whose zone is fixed, so a zone ends at its strait (they do not spread a zone either). */
const FIXED: readonly [Cell, string][] = [
  [[16, 17], 'north-atlantic'],
  [[17, 16], 'north-sea'],
  [[24, 12], 'baltic'],
  [[12, 27], 'western-med'],
  [[35, 23], 'black-sea'],
  [[34, 24], 'marmara'],
  [[35, 24], 'marmara'],
];

const STRAITS: MapStrait[] = [
  { id: 'giuk-gap', name: 'GIUK gap', kind: 'strait', hexes: [[6, 8], [7, 9], [9, 9], [10, 10], [12, 10]], joins: ['north-atlantic', 'norwegian-sea'] },
  { id: 'english-channel', name: 'English Channel', kind: 'strait', hexes: [[16, 17], [17, 16]], joins: ['north-atlantic', 'north-sea'] },
  { id: 'oresund', name: 'Danish Straits', kind: 'strait', hexes: [[24, 12]], joins: ['north-sea', 'baltic'] },
  { id: 'gibraltar', name: 'Strait of Gibraltar', kind: 'strait', hexes: [[12, 27]], joins: ['north-atlantic', 'western-med'] },
  { id: 'bosphorus', name: 'Bosphorus', kind: 'strait', hexes: [[35, 23]], joins: ['black-sea', 'marmara'] },
  { id: 'dardanelles', name: 'Dardanelles', kind: 'strait', hexes: [[34, 24]], joins: ['marmara', 'aegean'] },
  { id: 'kerch', name: 'Kerch Strait', kind: 'strait', hexes: [[40, 20]] },
  { id: 'suwalki', name: 'Suwalki corridor', kind: 'land-bridge', hexes: [[31, 14], [31, 13]] },
];

const RESOURCES: MapResource[] = [
  { kind: 'oil', at: [14, 12], name: 'North Sea oil (Aberdeen)' },
  { kind: 'oil', at: [48, 24], name: 'Baku fields' },
  { kind: 'oil', at: [52, 14], name: 'Volga-Urals fields' },
  { kind: 'oil', at: [45, 28], name: 'Kirkuk' },
  { kind: 'oil', at: [20, 30], name: 'Hassi Messaoud' },
  { kind: 'oil', at: [28, 31], name: 'Sirte Basin' },
  { kind: 'food', at: [38, 18], name: 'The black earth' },
  { kind: 'food', at: [17, 19], name: 'The Paris Basin' },
  { kind: 'chips', at: [20, 15], name: 'Eindhoven' },
  { kind: 'chips', at: [26, 16], name: 'Silicon Saxony' },
  { kind: 'rare-earths', at: [40, 4], name: 'Lovozero' },
  { kind: 'rare-earths', at: [29, 4], name: 'Kiruna' },
];

const COLS = EUROPE_GRID[0]!.length;
const ROWS = EUROPE_GRID.length;
const isSea = (c: number, r: number) => EUROPE_GRID[r]![c] === '.';

/** Every sea hex's zone: the fixed hexes, then a breadth-first spread from each zone's seed. */
function seaZoneOf(): (c: number, r: number) => string {
  const zone = new Map<string, string>();
  const k = (c: number, r: number) => `${c},${r}`;
  for (const [[c, r], z] of FIXED) zone.set(k(c, r), z);
  let ring: [Cell, string][] = ZONES.flatMap((z) => z.seeds.map((s): [Cell, string] => [s, z.id]));
  for (const [[c, r], z] of ring) zone.set(k(c, r), z);
  while (ring.length) {
    const next: [Cell, string][] = [];
    for (const [cell, z] of ring)
      for (const [c, r] of cellNeighbors({ cols: COLS, rows: ROWS }, cell)) {
        if (!isSea(c, r) || zone.has(k(c, r))) continue;
        zone.set(k(c, r), z);
        next.push([[c, r], z]);
      }
    ring = next;
  }
  return (c, r) => zone.get(k(c, r)) ?? `unzoned ${c},${r}`;
}

const SUBTROPICAL = new Set<NationId>(['portugal', 'spain', 'italy', 'greece', 'cyprus', 'israel', 'syria', 'tunisia', 'morocco', 'algeria']);
const DESERT = new Set<NationId>(['egypt', 'libya', 'jordan', 'iraq']);
const HIGHLAND = new Set<NationId>(['switzerland', 'austria', 'georgia', 'armenia', 'iran']);

/** What the ground looks like: ice and tundra in the far north, the taiga, the plains, the steppe, the Mediterranean, the desert. */
function biomeOf(c: number, r: number, owner: NationId | null): Biome {
  if (r <= 1) return 'ice';
  if (owner === 'iceland' || r <= 4) return 'tundra';
  if (owner && HIGHLAND.has(owner)) return 'highland';
  if (owner && DESERT.has(owner)) return r <= 28 && owner === 'iraq' ? 'steppe' : 'desert';
  if (owner === 'algeria' && r >= 29) return 'desert';
  if (owner && SUBTROPICAL.has(owner)) return 'subtropical';
  if (owner === 'turkey') return c >= 38 ? 'highland' : 'subtropical';
  if (owner === 'kazakhstan' || owner === 'azerbaijan') return 'steppe';
  if (r <= 10) return 'boreal';
  if ((owner === 'russia' || owner === 'ukraine') && r >= 16 && c >= 38) return 'steppe';
  if (r >= 21) return 'subtropical';
  return 'temperate';
}

export function europeMap(): MapFile {
  const regions: Record<string, NationId> = {};
  const nations: MapNation[] = NATIONS.map((n) => {
    regions[n.ch] = n.id;
    return { id: n.id, name: n.name, short: n.short, color: n.color, government: n.government, role: n.role, capital: `${n.id}-capital`, ...(n.bias ? { terrainBias: n.bias } : {}) };
  });
  const counts = new Map<string, number>();
  const sites: MapSite[] = SITES.map(([owner, kind, name, col, row, extra]) => {
    let id = `${owner}-capital`;
    if (kind !== 'capital') {
      const key = `${owner}-${kind}`;
      const i = counts.get(key) ?? 0;
      counts.set(key, i + 1);
      id = `${key}${i}`;
    }
    return { id, kind, name, at: [col, row], owner, ...(extra ?? {}) };
  });
  return gridToMap({
    id: 'europe',
    name: 'Europe',
    source:
      "Natural Earth 1:50m admin-0 countries (public domain, naturalearthdata.com), baked over 25W-60E, 29.5N-74N and finished by hand in packages/mapgen/src/europe.ts.",
    grid: EUROPE_GRID,
    sea: '.',
    regions,
    nations,
    sites,
    seaZones: { zones: ZONES.map(({ id, name }) => ({ id, name })), at: seaZoneOf() },
    biome: biomeOf,
    straits: STRAITS,
    resources: RESOURCES,
  });
}
