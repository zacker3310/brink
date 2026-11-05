import type { HexKey, Nation, NationId, Relation, UnitClass, WorldState } from '@brink/contracts';
import { STACK_LIMIT, UNITS } from '@brink/game-data';
import { keyDistance, keyOf, neighborKeys, offsetToAxial } from '@brink/map';
import { computeVision, emptyIntel, grossYields, newFormation, pairKey, sortedKeys, updateIntel } from '@brink/simulation';
import { PACIFIC_ID } from './pacific';

// Opening Crises (docs/pacific.md): a story and a deterministic edit of the turn-1 Pacific world.
// A crisis is chosen at setup (dealt at random by default) and stored in `world.crisis`, so saves
// and replays carry it. Every edit leaves a legal world: no two nations at war share a hex, no hex
// holds more than STACK_LIMIT formations, and every landed force stands on ground its owner holds
// next to a site of its own, so it is in supply from turn 1.

export type CrisisId =
  | 'cold-peace'
  | 'korean-collapse'
  | 'straits-of-fire'
  | 'pearl-harbor'
  | 'red-dawn'
  | 'the-test'
  | 'operation-sombra'
  | 'maple-leaf-down'
  | 'kuril-gambit'
  | 'dragon-bear'
  | 'panama-shut'
  | 'ring-of-fire'
  | 'pacific-pact'
  | 'second-civil-war';

export interface Crisis {
  id: CrisisId;
  name: string;
  /** One line for a card. */
  hook: string;
  /** The briefing: what happened, in a few sentences. */
  story: string;
  /** What is different on turn 1, in plain words. */
  setup: string;
  /** 1 calm, 2 tense, 3 brutal (for the recommended side). */
  threat: 1 | 2 | 3;
  /** The power the story is about: the brief suggests it, never forces it. */
  recommended: NationId | null;
  apply: (w: WorldState) => void;
}

const POWERS: readonly NationId[] = ['china', 'japan', 'russia', 'usa'];

/** The West against the East: whose side each nation is on in the Pacific Pact. */
const WEST: readonly NationId[] = ['usa', 'japan', 'canada', 'mexico'];
const EAST: readonly NationId[] = ['russia', 'china'];

const cell = (col: number, row: number): HexKey => keyOf(offsetToAxial(col, row));

function site(w: WorldState, name: string) {
  const s = Object.values(w.sites).find((x) => x.name === name);
  if (!s) throw new Error(`crisis: no site ${name}`);
  return s;
}

function relate(w: WorldState, a: NationId, b: NationId, r: Relation): void {
  w.relations[pairKey(a, b)] = r;
}

/** Every pair of powers at peace (minor states keep their wars: they are ground to take). */
function calm(w: WorldState): void {
  for (let i = 0; i < POWERS.length; i++) for (let j = i + 1; j < POWERS.length; j++) relate(w, POWERS[i]!, POWERS[j]!, 'peace');
}

/** Hand a hex to a new owner; anyone else's formations there are lost (overrun, interned, gone). */
function seize(w: WorldState, key: HexKey, owner: NationId): void {
  const t = w.tiles[key];
  if (!t || t.terrain === 'water') throw new Error(`crisis: cannot seize ${key}`);
  t.owner = owner;
  for (const id of sortedKeys(w.formations)) {
    const f = w.formations[id]!;
    if (f.key === key && f.owner !== owner) delete w.formations[id];
  }
  if (t.siteId) {
    const s = w.sites[t.siteId]!;
    s.owner = owner;
  }
}

/** Formations landed on a hex its owner holds, up to the stacking limit. */
function land(w: WorldState, owner: NationId, key: HexKey, classes: readonly UnitClass[], name: string): void {
  if (w.tiles[key]?.owner !== owner) throw new Error(`crisis: ${owner} does not hold ${key}`);
  for (const c of classes) {
    const here = Object.values(w.formations).filter((f) => f.key === key).length;
    if (here >= STACK_LIMIT) return;
    const f = newFormation(w, owner, c, key, `${w.nations[owner]!.name} ${name}`);
    f.readiness = 80;
    f.organization = 70;
  }
}

/** Every formation of `owner` on these hexes down to a share of its strength. */
function batter(w: WorldState, owner: NationId, keys: readonly HexKey[], percent: number): void {
  for (const id of sortedKeys(w.formations)) {
    const f = w.formations[id]!;
    if (f.owner === owner && keys.includes(f.key)) {
      f.strength = Math.max(1, Math.floor((f.strength * percent) / 100));
      f.organization = Math.floor((f.organization * percent) / 100);
    }
  }
}

/** Ships put to sea in the open water off a site, never sharing a sea hex with another nation. */
function afloat(w: WorldState, owner: NationId, near: string, classes: readonly UnitClass[], name: string): void {
  const s = site(w, near);
  const sea = neighborKeys(s.key)
    .filter((k) => w.tiles[k]?.terrain === 'water')
    .sort();
  for (const c of classes) {
    const key = sea.find((k) => {
      const here = Object.values(w.formations).filter((f) => f.key === k && !f.aboard);
      return here.every((f) => f.owner === owner) && here.length < STACK_LIMIT;
    });
    if (!key) return;
    const f = newFormation(w, owner, c, key, `${w.nations[owner]!.name} ${name}`);
    f.readiness = 80;
    f.organization = 70;
  }
}

/** Every ship of `owner` down to a share of its strength (a fleet caught in harbour). */
function batterNavy(w: WorldState, owner: NationId, percent: number): void {
  for (const id of sortedKeys(w.formations)) {
    const f = w.formations[id]!;
    if (f.owner === owner && UNITS[f.unitClass].naval) {
      f.strength = Math.max(1, Math.floor((f.strength * percent) / 100));
      f.organization = Math.floor((f.organization * percent) / 100);
    }
  }
}

function shake(w: WorldState, n: NationId, stability: number, stockPercent = 100): void {
  const nation = w.nations[n]!;
  nation.stability = Math.max(0, Math.min(100, nation.stability + stability));
  for (const r of sortedKeys(nation.stockpile) as (keyof typeof nation.stockpile)[]) nation.stockpile[r] = Math.floor((nation.stockpile[r] * stockPercent) / 100);
}

export const CRISES: readonly Crisis[] = [
  {
    id: 'cold-peace',
    name: 'Cold Peace',
    hook: 'Nobody is at war. Yet.',
    story: 'Four superpowers, five nations caught between them, and every diplomat lying. The first army across a border decides who the rest gang up on.',
    setup: 'The powers start at peace with each other. The minor states are open ground for whoever moves first.',
    threat: 1,
    recommended: null,
    apply: (w) => calm(w),
  },
  {
    id: 'korean-collapse',
    name: 'Korean Collapse',
    hook: 'The Dear Leader dies on camera.',
    story: 'The army splits three ways within hours. Pyongyang goes dark, the border posts are empty, and every power has troops a day’s drive away.',
    setup: 'North Korea’s militia is shattered and its capital barely held. The powers start at peace: it is a race for the peninsula.',
    threat: 1,
    recommended: 'china',
    apply: (w) => {
      calm(w);
      batter(
        w,
        'nkorea',
        Object.values(w.formations)
          .filter((f) => f.owner === 'nkorea')
          .map((f) => f.key),
        25,
      );
      shake(w, 'nkorea', -45);
    },
  },
  {
    id: 'straits-of-fire',
    name: 'Straits of Fire',
    hook: 'China lands on Taiwan at dawn.',
    story: 'The PLA takes Kaohsiung in a night, then the mines and missiles turn the strait into a graveyard. Day three: the invasion is stalled short of Taipei and Tokyo is deciding what Article 9 still means.',
    setup: 'China holds Kaohsiung with a landing force and is at war with Taiwan and the United States. Japan and Russia are at peace with everyone.',
    threat: 2,
    recommended: 'china',
    apply: (w) => {
      calm(w);
      relate(w, 'china', 'usa', 'war');
      const k = site(w, 'Kaohsiung').key;
      seize(w, k, 'china');
      land(w, 'china', k, ['infantry', 'mechanized', 'infantry'], 'Strait Landing Force');
    },
  },
  {
    id: 'pearl-harbor',
    name: 'Pearl Harbor 2.0',
    hook: 'Hypersonics over Honolulu.',
    story: 'A nationalist coalition takes Tokyo after an acquittal in Okinawa. Forty minutes later the first missiles hit Pearl. The Pacific Fleet is a burning ring and Guam is cut off.',
    setup: 'Japan and the United States are at war. A Japanese strike group lies off Honolulu, its garrison is cut to a third, the US fleet is crippled and morale shaken. Russia and China watch.',
    threat: 3,
    recommended: 'usa',
    apply: (w) => {
      calm(w);
      relate(w, 'japan', 'usa', 'war');
      batter(w, 'usa', [site(w, 'Honolulu').key, site(w, 'Guam').key], 33);
      batterNavy(w, 'usa', 40);
      afloat(w, 'japan', 'Honolulu', ['fleet', 'carrier'], 'Strike Group');
      shake(w, 'usa', -15);
      shake(w, 'japan', 10);
    },
  },
  {
    id: 'red-dawn',
    name: 'Red Dawn, Arctic Edition',
    hook: 'Russian paratroopers hold Nome.',
    story: 'A storm grounds American surveillance for 72 hours. When it lifts, Russian paratroopers hold western Alaska and Anchorage’s airport is under artillery fire. Moscow calls it returning Russian America.',
    setup: 'Russia holds western Alaska with an airborne force and is at war with the United States. Anchorage is on the front line.',
    threat: 2,
    recommended: 'usa',
    apply: (w) => {
      calm(w);
      relate(w, 'russia', 'usa', 'war');
      // Western Alaska: the coast across the strait. Nome falls; the paratroopers dig in there.
      for (const k of [cell(26, 0), cell(26, 1), cell(27, 0), cell(26, 2)]) seize(w, k, 'russia');
      w.sites['nome'] = { id: 'nome', name: 'Nome', kind: 'depot', key: cell(26, 1), owner: 'russia', originalOwner: 'usa', population: 100, victoryPoints: 3, yields: { credits: 2, energy: 4, materials: 4, food: 2, industry: 4, research: 0 }, facilities: [] };
      w.tiles[cell(26, 1)]!.siteId = 'nome';
      w.tiles[cell(26, 1)]!.terrain = 'plains';
      land(w, 'russia', cell(26, 1), ['infantry', 'artillery', 'infantry'], 'Airborne');
      land(w, 'russia', cell(27, 0), ['infantry'], 'Airborne');
    },
  },
  {
    id: 'the-test',
    name: 'The Test',
    hook: 'A mushroom cloud over empty tundra.',
    story: 'Washington detonates a demonstration device in Siberia to halt a Russian push into Kazakhstan. It works too well: the fallout drifts over Chinese farmland, and Beijing’s streets fill.',
    setup: 'Russia and the United States are at war. Russia’s home front reels and its stockpile is half gone. China is furious at both and at war with neither.',
    threat: 2,
    recommended: 'china',
    apply: (w) => {
      calm(w);
      relate(w, 'russia', 'usa', 'war');
      shake(w, 'russia', -25, 50);
      shake(w, 'china', -10);
      shake(w, 'usa', -10);
    },
  },
  {
    id: 'operation-sombra',
    name: 'Operation Sombra',
    hook: 'The PLA lands in Mexico.',
    story: 'A cartel war topples Mexico City. Beijing answers a humanitarian request from a junta nobody recognises: two divisions land at Tijuana and destroyers sit off the coast. Washington wakes to a hostile army a day from San Diego.',
    setup: 'China holds Tijuana with an expeditionary corps, its fleet offshore, and is at war with the United States. Mexico’s militia is broken.',
    threat: 3,
    recommended: 'usa',
    apply: (w) => {
      calm(w);
      relate(w, 'china', 'usa', 'war');
      const k = site(w, 'Tijuana').key;
      seize(w, k, 'china');
      land(w, 'china', k, ['infantry', 'armor', 'infantry'], 'Expeditionary Corps');
      afloat(w, 'china', 'Tijuana', ['fleet', 'transport'], 'Task Force Sombra');
      batter(
        w,
        'mexico',
        Object.values(w.formations)
          .filter((f) => f.owner === 'mexico')
          .map((f) => f.key),
        40,
      );
    },
  },
  {
    id: 'maple-leaf-down',
    name: 'Maple Leaf Down',
    hook: 'Canada falls apart.',
    story: 'Ottawa collapses after a secession vote. Alberta asks Washington for protection; British Columbia asks Beijing for investment, and Beijing sends investors with rifles to Vancouver.',
    setup: 'China holds Vancouver, the United States holds Calgary, and the two are at war over what is left of Canada.',
    threat: 2,
    recommended: 'usa',
    apply: (w) => {
      calm(w);
      relate(w, 'china', 'usa', 'war');
      const van = site(w, 'Vancouver').key;
      const cal = site(w, 'Calgary').key;
      seize(w, van, 'china');
      seize(w, cal, 'usa');
      land(w, 'china', van, ['infantry', 'infantry', 'artillery'], 'Pacific Brigade');
      land(w, 'usa', cal, ['mechanized', 'infantry'], 'Alberta Task Force');
    },
  },
  {
    id: 'kuril-gambit',
    name: 'The Kuril Gambit',
    hook: 'Japan takes the Kurils in one night.',
    story: 'Japanese special forces retake the southern Kurils in a single night of landings. Moscow’s answer is coming, and Tokyo needs Washington to pick up the phone.',
    setup: 'Japan holds the Kurils and is at war with Russia. Japan and the United States start as allies.',
    threat: 3,
    recommended: 'japan',
    apply: (w) => {
      calm(w);
      relate(w, 'japan', 'russia', 'war');
      relate(w, 'japan', 'usa', 'alliance');
      const k = cell(22, 5);
      seize(w, k, 'japan');
      land(w, 'japan', k, ['infantry', 'recon'], 'Special Landing Force');
    },
  },
  {
    id: 'dragon-bear',
    name: 'Dragon and Bear Divorce',
    hook: 'China takes Vladivostok in 48 hours.',
    story: 'A border clash on the Amur becomes a blitz. Vladivostok falls in two days, the Pacific Fleet is trapped in harbour, and for the first time since 1945 Washington is courting Moscow.',
    setup: 'China holds Vladivostok and is at war with Russia. The United States and Japan are at peace with both.',
    threat: 3,
    recommended: 'russia',
    apply: (w) => {
      calm(w);
      relate(w, 'china', 'russia', 'war');
      const k = site(w, 'Vladivostok').key;
      seize(w, k, 'china');
      land(w, 'china', k, ['armor', 'mechanized', 'infantry'], 'Amur Front');
      shake(w, 'russia', -15);
    },
  },
  {
    id: 'panama-shut',
    name: 'Panama Shut',
    hook: 'A ship runs aground. On purpose.',
    story: 'A container ship grounds in the Panama Canal and the Atlantic fleet is locked out. Then Moscow and Beijing announce a mutual defence pact, and Mexico closes its airspace.',
    setup: 'Russia and China are allies, at war with the United States. American reserves are cut by a third and its Pacific fleet is under strength.',
    threat: 3,
    recommended: 'usa',
    apply: (w) => {
      calm(w);
      relate(w, 'china', 'russia', 'alliance');
      relate(w, 'china', 'usa', 'war');
      relate(w, 'russia', 'usa', 'war');
      shake(w, 'usa', -5, 66);
      batterNavy(w, 'usa', 60);
    },
  },
  {
    id: 'ring-of-fire',
    name: 'Ring of Fire',
    hook: 'A magnitude 9.2 splits Honshu.',
    story: 'Tokyo is dark, the army is digging people out of rubble, and three fleets have suddenly found humanitarian missions in Japanese waters. Survive the vultures.',
    setup: 'Japan’s stability, stockpile and army are crushed. Nobody is at war, yet; everyone is watching Japan.',
    threat: 3,
    recommended: 'japan',
    apply: (w) => {
      calm(w);
      shake(w, 'japan', -35, 40);
      batter(
        w,
        'japan',
        Object.values(w.formations)
          .filter((f) => f.owner === 'japan')
          .map((f) => f.key),
        60,
      );
    },
  },
  {
    id: 'pacific-pact',
    name: 'The Pacific Pact',
    hook: 'Two blocs. One ocean. No neutrals.',
    story: 'Washington, Tokyo, Ottawa and Mexico City sign a mutual defence treaty in Honolulu. Forty minutes later Moscow and Beijing announce a joint command and close the Sea of Japan. The Cold War is back, and this time it is hot.',
    setup: 'The United States, Japan, Canada and Mexico are allies, at war with Russia and China, who are allies too. Allies share supply, ground and sight. Korea, Taiwan, Kazakhstan and Mongolia are the ground between.',
    threat: 2,
    recommended: null,
    apply: (w) => {
      for (const side of [WEST, EAST]) for (let i = 0; i < side.length; i++) for (let j = i + 1; j < side.length; j++) relate(w, side[i]!, side[j]!, 'alliance');
      for (const a of WEST) for (const b of EAST) relate(w, a, b, 'war');
      // Nobody fights for an ally's capital: a power's prizes are the minor states it is at war with.
      for (const p of POWERS) {
        const n = w.nations[p]!;
        n.objectives = n.objectives.filter((id) => {
          const owner = w.sites[id]?.owner;
          return !!owner && w.relations[pairKey(p, owner)] === 'war';
        });
      }
    },
  },
  {
    id: 'second-civil-war',
    name: 'The Second Civil War',
    hook: 'The cities against the heartland. Everyone else smells blood.',
    story: 'A disputed election, then a general strike, then the governors stop taking Washington\'s calls. The interior declares the Heartland Republic in Houston with Russian money and Russian advisers. The coastal cities hold with Washington and beg Tokyo for help. Then Ottawa and Mexico City look at the map and send their armies south and north at once.',
    setup: 'The Heartland Republic, a new power, holds the American interior and Alaska from Houston, Denver and Atlanta, at war with the cities, allied with Russia. Every US city and the ground around it stays with Washington, allied with Japan. Canada and Mexico invade the cities, both at once. China watches.',
    threat: 3,
    recommended: 'usa',
    apply: (w) => {
      calm(w);
      const usa = w.nations.usa!;
      // The Heartland: everything American on the mainland that is not a city or next to one.
      const cityKeys = new Set(Object.values(w.sites).filter((x) => x.owner === 'usa' && (x.kind === 'capital' || x.kind === 'city')).map((x) => x.key));
      const urban = new Set([...cityKeys].flatMap((k) => [k, ...neighborKeys(k)]));
      const capital = site(w, 'Washington').key;
      const mainland = new Set<HexKey>([capital]);
      const queue = [capital];
      while (queue.length) {
        for (const n of neighborKeys(queue.pop()!)) {
          if (mainland.has(n) || !w.tiles[n] || w.tiles[n]!.terrain === 'water') continue;
          mainland.add(n);
          queue.push(n);
        }
      }
      const heartland: Nation = {
        ...(JSON.parse(JSON.stringify(usa)) as Nation),
        id: 'heartland',
        name: 'Heartland',
        color: '#b08a4e',
        government: 'union',
        stockpile: { credits: 480, energy: 240, materials: 300, food: 320 },
        productionQueue: [],
        construction: [],
        objectives: [...cityKeys].map((k) => w.tiles[k]!.siteId!).filter(Boolean),
        warLosses: 0,
      };
      w.nations.heartland = heartland;
      for (const key of sortedKeys(w.tiles)) {
        const t = w.tiles[key]!;
        if (t.owner !== 'usa' || !mainland.has(key) || urban.has(key)) continue;
        t.owner = 'heartland';
        if (t.siteId) w.sites[t.siteId]!.owner = 'heartland';
      }
      // Houston is the rebel capital.
      const houston = site(w, 'Houston');
      Object.assign(houston, { kind: 'capital', originalOwner: 'heartland', victoryPoints: 10, population: 1600 });
      houston.yields = { credits: 30, energy: 14, materials: 16, food: 18, industry: 30, research: 4 };
      w.tiles[houston.key]!.terrain = 'urban';
      // Units in the countryside go over to the Heartland; the cities keep theirs.
      for (const id of sortedKeys(w.formations)) {
        const f = w.formations[id]!;
        if (f.owner === 'usa' && !f.aboard && w.tiles[f.key]?.owner === 'heartland') f.owner = 'heartland';
      }
      land(w, 'heartland', houston.key, ['armor', 'mechanized', 'infantry'], 'Republican Guard');
      // Denver and Atlanta rise for the Republic: the interior's own cities, with their garrisons.
      for (const [col, row, name, id] of [
        [30, 9, 'Denver', 'heartland-denver'],
        [36, 12, 'Atlanta', 'heartland-atlanta'],
      ] as const) {
        // The named hex, or the nearest open Heartland ground to it.
        const want = cell(col, row);
        const key = sortedKeys(w.tiles)
          .filter((k) => w.tiles[k]!.owner === 'heartland' && !w.tiles[k]!.siteId && w.tiles[k]!.terrain !== 'water')
          .sort((a, b) => keyDistance(a, want) - keyDistance(b, want) || (a < b ? -1 : 1))[0]!;
        w.sites[id] = { id, name, kind: 'city', key, owner: 'heartland', originalOwner: 'heartland', population: 900, victoryPoints: 5, yields: { credits: 14, energy: 6, materials: 8, food: 9, industry: 16, research: 3 }, facilities: [] };
        Object.assign(w.tiles[key]!, { siteId: id, terrain: 'urban', infrastructure: 3 });
        land(w, 'heartland', key, ['infantry', 'mechanized', 'artillery'], `${name} Guard`);
      }
      // Militias rise outside each city.
      for (const k of sortedKeys(Object.fromEntries([...cityKeys].map((x) => [x, true])))) {
        const camp = sortedKeys(w.tiles).find((x) => w.tiles[x]!.owner === 'heartland' && !w.tiles[x]!.siteId && neighborKeys(x).some((n) => urban.has(n) && neighborKeys(n).includes(k)));
        if (camp) land(w, 'heartland', camp, ['infantry'], 'Militia');
      }
      // Canada and Mexico go to war as powers in their own right, and hit the cities at once.
      for (const m of ['canada', 'mexico'] as const) {
        delete w.nations[m]!.minor;
        relate(w, m, 'usa', 'war');
        relate(w, m, 'japan', 'war');
        relate(w, m, 'heartland', 'peace');
        relate(w, m, 'russia', 'peace');
        relate(w, m, 'china', 'peace');
        w.nations[m]!.stockpile = { credits: 280, energy: 140, materials: 180, food: 180 };
      }
      relate(w, 'canada', 'mexico', 'alliance');
      land(w, 'canada', site(w, 'Vancouver').key, ['armor', 'mechanized'], 'Pacific Command');
      land(w, 'canada', site(w, 'Ottawa').key, ['armor', 'mechanized'], 'Eastern Command');
      land(w, 'mexico', site(w, 'Tijuana').key, ['mechanized', 'armor'], 'Northern Army');
      land(w, 'mexico', site(w, 'Monterrey').key, ['mechanized', 'armor'], 'Gulf Army');
      // Moscow arms the Heartland and fights the cities; Tokyo stands with the cities.
      relate(w, 'heartland', 'usa', 'war');
      relate(w, 'heartland', 'russia', 'alliance');
      relate(w, 'russia', 'usa', 'war');
      relate(w, 'japan', 'usa', 'alliance');
      relate(w, 'heartland', 'japan', 'war');
      relate(w, 'heartland', 'china', 'peace');
      for (const n of sortedKeys(w.nations)) {
        if (n === 'heartland' || w.relations[pairKey(n, 'heartland')]) continue;
        relate(w, n, 'heartland', w.nations[n]!.minor ? 'peace' : 'war');
      }
      shake(w, 'usa', -20, 70);
      heartland.industrialCapacity = grossYields(w, 'heartland').industry;
      w.intel.heartland = emptyIntel();
    },
  },
];

/** The crises a theatre can open with: every one is written for the Pacific's map, so only it has any. */
export function crisesFor(theatre: string): readonly Crisis[] {
  return theatre === PACIFIC_ID ? CRISES : [];
}

export function crisisOf(id: string | undefined): Crisis | undefined {
  return CRISES.find((c) => c.id === id);
}

/** The crisis a seed deals when the player leaves it to chance: stable for a seed, like its codename. */
export function dealCrisis(seed: number): CrisisId {
  let h = Math.imul((seed ^ 0x27d4eb2f) >>> 0, 0x165667b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77) >>> 0;
  return CRISES[h % CRISES.length]!.id;
}

/** Apply a crisis to a fresh Pacific world, once. */
export function applyCrisis(w: WorldState, id: CrisisId): void {
  const c = crisisOf(id);
  if (!c) throw new Error(`unknown crisis: ${id}`);
  if (w.crisis) throw new Error('a campaign begins with one crisis');
  c.apply(w);
  w.crisis = id;
  // Every power's atlas shows the borders as the crisis left them, and what it now sees.
  for (const n of sortedKeys(w.intel)) {
    const intel = w.intel[n]!;
    for (const key of sortedKeys(w.tiles)) intel.knownOwner[key] = w.tiles[key]!.owner;
    updateIntel(w, n, computeVision(w, n), 0);
  }
}
