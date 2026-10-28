import { UNIT_CLASSES } from '@brink/contracts';
import { describe, expect, it } from 'vitest';
import { findPath } from '@brink/map';
import { enterCost, hashState } from '@brink/simulation';
import { createScenario } from './index';
import { createMeridianScenario, MERIDIAN_ID, THEATRES } from './meridian';

describe('the Meridian Crisis', () => {
  const w = createMeridianScenario(1);

  it('has four nations on 150-300 hexes with every required terrain', () => {
    const tiles = Object.values(w.tiles);
    expect(tiles.length).toBeGreaterThanOrEqual(150);
    expect(tiles.length).toBeLessThanOrEqual(300);
    expect(Object.keys(w.nations).sort()).toEqual(['aster', 'drevan', 'korva', 'selmar']);
    const terrains = new Set(tiles.map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water']) expect(terrains.has(t as never)).toBe(true);
    expect(tiles.some((t) => t.river)).toBe(true);
  });

  it('gives every nation territory, three cities and every unit class', () => {
    for (const n of Object.keys(w.nations)) {
      expect(Object.values(w.tiles).filter((t) => t.owner === n).length).toBeGreaterThan(20);
      expect(Object.values(w.sites).filter((s) => s.owner === n && s.kind !== 'depot').length).toBe(3);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === n).map((f) => f.unitClass));
      expect(classes.size).toBe(UNIT_CLASSES.length);
    }
  });

  it('connects every capital to every other by land', () => {
    const caps = Object.values(w.sites).filter((s) => s.kind === 'capital');
    for (const a of caps) for (const b of caps) {
      if (a === b) continue;
      expect(findPath(a.key, b.key, (_f, to) => enterCost(w.tiles[to], 'infantry'))).not.toBeNull();
    }
  });

  it('is deterministic in the seed and varies with it', () => {
    expect(hashState(createMeridianScenario(1))).toBe(hashState(w));
    expect(hashState(createMeridianScenario(2))).not.toBe(hashState(w));
  });
});

describe('theatres', () => {
  it('give every theatre its own ground, rivers and id', () => {
    const terrain = (id: string) => {
      const w = createScenario(id, 3);
      expect(w.scenarioId).toBe(id);
      const tiles = Object.values(w.tiles);
      return { rough: tiles.filter((t) => t.terrain === 'hills' || t.terrain === 'mountains' || t.terrain === 'forest').length, rivers: tiles.filter((t) => t.river).length };
    };
    const base = terrain(MERIDIAN_ID);
    const high = terrain('highland-front');
    const delta = terrain('varn-delta');
    expect(high.rough).toBeGreaterThan(base.rough);
    expect(delta.rough).toBeLessThan(base.rough);
    expect(delta.rivers).toBeGreaterThan(base.rivers);
    for (const t of THEATRES) expect(Object.keys(createScenario(t.id, 3).sites)).toHaveLength(Object.keys(createScenario(MERIDIAN_ID, 3).sites).length);
  });
});
