// Indonesia: the Union's archipelago, seventeen thousand islands across the straits that join two
// oceans. It fights a war of islands: it holds Malacca, Sunda and Lombok, puts marines ashore on
// the next island, and defends each of its own in depth. Generals and the leader are invented.
// Every number is an integer; a change is a ruleset change.

import type { CardDef, NationDoctrine } from '../doctrine';
import type { GeneralDef } from '../commanders';
import type { LeaderDef } from '../leaders';

/** A few lines for the nation picker and the briefing. */
export const BLURB =
  'The archipelago that holds the straits. Indonesia sits astride Malacca, Sunda and Lombok, ' +
  'with land borders on Borneo and New Guinea and a sea of islands to defend. Mass and marines: ' +
  'hold the narrows, land on the next island, and make every beach a fortress.';

/** Three generals: the marines, the supply lines between the islands, the jungle defence. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  { name: 'Bayu Santoso', trait: 'marine', bio: 'Marine commander who has landed on more islands than most admirals have sailed past.' },
  { name: 'Retno Wulandari', trait: 'quartermaster', bio: 'Keeps a convoy moving between seven islands at once and knows the tide tables by heart.' },
  { name: 'Agus Hartono', trait: 'ironside', bio: 'Jungle warfare instructor; says the rain forest has never lost a defensive battle.' },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards, prefixed `indo_` so no other nation's cards collide. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'indo_marine_landing',
    name: 'Korps Marinir',
    flavour: 'The next island is always closer than the enemy thinks.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'amphibious' },
      { kind: 'arena_support', asset: 'naval_gun', missions: 1 },
    ],
  }),
  card({
    id: 'indo_total_defence',
    name: 'Total People’s Defence',
    flavour: 'Every village a garrison, every kampung a trench line.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 25, radius: 2 }],
  }),
  card({
    id: 'indo_strait_closure',
    name: 'Close the Straits',
    flavour: 'Mines in Sunda, patrol boats in Lombok, and a very polite notice to mariners.',
    cost: 3,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 2 }],
  }),
  card({
    id: 'indo_kopassus_raid',
    name: 'Special Forces Raid',
    flavour: 'Red berets out of the jungle at night, gone before the alarm.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'fleet', range: 3, damage: 120 }],
  }),
  card({
    id: 'indo_island_watch',
    name: 'Island Watch',
    flavour: 'A fisherman on every reef with a radio and a reason to use it.',
    cost: 2,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 3 }],
  }),
  card({
    id: 'indo_unity_in_diversity',
    name: 'Unity in Diversity',
    flavour: 'Seven hundred languages, one flag.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'stability', amount: 5 },
      { kind: 'rally', organization: 10, morale: 10 },
    ],
  }),
];

/** Seventeen cards: the landing and the defence twice, the rest once, on a union base. */
export const DOCTRINE: NationDoctrine = {
  nation: 'indonesia',
  cards: [...CARDS],
  deck: [
    'indo_marine_landing',
    'indo_marine_landing',
    'indo_total_defence',
    'indo_total_defence',
    'indo_strait_closure',
    'indo_kopassus_raid',
    'indo_island_watch',
    'indo_unity_in_diversity',
    'amphibious_doctrine',
    'naval_bombardment',
    'forced_march',
    'propaganda',
    'requisition',
    'requisition',
    'rally',
    'recon_flight',
    'dig_in',
  ],
};

/** Indonesia's head of government: invented. */
export const LEADER: LeaderDef = {
  id: 'indonesia_kusumawardani',
  name: 'Dewi Kusumawardani',
  title: 'President',
  temperament: 'dove',
  agenda: 'honour',
  bio: 'A former governor of Surabaya who holds that islands are kept by consent, and straits by treaty.',
  lines: {
    hostile: ['Jakarta has nothing left to say to {you}.', 'You have made an enemy of seventeen thousand islands, {you}.'],
    wary: ['We will listen, {you}. Then we will decide.', 'Your words will be measured against your ships, {you}.'],
    neutral: ['The straits are open to those who respect them, {you}.', 'Let us talk, {you}, as neighbours on the same sea.'],
    cordial: ['Welcome, {you}. Our harbours are open to you.', 'Good relations are worth more than good fleets, {you}.'],
    friendly: ['{you} are a friend to every island we have.', 'Whatever comes, {you}, we stand together.'],
    accept: ['Agreed. We will honour it.', 'A fair agreement. We accept.'],
    reject_mood: ['Trust is slow to rebuild, {you}.', 'Not yet, {you}. Show us first.'],
    reject_terms: ['That is not a fair bargain, {you}.', 'We cannot accept these terms.'],
    reject_strength: ['We will not be bullied off our own sea, {you}.', 'Pressure will not open the straits.'],
    took_city: ['{you} took one of our islands. We will not rest until it is home.', 'Our people grieve, {you}, and they remember.'],
    betrayed: ['{you} broke a solemn promise.', 'A treaty broken is a wound, {you}.'],
    winning: ['{you} grow strong. Be just as well.', 'Power on this sea frightens us, {you}, whoever holds it.'],
    war: ['We did not want this war, {you}.', 'With sorrow, we defend ourselves.'],
    peace: ['Peace. Thank you, {you}.', 'Let the sea be quiet again.'],
    deal: ['Signed, and we will keep it.', 'An agreement between neighbours.'],
    demand: ['We must ask {you} for what is owed. Please do not refuse.'],
    defied: ['{you} ignored a fair request. We are disappointed.'],
    paid: ['We pay for peace. Remember that we did.'],
  },
};
