// Russia: the Directorate's land power. It plays a war of mass and patience: guns before men,
// drones over the line every night, the enemy's radios jammed and his supply cut, and a defence
// dug three belts deep while the missiles reach past the front. No landings, no carrier war.
// Registered in `NATION_ROSTERS` (commanders.ts) and `NATION_DOCTRINES` (doctrine.ts).

import type { CardDef, NationDoctrine } from '../doctrine';
import type { GeneralDef } from '../commanders';

/** A Russian general: the roster entry plus a line of biography. */
export interface RussianGeneral extends GeneralDef {
  bio: string;
}

/** Three fictional generals, one for each of the Russian school's habits: guns, depth and spades. */
export const ROSTER: readonly RussianGeneral[] = [
  {
    name: 'Arkady Zhelezin',
    trait: 'gunner',
    bio: 'Commanded a Tornado-S brigade on the Dnieper; counts a battle won in shells fired, not ground taken.',
  },
  {
    name: 'Yuri Belotserkov',
    trait: 'firebrand',
    bio: 'A disciple of Tukhachevsky’s deep battle: breach on a narrow front, then pour the second echelon through.',
  },
  {
    name: 'Nadezhda Orlova',
    trait: 'sapper',
    bio: 'Built the minefields of the southern line; her trenches are dug before the enemy has finished planning.',
  },
];

const card = (c: CardDef): CardDef => c;

/** Russia's six signature cards. */
export const SIGNATURE_CARDS: CardDef[] = [
  card({
    id: 'geran_swarm',
    name: 'Geran Swarm',
    flavour: 'A moped engine in the dark, then another, then forty. The sirens never stop.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'kamikaze', missions: 2 },
      { kind: 'strike_bonus', classes: ['drone'], percent: 30 },
    ],
  }),
  card({
    id: 'god_of_war',
    name: 'God of War',
    flavour: 'Artillery is the god of war, and the god is fed ten thousand shells a day.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'strike_bonus', classes: ['artillery'], percent: 40 },
      { kind: 'arena_support', asset: 'tornado', missions: 2 },
    ],
  }),
  card({
    id: 'iskander_strike',
    name: 'Iskander Strike',
    flavour: 'Quasi-ballistic, manoeuvring, five hundred kilometres. The command post was there an hour ago.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 8, damage: 140 }],
  }),
  card({
    id: 'kalibr_volley',
    name: 'Kalibr Volley',
    flavour: 'A corvette in a quiet bay ripples eight missiles and turns for home.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'fleet', range: 3, damage: 110 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 1 },
    ],
  }),
  card({
    id: 'krasukha_jamming',
    name: 'Krasukha Jamming',
    flavour: 'The radios hiss, the satnav lies, and the fuel convoy drives into the wrong valley.',
    cost: 3,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 2 }],
  }),
  card({
    id: 'surovikin_line',
    name: 'Surovikin Line',
    flavour: 'Dragon’s teeth, an anti-tank ditch, a minefield, and then the trenches begin.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 60, radius: 3 }],
  }),
];

/**
 * Seventeen cards: the signatures (the guns, drones and spades twice), information war twice, and
 * the generic staples a land power leans on. No landings, no air superiority, no naval gunfire.
 */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'russia',
  cards: SIGNATURE_CARDS,
  deck: [
    'dig_in',
    'disinformation',
    'disinformation',
    'geran_swarm',
    'geran_swarm',
    'god_of_war',
    'god_of_war',
    'iskander_strike',
    'kalibr_volley',
    'krasukha_jamming',
    'propaganda',
    'rally',
    'recon_flight',
    'requisition',
    'requisition',
    'surovikin_line',
    'surovikin_line',
  ],
};

/** A line for the nation picker or briefing, where one is shown. */
export const NATION_BLURBS: Record<string, string> = {
  russia:
    'A war of mass and patience: massed guns and drone swarms grind the line, jammers starve the enemy of supply, missiles reach past the front, and every hex taken is dug in three belts deep.',
};
