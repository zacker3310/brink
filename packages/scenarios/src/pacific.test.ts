import { describe, expect, it } from 'vitest';
import { UNIT_CLASSES } from '@brink/contracts';
import { findPath, offsetToAxial, keyOf } from '@brink/map';
import { enterCost, sortedKeys } from '@brink/simulation';
import { createPacificScenario, MINORS, NATIONS, PACIFIC_ID } from './pacific';
import { createScenario } from './index';

describe('The Pacific', () => {
  const w = createPacificScenario(1);
  const sitesOf = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);

  it('is the four powers and the five minor states, on a 30 x 18 map with sea and every land terrain', () => {
    expect(sortedKeys(w.nations)).toEqual(['canada', 'china', 'japan', 'mexico', 'nkorea', 'russia', 'skorea', 'taiwan', 'usa']);
    expect(NATIONS.map((n) => n.id)).toEqual(['usa', 'russia', 'china', 'japan']);
    expect(Object.keys(w.tiles)).toHaveLength(540);
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
      for (const c of UNIT_CLASSES) expect(classes.has(c), `${n.id} ${c}`).toBe(true);
    }
  });

  it('makes the minor states minor: a capital, militia only, at war with every power and at peace with each other', () => {
    for (const m of MINORS) {
      expect(w.nations[m.id]!.minor).toBe(true);
      expect(sitesOf(m.id).filter((x) => x.kind === 'capital')).toHaveLength(1);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === m.id).map((f) => f.unitClass));
      expect([...classes].sort()).toEqual(['infantry', 'recon']);
    }
    for (const n of NATIONS) for (const m of MINORS) expect(w.relations[[n.id, m.id].sort().join('|')]).toBe('war');
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
    expect(w.tiles[keyOf(offsetToAxial(15, 0))]!.terrain).toBe('water'); // the Bering Strait
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
