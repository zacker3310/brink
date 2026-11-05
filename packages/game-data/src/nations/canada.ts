// Canada: a Commonwealth that holds the north. A minor state in the Pacific, a power in the
// Americas (docs/americas.md). Its generals fight in the cold, keep the long supply roads open and
// hold what they take; its signature cards watch the Arctic, dig in for the winter, fly the
// continent's air defence and bring the Atlantic convoys home. No missiles, no drone swarms, no
// saboteurs. Integers only; a change is a ruleset change. Registered in `commanders.ts`
// (`NATION_ROSTERS`), `doctrine.ts` (`NATION_DOCTRINES`), `leaders.ts` and `blurbs.ts`; type-only
// imports keep that registration free of cycles.

import type { GovernmentId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** Canada's government on every map that lists it. */
export const GOVERNMENT: GovernmentId = 'commonwealth';

/** How Canada plays, for the setup dossier. */
export const BLURB =
  'The north holds. A huge country with a small army: it sees the enemy coming across the Arctic, digs in for a winter he is not dressed for, and lets the convoys and the air defence of the continent carry the war.';

/** Three fictional generals: a winter sapper, a quartermaster of the long roads, a stubborn defender. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Elise Marchand',
    trait: 'sapper',
    bio: 'Built ice roads and snow forts across Nunavut for twenty winters; thinks a trench in permafrost is a luxury.',
  },
  {
    name: 'Duncan MacAllister',
    trait: 'quartermaster',
    bio: 'Ran the resupply of every northern station from Alert to Inuvik; has never lost a truck to the cold.',
  },
  {
    name: 'Priya Sandhu',
    trait: 'ironside',
    bio: 'Held a valley for nine days on a peacekeeping tour with half a battalion and no air; refuses to discuss it.',
  },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards. Ids carry the `ca_` prefix. The first effect is the one the AI values. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'ca_canadian_rangers',
    name: 'Canadian Rangers',
    flavour: 'Five thousand reservists who live out there. Nothing crosses the tundra without one of them noticing.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 4 }],
  }),
  card({
    id: 'ca_norad_watch',
    name: 'NORAD Watch',
    flavour: 'Under the mountain, the screens are lit from the Aleutians to Labrador.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['air'], percent: 20 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
    ],
  }),
  card({
    id: 'ca_winter_warfare',
    name: 'Winter Warfare',
    flavour: 'Minus forty is the same in Celsius and Fahrenheit, and the same for both armies. Only one of them trained for it.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 50, radius: 2 }],
  }),
  card({
    id: 'ca_halifax_convoy',
    name: 'Halifax Convoy',
    flavour: 'Forty ships in the Bedford Basin at dusk, gone by morning, and every one of them full.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'resources', gain: { materials: 70, food: 60, credits: 30 } },
      { kind: 'stability', amount: 2 },
    ],
  }),
  card({
    id: 'ca_blue_berets',
    name: 'Blue Berets',
    flavour: 'They have stood between other people\'s armies for seventy years. Standing in front of their own is easier.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 20, morale: 20 },
      { kind: 'stability', amount: 3 },
    ],
  }),
  card({
    id: 'ca_hornet_sortie',
    name: 'Hornet Sortie',
    flavour: 'Two jets out of Cold Lake, low over the trees, home before the coffee is cold.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 6, damage: 100 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
    ],
  }),
];

/** Seventeen cards: the Rangers, NORAD and the winter twice, the rest once, on a defensive base. */
export const DECK: readonly string[] = [
  'ca_canadian_rangers',
  'ca_canadian_rangers',
  'ca_norad_watch',
  'ca_norad_watch',
  'ca_winter_warfare',
  'ca_winter_warfare',
  'ca_halifax_convoy',
  'ca_blue_berets',
  'ca_hornet_sortie',
  'dig_in',
  'rally',
  'requisition',
  'recon_flight',
  'air_superiority',
  'propaganda',
  'amphibious_doctrine',
  'naval_bombardment',
];

export const DOCTRINE: NationDoctrine = { nation: 'canada', cards: [...CARDS], deck: [...DECK] };

/** Canada's head of government: invented, like every leader. */
export const LEADER: LeaderDef = {
  id: 'canada_beaulieu',
  name: 'Margaux Beaulieu',
  title: 'Prime Minister',
  temperament: 'dove',
  agenda: 'honour',
  bio: 'A constitutional lawyer from Trois-Rivieres who coached junior hockey on weekends and still keeps every promise in writing.',
  lines: {
    hostile: ['We have been patient with {you}. That is over.', 'Say what you came to say, {you}, and go.'],
    wary: ['Canada is listening, {you}. Carefully.', 'We remember what {you} said last time.'],
    neutral: ['Good day, {you}. What can we do for each other?', 'There is room on this continent for both of us, {you}.'],
    cordial: ['Always good to hear from {you}.', 'Our door is open to {you}, as it should be between neighbours.'],
    friendly: ['{you}! Come in out of the cold.', 'Whatever {you} need, we will find a way.'],
    accept: ['Agreed. We will put it in writing and keep it.', 'Done, and gladly.'],
    reject_mood: ['Not after what {you} have done. Not yet.', 'Trust is earned, {you}, and you have spent yours.'],
    reject_terms: ['That is not a fair deal, and you know it.', 'We cannot sign that, {you}.'],
    reject_strength: ['Canada does not bend to threats, {you}.', 'We have outlasted winters worse than you.'],
    took_city: ['{you} took one of our cities. We will be back for it.', 'You will not keep what you took from us, {you}.'],
    betrayed: ['You gave us your word, {you}. We will not forget that you broke it.', '{you} broke a treaty. The world will hear of it.'],
    winning: ['{you} are growing too strong for anyone\'s comfort.', 'Nobody should own this continent, {you}. Not even you.'],
    war: ['Then we defend ourselves, {you}. We always have.', 'We did not choose this, {you}.'],
    peace: ['Peace. Let us keep it this time.', 'Good. Bring them home.'],
    deal: ['A good arrangement. Signed.', 'Done. We keep our word.'],
    demand: ['{you} owe us, and we are asking politely.', 'It is time {you} paid what is fair.'],
    defied: ['{you} refused a fair request. We will remember.', 'So be it, {you}.'],
    paid: ['Thank you. That was the right thing to do.', 'Received. We are square.'],
  },
};
