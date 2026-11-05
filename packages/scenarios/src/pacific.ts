import type { NationId, UnitClass, WorldState } from '@brink/contracts';
import { type MapFile, parseMap } from '@brink/map';
import { AMERICAS_ALLIES, AMERICAS_ID } from './americas';
import { buildScenario, nationSpecs, type NationSpec, type ScenarioSetup } from './build';
import pacificMap from './maps/pacific.map.json';

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

/** A nation's short name for map labels and small tiles; the full name if it is not one of ours. */
export function shortName(name: string): string {
  return ALL.find((n) => n.name === name)?.short ?? name;
}

/** The one theatre. Kept as a list so saves and the setup screen read theatres as before. */
export interface Theatre {
  id: string;
  name: string;
  summary: string;
  /** Wars you must have won to play it. */
  unlock: number;
  /** Easy's natural allies by nation, where the theatre names its own (else the session's table). */
  allies?: Readonly<Record<NationId, NationId>>;
  /** The classic opening only: the Opening Crises are written for the Pacific's map and nations. */
  classicOnly?: true;
}

export const THEATRES: readonly Theatre[] = [
  { id: PACIFIC_ID, name: 'The Pacific', summary: 'Moscow to Washington: four powers, seven nations caught between them, and an ocean of islands.', unlock: 0 },
  { id: AMERICAS_ID, name: 'The Americas', summary: 'Alaska to Cape Horn: six powers, fourteen nations between them, and the Panama Canal in the middle.', unlock: 0, allies: AMERICAS_ALLIES, classicOnly: true },
];

export function theatreOf(id: string): Theatre | undefined {
  return THEATRES.find((t) => t.id === id);
}

export function createPacificScenario(seed: number): WorldState {
  return buildScenario(PACIFIC_MAP, seed, SETUP);
}
