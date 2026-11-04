// The United States: a power that fights from the sea and the sky, a long way from home. Its
// generals and its doctrine. The deck leans on carriers, fleets and air wings, on landing where
// the enemy is thin, and on an industrial base nobody else can match; it holds no drone swarms,
// no saboteurs and no forced marches. Every number is an integer; a change is a ruleset change.

import type { CardId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A US general: the roster entry and one line of who they are. */
export interface UsaGeneral extends GeneralDef {
  bio: string;
}

/** Three fictional generals: carrier air power, the Marine Corps, and the logistics that carry both. */
export const ROSTER: readonly UsaGeneral[] = [
  {
    name: 'Margaret Halvorsen',
    trait: 'gunner',
    bio: 'Former carrier air wing commander who still plans every strike package on paper first.',
  },
  {
    name: 'Darius Whitfield',
    trait: 'marine',
    bio: 'Marine who has walked onto four hostile beaches and insists the fifth will be easier.',
  },
  {
    name: 'Raymond Castellanos',
    trait: 'quartermaster',
    bio: 'Ran the Pacific sealift; says amateurs talk tactics and he talks fuel.',
  },
];

/** One line for the setup dossier: how the United States plays. */
export const BLURB =
  'Expeditionary power. Carriers and cruise missiles reach where the army cannot; Marines land where the enemy is thin; the arsenal at home outlasts everyone.';

const card = (c: CardDef): CardDef => c;

/**
 * The signature cards. Ids carry the `us_` prefix so no other nation's cards can collide. The first
 * effect of each is the one the AI values it by (`packages/ai/src/doctrine.ts`).
 */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'us_carrier_strike_group',
    name: 'Carrier Strike Group',
    flavour: 'Ninety aircraft, four and a half acres of sovereign territory, and nobody asked permission.',
    cost: 4,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['carrier', 'air'], percent: 30 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
    ],
  }),
  card({
    id: 'us_tomahawk_salvo',
    name: 'Tomahawk Salvo',
    flavour: 'Forty birds off the destroyers before dawn. The first anyone hears is the second wave.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'fleet', range: 4, damage: 110 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 1 },
    ],
  }),
  card({
    id: 'us_marine_expeditionary_unit',
    name: 'Marine Expeditionary Unit',
    flavour: 'Twenty-two hundred Marines, their own air and their own guns, a day off any coast on earth.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'amphibious' },
      { kind: 'arena_support', asset: 'naval_gun', missions: 2 },
    ],
  }),
  card({
    id: 'us_awacs_overwatch',
    name: 'AWACS Overwatch',
    flavour: 'A rotodome at thirty thousand feet sees three hundred miles in every direction, and talks.',
    cost: 2,
    target: 'hex',
    duration: 2,
    effects: [
      { kind: 'reveal', radius: 4 },
      { kind: 'strike_bonus', classes: ['air'], percent: 10 },
    ],
  }),
  card({
    id: 'us_arsenal_of_democracy',
    name: 'Arsenal of Democracy',
    flavour: 'Detroit stops making sedans on Monday. By Friday the ships are sailing full.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'resources', gain: { materials: 90, energy: 40, credits: 40 } },
      { kind: 'stability', amount: 2 },
    ],
  }),
  card({
    id: 'us_global_strike',
    name: 'Global Strike',
    flavour: 'Thirty hours there and back from Missouri. The target never saw the bomber.',
    cost: 5,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 10, damage: 150 }],
  }),
];

/**
 * Seventeen cards: nine signature (the carrier group, Tomahawks and AWACS twice) and eight generic
 * ones that suit an expeditionary power. No Kamikaze Swarm, Sabotage, Forced March or Disinformation.
 */
export const DECK: readonly CardId[] = [
  'us_carrier_strike_group',
  'us_carrier_strike_group',
  'us_tomahawk_salvo',
  'us_tomahawk_salvo',
  'us_marine_expeditionary_unit',
  'us_awacs_overwatch',
  'us_awacs_overwatch',
  'us_arsenal_of_democracy',
  'us_global_strike',
  'air_superiority',
  'naval_bombardment',
  'amphibious_doctrine',
  'recon_flight',
  'requisition',
  'rally',
  'dig_in',
  'propaganda',
];

export const DOCTRINE: NationDoctrine = { nation: 'usa', cards: [...CARDS], deck: [...DECK] };
