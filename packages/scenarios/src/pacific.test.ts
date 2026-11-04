import { describe, expect, it } from 'vitest';
import { UNIT_CLASSES } from '@brink/contracts';
import { RULES, UNITS } from '@brink/game-data';
import { findPath, keyDistance, offsetToAxial, keyOf } from '@brink/map';
import { enterCost, seedCommanders, sortedKeys } from '@brink/simulation';
import { createPacificScenario, MINORS, NATIONS, PACIFIC_ID } from './pacific';
import { createScenario } from './index';

describe('The Pacific', () => {
  const w = createPacificScenario(1);
  const sitesOf = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);

  it('is the four powers and the seven minor states, on a 40 x 20 map with sea and every land terrain', () => {
    expect(sortedKeys(w.nations)).toEqual(['canada', 'china', 'japan', 'kazakhstan', 'mexico', 'mongolia', 'nkorea', 'russia', 'skorea', 'taiwan', 'usa']);
    expect(NATIONS.map((n) => n.id)).toEqual(['usa', 'russia', 'china', 'japan']);
    expect(Object.keys(w.tiles)).toHaveLength(800);
    const terrains = new Set(Object.values(w.tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'] as const) expect(terrains.has(t), t).toBe(true);
    // createScenario is the Pacific with each power's starting generals (ruleset 2.3); the theatre
    // itself carries none, so the dispatch check compares against the seeded world.
    expect(createScenario(PACIFIC_ID, 1)).toEqual(seedCommanders(JSON.parse(JSON.stringify(w)) as typeof w));
  });

  it('gives every power a capital, three or more cities, a depot and the same opening army', () => {
    for (const n of NATIONS) {
      const s = sitesOf(n.id);
      expect(s.filter((x) => x.kind === 'capital'), n.id).toHaveLength(1);
      expect(s.filter((x) => x.kind === 'city').length, n.id).toBeGreaterThanOrEqual(3);
      expect(s.filter((x) => x.kind === 'depot').length, n.id).toBeGreaterThanOrEqual(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === n.id).map((f) => f.unitClass));
      // Every land and air class; the navy differs by power (below).
      for (const c of UNIT_CLASSES.filter((x) => !UNITS[x].naval)) expect(classes.has(c), `${n.id} ${c}`).toBe(true);
      expect(classes.has('fleet') && classes.has('transport'), `${n.id} navy`).toBe(true);
    }
  });

  it('makes the minor states minor: a capital, militia only, at war with every power and at peace with each other', () => {
    for (const m of MINORS) {
      expect(w.nations[m.id]!.minor).toBe(true);
      expect(sitesOf(m.id).filter((x) => x.kind === 'capital')).toHaveLength(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === m.id).map((f) => f.unitClass));
      // Militia: infantry, a recon screen, and in the big countries mechanized; never armour, air or ships.
      for (const c of classes) expect(['infantry', 'mechanized', 'recon'], `${m.id} ${c}`).toContain(c);
    }
    for (const n of NATIONS) for (const m of MINORS) expect(w.relations[[n.id, m.id].sort().join('|')], `${n.id} ${m.id}`).toBe('war');
    expect(w.relations[['canada', 'mexico'].sort().join('|')]).toBe('peace');
  });

  it('puts the real places where they belong: Hawaii, Guam and the Aleutians American, Sakhalin Russian, the islands at sea', () => {
    const owner = (name: string) => Object.values(w.sites).find((s) => s.name === name)!.owner;
    expect([owner('Honolulu'), owner('Guam'), owner('Adak'), owner('Anchorage')]).toEqual(['usa', 'usa', 'usa', 'usa']);
    expect(owner('Sakhalin')).toBe('russia');
    expect(owner('Taipei')).toBe('taiwan');
    // Hawaii and Japan cannot be walked to from the mainland: the sea is in the way.
    const cost = (k: string) => enterCost(w.tiles[k], 'infantry');
    const key = (name: string) => Object.values(w.sites).find((s) => s.name === name)!.key;
    expect(findPath(key('Honolulu'), key('San Francisco'), cost)).toBeNull();
    expect(findPath(key('Tokyo'), key('Beijing'), cost)).toBeNull();
    // Korea joins China by land; Alaska joins Canada.
    expect(findPath(key('Seoul'), key('Beijing'), cost)).not.toBeNull();
    expect(findPath(key('Anchorage'), key('Vancouver'), cost)).not.toBeNull();
    // The Bering crossing: an army can walk from Siberia into Alaska, and on to Moscow.
    expect(w.tiles[keyOf(offsetToAxial(25, 0))]!.terrain).not.toBe('water');
    expect(findPath(key('Anchorage'), key('Petropavlovsk'), cost)).not.toBeNull();
    // Moscow and St Petersburg to the west; Washington and New York on the Atlantic coast.
    expect([owner('Moscow'), owner('St Petersburg'), owner('Washington'), owner('New York')]).toEqual(['russia', 'russia', 'usa', 'usa']);
    expect(findPath(key('Moscow'), key('Vladivostok'), cost)).not.toBeNull();
    expect(findPath(key('Washington'), key('San Francisco'), cost)).not.toBeNull();
    expect(w.sites['russia-capital']!.name).toBe('Moscow');
    expect(w.sites['usa-capital']!.name).toBe('Washington');
  });

  it('opens with each power\'s navy at sea off a home port, and every coastal site a port', () => {
    const navy = (n: string) => Object.values(w.formations).filter((f) => f.owner === n && UNITS[f.unitClass].naval).map((f) => f.unitClass).sort();
    expect(navy('usa')).toEqual(['carrier', 'fleet', 'transport', 'transport']);
    expect(navy('china')).toEqual(['carrier', 'fleet', 'transport', 'transport']);
    expect(navy('japan')).toEqual(['carrier', 'carrier', 'fleet', 'transport', 'transport']);
    expect(navy('russia')).toEqual(['carrier', 'fleet', 'transport']);
    for (const f of Object.values(w.formations)) if (UNITS[f.unitClass].naval) expect(w.tiles[f.key]!.terrain).toBe('water');
    const port = (name: string) => w.tiles[Object.values(w.sites).find((s) => s.name === name)!.key]!.port;
    expect([port('San Francisco'), port('Tokyo'), port('Vladivostok'), port('Shanghai'), port('Honolulu')]).toEqual([true, true, true, true, true]);
    expect(port('Calgary')).toBeFalsy();
  });

  it('starts every power level: the same victory points, output and army weight, whatever its size', () => {
    const vp = (p: string) => Object.values(w.sites).filter((s) => s.owner === p).reduce((a, s) => a + s.victoryPoints, 0);
    // Output is what the sites yield and what the land pays (a credit per RULES.hexesPerCredit
    // hexes). Before ruleset 2.6.0 this measured the sites alone, so it called Japan level while
    // its 16 hexes paid it 4 credits a turn against China's 42.
    const land = (p: string) => Object.values(w.tiles).filter((t) => t.owner === p).length;
    const out = (p: string) => Object.values(w.sites).filter((s) => s.owner === p).reduce((a, s) => a + s.yields.credits + s.yields.energy + s.yields.materials + s.yields.food + s.yields.industry, 0) + Math.floor(land(p) / RULES.hexesPerCredit);
    const credits = (p: string) => Object.values(w.sites).filter((s) => s.owner === p).reduce((a, s) => a + s.yields.credits, 0) + Math.floor(land(p) / RULES.hexesPerCredit);
    const army = (p: string) => Object.values(w.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
    const spread = (f: (p: string) => number) => {
      const v = NATIONS.map((n) => f(n.id));
      return (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    };
    expect(spread(vp)).toBeLessThanOrEqual(0.05);
    expect(spread(out)).toBeLessThanOrEqual(0.05);
    expect(spread(army)).toBeLessThanOrEqual(0.1);
    // No power is poorer in credits for being small: the land's pay is made up on the cities.
    // (Japan's were 113 a turn against China's 148, a spread of 0.24, before 2.6.0.)
    expect(spread(credits)).toBeLessThanOrEqual(0.1);
    // The United States is still the biggest country on the map, and Japan the smallest.
    expect(land('usa')).toBeGreaterThan(land('japan') * 5);
  });

  it('gives every island prize open ground to land on beside its cities', () => {
    // A landing goes onto open ground first, then the city is taken from the land: an island of
    // nothing but garrisoned cities could only be stormed straight from the ships.
    for (const m of ['taiwan', 'skorea']) {
      const ground = Object.values(w.tiles).filter((t) => t.owner === m && !t.siteId);
      expect(ground.length, m).toBeGreaterThanOrEqual(1);
    }
    const taipei = Object.values(w.sites).find((s) => s.name === 'Taipei')!;
    const beside = Object.values(w.tiles).filter((t) => t.owner === 'taiwan' && !t.siteId && keyDistance(t.key, taipei.key) === 1);
    expect(beside.length).toBeGreaterThanOrEqual(1);
  });

  it('changes only the ground with the seed, never the coasts, borders or sites', () => {
    const a = createPacificScenario(1);
    const b = createPacificScenario(99);
    const shape = (x: typeof a) => sortedKeys(x.tiles).map((k) => `${k}:${x.tiles[k]!.owner}:${x.tiles[k]!.terrain === 'water'}`);
    expect(shape(a)).toEqual(shape(b));
    expect(Object.values(a.sites).map((s) => s.key)).toEqual(Object.values(b.sites).map((s) => s.key));
    expect(sortedKeys(a.tiles).some((k) => a.tiles[k]!.terrain !== b.tiles[k]!.terrain)).toBe(true);
  });
});
