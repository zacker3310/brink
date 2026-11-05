import type { WorldState } from '@brink/contracts';
import { seedCommanders } from '@brink/simulation';
import { type NationSpec } from './build';
import { createIndoPacScenario, INDOPAC_ID, INDOPAC_MAX_TURNS, INDOPAC_MINORS, INDOPAC_NATIONS } from './indopac';
import { createPacificScenario, MAX_TURNS, MINORS, NATIONS, PACIFIC_ID } from './pacific';
import { createTestbedScenario, TESTBED_ID } from './testbed';

export * from './crises';
export * from './pacific';
export * from './indopac';
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
  {
    id: INDOPAC_ID,
    name: 'Indo-Pacific South',
    summary: 'India, Pakistan, China, Indonesia and Australia fight from the Himalaya to the Tasman Sea, over the straits, reefs and islands between two oceans.',
    nations: INDOPAC_NATIONS.length,
    maxTurns: INDOPAC_MAX_TURNS,
  },
];

/** Each theatre's turn-1 world and the nations on its map: one entry per theatre. */
const THEATRE_BUILDS: Readonly<Record<string, { create: (seed: number) => WorldState; nations: readonly NationSpec[]; minors: readonly NationSpec[] }>> = {
  [PACIFIC_ID]: { create: createPacificScenario, nations: NATIONS, minors: MINORS },
  [INDOPAC_ID]: { create: createIndoPacScenario, nations: INDOPAC_NATIONS, minors: INDOPAC_MINORS },
};

/** The powers a player can lead in a theatre (the Pacific's for an unknown id). */
export function nationsOf(theatre: string): readonly NationSpec[] {
  return (THEATRE_BUILDS[theatre] ?? THEATRE_BUILDS[PACIFIC_ID]!).nations;
}

/** The minor states of a theatre (the Pacific's for an unknown id). */
export function minorsOf(theatre: string): readonly NationSpec[] {
  return (THEATRE_BUILDS[theatre] ?? THEATRE_BUILDS[PACIFIC_ID]!).minors;
}

/** A nation as some theatre describes it, powers first: for labels that know only a nation id. */
export function findNation(id: string): NationSpec | undefined {
  const all = Object.keys(THEATRE_BUILDS).sort((a, b) => (a === PACIFIC_ID ? -1 : b === PACIFIC_ID ? 1 : a < b ? -1 : 1));
  for (const t of all) {
    const n = THEATRE_BUILDS[t]!.nations.find((x) => x.id === id);
    if (n) return n;
  }
  for (const t of all) {
    const n = THEATRE_BUILDS[t]!.minors.find((x) => x.id === id);
    if (n) return n;
  }
  return undefined;
}

export function createScenario(id: string, seed: number): WorldState {
  const build = THEATRE_BUILDS[id];
  if (build) return seedCommanders(build.create(seed));
  // The world-engine testbed: playable by the engine and the AI, never listed for a player.
  if (id === TESTBED_ID) return seedCommanders(createTestbedScenario(seed));
  throw new Error(`unknown scenario: ${id}`);
}
