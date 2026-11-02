import { describe, expect, it } from 'vitest';
import { UNIT_CLASSES } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { findPath, offsetToAxial, keyOf } from '@brink/map';
import { enterCost, sortedKeys } from '@brink/simulation';
import { createPacificScenario, MINORS, NATIONS, PACIFIC_ID } from './pacific';
import { createScenario } from './index';

describe('The Pacific', () => {
  const w = createPacificScenario(1);
  const sitesOf = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);

  it('is the four powers and the seven minor states, on a 42 x 20 map with sea and every land terrain', () => {
    expect(sortedKeys(w.nations)).toEqual(['canada', 'china', 'japan', 'kazakhstan', 'mexico', 'mongolia', 'nkorea', 'russia', 'skorea', 'taiwan', 'usa']);
    expect(NATIONS.map((n) => n.id)).toEqual(['usa', 'russia', 'china', 'japan']);
    expect(Object.keys(w.tiles)).toHaveLength(840);
    const terrains = new Set(Object.values(w.tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'] as const) expect(terrains.has(t), t).toBe(true);
    expect(createScenario(PACIFIC_ID, 1)).toEqual(w);
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

  it('makes the minor states minor: a capital, militia only, at war with the powers (Canada and Mexico at peace with the US) and at peace with each other', () => {
    for (const m of MINORS) {
      expect(w.nations[m.id]!.minor).toBe(true);
      expect(sitesOf(m.id).filter((x) => x.kind === 'capital')).toHaveLength(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === m.id).map((f) => f.unitClass));
      // Militia: infantry, a recon screen, and in the big countries mechanized; never armour, air or ships.
      for (const c of classes) expect(['infantry', 'mechanized', 'recon'], `${m.id} ${c}`).toContain(c);
    }
    const home = (n: string, m: string) => n === 'usa' && (m === 'canada' || m === 'mexico');
    for (const n of NATIONS) for (const m of MINORS) expect(w.relations[[n.id, m.id].sort().join('|')], `${n.id} ${m.id}`).toBe(home(n.id, m.id) ? 'peace' : 'war');
    // The United States' war is across the ocean: its neighbours are not its prizes.
    expect(w.nations.usa!.objectives).not.toContain('canada-capital');
    expect(w.nations.russia!.objectives).toContain('canada-capital');
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
    expect(w.tiles[keyOf(offsetToAxial(25, 0))]!.terrain).toBe('water'); // the Bering Strait
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

  it('changes only the ground with the seed, never the coasts, borders or sites', () => {
    const a = createPacificScenario(1);
    const b = createPacificScenario(99);
    const shape = (x: typeof a) => sortedKeys(x.tiles).map((k) => `${k}:${x.tiles[k]!.owner}:${x.tiles[k]!.terrain === 'water'}`);
    expect(shape(a)).toEqual(shape(b));
    expect(Object.values(a.sites).map((s) => s.key)).toEqual(Object.values(b.sites).map((s) => s.key));
    expect(sortedKeys(a.tiles).some((k) => a.tiles[k]!.terrain !== b.tiles[k]!.terrain)).toBe(true);
  });
});
