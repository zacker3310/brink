import type { WorldState } from '@brink/contracts';
import { seedCommanders } from '@brink/simulation';
import { createTestbedScenario, TESTBED_ID } from './testbed';
import { ALL_THEATRES, createTheatre } from './theatres';

export * from './crises';
export * from './build';
export * from './pacific';
export * from './europe';
export * from './mideast';
export * from './indopac';
export * from './americas';
export * from './blackfiles';
export * from './testbed';
export * from './theatres';

export interface ScenarioInfo {
  id: string;
  name: string;
  summary: string;
  nations: number;
  maxTurns: number;
}

/** Every campaign a player can start, as the title screen and the API list them (`ALL_THEATRES`). */
export const SCENARIOS: readonly ScenarioInfo[] = ALL_THEATRES.map((t) => ({ id: t.id, name: t.name, summary: t.about, nations: t.powers.length, maxTurns: t.maxTurns }));

export function createScenario(id: string, seed: number): WorldState {
  const world = createTheatre(id, seed);
  if (world) return world;
  // The world-engine testbed: playable by the engine and the AI, never listed for a player.
  if (id === TESTBED_ID) return seedCommanders(createTestbedScenario(seed));
  throw new Error(`unknown scenario: ${id}`);
}
