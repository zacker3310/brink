import type { NationId, UnitClass, WorldState } from '@brink/contracts';
import { type MapFile, parseMap } from '@brink/map';
import { buildScenario, nationSpecs, type NationSpec, type ScenarioSetup } from './build';
import indopacMap from './maps/indopac.map.json' with { type: 'json' };

// The Indo-Pacific South (docs/indopac.md): South Asia, Southeast Asia and Oceania on one map, from
// Pakistan and India across the Bay of Bengal and the South China Sea to Australia and New Zealand,
// with China's south as the northern edge. Five powers (India, Pakistan, China, Indonesia, Australia)
// and fifteen minor states. The geography is `maps/indopac.map.json`; the seed varies only the ground
// inside each country. It is an archipelago war: most prizes are islands, so the navies matter.

export const INDOPAC_ID = 'indopac';
export const INDOPAC_MAX_TURNS = 30;

/** The theatre's map, checked when the module loads. */
export const INDOPAC_MAP: MapFile = parseMap(indopacMap, 'maps/indopac.map.json');

/** What the theatre adds to its map: the opening navies and the bigger minor states' militia. */
const SETUP: ScenarioSetup = {
  scenarioId: INDOPAC_ID,
  maxTurns: INDOPAC_MAX_TURNS,
  navies: {
    india: { port: 'Mumbai', ships: ['fleet', 'transport', 'transport', 'carrier'] },
    pakistan: { port: 'Karachi', ships: ['fleet', 'transport', 'transport'] },
    china: { port: 'Guangzhou', ships: ['fleet', 'transport', 'transport', 'carrier'] },
    // An archipelago's navy: the lift to hold its own islands and to reach the next one.
    indonesia: { port: 'Surabaya', ships: ['fleet', 'fleet', 'transport', 'transport', 'transport'] },
    // An island continent: nothing reaches it, or leaves it, except by sea.
    australia: { port: 'Darwin', ships: ['carrier', 'fleet', 'transport', 'transport', 'transport'] },
  },
  // Big countries defend deeper: militia per city beyond the infantry every city has.
  // Indochina is China's back yard: its states dig in deep, or China eats them in ten turns and
  // wins every war on the score (20 of 20 soak matches with one infantry regiment a city).
  militia: {
    vietnam: ['infantry', 'mechanized'],
    thailand: ['infantry', 'mechanized'],
    myanmar: ['infantry'],
    laos: ['infantry'],
    cambodia: ['infantry'],
    philippines: ['infantry'],
    malaysia: ['infantry'],
  } satisfies Record<NationId, UnitClass[]>,
};

const ALL: readonly NationSpec[] = nationSpecs(INDOPAC_MAP, SETUP);

/** The five powers a player can lead. */
export const INDOPAC_NATIONS: readonly NationSpec[] = ALL.filter((n) => !n.minor);

/** The independent states between them. */
export const INDOPAC_MINORS: readonly NationSpec[] = ALL.filter((n) => n.minor);

export function createIndoPacScenario(seed: number): WorldState {
  return buildScenario(INDOPAC_MAP, seed, SETUP);
}
