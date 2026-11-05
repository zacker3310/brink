// France: Europe's other nuclear-armed sea power, with an army that goes abroad. Its generals know
// the guns, the Legion and the long view; its signature cards are SCALP, the Rafale, the Caesar
// howitzer, the Charles de Gaulle, the Foreign Legion and the intelligence service. Balance data:
// integers only; a change is a ruleset change. Registered in `commanders.ts`, `doctrine.ts`,
// `blurbs.ts` and `leaders.ts`; type-only imports keep that free of cycles. Every person is fictional.

import type { CardId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** A few lines on how France plays, for the setup dossier. */
export const BLURB =
  'Two seas and a long reach. Rafales and SCALP strike deep, the Caesar guns break the line, the Legion marches ' +
  'where it is sent, and the Charles de Gaulle carries the war to the Mediterranean shore.';

/** Three fictional generals: the gunner, the legionnaire and the scholar of war. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Hélène Marchetti',
    trait: 'gunner',
    bio: 'Commanded a Caesar battery in the desert; fires, moves and fires again before the counter-battery arrives.',
  },
  {
    name: 'Bastien Lefort',
    trait: 'firebrand',
    bio: 'Came up through the Foreign Legion; never asks a company to go where he has not gone first.',
  },
  {
    name: 'Isabelle Duroc',
    trait: 'scholar',
    bio: 'Taught at the École de Guerre; reads every campaign since Austerlitz for the mistake the enemy will repeat.',
  },
];

const card = (c: CardDef): CardDef => c;

export const CARDS: readonly CardDef[] = [
  card({
    id: 'france_scalp_strike',
    name: 'SCALP Strike',
    flavour: 'Two missiles off a Rafale over the sea, a bridge two hundred kilometres inland.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 7, damage: 125 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 1 },
    ],
  }),
  card({
    id: 'france_rafale_sortie',
    name: 'Rafale Sortie',
    flavour: 'Omnirole: the same jet that clears the sky comes back an hour later for the tanks.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
      { kind: 'strike_bonus', classes: ['air'], percent: 25 },
    ],
  }),
  card({
    id: 'france_caesar_barrage',
    name: 'Caesar Barrage',
    flavour: 'A howitzer on a truck: six rounds in a minute, then gone down the road.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'strike_bonus', classes: ['artillery'], percent: 35 }],
  }),
  card({
    id: 'france_charles_de_gaulle',
    name: 'Charles de Gaulle',
    flavour: 'The carrier group leaves Toulon at dusk; by morning the coast is in range.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'naval_gun', missions: 1 },
      { kind: 'strike_bonus', classes: ['carrier', 'fleet'], percent: 25 },
    ],
  }),
  card({
    id: 'france_foreign_legion',
    name: 'Foreign Legion',
    flavour: 'Legio patria nostra. Forty kilometres before breakfast, and then the attack.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 2 },
      { kind: 'rally', organization: 15, morale: 15 },
    ],
  }),
  card({
    id: 'france_dgse_network',
    name: 'Intelligence Network',
    flavour: 'A rail yard burns, a general’s phone goes quiet, and nobody can say who did it.',
    cost: 2,
    target: 'enemy-hex',
    duration: 2,
    effects: [
      { kind: 'sabotage', radius: 1 },
      { kind: 'reveal', radius: 2 },
    ],
  }),
];

const DECK: readonly CardId[] = [
  'france_scalp_strike',
  'france_scalp_strike',
  'france_rafale_sortie',
  'france_rafale_sortie',
  'france_caesar_barrage',
  'france_caesar_barrage',
  'france_charles_de_gaulle',
  'france_foreign_legion',
  'france_dgse_network',
  'amphibious_doctrine',
  'naval_bombardment',
  'recon_flight',
  'requisition',
  'rally',
  'dig_in',
  'propaganda',
];

/** France's doctrine: six signature cards and a sixteen-card deck of deep strike, guns and reach. */
export const NATION_DOCTRINE: NationDoctrine = { nation: 'france', cards: [...CARDS], deck: [...DECK] };

const L = (d: LeaderDef): LeaderDef => d;

/** The President: invented, like every leader in the game. */
export const LEADER: LeaderDef = L({
  id: 'france_vautrin',
  name: 'Solène Vautrin',
  title: 'President',
  temperament: 'hawk',
  agenda: 'strength',
  bio: 'A former naval aviator who believes France is listened to exactly as far as its carrier can reach.',
  lines: {
    hostile: ['France has nothing to say to {you}.', 'You will have our answer, {you}, and it will not be in words.'],
    wary: ['Speak, {you}. Paris is listening, for now.', 'We remember what {you} said last time.'],
    neutral: ['Let us talk as equals, {you}.', 'France keeps her own counsel. What do you propose?'],
    cordial: ['A pleasure, {you}. Our friendship has served us both.', 'Paris welcomes {you}.'],
    friendly: ['{you}, our ally. Ask, and France will answer.', 'Between us, {you}, there is no need for ceremony.'],
    accept: ['Agreed. France keeps her word.', 'C’est entendu. We accept.'],
    reject_mood: ['Not after what {you} have done.', 'You have not earned that from us, {you}.'],
    reject_terms: ['These terms are beneath us.', 'France does not sell cheaply, {you}.'],
    reject_strength: ['Threats? From {you}? We have a deterrent of our own.', 'France does not bend.'],
    took_city: ['{you} took a French city. It will be French again.', 'That was our soil, {you}. We will come for it.'],
    betrayed: ['{you} betrayed us. France will not forget.', 'Your signature is worthless, {you}.'],
    winning: ['{you} grow too large for Europe, and for France.', 'A continent ruled by {you}? Never.'],
    war: ['Aux armes, then. You chose this, {you}.', 'France will fight, {you}.'],
    peace: ['Peace. France accepts it with honour.', 'The guns may rest.'],
    deal: ['Signed in Paris. Let it hold.', 'A sound agreement, {you}.'],
    demand: ['France expects reparation, {you}.'],
    defied: ['{you} ignored France. A mistake.'],
    paid: ['Received. Do not make us ask again.'],
  },
});
