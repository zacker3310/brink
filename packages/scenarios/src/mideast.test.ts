import { describe, expect, it } from 'vitest';
import type { HexKey } from '@brink/contracts';
import { UNIT_CLASSES } from '@brink/contracts';
import { RULES, UNITS } from '@brink/game-data';
import { findPath, keyOf, layerAt, neighborKeys, offsetToAxial } from '@brink/map';
import { enterCost, seedCommanders, sortedKeys } from '@brink/simulation';
import { createScenario, SCENARIOS } from './index';
import { createMideastScenario, MIDEAST_ID, MIDEAST_MAP, MIDEAST_MINORS, MIDEAST_NATIONS } from './mideast';
import { shortName, THEATRES, theatreCrises, theatreMinors, theatrePowers } from './theatres';

// The Middle East and Africa (docs/mideast.md): the geography sanity of the map and the turn-1
// world it builds. Places are where they are on a globe, the straits are chokepoints, the seas
// join only where the straits are, and every power starts level.

describe('The Middle East and Africa', () => {
  const w = createMideastScenario(1);
  const site = (name: string) => {
    const s = Object.values(w.sites).find((x) => x.name === name);
    if (!s) throw new Error(`no site ${name}`);
    return s;
  };
  const cell = (col: number, row: number) => keyOf(offsetToAxial(col, row));
  const walk = (k: HexKey) => enterCost(w.tiles[k], 'infantry');
  const sitesOf = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);

  it('is registered: listed for the setup screen, built by createScenario with its generals', () => {
    expect(THEATRES.map((t) => t.id)).toContain(MIDEAST_ID);
    expect(SCENARIOS.find((s) => s.id === MIDEAST_ID)?.nations).toBe(6);
    expect(theatreCrises(MIDEAST_ID)).toEqual([]);
    expect(theatrePowers(MIDEAST_ID)).toBe(MIDEAST_NATIONS);
    expect(theatreMinors(MIDEAST_ID)).toBe(MIDEAST_MINORS);
    expect(createScenario(MIDEAST_ID, 1)).toEqual(seedCommanders(JSON.parse(JSON.stringify(w)) as typeof w));
    expect(w.scenarioId).toBe(MIDEAST_ID);
    expect(w.maxTurns).toBe(30);
    expect(shortName('South Africa')).toBe('S. Africa');
  }, 60_000);

  it('is six powers and twenty-four minor states on a 44 x 44 map with sea and every land terrain', () => {
    expect(MIDEAST_NATIONS.map((n) => n.id)).toEqual(['turkey', 'iran', 'saudi-arabia', 'egypt', 'nigeria', 'south-africa']);
    expect(MIDEAST_MINORS).toHaveLength(24);
    // Six powers: the victory bars come down in proportion (victoryBars).
    expect(w.barPowers).toBe(6);
    expect(Object.keys(w.tiles)).toHaveLength(44 * 44);
    const terrains = new Set(Object.values(w.tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'] as const) expect(terrains.has(t), t).toBe(true);
  });

  it('puts the real capitals in their countries, north to south and west to east as on a globe', () => {
    const capitals: Record<string, string> = {
      turkey: 'Ankara', iran: 'Tehran', 'saudi-arabia': 'Riyadh', egypt: 'Cairo', nigeria: 'Abuja', 'south-africa': 'Pretoria',
      morocco: 'Rabat', algeria: 'Algiers', libya: 'Tripoli', mali: 'Bamako', chad: "N'Djamena", sudan: 'Khartoum', ethiopia: 'Addis Ababa',
      somalia: 'Mogadishu', kenya: 'Nairobi', 'dr-congo': 'Kinshasa', angola: 'Luanda', namibia: 'Windhoek', mozambique: 'Maputo',
      iraq: 'Baghdad', syria: 'Damascus', israel: 'Jerusalem', jordan: 'Amman', yemen: "Sana'a", oman: 'Muscat',
      niger: 'Niamey', ghana: 'Accra', cameroon: 'Yaoundé', tanzania: 'Dodoma', zimbabwe: 'Harare',
    };
    expect(sortedKeys(w.nations)).toEqual(Object.keys(capitals).sort());
    for (const [n, name] of Object.entries(capitals)) {
      expect(w.sites[`${n}-capital`]!.name, n).toBe(name);
      expect(w.sites[`${n}-capital`]!.kind, n).toBe('capital');
    }
    const at = (name: string) => MIDEAST_MAP.sites.find((s) => s.name === name)!.at;
    const row = (name: string) => at(name)[1];
    const col = (name: string) => at(name)[0];
    const southward = ['Istanbul', 'Ankara', 'Cairo', 'Aswan', 'Khartoum', 'Addis Ababa', 'Nairobi', 'Kinshasa', 'Lubumbashi', 'Beira', 'Pretoria', 'Durban', 'Cape Town'];
    for (let i = 1; i < southward.length; i++) expect(row(southward[i]!), `${southward[i - 1]} is north of ${southward[i]}`).toBeGreaterThanOrEqual(row(southward[i - 1]!));
    const eastward = ['Rabat', 'Algiers', 'Tripoli', 'Benghazi', 'Cairo', 'Jerusalem', 'Baghdad', 'Tehran', 'Mashhad'];
    for (let i = 1; i < eastward.length; i++) expect(col(eastward[i]!), `${eastward[i - 1]} is west of ${eastward[i]}`).toBeGreaterThan(col(eastward[i - 1]!));
    expect(col('Lagos')).toBeLessThan(col('Kinshasa'));
    expect(col('Luanda')).toBeLessThan(col('Mombasa'));
  });

  it('joins Africa to Asia by land at Sinai, and leaves Madagascar an island', () => {
    expect(findPath(site('Cairo').key, site('Riyadh').key, walk)).not.toBeNull();
    expect(findPath(site('Cape Town').key, site('Ankara').key, walk)).not.toBeNull();
    expect(findPath(site('Lagos').key, site('Tehran').key, walk)).not.toBeNull();
    // Port Said stands on the isthmus: Sinai is Egypt's, and the road from Cairo to Jerusalem runs through it.
    expect(w.tiles[cell(28, 6)]!.owner).toBe('egypt');
    expect(w.tiles[cell(33, 32)]!.terrain).toBe('water');
    const madagascar = cell(36, 31);
    expect(w.tiles[madagascar]!.terrain).not.toBe('water');
    expect(findPath(madagascar, site('Maputo').key, walk)).toBeNull();
  });

  it('makes the straits chokepoints: the seas they join meet nowhere else, and Suez is a port, not a channel', () => {
    const sea = (k: HexKey) => w.tiles[k]?.terrain === 'water';
    const zones = new Map<HexKey, string | null>();
    for (let r = 0; r < MIDEAST_MAP.rows; r++) for (let c = 0; c < MIDEAST_MAP.cols; c++) zones.set(cell(c, r), layerAt(MIDEAST_MAP.layers.seaZone!, c, r));
    const zone = (k: HexKey) => zones.get(k) ?? null;
    /** The sea hexes a ship reaches from `from` by water alone, never through `blocked`. */
    const reach = (from: HexKey, blocked: ReadonlySet<HexKey>) => {
      const seen = new Set<HexKey>([from]);
      const queue = [from];
      while (queue.length)
        for (const n of neighborKeys(queue.shift()!))
          if (sea(n) && !blocked.has(n) && !seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
      return seen;
    };
    const zonesIn = (s: ReadonlySet<HexKey>) => new Set([...s].map(zone));
    for (const strait of MIDEAST_MAP.straits!) {
      const hexes = strait.hexes.map(([c, r]) => cell(c, r));
      const [a, b] = strait.joins! as [string, string];
      if (strait.kind === 'strait') {
        for (const h of hexes) {
          expect(sea(h), strait.id).toBe(true);
          // Land on both shores.
          expect(neighborKeys(h).filter((n) => w.tiles[n] && !sea(n)).length, strait.id).toBeGreaterThanOrEqual(2);
        }
        const start = [...reach(hexes[0]!, new Set())].find((k) => zone(k) === a && !hexes.includes(k))!;
        expect(zonesIn(reach(start, new Set())).has(b), `${strait.id} joins ${a} and ${b}`).toBe(true);
        expect(zonesIn(reach(start, new Set(hexes))).has(b), `${strait.id} is the only way from ${a} to ${b}`).toBe(false);
      } else {
        // The canal: the Mediterranean and the Red Sea never meet by water; Port Said lies on both.
        expect(strait.id).toBe('suez');
        expect(hexes[0]).toBe(site('Port Said').key);
        expect(w.tiles[hexes[0]!]!.port).toBe(true);
        const touching = new Set(neighborKeys(hexes[0]!).filter(sea).map(zone));
        expect(touching.has(a) && touching.has(b)).toBe(true);
        const med = neighborKeys(hexes[0]!).find((k) => sea(k) && zone(k) === a)!;
        expect(zonesIn(reach(med, new Set())).has(b)).toBe(false);
        // A ship passes through the port: the canal is the short way from Alexandria to Jeddah.
        const ship = (k: HexKey) => enterCost(w.tiles[k], 'fleet');
        expect(findPath(med, neighborKeys(site('Jeddah').key).find(sea)!, ship)!.path).toContain(hexes[0]);
      }
    }
    // Hormuz lies between Iran and Oman's Musandam; Bab-el-Mandeb between Yemen and the Horn.
    const shores = (c: number, r: number) => new Set(neighborKeys(cell(c, r)).map((k) => w.tiles[k]?.owner).filter((o) => o));
    expect([...shores(40, 9)].sort()).toEqual(['iran', 'oman']);
    expect(shores(32, 16).has('yemen')).toBe(true);
  });

  it('lays the oil around the Gulf and in the Sahara and the Delta, and the minerals in the south', () => {
    const res = MIDEAST_MAP.resources!;
    const oil = res.filter((r) => r.kind === 'oil');
    expect(oil.length).toBeGreaterThanOrEqual(8);
    const gulf = MIDEAST_MAP.straits!.find((s) => s.id === 'hormuz')!.hexes[0]!;
    expect(oil.filter((r) => Math.abs(r.at[0] - gulf[0]) <= 7 && Math.abs(r.at[1] - gulf[1]) <= 5).length).toBeGreaterThanOrEqual(5);
    const minerals = res.filter((r) => r.kind === 'rare-earths');
    expect(minerals.length).toBeGreaterThanOrEqual(3);
    for (const m of minerals) expect(m.at[1], m.name).toBeGreaterThan(25);
    for (const r of res) expect(w.tiles[cell(r.at[0], r.at[1])]!.terrain, r.name).not.toBe('water');
  });

  it('keeps the desert open and the Congo green: the Sahara and Arabia plains, the basin forest', () => {
    const ground = (name: string, dc = 0, dr = 0) => {
      const [c, r] = MIDEAST_MAP.sites.find((s) => s.name === name)!.at;
      return w.tiles[cell(c + dc, r + dr)]!.terrain;
    };
    expect(ground('Tamanrasset', 2, 0)).toBe('plains');
    expect(ground('Riyadh', 1, 0)).toBe('plains');
    expect(ground('Kisangani', 1, 0)).toBe('forest');
    // The seeded texture never plants a forest in the Sahara or Arabia.
    for (let seed = 1; seed <= 3; seed++) {
      const x = createMideastScenario(seed);
      for (const s of ['Tamanrasset', 'Riyadh', 'Khartoum']) {
        const [c, r] = MIDEAST_MAP.sites.find((q) => q.name === s)!.at;
        for (const k of neighborKeys(cell(c, r))) expect(x.tiles[k]!.terrain, `${s} seed ${seed}`).not.toBe('forest');
      }
    }
  }, 60_000);

  it('gives every power a capital, three or more cities, a depot, a navy and the same opening army', () => {
    for (const n of MIDEAST_NATIONS) {
      const s = sitesOf(n.id);
      expect(s.filter((x) => x.kind === 'capital'), n.id).toHaveLength(1);
      expect(s.filter((x) => x.kind === 'city').length, n.id).toBeGreaterThanOrEqual(3);
      expect(s.filter((x) => x.kind === 'depot').length, n.id).toBeGreaterThanOrEqual(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === n.id).map((f) => f.unitClass));
      for (const c of UNIT_CLASSES.filter((x) => !UNITS[x].naval)) expect(classes.has(c), `${n.id} ${c}`).toBe(true);
      expect(classes.has('fleet') && classes.has('transport'), `${n.id} navy`).toBe(true);
    }
    for (const f of Object.values(w.formations)) if (UNITS[f.unitClass].naval) expect(w.tiles[f.key]!.terrain).toBe('water');
    // Each navy sails from a real port.
    for (const name of ['Izmir', 'Alexandria', 'Bandar Abbas', 'Jeddah', 'Lagos', 'Durban', 'Port Said']) expect(w.tiles[site(name).key]!.port, name).toBe(true);
  });

  it('makes the minor states minor, and leaves the unaligned land nobody’s and stable', () => {
    for (const m of MIDEAST_MINORS) {
      expect(w.nations[m.id]!.minor).toBe(true);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === m.id).map((f) => f.unitClass));
      for (const c of classes) expect(['infantry', 'mechanized', 'recon'], `${m.id} ${c}`).toContain(c);
      for (const n of MIDEAST_NATIONS) expect(w.relations[[n.id, m.id].sort().join('|')]).toBe('war');
    }
    const unaligned = Object.values(w.tiles).filter((t) => t.terrain !== 'water' && t.owner === null);
    expect(unaligned.length).toBeGreaterThan(100);
    expect(unaligned.some((t) => t.siteId)).toBe(false);
    // No unaligned hex is so nearly surrounded by one nation that the front's consolidation (four
    // neighbours or more) would hand it over on turn 1 without a shot.
    for (const t of unaligned) {
      const counts = new Map<string, number>();
      for (const k of neighborKeys(t.key)) {
        const o = w.tiles[k]?.owner;
        if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
      }
      expect(Math.max(0, ...counts.values()), t.key).toBeLessThan(4);
    }
  });

  it('starts every power level: the same victory points, output and army weight, whatever its size', () => {
    const vp = (p: string) => sitesOf(p).reduce((a, s) => a + s.victoryPoints, 0);
    const land = (p: string) => Object.values(w.tiles).filter((t) => t.owner === p).length;
    const out = (p: string) => sitesOf(p).reduce((a, s) => a + s.yields.credits + s.yields.energy + s.yields.materials + s.yields.food + s.yields.industry, 0) + Math.floor(land(p) / RULES.hexesPerCredit);
    const army = (p: string) => Object.values(w.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
    const spread = (f: (p: string) => number) => {
      const v = MIDEAST_NATIONS.map((n) => f(n.id));
      return (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    };
    expect(spread(vp)).toBeLessThanOrEqual(0.05);
    expect(spread(out)).toBeLessThanOrEqual(0.05);
    expect(spread(army)).toBeLessThanOrEqual(0.1);
    // Saudi Arabia is the biggest country on the map among the powers; Turkey and South Africa are among the smallest.
    expect(land('saudi-arabia')).toBeGreaterThan(land('turkey'));
  });

  it('changes only the ground with the seed, never the coasts, borders or sites', () => {
    const a = createMideastScenario(1);
    const b = createMideastScenario(99);
    const shape = (x: typeof a) => sortedKeys(x.tiles).map((k) => `${k}:${x.tiles[k]!.owner}:${x.tiles[k]!.terrain === 'water'}`);
    expect(shape(a)).toEqual(shape(b));
    expect(Object.values(a.sites).map((s) => s.key)).toEqual(Object.values(b.sites).map((s) => s.key));
    expect(sortedKeys(a.tiles).some((k) => a.tiles[k]!.terrain !== b.tiles[k]!.terrain)).toBe(true);
  }, 60_000);
});
