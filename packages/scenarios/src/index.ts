import type { WorldState } from '@brink/contracts';
import { createPacificScenario, MAX_TURNS, PACIFIC_ID, THEATRES } from './pacific';

export * from './crises';
export * from './pacific';

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
    nations: 4,
    maxTurns: MAX_TURNS,
  },
];

export function createScenario(id: string, seed: number): WorldState {
  if (THEATRES.some((t) => t.id === id)) return createPacificScenario(seed);
  throw new Error(`unknown scenario: ${id}`);
}
