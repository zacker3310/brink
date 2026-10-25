import type { WorldState } from '@brink/contracts';
import { createMeridianScenario, MERIDIAN_ID } from './meridian';

export * from './meridian';

export interface ScenarioInfo {
  id: string;
  name: string;
  summary: string;
  nations: number;
  maxTurns: number;
}

export const SCENARIOS: readonly ScenarioInfo[] = [
  {
    id: MERIDIAN_ID,
    name: 'The Meridian Crisis',
    summary: 'Four states fight over the Meridian basin, its oil, its mines and the free city of Vessa.',
    nations: 4,
    maxTurns: 30,
  },
];

export function createScenario(id: string, seed: number): WorldState {
  if (id === MERIDIAN_ID) return createMeridianScenario(seed);
  throw new Error(`unknown scenario: ${id}`);
}
