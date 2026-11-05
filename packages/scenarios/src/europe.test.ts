import { describe, expect, it } from 'vitest';
import { UNIT_CLASSES } from '@brink/contracts';
import { NATION_DOCTRINES, NATION_LEADERS, NATION_ROSTERS, RULES, UNITS, victoryBars, VICTORY } from '@brink/game-data';
import { cellKey, findPath, keyDistance, neighborKeys } from '@brink/map';
import { enterCost, seedCommanders, sortedKeys } from '@brink/simulation';
import { createEuropeScenario, EUROPE_ID, EUROPE_MAP, EUROPE_MINORS, EUROPE_NATIONS } from './europe';
import { createScenario, SCENARIOS } from './index';
import { THEATRES } from './pacific';
import { findNation, theatreCrises, theatreMinors, theatrePowers } from './theatres';

describe('Europe', { timeout: 60_000 }, () => {
  const w = createEuropeScenario(1);
  const sitesOf = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);
  const site = (name: string) => {
    const s = Object.values(w.sites).find((x) => x.name === name);
    if (!s) throw new Error(`no site ${name}`);
    return s;
  };
  const owner = (name: string) => site(name).owner;
  const at = (col: number, row: number) => w.tiles[cellKey([col, row])]!;
  // A step's cost is the cost of the hex stepped into (`StepCost` is from, to); null where it cannot go.
  const walk = (_from: string, k: string) => enterCost(w.tiles[k], 'infantry');
  const byLand = (a: string, b: string) => findPath(site(a).key, site(b).key, walk) !== null;

  it('is six powers and forty minor states on a 56 x 32 map with sea and every land terrain', () => {
    expect(EUROPE_NATIONS.map((n) => n.id)).toEqual(['uk', 'france', 'germany', 'poland', 'russia', 'turkey']);
    expect(EUROPE_MINORS).toHaveLength(40);
    expect(sortedKeys(w.nations)).toHaveLength(46);
    expect(Object.keys(w.tiles)).toHaveLength(56 * 32);
    const terrains = new Set(Object.values(w.tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'] as const) expect(terrains.has(t), t).toBe(true);
    // createScenario is the theatre with each power's starting generals.
    expect(createScenario(EUROPE_ID, 1)).toEqual(seedCommanders(JSON.parse(JSON.stringify(w)) as typeof w));
  });

  it('is listed for a player: a theatre, a scenario, its own cast and no Pacific crises', () => {
    expect(THEATRES.find((t) => t.id === EUROPE_ID)?.unlock).toBe(0);
    expect(SCENARIOS.find((s) => s.id === EUROPE_ID)?.nations).toBe(6);
    expect(theatrePowers(EUROPE_ID)).toBe(EUROPE_NATIONS);
    expect(theatreMinors(EUROPE_ID)).toBe(EUROPE_MINORS);
    expect(theatreCrises(EUROPE_ID)).toEqual([]);
    // Russia is in both theatres; the lookup finds the first, and every European power is found.
    for (const n of EUROPE_NATIONS) expect(findNation(n.id)?.id).toBe(n.id);
    expect(findNation('uk')?.name).toBe('United Kingdom');
  });

  it('gives every power its own generals, doctrine deck and leader', () => {
    for (const n of EUROPE_NATIONS) {
      expect(NATION_ROSTERS[n.id], n.id).toBeDefined();
      expect(NATION_DOCTRINES[n.id], n.id).toBeDefined();
      expect(NATION_LEADERS[n.id], n.id).toBeDefined();
      expect(Object.values(w.commanders ?? {}).length).toBe(0);
    }
    const seeded = createScenario(EUROPE_ID, 1);
    for (const n of EUROPE_NATIONS) expect(Object.values(seeded.commanders ?? {}).filter((c) => c.nation === n.id).map((c) => c.name).sort(), n.id).toEqual(NATION_ROSTERS[n.id]!.map((g) => g.name).sort());
  });

  it('gives every power a capital, three or more cities, a depot, the same opening army and a navy', () => {
    for (const n of EUROPE_NATIONS) {
      const s = sitesOf(n.id);
      expect(s.filter((x) => x.kind === 'capital'), n.id).toHaveLength(1);
      expect(s.filter((x) => x.kind === 'city').length, n.id).toBeGreaterThanOrEqual(3);
      expect(s.filter((x) => x.kind === 'depot').length, n.id).toBeGreaterThanOrEqual(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === n.id).map((f) => f.unitClass));
      for (const c of UNIT_CLASSES.filter((x) => !UNITS[x].naval)) expect(classes.has(c), `${n.id} ${c}`).toBe(true);
      expect(classes.has('fleet') && classes.has('transport'), `${n.id} navy`).toBe(true);
    }
  });

  it('opens with each navy at sea off its home ports: Russia in three seas, France and Turkey in two', () => {
    const ships = (n: string) => Object.values(w.formations).filter((f) => f.owner === n && UNITS[f.unitClass].naval);
    for (const f of Object.values(w.formations)) if (UNITS[f.unitClass].naval) expect(w.tiles[f.key]!.terrain).toBe('water');
    const near = (n: string, port: string) => ships(n).filter((f) => keyDistance(f.key, site(port).key) <= 2).map((f) => f.unitClass).sort();
    expect(near('uk', 'Portsmouth')).toEqual(['carrier', 'fleet', 'transport', 'transport']);
    expect(near('russia', 'Kaliningrad')).toEqual(['fleet', 'transport']);
    expect(near('russia', 'Murmansk')).toEqual(['carrier', 'fleet']);
    expect(near('russia', 'Novorossiysk')).toEqual(['fleet', 'transport']);
    expect(near('france', 'Toulon')).toEqual(['carrier', 'fleet', 'transport']);
    expect(near('france', 'Brest')).toEqual(['fleet', 'transport']);
    expect(ships('turkey').map((f) => f.unitClass).sort()).toEqual(['carrier', 'fleet', 'fleet', 'transport', 'transport']);
    // Russia's Baltic squadron is in the Baltic, its Black Sea squadron in the Black Sea.
    const zone = (k: string) => {
      for (let row = 0; row < EUROPE_MAP.rows; row++)
        for (let col = 0; col < EUROPE_MAP.cols; col++) if (cellKey([col, row]) === k) return EUROPE_MAP.layers.seaZone!.legend[EUROPE_MAP.layers.seaZone!.rows[row]![col]!];
      return undefined;
    };
    for (const f of ships('russia')) {
      const home = ['Kaliningrad', 'Murmansk', 'Novorossiysk'].find((p) => keyDistance(f.key, site(p).key) <= 2)!;
      expect(zone(f.key), f.name).toBe({ Kaliningrad: 'baltic', Murmansk: 'barents', Novorossiysk: 'black-sea' }[home]);
    }
  });

  it('puts the capitals where they belong, west to east and north to south', () => {
    const col = (name: string) => EUROPE_MAP.sites.find((s) => s.name === name)!.at[0];
    const row = (name: string) => EUROPE_MAP.sites.find((s) => s.name === name)!.at[1];
    expect([owner('London'), owner('Paris'), owner('Berlin'), owner('Warsaw'), owner('Moscow'), owner('Ankara')]).toEqual(['uk', 'france', 'germany', 'poland', 'russia', 'turkey']);
    for (const n of EUROPE_NATIONS) expect(w.sites[`${n.id}-capital`]!.name).toBe({ uk: 'London', france: 'Paris', germany: 'Berlin', poland: 'Warsaw', russia: 'Moscow', turkey: 'Ankara' }[n.id]);
    // West to east across the plain: Lisbon, Madrid, Paris, Berlin, Warsaw, Minsk, Moscow.
    const east = ['Lisbon', 'Madrid', 'Paris', 'Berlin', 'Warsaw', 'Minsk', 'Moscow'].map(col);
    expect([...east].sort((a, b) => a - b)).toEqual(east);
    // North to south: Oslo above Copenhagen above Berlin above Vienna above Rome above Tunis.
    const south = ['Oslo', 'Copenhagen', 'Berlin', 'Vienna', 'Rome', 'Tunis'].map(row);
    expect([...south].sort((a, b) => a - b)).toEqual(south);
    // The Arctic and the Levant: Svalbard on the top row, Murmansk on the Kola peninsula, Cairo on the bottom row.
    expect(row('Longyearbyen')).toBe(0);
    expect(owner('Longyearbyen')).toBe('norway');
    expect(row('Murmansk')).toBeLessThanOrEqual(4);
    expect(row('Cairo')).toBe(31);
    expect([owner('Jerusalem'), owner('Damascus'), owner('Kyiv'), owner('Minsk'), owner('Vilnius'), owner('Kaliningrad')]).toEqual(['israel', 'syria', 'ukraine', 'belarus', 'lithuania', 'russia']);
    // Crimea is drawn as Ukraine's.
    expect(owner('Sevastopol')).toBe('ukraine');
  });

  it('opens the straits: the Channel, the Danish Straits, Gibraltar, the Bosphorus and the Dardanelles are sea', () => {
    const straits = new Map((EUROPE_MAP.straits ?? []).map((s) => [s.id, s]));
    for (const id of ['english-channel', 'oresund', 'gibraltar', 'bosphorus', 'dardanelles', 'giuk-gap']) {
      const s = straits.get(id)!;
      expect(s.kind, id).toBe('strait');
      for (const [c, r] of s.hexes) expect(at(c, r).terrain, `${id} ${c},${r}`).toBe('water');
    }
    // Britain is an island, and so are Ireland, Iceland, Sicily, Corsica, Crete and Cyprus.
    expect(byLand('London', 'Paris')).toBe(false);
    expect(byLand('London', 'Glasgow')).toBe(true);
    expect(byLand('Dublin', 'London')).toBe(false);
    expect(byLand('Reykjavik', 'Oslo')).toBe(false);
    expect(byLand('Palermo', 'Rome')).toBe(false);
    expect(byLand('Ajaccio', 'Paris')).toBe(false);
    expect(byLand('Heraklion', 'Athens')).toBe(false);
    expect(byLand('Nicosia', 'Ankara')).toBe(false);
    // Spain does not touch Morocco: Africa is walked to only the long way, through the Levant.
    const borders = (a: string, b: string) => Object.values(w.tiles).some((t) => t.owner === a && neighborKeys(t.key).some((k) => w.tiles[k]?.owner === b));
    expect(borders('spain', 'morocco')).toBe(false);
    expect(borders('france', 'italy')).toBe(true);
    // Istanbul is on the European shore: four hexes from Ankara, but a march round the Black Sea.
    const steps = (a: string, b: string) => findPath(site(a).key, site(b).key, walk)!.path.length;
    expect(keyDistance(site('Istanbul').key, site('Ankara').key)).toBeLessThanOrEqual(5);
    expect(steps('Istanbul', 'Ankara')).toBeGreaterThan(20);
    expect(steps('Istanbul', 'Sofia')).toBeLessThanOrEqual(3);
    // A ship sails from the Black Sea into the Aegean only through the Bosphorus and the Dardanelles.
    const sail = (_from: string, k: string) => (w.tiles[k]?.terrain === 'water' ? 1 : null);
    const sea = (c: number, r: number) => cellKey([c, r]);
    expect(findPath(sea(37, 22), sea(32, 25), sail)).not.toBeNull();
    const shut = (from: string, k: string) => (k === sea(35, 23) ? null : sail(from, k));
    expect(findPath(sea(37, 22), sea(32, 25), shut)).toBeNull();
    // And from the North Sea into the Baltic only through the Danish Straits.
    expect(findPath(sea(18, 12), sea(27, 12), sail)).not.toBeNull();
    expect(findPath(sea(18, 12), sea(27, 12), (from, k) => (k === sea(24, 12) ? null : sail(from, k)))).toBeNull();
    // The Mediterranean opens on the Atlantic only at Gibraltar.
    expect(findPath(sea(5, 25), sea(18, 24), (from, k) => (k === sea(12, 27) ? null : sail(from, k)))).toBeNull();
  });

  it('runs the land war across the plain: Moscow from Berlin, Kyiv from Warsaw, Kaliningrad cut off by the Suwalki corridor', () => {
    expect(byLand('Berlin', 'Moscow')).toBe(true);
    expect(byLand('Paris', 'Berlin')).toBe(true);
    expect(byLand('Warsaw', 'Kyiv')).toBe(true);
    expect(byLand('Moscow', 'Tbilisi')).toBe(true);
    expect(byLand('Ankara', 'Tbilisi')).toBe(true);
    expect(byLand('Berlin', 'Lisbon')).toBe(true);
    // Kaliningrad: Russia's exclave borders only Poland and Lithuania by land; the corridor between
    // it and Belarus is Polish and Lithuanian ground.
    const kal = site('Kaliningrad');
    const sides = new Set(neighborKeys(kal.key).map((k) => w.tiles[k]).filter((t) => t && t.terrain !== 'water').map((t) => t!.owner));
    expect([...sides].sort()).toEqual(['lithuania', 'poland']);
    const suwalki = EUROPE_MAP.straits!.find((s) => s.id === 'suwalki')!;
    expect(suwalki.kind).toBe('land-bridge');
    expect(suwalki.hexes.map(([c, r]) => at(c, r).owner).sort()).toEqual(['lithuania', 'poland']);
    // Without Russia's own ground, Kaliningrad is reached from Moscow only through other countries.
    const russianOnly = (from: string, k: string) => (w.tiles[k]?.owner === 'russia' ? walk(from, k) : null);
    expect(findPath(site('Moscow').key, kal.key, russianOnly)).toBeNull();
  });

  it('starts every power level: the same victory points, output and army weight', () => {
    const vp = (p: string) => sitesOf(p).reduce((a, s) => a + s.victoryPoints, 0);
    const land = (p: string) => Object.values(w.tiles).filter((t) => t.owner === p).length;
    const out = (p: string) => sitesOf(p).reduce((a, s) => a + s.yields.credits + s.yields.energy + s.yields.materials + s.yields.food + s.yields.industry, 0) + Math.floor(land(p) / RULES.hexesPerCredit);
    const army = (p: string) => Object.values(w.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
    const spread = (f: (p: string) => number) => {
      const v = EUROPE_NATIONS.map((n) => f(n.id));
      return (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    };
    expect(spread(vp)).toBeLessThanOrEqual(0.05);
    expect(spread(out)).toBeLessThanOrEqual(0.05);
    expect(spread(army)).toBeLessThanOrEqual(0.1);
    // Russia is still the biggest country on the map, and the United Kingdom among the smallest.
    expect(land('russia')).toBeGreaterThan(land('uk') * 10);
  });

  it('asks a European power for as much as a Pacific one: its own victory bars', () => {
    const total = Object.values(w.sites).reduce((a, s) => a + s.victoryPoints, 0);
    const start = sitesOf('uk').reduce((a, s) => a + s.victoryPoints, 0);
    const bars = victoryBars(w.maxTurns, w.barPowers, EUROPE_ID);
    expect(bars.dominationShare).toBeLessThan(VICTORY.dominationShare);
    // Domination is about twice a power's opening share, as in the Pacific (32% against 15%).
    const multiple = (bars.dominationShare * total) / 100 / start;
    expect(multiple).toBeGreaterThan(1.8);
    expect(multiple).toBeLessThan(2.6);
    // Every power is at war with every other, and the minor states at peace with one another.
    for (const a of EUROPE_NATIONS) for (const b of EUROPE_MINORS) expect(w.relations[[a.id, b.id].sort().join('|')]).toBe('war');
    expect(w.relations[['spain', 'portugal'].sort().join('|')]).toBe('peace');
  });

  it('changes only the ground with the seed, never the coasts, borders or sites', () => {
    const b = createEuropeScenario(99);
    const shape = (x: typeof w) => sortedKeys(x.tiles).map((k) => `${k}:${x.tiles[k]!.owner}:${x.tiles[k]!.terrain === 'water'}`);
    expect(shape(w)).toEqual(shape(b));
    expect(Object.values(w.sites).map((s) => s.key)).toEqual(Object.values(b.sites).map((s) => s.key));
    expect(sortedKeys(w.tiles).some((k) => w.tiles[k]!.terrain !== b.tiles[k]!.terrain)).toBe(true);
  });
});
