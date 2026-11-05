import type { NationId } from '@brink/contracts';
import type { NationSpec } from './build';
import { CRISES, type Crisis } from './crises';
import { EUROPE_ID, EUROPE_MINORS, EUROPE_NATIONS } from './europe';
import { MIDEAST_ID, MIDEAST_MINORS, MIDEAST_NATIONS } from './mideast';
import { MINORS, NATIONS, PACIFIC_ID } from './pacific';

// Who is in each theatre a player can pick: its powers and its minor states, and the Opening Crises
// written for it. One entry per theatre; a theatre without one of its own has no crises (the classic
// opening only). The setup screen, the title and the save list read nations through here, so a
// campaign in any theatre finds its own.

interface TheatreCast {
  powers: readonly NationSpec[];
  minors: readonly NationSpec[];
  crises: readonly Crisis[];
}

export const THEATRE_CAST: Readonly<Record<string, TheatreCast>> = {
  [PACIFIC_ID]: { powers: NATIONS, minors: MINORS, crises: CRISES },
  [EUROPE_ID]: { powers: EUROPE_NATIONS, minors: EUROPE_MINORS, crises: [] },
  [MIDEAST_ID]: { powers: MIDEAST_NATIONS, minors: MIDEAST_MINORS, crises: [] },
};

const castOf = (theatre: string): TheatreCast => THEATRE_CAST[theatre] ?? THEATRE_CAST[PACIFIC_ID]!;

/** The powers a player can lead in a theatre (the Pacific's for an unknown id). */
export function theatrePowers(theatre: string): readonly NationSpec[] {
  return castOf(theatre).powers;
}

/** The minor states of a theatre. */
export function theatreMinors(theatre: string): readonly NationSpec[] {
  return castOf(theatre).minors;
}

/** The Opening Crises written for a theatre; none means the classic opening only. */
export function theatreCrises(theatre: string): readonly Crisis[] {
  return castOf(theatre).crises;
}

/** A nation of any theatre by id: the first theatre that has it (Russia is in two). */
export function findNation(id: NationId | undefined): NationSpec | undefined {
  if (!id) return undefined;
  for (const t of Object.keys(THEATRE_CAST)) {
    const c = THEATRE_CAST[t]!;
    const n = c.powers.find((x) => x.id === id) ?? c.minors.find((x) => x.id === id);
    if (n) return n;
  }
  return undefined;
}

/** A nation's short name for map labels and small tiles; the full name if it is not one of ours. */
export function shortName(name: string): string {
  for (const t of Object.keys(THEATRE_CAST)) {
    const c = THEATRE_CAST[t]!;
    const n = c.powers.find((x) => x.name === name) ?? c.minors.find((x) => x.name === name);
    if (n) return n.short;
  }
  return name;
}
