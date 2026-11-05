import type { NationId, UnitClass, WorldState } from '@brink/contracts';
import { type MapFile, parseMap } from '@brink/map';
import { buildScenario, nationSpecs, type NationSpec, type ScenarioSetup } from './build';
import pacificMap from './maps/pacific.map.json' with { type: 'json' };

export type { NationSpec, Place } from './build';

// The Pacific: four real powers (the United States, Russia, China, Japan) around a compressed ocean,
// seven independent states between them, and island chains to fight over. The map runs from Moscow
// in the west to Washington in the east: all of Russia and all of the United States, with the
// ocean squeezed so the war is on land and sea alike. The geography is the map file
// `maps/pacific.map.json` (the format: docs/mapgen.md), so coastlines and borders never change; the
// seed varies only the ground inside each country (forest, hills, mountains). Design: docs/pacific.md.

export const PACIFIC_ID = 'pacific';
export const MAX_TURNS = 30;

/** The theatre's map, checked when the module loads. */
export const PACIFIC_MAP: MapFile = parseMap(pacificMap, 'maps/pacific.map.json');
export const COLS = PACIFIC_MAP.cols;
export const ROWS = PACIFIC_MAP.rows;

/** What the Pacific adds to its map: the opening navies and the minor states' militia. */
const SETUP: ScenarioSetup = {
  scenarioId: PACIFIC_ID,
  maxTurns: MAX_TURNS,
  navies: {
    usa: { port: 'San Francisco', ships: ['fleet', 'transport', 'transport', 'carrier'] },
    russia: { port: 'Vladivostok', ships: ['fleet', 'transport', 'carrier'] },
    china: { port: 'Shanghai', ships: ['fleet', 'transport', 'transport', 'carrier'] },
    // An island nation's navy: two carrier groups and the lift to put an army ashore.
    japan: { port: 'Tokyo', ships: ['carrier', 'carrier', 'fleet', 'transport', 'transport'] },
  },
  // Big countries defend deeper: militia per city beyond the infantry every city has.
  militia: { canada: ['infantry', 'mechanized'], mexico: ['infantry'], kazakhstan: ['infantry'] } satisfies Record<NationId, UnitClass[]>,
};

const ALL: readonly NationSpec[] = nationSpecs(PACIFIC_MAP, SETUP);

/** The four powers a player can lead. */
export const NATIONS: readonly NationSpec[] = ALL.filter((n) => !n.minor);

/** The independent states between the powers. */
export const MINORS: readonly NationSpec[] = ALL.filter((n) => n.minor);

export function createPacificScenario(seed: number): WorldState {
  return buildScenario(PACIFIC_MAP, seed, SETUP);
}
