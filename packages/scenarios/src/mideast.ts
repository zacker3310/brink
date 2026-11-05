import type { NationId, UnitClass, WorldState } from '@brink/contracts';
import { type MapFile, parseMap } from '@brink/map';
import { buildScenario, nationSpecs, type NationSpec, type ScenarioSetup } from './build';
import mideastMap from './maps/mideast.map.json';

// The Middle East and Africa: six regional powers (Turkey, Iran, Saudi Arabia, Egypt, Nigeria,
// South Africa) from the Mediterranean's south shore to the Cape, twenty-four minor states between them,
// and four of the world's chokepoints (Gibraltar, Suez, Bab-el-Mandeb, Hormuz). The geography is the
// map file `maps/mideast.map.json`, written by `packages/mapgen/src/cli/mideast.ts`; the seed varies
// only the ground the map leaves to it. Land outside every nation (`+` in the grid) is unaligned:
// nobody holds it and anyone may take it. Design: docs/mideast.md.

export const MIDEAST_ID = 'mideast';
export const MIDEAST_MAX_TURNS = 30;

/** The theatre's map, checked when the module loads. */
export const MIDEAST_MAP: MapFile = parseMap(mideastMap, 'maps/mideast.map.json');

/** What the theatre adds to its map: the opening navies and the bigger minor states' militia. */
const SETUP: ScenarioSetup = {
  scenarioId: MIDEAST_ID,
  maxTurns: MIDEAST_MAX_TURNS,
  navies: {
    // A light carrier each for the two Mediterranean navies (an amphibious assault ship's deck).
    turkey: { port: 'Izmir', ships: ['fleet', 'transport', 'carrier'] },
    egypt: { port: 'Alexandria', ships: ['fleet', 'transport', 'carrier'] },
    iran: { port: 'Bandar Abbas', ships: ['fleet', 'fleet', 'transport'] },
    'saudi-arabia': { port: 'Jeddah', ships: ['fleet', 'transport'] },
    nigeria: { port: 'Lagos', ships: ['fleet', 'transport'] },
    'south-africa': { port: 'Durban', ships: ['fleet', 'transport'] },
  },
  // Militia per city beyond the infantry every city has: a regiment more everywhere, so no prize falls
  // to a single column (the first 20 AI-only matches saw most minor capitals taken by turn 6), and
  // the big countries deeper still.
  militia: {
    ...Object.fromEntries(MIDEAST_MAP.nations.filter((n) => n.role === 'minor').map((n) => [n.id, ['infantry'] as UnitClass[]])),
    algeria: ['infantry', 'infantry'],
    'dr-congo': ['infantry', 'infantry'],
    ethiopia: ['infantry', 'mechanized'],
    iraq: ['infantry', 'mechanized'],
    sudan: ['infantry', 'infantry'],
  } satisfies Record<NationId, UnitClass[]>,
};

const ALL: readonly NationSpec[] = nationSpecs(MIDEAST_MAP, SETUP);

/** The six powers a player can lead, in the map's order. */
export const MIDEAST_NATIONS: readonly NationSpec[] = ALL.filter((n) => !n.minor);

/** The minor states between them. */
export const MIDEAST_MINORS: readonly NationSpec[] = ALL.filter((n) => n.minor);

export function createMideastScenario(seed: number): WorldState {
  return buildScenario(MIDEAST_MAP, seed, SETUP);
}
