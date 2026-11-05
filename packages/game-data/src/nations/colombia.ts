// Colombia: a Directorate hardened by a long war in the jungle and the mountains. A power in the
// Americas (docs/americas.md), the hinge between the continents. Its generals know guns, luck and
// the long study of war; its signature cards send the Lanceros through the jungle, lift troops by
// helicopter, strike with Kfirs, hold the Andean redoubt and patrol the Caribbean. No carriers, no
// drone swarms. Integers only; a change is a ruleset change. Registered in `commanders.ts`,
// `doctrine.ts`, `leaders.ts` and `blurbs.ts`; type-only imports keep that registration free of cycles.

import type { GovernmentId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** Colombia's government on every map that lists it. */
export const GOVERNMENT: GovernmentId = 'directorate';

/** How Colombia plays, for the setup dossier. */
export const BLURB =
  'The hinge of two continents. Small, mountainous and battle-hardened: it holds the Andes, raids through the jungle where nobody else can move, lifts its troops over the mountains by helicopter, and sits one march from the Panama Canal.';

/** Three fictional generals: a gunner, a jungle commando who should be dead, a student of war. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Hernan Restrepo',
    trait: 'gunner',
    bio: 'Commanded the artillery school at Tolemaida; plots fire missions on napkins in the mess.',
  },
  {
    name: 'Camila Ospina Duarte',
    trait: 'lucky',
    bio: 'Lancero who walked out of the Darien twice after being reported killed; her men touch her helmet before a patrol.',
  },
  {
    name: 'Mauricio Bermudez',
    trait: 'scholar',
    bio: 'Wrote the army\'s manual on mountain war and rewrites it after every battle.',
  },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards. Ids carry the `co_` prefix. The first effect is the one the AI values. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'co_lanceros',
    name: 'Lanceros',
    flavour: 'Twelve men, eight days in the jungle, one bridge that will not be there in the morning.',
    cost: 2,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 1 }],
  }),
  card({
    id: 'co_air_assault',
    name: 'Air Assault',
    flavour: 'The Black Hawks lift at first light and put a battalion on the far side of the ridge by breakfast.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'movement', bonus: 2 }],
  }),
  card({
    id: 'co_kfir_strike',
    name: 'Kfir Strike',
    flavour: 'Old airframes, new bombs, pilots who have flown into valleys nobody else will.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 5, damage: 110 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
    ],
  }),
  card({
    id: 'co_andean_redoubt',
    name: 'Andean Redoubt',
    flavour: 'Three cordilleras and every pass already mined.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 45, radius: 2 }],
  }),
  card({
    id: 'co_coffee_and_coal',
    name: 'Coffee and Coal',
    flavour: 'The ports at Barranquilla and Buenaventura work three shifts, and the bills are paid in dollars.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { credits: 60, materials: 40, energy: 30 } }],
  }),
  card({
    id: 'co_caribbean_patrol',
    name: 'Caribbean Patrol',
    flavour: 'The frigates out of Cartagena know every cay between the canal and the Guajira.',
    cost: 2,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'fleet', range: 3, damage: 90 },
      { kind: 'arena_support', asset: 'naval_gun', missions: 1 },
    ],
  }),
];

/** Seventeen cards: the Lanceros, the air assault and the redoubt twice, on a directorate base. */
export const DECK: readonly string[] = [
  'co_lanceros',
  'co_lanceros',
  'co_air_assault',
  'co_air_assault',
  'co_andean_redoubt',
  'co_andean_redoubt',
  'co_kfir_strike',
  'co_coffee_and_coal',
  'co_caribbean_patrol',
  'dig_in',
  'rally',
  'requisition',
  'recon_flight',
  'propaganda',
  'disinformation',
  'naval_bombardment',
  'missile_barrage',
];

export const DOCTRINE: NationDoctrine = { nation: 'colombia', cards: [...CARDS], deck: [...DECK] };

/** Colombia's head of government: invented, like every leader. */
export const LEADER: LeaderDef = {
  id: 'colombia_saldarriaga',
  name: 'Esteban Saldarriaga',
  title: 'President',
  temperament: 'hawk',
  agenda: 'strength',
  bio: 'A former army colonel from Medellin who negotiated one peace, fought two wars and trusts neither.',
  lines: {
    hostile: ['We have fought worse than {you} in our own mountains.', 'Go home, {you}, while you still can.'],
    wary: ['Talk, {you}. My generals are listening too.', 'We know what {you} are, and we are watching.'],
    neutral: ['Bogota hears you, {you}.', 'Strength first, {you}. Then we talk.'],
    cordial: ['A sound partner, {you}.', 'Colombia respects {you}. That is not nothing.'],
    friendly: ['{you}, hermano. Ask.', 'We stand with {you}, as the strong stand together.'],
    accept: ['Agreed. We keep our bargains.', 'Done. Shake on it.'],
    reject_mood: ['Not with {you}. Not now.', 'You have not earned it, {you}.'],
    reject_terms: ['Weak terms. No.', 'Come back with a real offer, {you}.'],
    reject_strength: ['You threaten Colombia? We have heard threats all our lives, {you}.', 'Try it, {you}.'],
    took_city: ['{you} took one of ours. We will make you bleed for every street.', 'That city is coming back, {you}.'],
    betrayed: ['{you} broke faith. The strong do not, and now we know you are weak.', 'A traitor\'s word, {you}. Never again.'],
    winning: ['{you} are reaching too far.', 'Too strong, {you}. Someone has to stop you.'],
    war: ['Then war, {you}. We know how it is fought.', 'Good. Let us see what {you} are made of.'],
    peace: ['Peace. Keep your guns cleaned.', 'Enough, for now.'],
    deal: ['Signed.', 'Agreed, on our terms.'],
    demand: ['Pay what you owe, {you}.', 'Colombia expects tribute, {you}.'],
    defied: ['{you} refused us. We will remember who was weak.', 'Your choice, {you}. Live with it.'],
    paid: ['Received. You show sense, {you}.', 'Good. We understand each other.'],
  },
};
