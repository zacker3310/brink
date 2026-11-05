// India: the Federation's two-front power of the Indo-Pacific South. It holds the Himalaya against
// China and the plains against Pakistan, and reaches into the Bay of Bengal with a carrier. Its hand
// is built for that: missiles that reach Islamabad and Lhasa from New Delhi, corps that move fast
// on the plains and dig in on the passes, and an eye in the sky over both fronts. Generals and the
// leader are invented. Every number is an integer; a change is a ruleset change.

import type { CardDef, NationDoctrine } from '../doctrine';
import type { GeneralDef } from '../commanders';
import type { LeaderDef } from '../leaders';

/** A few lines for the nation picker and the briefing. */
export const BLURB =
  'Two fronts and an ocean. India holds the Himalaya against China and the plains against Pakistan, ' +
  'strikes with long-range missiles from New Delhi, and sails a carrier into the Bay of Bengal. ' +
  'Big, populous and quick to arm; the art is choosing which front to win first.';

/** Three generals: the passes, the guns, the supply line over the mountains. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  { name: 'Arjun Rathore', trait: 'sapper', bio: 'Built the forward posts on the Ladakh ridges; says a mountain is held by the side that digs first.' },
  { name: 'Devika Bhalla', trait: 'gunner', bio: 'Artillery officer who plans a barrage like a raga: slow, then all at once.' },
  { name: 'Kavita Raghunathan', trait: 'quartermaster', bio: 'Ran the airlift to the high passes; nobody on the line has gone a winter without fuel.' },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards, prefixed `india_` so no other nation's cards collide. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'india_agni_strike',
    name: 'Agni Strike',
    flavour: 'The fire god has a range now, and a launch window.',
    cost: 4,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 7, damage: 140 }],
  }),
  card({
    id: 'india_cold_start',
    name: 'Cold Start',
    flavour: 'Integrated battle groups across the border inside forty-eight hours, before anyone can call for a ceasefire.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 2 },
      { kind: 'arena_support', asset: 'himars', missions: 1 },
    ],
  }),
  card({
    id: 'india_vikrant_group',
    name: 'Vikrant Strike Group',
    flavour: 'A carrier built at home, and a flag that has not flown at sea this far east in centuries.',
    cost: 4,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['carrier', 'air'], percent: 25 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
    ],
  }),
  card({
    id: 'india_mountain_corps',
    name: 'Mountain Strike Corps',
    flavour: 'Ninety thousand men who train at four thousand metres and breathe easier there than you do.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 25, radius: 2 }],
  }),
  card({
    id: 'india_netra_awacs',
    name: 'Netra Watch',
    flavour: 'A radar on a jet, a racetrack over the border, and nothing moves on either front unseen.',
    cost: 2,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 4 }],
  }),
  card({
    id: 'india_green_revolution',
    name: 'Green Revolution',
    flavour: 'The Punjab feeds the army, and the army knows it.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'resources', gain: { food: 120, credits: 60 } },
      { kind: 'stability', amount: 3 },
    ],
  }),
];

/** Seventeen cards: the missiles and the watch twice, the rest once, on a federation base. */
export const DOCTRINE: NationDoctrine = {
  nation: 'india',
  cards: [...CARDS],
  deck: [
    'india_agni_strike',
    'india_agni_strike',
    'india_cold_start',
    'india_vikrant_group',
    'india_mountain_corps',
    'india_netra_awacs',
    'india_netra_awacs',
    'india_green_revolution',
    'air_superiority',
    'amphibious_doctrine',
    'dig_in',
    'forced_march',
    'rally',
    'recon_flight',
    'requisition',
    'requisition',
    'propaganda',
  ],
};

/** India's head of government: invented. */
export const LEADER: LeaderDef = {
  id: 'india_varadarajan',
  name: 'Anand Varadarajan',
  title: 'Prime Minister',
  temperament: 'opportunist',
  agenda: 'balance',
  bio: 'A former chess federation president who plays three neighbours at once and never resigns.',
  lines: {
    hostile: ['We have nothing further to discuss, {you}.', 'Delhi has a long memory, {you}, and a longer reach.'],
    wary: ['We are listening, {you}. Carefully.', 'Say it plainly, {you}; we have two borders to watch.'],
    neutral: ['Every arrangement is possible, {you}, if it serves India.', 'Let us see what you bring to the table.'],
    cordial: ['A good relationship, {you}. Let us keep it so.', 'Our ports and yours could do much together, {you}.'],
    friendly: ['{you}! A true partner in a difficult neighbourhood.', 'Whatever {you} need, Delhi will hear it.'],
    accept: ['Agreed. India keeps its word.', 'A sensible bargain. We accept.'],
    reject_mood: ['After what {you} have done? No.', 'Trust is earned, {you}. You have not earned it.'],
    reject_terms: ['That is not a fair trade, {you}.', 'We do not accept these terms.'],
    reject_strength: ['A billion people do not take orders, {you}.', 'Threats will not move us.'],
    took_city: ['{you} hold an Indian city. That will not stand.', 'We will be back for it, {you}.'],
    betrayed: ['{you} broke your word. The whole region saw it.', 'A betrayal, {you}. We will answer it.'],
    winning: ['No one power should own these seas, {you}.', '{you} grow too strong. The balance must be kept.'],
    war: ['So be it, {you}. India did not choose this.', 'Then we fight, {you}, on every front.'],
    peace: ['Peace. Let the border cool.', 'Good. There is work enough at home.'],
    deal: ['Signed. A fair day for both of us.', 'Done, {you}. Let it hold.'],
    demand: ['Compensation, {you}, or we will collect it ourselves.'],
    defied: ['{you} refused a reasonable request. Remember that you did.'],
    paid: ['Take it. This is not forgotten.'],
  },
};
