import type { WorldState } from '@brink/contracts';
import { seedCommanders } from '@brink/simulation';
import { createPacificScenario, MAX_TURNS, NATIONS, PACIFIC_ID, THEATRES } from './pacific';
import { createTestbedScenario, TESTBED_ID } from './testbed';

export * from './crises';
export * from './pacific';
export * from './build';
export * from './testbed';

export interface ScenarioInfo {
  id: string;
  name: string;
  summary: string;
  nations: number;
  maxTurns: number;
}

export const SCENARIOS: readonly ScenarioInfo[] = [
  {
    id: PACIFIC_ID,
    name: 'The Pacific',
    summary: 'The United States, Russia, China and Japan fight across an ocean of islands, with Canada, Mexico, the Koreas and Taiwan caught between them.',
    nations: NATIONS.length,
    maxTurns: MAX_TURNS,
  },
];

export function createScenario(id: string, seed: number): WorldState {
  if (THEATRES.some((t) => t.id === id)) return seedCommanders(createPacificScenario(seed));
  // The world-engine testbed: playable by the engine and the AI, never listed for a player.
  if (id === TESTBED_ID) return seedCommanders(createTestbedScenario(seed));
  throw new Error(`unknown scenario: ${id}`);
}
