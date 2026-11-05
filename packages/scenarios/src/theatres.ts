import type { NationId, WorldState } from '@brink/contracts';
import { seedCommanders } from '@brink/simulation';
import { AMERICAS_ID, AMERICAS_MAX_TURNS, AMERICAS_MINORS, AMERICAS_POWERS, createAmericasScenario } from './americas';
import { createFirstContact, FIRST_CONTACT_ID, FIRST_CONTACT_MINORS, FIRST_CONTACT_NATIONS, FIRST_CONTACT_TURNS } from './blackfiles';
import type { NationSpec } from './build';
import { CRISES, type Crisis } from './crises';
import { createEuropeScenario, EUROPE_ID, EUROPE_MAX_TURNS, EUROPE_MINORS, EUROPE_NATIONS } from './europe';
import { createIndoPacScenario, INDOPAC_ID, INDOPAC_MAX_TURNS, INDOPAC_MINORS, INDOPAC_NATIONS } from './indopac';
import { createMideastScenario, MIDEAST_ID, MIDEAST_MAX_TURNS, MIDEAST_MINORS, MIDEAST_NATIONS } from './mideast';
import { createPacificScenario, MAX_TURNS, MINORS, NATIONS, PACIFIC_ID } from './pacific';

// Every campaign a player can start, in one table: the five theatres of the setup screen's picker
// and Black Files: First Contact, which has a button of its own. Each entry says who is in it (its
// powers and minor states), how it opens (the Opening Crises written for its map, none meaning the
// classic war only), who Easy puts beside a player (natural allies, in pairs), whether the Black
// Files toggle can seed it, and how its world is built. The setup screen, the title, the menu, the
// archive, the deploy screen, the map and the session all read theatres through here: no theatre
// id is compared anywhere else.

export interface Theatre {
  id: string;
  /** Its name on the picker and in the scenario list. */
  name: string;
  /** The picker's line: where it runs and what is in it. */
  summary: string;
  /** The scenario list's longer line (the title screen, the API). */
  about: string;
  /** Wars you must have won to play it. */
  unlock: number;
  /** The scenario's own turn limit (a campaign's length can set another). */
  maxTurns: number;
  /** On the setup screen's theatre picker. First Contact is not: it starts from its own button. */
  listed: boolean;
  /** The powers a player can lead, in the map's order. */
  powers: readonly NationSpec[];
  /** The minor states between them. */
  minors: readonly NationSpec[];
  /** The Opening Crises written for its map; none: the classic opening only. */
  crises: readonly Crisis[];
  /** Easy's natural ally for each power that has one: pairs, both ways. */
  allies: Readonly<Record<NationId, NationId>>;
  /** The Black Files toggle can seed the anomaly into a campaign here (its sites are on this map). */
  blackFiles: boolean;
  /** Opens under a treaty (First Contact's Antarctic Treaty): Easy sets no wars of its own. */
  treaty: boolean;
  /** The land is ice: the map draws it pale. */
  ice: boolean;
  /** The turn-1 world for a seed, generals and all. */
  create: (seed: number) => WorldState;
}

const pairs = (...p: readonly [NationId, NationId][]): Record<NationId, NationId> => Object.fromEntries(p.flatMap(([a, b]) => [[a, b], [b, a]]));

const BASE = { unlock: 0, listed: true, crises: [] as readonly Crisis[], blackFiles: false, treaty: false, ice: false };

/** Every campaign there is, the picker's in its order, First Contact last. */
export const ALL_THEATRES: readonly Theatre[] = [
  {
    ...BASE,
    id: PACIFIC_ID,
    name: 'The Pacific',
    summary: 'Moscow to Washington: four powers, seven nations caught between them, and an ocean of islands.',
    about: 'The United States, Russia, China and Japan fight across an ocean of islands, with Canada, Mexico, the Koreas and Taiwan caught between them.',
    maxTurns: MAX_TURNS,
    powers: NATIONS,
    minors: MINORS,
    crises: CRISES,
    allies: pairs(['usa', 'japan'], ['russia', 'china']),
    // The Black Files' sites, digs and incursions are placed on the Pacific's map (`applyBlackFiles`).
    blackFiles: true,
    create: createPacificScenario,
  },
  {
    ...BASE,
    id: EUROPE_ID,
    name: 'Europe',
    summary: 'The Atlantic to the Urals: six powers, forty nations between them, and the straits from the Channel to the Bosphorus.',
    about: 'The United Kingdom, France, Germany, Poland, Russia and Turkey fight from the Atlantic to the Urals, with the Nordics, the Baltics, Ukraine, the Balkans and the Mediterranean shore caught between them.',
    maxTurns: EUROPE_MAX_TURNS,
    powers: EUROPE_NATIONS,
    minors: EUROPE_MINORS,
    allies: pairs(['uk', 'france'], ['germany', 'poland'], ['russia', 'turkey']),
    create: createEuropeScenario,
  },
  {
    ...BASE,
    id: MIDEAST_ID,
    name: 'Middle East and Africa',
    summary: 'Istanbul to the Cape: six regional powers, twenty-four states between them, and the oil and the straits of Suez, Hormuz and Bab-el-Mandeb.',
    about: 'Turkey, Iran, Saudi Arabia, Egypt, Nigeria and South Africa contest the oil, the minerals and the straits from the Mediterranean to the Cape.',
    maxTurns: MIDEAST_MAX_TURNS,
    powers: MIDEAST_NATIONS,
    minors: MIDEAST_MINORS,
    // Cairo and Riyadh, the continent's two biggest economies, and Ankara and Tehran, rivals who trade.
    allies: pairs(['egypt', 'saudi-arabia'], ['nigeria', 'south-africa'], ['turkey', 'iran']),
    create: createMideastScenario,
  },
  {
    ...BASE,
    id: INDOPAC_ID,
    name: 'Indo-Pacific South',
    summary: 'Karachi to Wellington: India, Pakistan, China, Indonesia and Australia, fifteen nations between them, and the straits that join two oceans.',
    about: 'India, Pakistan, China, Indonesia and Australia fight from the Himalaya to the Tasman Sea, over the straits, reefs and islands between two oceans.',
    maxTurns: INDOPAC_MAX_TURNS,
    powers: INDOPAC_NATIONS,
    minors: INDOPAC_MINORS,
    // Five powers: Indonesia stands alone.
    allies: pairs(['india', 'australia'], ['pakistan', 'china']),
    create: createIndoPacScenario,
  },
  {
    ...BASE,
    id: AMERICAS_ID,
    name: 'The Americas',
    summary: 'Alaska to Cape Horn: six powers, fourteen nations between them, and the Panama Canal in the middle.',
    about: 'The United States, Canada, Mexico, Colombia, Brazil and Argentina fight from the Arctic to Cape Horn, with Cuba, Venezuela, Peru, Chile and the Panama Canal between them.',
    maxTurns: AMERICAS_MAX_TURNS,
    powers: AMERICAS_POWERS,
    minors: AMERICAS_MINORS,
    allies: pairs(['usa', 'canada'], ['mexico', 'colombia'], ['brazil', 'argentina']),
    create: createAmericasScenario,
  },
  {
    ...BASE,
    id: FIRST_CONTACT_ID,
    name: 'Black Files: First Contact',
    summary: 'The Antarctic ice: five powers under the treaty, four digs on the plateau, and something under it that wakes.',
    about: 'Five powers on the Antarctic ice under the treaty, four digs on the plateau, and something under it that wakes. Sign the Accord, or betray it.',
    maxTurns: FIRST_CONTACT_TURNS,
    listed: false,
    powers: FIRST_CONTACT_NATIONS,
    minors: FIRST_CONTACT_MINORS,
    // Easy's pairs as they stood before the theatres: Russia and China are both on the ice.
    allies: pairs(['russia', 'china']),
    treaty: true,
    ice: true,
    create: createFirstContact,
  },
];

/** The theatres of the setup screen's picker, in its order. The first is the default. */
export const THEATRES: readonly Theatre[] = ALL_THEATRES.filter((t) => t.listed);

/** The theatre a campaign starts in when nothing names one (a request without a theatre). */
export const DEFAULT_THEATRE: Theatre = THEATRES[0]!;

/** Black Files: First Contact, the campaign with a button of its own. */
export const FIRST_CONTACT: Theatre = ALL_THEATRES.find((t) => t.id === FIRST_CONTACT_ID)!;

/** Any campaign by id, listed or not; undefined for one the game does not have. */
export function theatreOf(id: string | undefined): Theatre | undefined {
  return ALL_THEATRES.find((t) => t.id === id);
}

const known = (id: string): Theatre => theatreOf(id) ?? DEFAULT_THEATRE;

/** The powers a player can lead in a theatre (the default theatre's for an unknown id). */
export function theatrePowers(theatre: string): readonly NationSpec[] {
  return known(theatre).powers;
}

/** The minor states of a theatre. */
export function theatreMinors(theatre: string): readonly NationSpec[] {
  return known(theatre).minors;
}

/** The Opening Crises written for a theatre; none means the classic opening only. */
export function theatreCrises(theatre: string): readonly Crisis[] {
  return theatreOf(theatre)?.crises ?? [];
}

/** True where a campaign can only open the classic way: no Opening Crisis is written for its map. */
export function classicOnly(theatre: string): boolean {
  return theatreCrises(theatre).length === 0;
}

/** A power's natural ally on Easy in a theatre, if it has one there. */
export function naturalAlly(theatre: string, nation: NationId): NationId | undefined {
  return theatreOf(theatre)?.allies[nation];
}

/**
 * A nation by id, as `theatre` describes it when it is given and has it (Turkey is red in the Middle
 * East and orange in Europe), else as the first campaign that has it: powers before minor states, so
 * Iran is the Middle East's power, not Europe's minor state.
 */
export function findNation(id: NationId | undefined, theatre?: string): NationSpec | undefined {
  if (!id) return undefined;
  const own = theatreOf(theatre);
  const here = own?.powers.find((x) => x.id === id) ?? own?.minors.find((x) => x.id === id);
  if (here) return here;
  for (const t of ALL_THEATRES) {
    const n = t.powers.find((x) => x.id === id);
    if (n) return n;
  }
  for (const t of ALL_THEATRES) {
    const n = t.minors.find((x) => x.id === id);
    if (n) return n;
  }
  return undefined;
}

/** A nation's short name for map labels and small tiles; the full name if no campaign has it. */
export function shortName(name: string): string {
  for (const t of ALL_THEATRES) {
    const n = t.powers.find((x) => x.name === name) ?? t.minors.find((x) => x.name === name);
    if (n) return n.short;
  }
  return name;
}

/** The turn-1 world of a campaign, with each power's starting generals. */
export function createTheatre(id: string, seed: number): WorldState | undefined {
  const t = theatreOf(id);
  return t ? seedCommanders(t.create(seed)) : undefined;
}
