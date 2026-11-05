import type { NationId, UnitClass, WorldState } from '@brink/contracts';
import { type MapFile, parseMap } from '@brink/map';
import { buildScenario, nationSpecs, type NationSpec, type ScenarioSetup } from './build';
import americasMap from './maps/americas.map.json' with { type: 'json' };

// The Americas (docs/americas.md): six powers from the Arctic to Cape Horn (the United States,
// Canada, Mexico, Colombia, Brazil and Argentina) and fourteen minor states between them, from
// Guatemala and Cuba to Chile and Uruguay. North and South America meet only at the isthmus, and
// the oceans meet only round the Horn and through the Panama Canal, whose port is Panama City: the
// holder of the city holds the canal. The geography is the map file `maps/americas.map.json`,
// drawn as a character grid in `packages/mapgen/src/americas.ts`.

export const AMERICAS_ID = 'americas';
export const AMERICAS_MAX_TURNS = 30;

/** The theatre's map, checked when the module loads. */
export const AMERICAS_MAP: MapFile = parseMap(americasMap, 'maps/americas.map.json');

/** What the Americas add to the map: the opening navies and the minor states' militia. */
const SETUP: ScenarioSetup = {
  scenarioId: AMERICAS_ID,
  maxTurns: AMERICAS_MAX_TURNS,
  navies: {
    // The US Second Fleet at Miami: the Gulf, the Caribbean and the Atlantic, the canal a day away.
    // One transport, not the Pacific's two: here the war is on land, on two fronts at once, and every
    // ship is weight that parity takes out of the army.
    usa: { port: 'Miami', ships: ['fleet', 'transport', 'carrier'] },
    canada: { port: 'Halifax', ships: ['fleet', 'transport'] },
    mexico: { port: 'Veracruz', ships: ['fleet', 'transport'] },
    colombia: { port: 'Cartagena', ships: ['fleet', 'transport'] },
    brazil: { port: 'Rio de Janeiro', ships: ['fleet', 'transport', 'carrier'] },
    argentina: { port: 'Buenos Aires', ships: ['fleet', 'transport'] },
  },
  // Big countries defend deeper: militia per city beyond the infantry every city has. Venezuela,
  // Ecuador and Peru most of all: without it Colombia ate the northern Andes by turn ten.
  militia: { venezuela: ['infantry', 'mechanized'], peru: ['infantry'], ecuador: ['infantry'], chile: ['infantry'], cuba: ['mechanized'] } satisfies Record<NationId, UnitClass[]>,
};

const ALL: readonly NationSpec[] = nationSpecs(AMERICAS_MAP, SETUP);

/** The six powers a player can lead, in the map's order. */
export const AMERICAS_POWERS: readonly NationSpec[] = ALL.filter((n) => !n.minor);

/** The independent states between them. */
export const AMERICAS_MINORS: readonly NationSpec[] = ALL.filter((n) => n.minor);

export function createAmericasScenario(seed: number): WorldState {
  return buildScenario(AMERICAS_MAP, seed, SETUP);
}
