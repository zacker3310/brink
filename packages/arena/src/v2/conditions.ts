import type { Terrain } from '@brink/contracts';
import type { Biome, Conditions, SiteKind, TimeOfDay, Weather } from './types';

// The look of a battle: the biome from the hex, its site and the theatre; the time of day and the
// weather from the seed. Draws come from a hash of the seed, never the map's stream, so the
// conditions never change the ground and the ground never changes the conditions.

export interface ConditionsSetup {
  seed: number;
  terrain: Terrain;
  site: SiteKind;
  /** War-map theatre id. */
  theatre?: string;
  /** Explicit choices win over the draw. */
  biome?: Biome;
  time?: TimeOfDay;
  weather?: Weather;
}

const TIMES: readonly (readonly [TimeOfDay, number])[] = [
  ['day', 50],
  ['dawn', 15],
  ['dusk', 15],
  ['night', 20],
];

/** Percent chances by biome. Snow only in winter; never rain or snow in the desert. */
const WEATHER: Record<Biome, readonly (readonly [Weather, number])[]> = {
  winter: [
    ['clear', 40],
    ['overcast', 20],
    ['snow', 25],
    ['fog', 15],
  ],
  desert: [
    ['clear', 75],
    ['overcast', 10],
    ['fog', 15],
  ],
  steppe: [
    ['clear', 55],
    ['overcast', 20],
    ['rain', 15],
    ['fog', 10],
  ],
  temperate: [
    ['clear', 45],
    ['overcast', 20],
    ['rain', 20],
    ['fog', 15],
  ],
  urban: [
    ['clear', 45],
    ['overcast', 20],
    ['rain', 20],
    ['fog', 15],
  ],
};

/** 0..1 from the seed and a salt: one independent draw per question asked. */
function hash01(seed: number, salt: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca77) ^ 0x2545f491) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function weighted<T>(r: number, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  for (const [v, w] of table) {
    acc += w;
    if (r * total < acc) return v;
  }
  return table[table.length - 1]![0];
}

/**
 * Towns are urban. The Highland Front is winter on its hills, mountains and forests; the Varn Delta
 * is steppe with some desert on its plains; the Meridian (and any other theatre) is temperate, with
 * steppe on some plains and winter on some mountains.
 */
export function pickBiome(setup: Pick<ConditionsSetup, 'seed' | 'terrain' | 'site' | 'theatre' | 'biome'>): Biome {
  if (setup.biome) return setup.biome;
  const { terrain, site } = setup;
  if (terrain === 'urban' || site === 'capital' || site === 'city') return 'urban';
  const r = hash01(setup.seed, 1);
  if (setup.theatre === 'highland-front') return terrain === 'hills' || terrain === 'mountains' || terrain === 'forest' ? 'winter' : 'temperate';
  if (setup.theatre === 'varn-delta') return terrain === 'plains' && r < 0.3 ? 'desert' : 'steppe';
  if (terrain === 'plains') return r < 0.45 ? 'steppe' : 'temperate';
  if (terrain === 'mountains') return r < 0.2 ? 'winter' : 'temperate';
  return 'temperate';
}

export function pickConditions(setup: ConditionsSetup): Conditions {
  const biome = pickBiome(setup);
  return {
    biome,
    time: setup.time ?? weighted(hash01(setup.seed, 2), TIMES),
    weather: setup.weather ?? weighted(hash01(setup.seed, 3), WEATHER[biome]),
  };
}
