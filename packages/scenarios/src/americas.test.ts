import { describe, expect, it } from 'vitest';
import type { HexKey, WorldState } from '@brink/contracts';
import { UNIT_CLASSES } from '@brink/contracts';
import { RULES, UNITS } from '@brink/game-data';
import { findPath, keyOf, neighborKeys, offsetToAxial } from '@brink/map';
import { enterCost, seedCommanders, sortedKeys } from '@brink/simulation';
import { AMERICAS_ID, AMERICAS_MAP, AMERICAS_MINORS, AMERICAS_POWERS, createAmericasScenario } from './americas';
import { createScenario, SCENARIOS } from './index';
import { classicOnly, findNation, naturalAlly, shortName, THEATRES, theatreCrises, theatreOf, theatrePowers } from './theatres';

describe('The Americas', () => {
  const w = createAmericasScenario(1);
  const sitesOf = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);
  const site = (name: string) => {
    const s = Object.values(w.sites).find((x) => x.name === name);
    if (!s) throw new Error(`no site ${name}`);
    return s;
  };
  const key = (name: string) => site(name).key;
  const cell = (col: number, row: number): HexKey => keyOf(offsetToAxial(col, row));
  const cellOf = new Map<HexKey, [number, number]>();
  for (let r = 0; r < AMERICAS_MAP.rows; r++) for (let c = 0; c < AMERICAS_MAP.cols; c++) cellOf.set(cell(c, r), [c, r]);
  /** Walking: the step's cost is the hex stepped into. */
  const walk = (world: WorldState) => (_: HexKey, to: HexKey) => enterCost(world.tiles[to], 'infantry');
  /** Sailing: sea and ports, as the engine moves a ship; `closed` hexes are shut. */
  const sail = (closed: readonly HexKey[] = []) => (_: HexKey, to: HexKey) => (closed.includes(to) ? null : enterCost(w.tiles[to], 'fleet'));

  it('is six powers and fourteen minor states on a 32 x 41 map with sea and every land terrain', () => {
    expect(AMERICAS_POWERS.map((n) => n.id)).toEqual(['usa', 'canada', 'mexico', 'brazil', 'argentina', 'colombia']);
    expect(AMERICAS_MINORS).toHaveLength(14);
    expect(sortedKeys(w.nations)).toHaveLength(20);
    expect(Object.keys(w.tiles)).toHaveLength(32 * 41);
    const terrains = new Set(Object.values(w.tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'] as const) expect(terrains.has(t), t).toBe(true);
    // createScenario is the theatre with each power's starting generals.
    expect(createScenario(AMERICAS_ID, 1)).toEqual(seedCommanders(JSON.parse(JSON.stringify(w)) as WorldState));
  });

  it('is listed for the player: a theatre, a scenario, its own nations, allies and no Pacific crises', () => {
    expect(theatreOf(AMERICAS_ID)?.unlock).toBe(0);
    expect(THEATRES.map((t) => t.id)).toContain(AMERICAS_ID);
    expect(SCENARIOS.find((s) => s.id === AMERICAS_ID)?.nations).toBe(6);
    expect(theatrePowers(AMERICAS_ID)).toBe(AMERICAS_POWERS);
    expect(theatreCrises(AMERICAS_ID)).toEqual([]);
    // Every power has a natural ally for Easy, and allies pair up.
    for (const p of AMERICAS_POWERS) expect(naturalAlly(AMERICAS_ID, naturalAlly(AMERICAS_ID, p.id)!)).toBe(p.id);
    expect(classicOnly(AMERICAS_ID)).toBe(true);
    // Brazil is found for the menus; the United States as the Pacific describes it.
    expect(findNation('brazil')?.name).toBe('Brazil');
    expect(findNation('usa')?.name).toBe('United States');
    expect(shortName('Dominican Republic')).toBe('Dom. Rep.');
    expect(shortName('North Korea')).toBe('N. Korea');
  });

  it('gives every power a capital, three or more cities, a depot, the same opening army and a navy off its port', () => {
    for (const n of AMERICAS_POWERS) {
      const s = sitesOf(n.id);
      expect(s.filter((x) => x.kind === 'capital'), n.id).toHaveLength(1);
      expect(s.filter((x) => x.kind === 'city').length, n.id).toBeGreaterThanOrEqual(3);
      expect(s.filter((x) => x.kind === 'depot').length, n.id).toBeGreaterThanOrEqual(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === n.id).map((f) => f.unitClass));
      for (const c of UNIT_CLASSES.filter((x) => !UNITS[x].naval)) expect(classes.has(c), `${n.id} ${c}`).toBe(true);
      expect(classes.has('fleet') && classes.has('transport'), `${n.id} navy`).toBe(true);
      expect(w.nations[n.id]!.doctrine, n.id).toBeDefined();
      expect(w.nations[n.id]!.objectives).toHaveLength(14);
    }
    for (const f of Object.values(w.formations)) if (UNITS[f.unitClass].naval) expect(w.tiles[f.key]!.terrain).toBe('water');
  });

  it('makes the minor states minor: militia only, at war with every power, at peace with each other', () => {
    for (const m of AMERICAS_MINORS) {
      expect(w.nations[m.id]!.minor).toBe(true);
      expect(sitesOf(m.id).filter((x) => x.kind === 'capital')).toHaveLength(1);
      for (const f of Object.values(w.formations).filter((x) => x.owner === m.id)) expect(['infantry', 'mechanized', 'recon'], `${m.id} ${f.unitClass}`).toContain(f.unitClass);
    }
    for (const n of AMERICAS_POWERS) for (const m of AMERICAS_MINORS) expect(w.relations[[n.id, m.id].sort().join('|')], `${n.id} ${m.id}`).toBe('war');
    expect(w.relations[['cuba', 'venezuela'].sort().join('|')]).toBe('peace');
  });

  it('puts the real places where they belong, north to south and west to east', () => {
    const owner = (name: string) => site(name).owner;
    expect([owner('Washington'), owner('Ottawa'), owner('Mexico City'), owner('Bogota'), owner('Brasilia'), owner('Buenos Aires')]).toEqual(['usa', 'canada', 'mexico', 'colombia', 'brazil', 'argentina']);
    expect([owner('Anchorage'), owner('Honolulu'), owner('San Juan')]).toEqual(['usa', 'usa', 'usa']);
    expect([owner('Havana'), owner('Caracas'), owner('Lima'), owner('Santiago'), owner('Panama City')]).toEqual(['cuba', 'venezuela', 'peru', 'chile', 'panama']);
    for (const n of [...AMERICAS_POWERS, ...AMERICAS_MINORS]) expect(site(n.capital[2]).kind).toBe('capital');
    // North to south by row, west to east by column.
    const row = (name: string) => AMERICAS_MAP.sites.find((s) => s.name === name)!.at[1];
    const col = (name: string) => AMERICAS_MAP.sites.find((s) => s.name === name)!.at[0];
    const south = ['Anchorage', 'Ottawa', 'Washington', 'Houston', 'Havana', 'Mexico City', 'Panama City', 'Bogota', 'Lima', 'Brasilia', 'Buenos Aires', 'Ushuaia'];
    for (let i = 1; i < south.length; i++) expect(row(south[i]!), south[i]).toBeGreaterThanOrEqual(row(south[i - 1]!));
    expect(col('Los Angeles')).toBeLessThan(col('Chicago'));
    expect(col('Chicago')).toBeLessThan(col('New York'));
    expect(col('Lima')).toBeLessThan(col('La Paz'));
    expect(col('Santiago')).toBeLessThan(col('Buenos Aires'));
    expect(col('Buenos Aires')).toBeLessThan(col('Montevideo'));
  });

  it('joins the continents by land only at the isthmus, and keeps the islands islands', () => {
    // An army walks from Alaska to Tierra del Fuego's strait, through Mexico and Panama.
    expect(findPath(key('Anchorage'), key('Vancouver'), walk(w))).not.toBeNull();
    expect(findPath(key('Washington'), key('Buenos Aires'), walk(w))).not.toBeNull();
    expect(findPath(key('Mexico City'), key('Bogota'), walk(w))).not.toBeNull();
    // Close the isthmus at Panama and the Americas fall apart.
    const shut = JSON.parse(JSON.stringify(w)) as WorldState;
    for (const k of [cell(19, 19), cell(20, 19)]) shut.tiles[k]!.terrain = 'water';
    expect(findPath(key('Mexico City'), key('Bogota'), walk(shut))).toBeNull();
    // Islands: Cuba, Hispaniola, Puerto Rico, Hawaii, Baffin, Tierra del Fuego.
    for (const name of ['Havana', 'Santo Domingo', 'San Juan', 'Honolulu', 'Iqaluit', 'Ushuaia']) expect(findPath(key(name), key('Washington'), walk(w)), name).toBeNull();
    expect(findPath(key('Havana'), key('Santiago de Cuba'), walk(w))).not.toBeNull();
    expect(findPath(key('Port-au-Prince'), key('Santo Domingo'), walk(w))).not.toBeNull();
    // The Andes, the Amazon and the Rockies are on the ground.
    // The map fixes their mountains; the builder lowers only those beside a site to hills, so no
    // city is walled in (build.ts).
    const terrain = AMERICAS_MAP.layers.terrain;
    const fixed: [number, number][] = [];
    terrain.rows.forEach((line, r) => [...line].forEach((ch, c) => terrain.legend[ch] === 'mountains' && fixed.push([c, r])));
    expect(fixed.filter(([, r]) => r >= 19).length, 'the Andes').toBeGreaterThanOrEqual(12);
    expect(fixed.filter(([, r]) => r <= 11).length, 'the Rockies and the Alaska Range').toBeGreaterThanOrEqual(12);
    const nearSite = (k: HexKey) => neighborKeys(k).some((n) => w.tiles[n]?.siteId);
    for (const [c, r] of fixed) {
      const t = w.tiles[cell(c, r)]!;
      expect(t.terrain === 'mountains' || (t.terrain === 'hills' && nearSite(t.key)), `${c},${r}`).toBe(true);
    }
    const terrainAt = (col: number, row: number) => w.tiles[cell(col, row)]!.terrain;
    expect([terrainAt(12, 8), terrainAt(12, 9), terrainAt(22, 25)]).toEqual(['mountains', 'mountains', 'mountains']);
    expect([terrainAt(25, 24), terrainAt(26, 23), terrainAt(27, 22)]).toEqual(['forest', 'forest', 'forest']);
  });

  it('puts the Panama Canal at Panama City: the one port between the Caribbean and the Pacific', () => {
    const panama = key('Panama City');
    expect(w.tiles[panama]!.port).toBe(true);
    const zones = new Set(
      neighborKeys(panama)
        .filter((k) => w.tiles[k]?.terrain === 'water')
        .map((k) => {
          const [c, r] = cellOf.get(k)!;
          return AMERICAS_MAP.layers.seaZone!.legend[AMERICAS_MAP.layers.seaZone!.rows[r]![c]!];
        }),
    );
    expect([...zones].sort()).toEqual(['caribbean', 'east-pacific']);
    // From off Cartagena to off Panama's Pacific shore: a hop through the canal, or round the Horn.
    const caribbean = cell(21, 18);
    const pacific = cell(19, 20);
    const through = findPath(caribbean, pacific, sail());
    const round = findPath(caribbean, pacific, sail([panama]));
    expect(through).not.toBeNull();
    expect(through!.path).toContain(panama);
    expect(through!.path.length).toBeLessThanOrEqual(6);
    expect(round).not.toBeNull();
    // With the canal shut, the way lies south of the River Plate: no other port on the isthmus or in
    // Mexico or Colombia joins the two oceans.
    const southmost = Math.max(...round!.path.map((k) => cellOf.get(k)![1]));
    expect(southmost).toBeGreaterThanOrEqual(33);
    expect(round!.path.length).toBeGreaterThan(through!.path.length * 6);
    // The other straits are open sea with land on both sides.
    for (const s of AMERICAS_MAP.straits!.filter((x) => x.kind === 'strait')) for (const [c, r] of s.hexes) expect(w.tiles[cell(c, r)]!.terrain, s.id).toBe('water');
    const florida = [cell(19, 14), cell(20, 14)];
    expect(florida.some((k) => neighborKeys(k).includes(key('Miami')))).toBe(true);
    expect(florida.some((k) => neighborKeys(k).includes(key('Havana')))).toBe(true);
  });

  it('starts every power level: the same victory points, output and army weight, whatever its size', () => {
    const land = (p: string) => Object.values(w.tiles).filter((t) => t.owner === p).length;
    const vp = (p: string) => sitesOf(p).reduce((a, s) => a + s.victoryPoints, 0);
    const out = (p: string) => sitesOf(p).reduce((a, s) => a + s.yields.credits + s.yields.energy + s.yields.materials + s.yields.food + s.yields.industry, 0) + Math.floor(land(p) / RULES.hexesPerCredit);
    const army = (p: string) => Object.values(w.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
    const spread = (f: (p: string) => number) => {
      const v = AMERICAS_POWERS.map((n) => f(n.id));
      return (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    };
    expect(spread(vp)).toBeLessThanOrEqual(0.05);
    expect(spread(out)).toBeLessThanOrEqual(0.05);
    expect(spread(army)).toBeLessThanOrEqual(0.1);
    // Canada is the biggest country on the map and Colombia the smallest power.
    expect(land('canada')).toBeGreaterThan(land('colombia') * 5);
  });

  it('changes only the ground with the seed, never the coasts, borders or sites', () => {
    const b = createAmericasScenario(99);
    const shape = (x: WorldState) => sortedKeys(x.tiles).map((k) => `${k}:${x.tiles[k]!.owner}:${x.tiles[k]!.terrain === 'water'}`);
    expect(shape(w)).toEqual(shape(b));
    expect(sortedKeys(w.tiles).some((k) => w.tiles[k]!.terrain !== b.tiles[k]!.terrain)).toBe(true);
    expect(createAmericasScenario(5)).toEqual(createAmericasScenario(5));
  });
});
