import type { WorldState } from '@brink/contracts';
import { seedCommanders } from '@brink/simulation';
import { AMERICAS_ID, AMERICAS_MAX_TURNS, AMERICAS_MINORS, AMERICAS_POWERS, createAmericasScenario } from './americas';
import type { NationSpec } from './build';
import { createPacificScenario, MAX_TURNS, MINORS, NATIONS, PACIFIC_ID } from './pacific';
import { createTestbedScenario, TESTBED_ID } from './testbed';

export * from './crises';
export * from './pacific';
export * from './build';
export * from './testbed';
export * from './americas';

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
    id: AMERICAS_ID,
    name: 'The Americas',
    summary: 'The United States, Canada, Mexico, Colombia, Brazil and Argentina fight from the Arctic to Cape Horn, with Cuba, Venezuela, Peru, Chile and the Panama Canal between them.',
    nations: AMERICAS_POWERS.length,
    maxTurns: AMERICAS_MAX_TURNS,
  },
];

/** Each theatre's powers and minor states, as the setup screen lists them. */
const THEATRE_NATIONS: Readonly<Record<string, { powers: readonly NationSpec[]; minors: readonly NationSpec[] }>> = {
  [PACIFIC_ID]: { powers: NATIONS, minors: MINORS },
  [AMERICAS_ID]: { powers: AMERICAS_POWERS, minors: AMERICAS_MINORS },
};

/** A theatre's powers and minor states; the Pacific's for an id it does not know. */
export function theatreNations(id: string): { powers: readonly NationSpec[]; minors: readonly NationSpec[] } {
  return THEATRE_NATIONS[id] ?? THEATRE_NATIONS[PACIFIC_ID]!;
}

/** Every power of every theatre, once each (the first theatre's spec wins): for saves and menus. */
export const ALL_POWERS: readonly NationSpec[] = Object.values(THEATRE_NATIONS)
  .flatMap((t) => t.powers)
  .filter((n, i, all) => all.findIndex((m) => m.id === n.id) === i);

/** A nation's short name for map labels and small tiles, from any theatre; the full name if none has it. */
export function shortName(name: string): string {
  for (const t of Object.values(THEATRE_NATIONS)) {
    const n = [...t.powers, ...t.minors].find((x) => x.name === name);
    if (n) return n.short;
  }
  return name;
}

export function createScenario(id: string, seed: number): WorldState {
  if (id === PACIFIC_ID) return seedCommanders(createPacificScenario(seed));
  if (id === AMERICAS_ID) return seedCommanders(createAmericasScenario(seed));
  // The world-engine testbed: playable by the engine and the AI, never listed for a player.
  if (id === TESTBED_ID) return seedCommanders(createTestbedScenario(seed));
  throw new Error(`unknown scenario: ${id}`);
}
