import type { NationId, UnitClass, WorldState } from '@brink/contracts';
import { type MapFile, parseMap } from '@brink/map';
import { buildScenario, nationSpecs, type NationSpec, type ScenarioSetup } from './build';
import europeMap from './maps/europe.map.json';

// Europe: six powers (the United Kingdom, France, Germany, Poland, Russia, Turkey) from the Atlantic
// to the Urals, Svalbard to the Sahara, and forty states between them: the Nordics and the Baltics,
// Ukraine and Belarus, the Balkans, the Mediterranean shore and the Levant. The geography is the map
// file `maps/europe.map.json`, baked from Natural Earth and finished by hand in packages/mapgen
// (europe.ts); the seed varies only the ground inside each country. Design: docs/europe.md.

export const EUROPE_ID = 'europe';
export const EUROPE_MAX_TURNS = 30;

/** The theatre's map, checked when the module loads. */
export const EUROPE_MAP: MapFile = parseMap(europeMap, 'maps/europe.map.json');

/**
 * What Europe adds to its map: the navies of six seas and the big states' militia. Russia sails
 * three squadrons (the Baltic Fleet from Kaliningrad, the Northern Fleet from Murmansk, the Black
 * Sea Fleet from Novorossiysk), France two (Toulon and Brest), Turkey two (the Bosphorus and the
 * Aegean). The United Kingdom's carriers sail from Portsmouth.
 */
const SETUP: ScenarioSetup = {
  scenarioId: EUROPE_ID,
  maxTurns: EUROPE_MAX_TURNS,
  navies: {
    uk: { port: 'Portsmouth', ships: ['carrier', 'fleet', 'transport', 'transport'] },
    france: [
      { port: 'Toulon', ships: ['carrier', 'fleet', 'transport'] },
      { port: 'Brest', ships: ['fleet', 'transport'] },
    ],
    germany: { port: 'Kiel', ships: ['fleet', 'transport'] },
    poland: { port: 'Gdansk', ships: ['fleet', 'transport'] },
    russia: [
      { port: 'Kaliningrad', ships: ['fleet', 'transport'] },
      { port: 'Murmansk', ships: ['fleet', 'carrier'] },
      { port: 'Novorossiysk', ships: ['fleet', 'transport'] },
    ],
    turkey: [
      { port: 'Istanbul', ships: ['fleet', 'transport'] },
      { port: 'Izmir', ships: ['carrier', 'fleet', 'transport'] },
    ],
  },
  // Big countries defend deeper: militia per city beyond the infantry every city has.
  militia: {
    ukraine: ['infantry', 'mechanized'],
    spain: ['infantry'],
    italy: ['infantry'],
    sweden: ['infantry'],
    iran: ['infantry'],
    egypt: ['infantry'],
    // The states of the central plain hold their capitals in depth, or the nearest power walks
    // through them all by turn 12 (Poland did, in most soak matches).
    czechia: ['infantry'],
    slovakia: ['infantry'],
    hungary: ['infantry'],
    belarus: ['infantry'],
    lithuania: ['infantry'],
    balkans: ['infantry'],
  } satisfies Record<NationId, UnitClass[]>,
};

const ALL: readonly NationSpec[] = nationSpecs(EUROPE_MAP, SETUP);

/** The six powers a player can lead. */
export const EUROPE_NATIONS: readonly NationSpec[] = ALL.filter((n) => !n.minor);

/** The independent states between the powers. */
export const EUROPE_MINORS: readonly NationSpec[] = ALL.filter((n) => n.minor);

export function createEuropeScenario(seed: number): WorldState {
  return buildScenario(EUROPE_MAP, seed, SETUP);
}
