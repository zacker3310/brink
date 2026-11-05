import type { NationId } from '@brink/contracts';
import { type Biome, type MapFile, type MapNation, type MapSite, type MapTerrain } from '@brink/map';
import { hexCentre } from './coastline';
import { type GridSpec, gridToMap } from './grid';

// The Middle East and Africa theatre (docs/mideast.md) as a hand-finished character grid, turned
// into `packages/scenarios/src/maps/mideast.map.json` by `gridToMap`. The first draft was baked from
// Natural Earth's 1:50m admin-0 countries (public domain) over the box below, then finished by hand:
// the Levant, Suez, the Gulf and Bab-el-Mandeb are drawn a little wider than life so a country fits
// and a strait is one hex. Edit the grid here, then `pnpm --filter @brink/mapgen map:mideast`; a test
// checks the committed file matches byte for byte.
//
// One character per hex, odd rows half a hex east. `~` is sea and `+` unaligned land (states not in
// the war at this scale, and disputed ground, e.g. Western Sahara): nobody's, until an army takes it.
// Capitals are powers, lowercase are minor states.

const BOX = { west: -18, east: 63, north: 42, south: -35 };

const GRID = [
  '~~~~~+++++++~~~~~++~+++~~TTTTTTTTTT++~~~++++', // 0 Iberia, Italy, Greece, Anatolia, the Caucasus, the Caspian
  '~~~~+++++~~~~~~~~~+~++~~TTTTTTTTTTT+~~~+++++', // 1
  '~~~~~++++~~~~~~~~~~~~+~~TTTTTTTTTTIII~~III++', // 2
  '~~~~~~~~~aaaaa++~~~~~~~~~~~~rrrrqqIIIIIIIII+', // 3 Gibraltar at col 6
  '~~~~~mmmmaaaaa++~~~~~~~~~~+~~+rrqqqIIIIIIII+', // 4 Cyprus, Lebanon
  '~~~~mmmmaaaaaa+lll~~ll~~~~~~ijjqqqqqIIIIII++', // 5 Israel, Jordan
  '~~~~mmmaaaaaaaallllllllEEEEEEjSSSqqqIIIIIII+', // 6 Port Said at col 27: the Suez Canal
  '~~~mmaaaaaaaaalllllllllEEEE~EjSSSSS+~~IIIII+', // 7 the Gulf of Suez, Aqaba, Kuwait
  '~~+++aaaaaaaaalllllllllEEEEE~~SSSSSSS~~IIII+', // 8 the Gulf of Aqaba: Egypt and Saudi Arabia share no border
  '~++++aaaaaaaaalllllllllEEEEE~SSSSSSSS+~~~~I+', // 9 Hormuz at col 40, Qatar
  '~+++++kkaaaaaalllllllllEEEEEE~SSSSSSSS++oo~~', // 10 the Emirates, Musandam
  '++++++kkkaaaaannnncccclssssss~SSSSSSSSSooo~~', // 11
  '~++++++kkkkaaannnnnccccsssssss~SSSSSSSooo~~~', // 12
  '++++++kkkkkknnnnnncccccsssssss~SSSSSSwoo~~~~', // 13
  '+++kkkkkkkkknnnnnncccccsssssss+~wwwwwwo~~~~~', // 14
  '+++kkkkkk++nnnnnncccccsssssss++~wwwww~~~~~~~', // 15
  '~++kkkkk++nnNNNNNcccccsssssssee+~www~~~~~~~~', // 16 Bab-el-Mandeb at col 32
  '~++++kk++++NNNNNNcccccsssssseee+~~~~ff~~~~~~', // 17
  '~~++++++hh++NNNNNuccc+++++++eeeeefffff~~~~~~', // 18
  '~~~+++++hh+NNNNNuu++++++++++eeeeeefff~~~~~~~', // 19
  '~~~~++++hh+NNNNuuu++++++++++eeeeeffff~~~~~~~', // 20
  '~~~~~~~~~~~~~~uuu+++dddddd++yyeeefff~~~~~~~~', // 21
  '~~~~~~~~~~~~~~~uu+++ddddddd++yyyfff~~~~~~~~~', // 22
  '~~~~~~~~~~~~~~~++++ddddddd++yyyyf~~~~~~~~~~~', // 23
  '~~~~~~~~~~~~~~~++++ddddddd+++yyyf~~~~~~~~~~~', // 24
  '~~~~~~~~~~~~~~~+++dddddddd++++yy~~~~~~~~~~~~', // 25
  '~~~~~~~~~~~~~~~~++dddddddd+tttty~~~~~~~~~~~~', // 26
  '~~~~~~~~~~~~~~~~dgddddddddttttt~~~~~~~~~~~~~', // 27
  '~~~~~~~~~~~~~~~~~ggdggdddddttttt~~~~~~~~~~~~', // 28
  '~~~~~~~~~~~~~~~~~ggggdddd+ttttt~~~~~~~~~~~~~', // 29
  '~~~~~~~~~~~~~~~~~gggggg+d+tttttz~~~~~~~~~~~~', // 30
  '~~~~~~~~~~~~~~~~gggggg++++++zzzz~~~~+~~~~~~~', // 31 Madagascar
  '~~~~~~~~~~~~~~~~~ggggg+++++zzzzz~~~~++~~~~~~', // 32 Malawi, too narrow at this scale, inside Mozambique
  '~~~~~~~~~~~~~~~~gggggg+++++zzzz~~~+++~~~~~~~', // 33
  '~~~~~~~~~~~~~~~~~xxxxx+++bbbzz~~~~+++~~~~~~~', // 34
  '~~~~~~~~~~~~~~~~~xxxx+++bbbzz~~~~~++~~~~~~~~', // 35
  '~~~~~~~~~~~~~~~~~~xxx++++bbzz~~~~~++~~~~~~~~', // 36
  '~~~~~~~~~~~~~~~~~xxxx+++ZZZzz~~~~+++~~~~~~~~', // 37
  '~~~~~~~~~~~~~~~~~~xxx+++ZZZz~~~~~~~~~~~~~~~~', // 38
  '~~~~~~~~~~~~~~~~~~xxZZZZZZZ~~~~~~~~~~~~~~~~~', // 39
  '~~~~~~~~~~~~~~~~~~~ZZZZZZZZ~~~~~~~~~~~~~~~~~', // 40
  '~~~~~~~~~~~~~~~~~~~ZZZZZZZ~~~~~~~~~~~~~~~~~~', // 41
  '~~~~~~~~~~~~~~~~~~~~ZZZZZZ~~~~~~~~~~~~~~~~~~', // 42
  '~~~~~~~~~~~~~~~~~~~~ZZ~~~~~~~~~~~~~~~~~~~~~~', // 43 the Cape
];

const REGIONS: Record<string, NationId | null> = {
  '+': null,
  T: 'turkey',
  I: 'iran',
  S: 'saudi-arabia',
  E: 'egypt',
  N: 'nigeria',
  Z: 'south-africa',
  m: 'morocco',
  a: 'algeria',
  l: 'libya',
  k: 'mali',
  c: 'chad',
  s: 'sudan',
  e: 'ethiopia',
  f: 'somalia',
  y: 'kenya',
  d: 'dr-congo',
  g: 'angola',
  x: 'namibia',
  z: 'mozambique',
  q: 'iraq',
  r: 'syria',
  i: 'israel',
  j: 'jordan',
  w: 'yemen',
  o: 'oman',
  n: 'niger',
  h: 'ghana',
  u: 'cameroon',
  t: 'tanzania',
  b: 'zimbabwe',
};

const power = (id: NationId, name: string, short: string, color: string, government: MapNation['government'], terrainBias: number): MapNation => ({ id, name, short, color, government, role: 'power', capital: `${id}-capital`, terrainBias });
const minor = (id: NationId, name: string, short: string, color: string, government: MapNation['government'], terrainBias: number): MapNation => ({ id, name, short, color, government, role: 'minor', capital: `${id}-capital`, terrainBias });

const NATIONS: MapNation[] = [
  power('turkey', 'Turkey', 'Turkey', '#d64a4a', 'federation', 25),
  power('iran', 'Iran', 'Iran', '#3fae8c', 'union', 25),
  power('saudi-arabia', 'Saudi Arabia', 'Saudi', '#8fb83a', 'commonwealth', 0),
  power('egypt', 'Egypt', 'Egypt', '#e0b43c', 'directorate', 0),
  power('nigeria', 'Nigeria', 'Nigeria', '#4f8fe0', 'union', 0),
  power('south-africa', 'South Africa', 'S. Africa', '#e8e8ee', 'commonwealth', 10),
  minor('morocco', 'Morocco', 'Morocco', '#b9424f', 'commonwealth', 20),
  minor('algeria', 'Algeria', 'Algeria', '#5f9a62', 'directorate', 0),
  minor('libya', 'Libya', 'Libya', '#a8744a', 'directorate', 0),
  minor('mali', 'Mali', 'Mali', '#c9a35a', 'union', 0),
  minor('chad', 'Chad', 'Chad', '#6a7ab8', 'union', 0),
  minor('sudan', 'Sudan', 'Sudan', '#b07a5a', 'union', 0),
  minor('ethiopia', 'Ethiopia', 'Ethiopia', '#7a9a3a', 'union', 35),
  minor('somalia', 'Somalia', 'Somalia', '#6aa7d5', 'federation', 0),
  minor('kenya', 'Kenya', 'Kenya', '#c25a3a', 'commonwealth', 15),
  minor('dr-congo', 'DR Congo', 'DR Congo', '#3fa7b5', 'union', 0),
  minor('angola', 'Angola', 'Angola', '#b04a6a', 'directorate', 0),
  minor('namibia', 'Namibia', 'Namibia', '#c08ab0', 'commonwealth', 0),
  minor('mozambique', 'Mozambique', 'Mozamb.', '#8a5ab8', 'union', 0),
  minor('iraq', 'Iraq', 'Iraq', '#9a8a5a', 'directorate', 0),
  minor('syria', 'Syria', 'Syria', '#8a6a9a', 'directorate', 10),
  minor('israel', 'Israel', 'Israel', '#8ab0d8', 'federation', 10),
  minor('jordan', 'Jordan', 'Jordan', '#a06a8a', 'commonwealth', 0),
  minor('yemen', 'Yemen', 'Yemen', '#8a6a4a', 'union', 30),
  minor('oman', 'Oman', 'Oman', '#c96a4a', 'commonwealth', 10),
  minor('niger', 'Niger', 'Niger', '#d08a3a', 'union', 0),
  minor('ghana', 'Ghana', 'Ghana', '#5aa06a', 'commonwealth', 0),
  minor('cameroon', 'Cameroon', 'Cameroon', '#4a8a7a', 'union', 15),
  minor('tanzania', 'Tanzania', 'Tanzania', '#5a7ac0', 'union', 10),
  minor('zimbabwe', 'Zimbabwe', 'Zimbabwe', '#a85a5a', 'union', 10),
];

type Kind = MapSite['kind'];
const counters = new Map<string, number>();
/** A site: ids follow the Pacific's (`turkey-capital`, `turkey-city0`, `turkey-depot0`). */
function site(owner: NationId, kind: Kind, name: string, col: number, row: number, extra: Partial<MapSite> = {}): MapSite {
  const k = `${owner}-${kind}`;
  const n = counters.get(k) ?? 0;
  counters.set(k, n + 1);
  return { id: kind === 'capital' ? `${owner}-capital` : `${owner}-${kind}${n}`, kind, name, at: [col, row], owner, ...extra };
}

// A power's first two cities stand on its front (its opening army stands there); its first depot
// takes the recon screen. Victory points mark the prizes the war is about.
const SITES: MapSite[] = [
  site('turkey', 'capital', 'Ankara', 27, 1),
  site('turkey', 'city', 'Adana', 28, 2),
  site('turkey', 'city', 'Gaziantep', 30, 2),
  site('turkey', 'city', 'Istanbul', 25, 0),
  site('turkey', 'city', 'Izmir', 24, 2),
  site('turkey', 'depot', 'Erzurum', 32, 1),

  site('iran', 'capital', 'Tehran', 37, 3),
  site('iran', 'city', 'Ahvaz', 36, 6),
  site('iran', 'city', 'Tabriz', 35, 2),
  site('iran', 'city', 'Bandar Abbas', 40, 8),
  site('iran', 'city', 'Isfahan', 37, 5),
  site('iran', 'city', 'Mashhad', 42, 3),
  site('iran', 'depot', 'Shiraz', 38, 7),
  site('iran', 'depot', 'Chabahar', 42, 9),

  site('saudi-arabia', 'capital', 'Riyadh', 34, 9),
  site('saudi-arabia', 'city', 'Dammam', 36, 8),
  site('saudi-arabia', 'city', 'Najran', 33, 13),
  site('saudi-arabia', 'city', 'Jeddah', 30, 11),
  site('saudi-arabia', 'city', 'Tabuk', 30, 7),
  site('saudi-arabia', 'depot', 'Hail', 32, 8),

  site('egypt', 'capital', 'Cairo', 26, 7),
  site('egypt', 'city', 'Port Said', 27, 6),
  site('egypt', 'city', 'Aswan', 27, 10),
  site('egypt', 'city', 'Alexandria', 25, 6),
  site('egypt', 'depot', 'Marsa Matruh', 23, 6),

  site('nigeria', 'capital', 'Abuja', 13, 18),
  site('nigeria', 'city', 'Kano', 14, 17),
  site('nigeria', 'city', 'Lagos', 11, 20),
  site('nigeria', 'city', 'Port Harcourt', 13, 20),
  site('nigeria', 'depot', 'Maiduguri', 16, 17),

  site('south-africa', 'capital', 'Pretoria', 25, 38),
  site('south-africa', 'city', 'Polokwane', 25, 37),
  site('south-africa', 'city', 'Durban', 26, 40),
  site('south-africa', 'city', 'Cape Town', 20, 43),
  site('south-africa', 'city', 'Gqeberha', 23, 42),
  site('south-africa', 'city', 'Bloemfontein', 23, 40),
  site('south-africa', 'depot', 'Upington', 21, 40),

  site('morocco', 'capital', 'Rabat', 5, 4),
  site('morocco', 'city', 'Marrakesh', 5, 6),
  site('algeria', 'capital', 'Algiers', 11, 3),
  site('algeria', 'city', 'Oran', 9, 3),
  site('algeria', 'city', 'Tamanrasset', 12, 10),
  site('libya', 'capital', 'Tripoli', 16, 5),
  site('libya', 'city', 'Benghazi', 20, 5),
  site('mali', 'capital', 'Bamako', 5, 16),
  site('mali', 'city', 'Timbuktu', 8, 14),
  site('chad', 'capital', "N'Djamena", 17, 17),
  site('chad', 'city', 'Abéché', 21, 16),
  site('sudan', 'capital', 'Khartoum', 27, 15),
  site('sudan', 'city', 'Port Sudan', 29, 12),
  site('ethiopia', 'capital', 'Addis Ababa', 31, 18),
  site('ethiopia', 'city', 'Mekelle', 30, 16),
  site('somalia', 'capital', 'Mogadishu', 34, 22),
  site('somalia', 'city', 'Hargeisa', 34, 18),
  site('kenya', 'capital', 'Nairobi', 30, 24),
  site('kenya', 'city', 'Mombasa', 31, 26),
  site('dr-congo', 'capital', 'Kinshasa', 18, 26),
  site('dr-congo', 'city', 'Kisangani', 23, 23),
  site('dr-congo', 'city', 'Lubumbashi', 24, 30),
  site('angola', 'capital', 'Luanda', 17, 28),
  site('angola', 'city', 'Huambo', 18, 31),
  site('namibia', 'capital', 'Windhoek', 18, 37),
  site('namibia', 'city', 'Walvis Bay', 17, 37),
  site('mozambique', 'capital', 'Maputo', 27, 38),
  site('mozambique', 'city', 'Beira', 28, 35),
  site('mozambique', 'city', 'Nampula', 30, 32),
  site('iraq', 'capital', 'Baghdad', 34, 4),
  site('iraq', 'city', 'Mosul', 33, 3),
  site('iraq', 'city', 'Basra', 35, 6),
  site('syria', 'capital', 'Damascus', 30, 4),
  site('syria', 'city', 'Aleppo', 29, 3),
  site('israel', 'capital', 'Jerusalem', 28, 5),
  site('jordan', 'capital', 'Amman', 29, 5),
  site('yemen', 'capital', "Sana'a", 33, 15),
  site('yemen', 'city', 'Aden', 34, 16),
  site('oman', 'capital', 'Muscat', 41, 11),
  site('oman', 'city', 'Salalah', 38, 14),
  site('niger', 'capital', 'Niamey', 10, 16),
  site('niger', 'city', 'Agadez', 15, 13),
  site('ghana', 'capital', 'Accra', 9, 20),
  site('ghana', 'city', 'Kumasi', 8, 19),
  site('cameroon', 'capital', 'Yaoundé', 16, 22),
  site('cameroon', 'city', 'Douala', 14, 21),
  site('tanzania', 'capital', 'Dodoma', 28, 27),
  site('tanzania', 'city', 'Dar es Salaam', 31, 28),
  site('zimbabwe', 'capital', 'Harare', 26, 34),
  site('zimbabwe', 'city', 'Bulawayo', 24, 35),
];

// What the war is about: the oil states and the Levant between the four northern powers are worth
// more than a minor state's usual 6 and 4 points, and the states deep in the south and west worth
// less. Twenty AI-only matches at the usual points went to Nigeria and South Africa 19 times: the
// two southern powers had a dozen prizes to themselves while the four in the north fought over the rest.
const PRIZES: Readonly<Record<NationId, readonly [capital: number, city: number]>> = {
  iraq: [10, 6],
  syria: [9, 5],
  israel: [9, 5],
  jordan: [8, 5],
  yemen: [8, 5],
  oman: [8, 5],
  libya: [8, 5],
  sudan: [8, 5],
  mali: [4, 2],
  niger: [4, 2],
  chad: [4, 2],
  ghana: [4, 2],
  cameroon: [4, 2],
  'dr-congo': [4, 2],
  angola: [4, 2],
  namibia: [4, 2],
  mozambique: [4, 2],
  zimbabwe: [4, 2],
  tanzania: [4, 2],
};
for (const s of SITES) {
  const p = s.owner ? PRIZES[s.owner] : undefined;
  if (p && (s.kind === 'capital' || s.kind === 'city')) s.victoryPoints = s.kind === 'capital' ? p[0] : p[1];
}

const SEA_ZONES = [
  { id: 'atlantic', name: 'North Atlantic' },
  { id: 'mediterranean', name: 'Mediterranean' },
  { id: 'caspian', name: 'Caspian Sea' },
  { id: 'red-sea', name: 'Red Sea' },
  { id: 'persian-gulf', name: 'Persian Gulf' },
  { id: 'arabian-sea', name: 'Arabian Sea and the Gulf of Aden' },
  { id: 'gulf-of-guinea', name: 'Gulf of Guinea' },
  { id: 'south-atlantic', name: 'South Atlantic' },
  { id: 'indian-ocean', name: 'Indian Ocean' },
];

const RED_SEA = new Set(['27,7', '28,8', '29,8', '28,9', '29,10', '30,11', '30,12', '30,13', '31,14', '31,15', '32,16', '29,11']);
const GULF = new Set(['36,7', '37,7', '37,8', '38,8', '38,9', '39,9', '40,9']);

function zoneAt(col: number, row: number): string {
  const k = `${col},${row}`;
  if (RED_SEA.has(k)) return 'red-sea';
  if (GULF.has(k)) return 'persian-gulf';
  if (row <= 2 && col >= 36 && col <= 39) return 'caspian';
  if (row <= 6 && col >= 7) return 'mediterranean';
  if (row <= 18 && col <= 12) return 'atlantic';
  if (col <= 21) return row <= 28 ? 'gulf-of-guinea' : 'south-atlantic';
  return row <= 21 ? 'arabian-sea' : 'indian-ocean';
}

const ll = (col: number, row: number) => hexCentre(BOX, { cols: GRID[0]!.length, rows: GRID.length }, col, row);
const inBox = (lon: number, lat: number, w: number, e: number, s: number, n: number) => lon >= w && lon <= e && lat >= s && lat <= n;

/** The Zagros: a belt running north-west to south-east along Iran's border with Iraq and the Gulf. */
function zagros(lon: number, lat: number): boolean {
  if (lat < 27 || lat > 36) return false;
  const west = 45.5 + (35.5 - lat) * 1.2;
  return lon >= west && lon <= west + 3.5;
}

/** Ground for a land hex: deserts and the Sahel are open plains, the ranges are fixed, the rest the seed rolls. */
function terrain(col: number, row: number, owner: NationId | null): MapTerrain {
  const [lon, lat] = ll(col, row);
  // Ranges first.
  if (inBox(lon, lat, -9.5, -3, 30.5, 33)) return 'mountains'; // High Atlas
  if (inBox(lon, lat, -1, 9, 34.5, 37)) return 'hills'; // the Tell Atlas
  if (owner === 'turkey' && inBox(lon, lat, 39, 45, 38.5, 42)) return 'mountains'; // eastern Anatolia
  if (owner === 'turkey' && lat < 38.2) return 'hills'; // the Taurus
  if (owner === 'iran' && inBox(lon, lat, 49, 57, 35.3, 37.5)) return 'mountains'; // the Elburz
  if (owner === 'iran' && zagros(lon, lat)) return 'mountains';
  if (owner === 'iran' && inBox(lon, lat, 52, 61, 27, 35.3)) return 'plains'; // Dasht-e Kavir and the Lut
  if (inBox(lon, lat, 43, 46.5, 12.5, 17.5)) return 'mountains'; // Yemen's highlands
  if (inBox(lon, lat, 38.5, 43.5, 15.5, 25)) return 'hills'; // the Hejaz and Asir
  if (inBox(lon, lat, 55.5, 60, 22, 26)) return 'hills'; // the Hajar
  if (inBox(lon, lat, 35.5, 41, 8, 14.5)) return 'mountains'; // the Ethiopian Highlands
  if (inBox(lon, lat, 34, 41, 4, 8)) return 'hills';
  if (inBox(lon, lat, 34, 38.5, -3, 2)) return 'hills'; // the Kenyan highlands
  if (inBox(lon, lat, 27.5, 31, -31.5, -27)) return 'mountains'; // the Drakensberg
  if (inBox(lon, lat, 4, 8, 21.5, 25.5)) return 'hills'; // the Ahaggar
  if (inBox(lon, lat, 16, 20, 19, 22.5)) return 'hills'; // the Tibesti
  if (inBox(lon, lat, 35, 37, 33, 35)) return 'hills'; // Mount Lebanon
  // Forest: the Congo basin and the Guinea coast.
  if (inBox(lon, lat, 12, 30, -5.5, 4)) return 'forest';
  if (inBox(lon, lat, -13, 9, 4, 8)) return 'forest';
  // Open ground: the Sahara and the Sahel, Arabia, the Syrian desert and Mesopotamia, the Kalahari,
  // the Somali lowlands.
  if (lat >= 11 && lat <= 31.6 && lon <= 35) return 'plains';
  if (lat >= 15 && lat <= 32 && lon >= 35 && lon <= 56) return 'plains';
  if (inBox(lon, lat, 36, 48, 29, 35)) return 'plains';
  if (inBox(lon, lat, 11, 25, -28.5, -17)) return 'plains';
  if (inBox(lon, lat, 41, 52, -2, 9)) return 'plains';
  return 'seeded';
}

function biome(col: number, row: number, owner: NationId | null): Biome {
  const [lon, lat] = ll(col, row);
  const t = terrain(col, row, owner);
  if (t === 'mountains' || (t === 'hills' && (inBox(lon, lat, 34, 47, 4, 17.5) || owner === 'iran'))) return 'highland';
  if (inBox(lon, lat, 34, 41, -3, 14.5)) return 'highland';
  if (t === 'forest') return 'tropical';
  if (lat >= 15 && lat <= 31.6 && lon <= 56 && !(owner === 'egypt' && lat > 30.5)) return 'desert';
  if (inBox(lon, lat, 36, 48, 29, 33)) return 'desert';
  if (owner === 'iran' && inBox(lon, lat, 52, 61, 27, 35.3)) return 'desert';
  if (inBox(lon, lat, 11, 21, -28.5, -17)) return 'desert';
  if (lat >= 11 && lat < 15) return 'steppe';
  if (owner === 'turkey' || owner === 'iran' || inBox(lon, lat, 41, 52, -2, 11)) return 'steppe';
  if (lat >= 30) return 'subtropical';
  if (lat <= -24) return inBox(lon, lat, 21, 29, -31, -24) ? 'steppe' : 'subtropical';
  return 'tropical';
}

const SPEC: GridSpec = {
  id: 'mideast',
  name: 'Middle East and Africa',
  source:
    "Hand-finished from a bake of Natural Earth 1:50m admin-0 countries (public domain, naturalearthdata.com) over lon -18..63, lat -35..42; drawn wider than life in the Levant, at Suez and in the Gulf. Generated by packages/mapgen/src/mideast.ts.",
  grid: GRID,
  sea: '~',
  regions: REGIONS,
  nations: NATIONS,
  sites: SITES,
  terrain,
  seaZones: { zones: SEA_ZONES, at: zoneAt },
  biome,
  straits: [
    { id: 'gibraltar', name: 'Strait of Gibraltar', kind: 'strait', hexes: [[6, 3]], joins: ['atlantic', 'mediterranean'] },
    { id: 'suez', name: 'Suez Canal', kind: 'canal', hexes: [[27, 6]], joins: ['mediterranean', 'red-sea'] },
    { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb', kind: 'strait', hexes: [[32, 16]], joins: ['red-sea', 'arabian-sea'] },
    { id: 'hormuz', name: 'Strait of Hormuz', kind: 'strait', hexes: [[40, 9]], joins: ['persian-gulf', 'arabian-sea'] },
  ],
  resources: [
    { kind: 'oil', at: [36, 9], name: 'Ghawar' },
    { kind: 'oil', at: [35, 7], name: 'Burgan' },
    { kind: 'oil', at: [34, 6], name: 'Rumaila' },
    { kind: 'oil', at: [33, 4], name: 'Kirkuk' },
    { kind: 'oil', at: [37, 6], name: 'Khuzestan' },
    { kind: 'oil', at: [37, 9], name: 'North Field' },
    { kind: 'oil', at: [38, 10], name: 'Abu Dhabi fields' },
    { kind: 'oil', at: [19, 6], name: 'Sirte Basin' },
    { kind: 'oil', at: [12, 5], name: 'Hassi Messaoud' },
    { kind: 'oil', at: [12, 20], name: 'Niger Delta' },
    { kind: 'oil', at: [17, 27], name: 'Cabinda' },
    { kind: 'rare-earths', at: [23, 29], name: 'Katanga cobalt' },
    { kind: 'rare-earths', at: [25, 31], name: 'The Copperbelt' },
    { kind: 'rare-earths', at: [24, 38], name: 'Bushveld platinum' },
    { kind: 'rare-earths', at: [18, 36], name: 'Erongo uranium' },
    { kind: 'food', at: [26, 6], name: 'The Nile Delta' },
    { kind: 'food', at: [27, 14], name: 'The Gezira' },
    { kind: 'food', at: [23, 41], name: 'The Free State' },
  ],
};

/** The theatre's map file, as committed. */
export function mideastMap(): MapFile {
  return gridToMap(SPEC);
}
