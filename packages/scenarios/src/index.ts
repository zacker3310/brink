import type { WorldState } from '@brink/contracts';
import { seedCommanders } from '@brink/simulation';
import { createEuropeScenario, EUROPE_ID, EUROPE_MAX_TURNS, EUROPE_NATIONS } from './europe';
import { createPacificScenario, MAX_TURNS, NATIONS, PACIFIC_ID } from './pacific';
import { createTestbedScenario, TESTBED_ID } from './testbed';
import { createFirstContact, FIRST_CONTACT_ID, FIRST_CONTACT_TURNS } from './blackfiles';

export * from './crises';
export * from './pacific';
export * from './build';
export * from './testbed';
export * from './blackfiles';
export * from './europe';
export * from './theatres';

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
  {
    id: FIRST_CONTACT_ID,
    name: 'Black Files: First Contact',
    summary: 'Five powers on the Antarctic ice under the treaty, four digs on the plateau, and something under it that wakes. Sign the Accord, or betray it.',
    nations: 5,
    maxTurns: FIRST_CONTACT_TURNS,
  },
  {
    id: EUROPE_ID,
    name: 'Europe',
    summary: 'The United Kingdom, France, Germany, Poland, Russia and Turkey fight from the Atlantic to the Urals, with the Nordics, the Baltics, Ukraine, the Balkans and the Mediterranean shore caught between them.',
    nations: EUROPE_NATIONS.length,
    maxTurns: EUROPE_MAX_TURNS,
  },
];

export function createScenario(id: string, seed: number): WorldState {
  // Black Files: First Contact, on the Antarctica map (scenarios `blackfiles.ts`).
  if (id === FIRST_CONTACT_ID) return seedCommanders(createFirstContact(seed));
  if (id === PACIFIC_ID) return seedCommanders(createPacificScenario(seed));
  if (id === EUROPE_ID) return seedCommanders(createEuropeScenario(seed));
  // The world-engine testbed: playable by the engine and the AI, never listed for a player.
  if (id === TESTBED_ID) return seedCommanders(createTestbedScenario(seed));
  throw new Error(`unknown scenario: ${id}`);
}
