// Poland: the front-line state, armed to the teeth because it remembers. Its generals lead the
// armour, dig the eastern line and mass the guns; its signature cards are the K2 Black Panther, the
// East Shield, the Chunmoo and Krab guns, the Apache hunters and the Territorial Defence Force.
// Balance data: integers only; a change is a ruleset change. Registered in `commanders.ts`,
// `doctrine.ts`, `blurbs.ts` and `leaders.ts`; type-only imports keep that free of cycles. Every
// person is fictional.

import type { CardId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** A few lines on how Poland plays, for the setup dossier. */
export const BLURB =
  'The front line, and it knows it. The East Shield is dug before the war starts, the K2s counter-attack through it, ' +
  'the rocket artillery out-guns anyone in range, and every village has a Territorial Defence platoon.';

/** Three fictional generals: the tank commander, the sapper of the eastern line and the gunner. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Tomasz Wierzbicki',
    trait: 'firebrand',
    bio: 'Took the first K2 battalion to the Suwałki exercises and insists the best defence is the counter-attack.',
  },
  {
    name: 'Agnieszka Sowa',
    trait: 'sapper',
    bio: 'Engineer who laid out the East Shield; every ditch and minefield on the border has her initials on a map.',
  },
  {
    name: 'Marek Zalewski',
    trait: 'gunner',
    bio: 'Rocket artilleryman who can put a Chunmoo battery into action from the march in four minutes.',
  },
];

const card = (c: CardDef): CardDef => c;

export const CARDS: readonly CardDef[] = [
  card({
    id: 'poland_east_shield',
    name: 'East Shield',
    flavour: 'Anti-tank ditches, dragon’s teeth and forest cut for fields of fire: the border is ready.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 60, radius: 3 }],
  }),
  card({
    id: 'poland_black_panther',
    name: 'Black Panther',
    flavour: 'The K2s come out of the forest at dusk, fire on the move, and are behind the enemy by night.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 2 },
      { kind: 'rally', organization: 20, morale: 10 },
    ],
  }),
  card({
    id: 'poland_chunmoo_salvo',
    name: 'Chunmoo Salvo',
    flavour: 'Two pods, twelve guided rockets, eighty kilometres: the ridge the enemy holds is not there any more.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'himars', missions: 2 },
      { kind: 'strike_bonus', classes: ['artillery'], percent: 30 },
    ],
  }),
  card({
    id: 'poland_krab_barrage',
    name: 'Krab Barrage',
    flavour: 'The self-propelled guns lay a wall of fire along the river; nothing crosses.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'strike_bonus', classes: ['artillery'], percent: 35 }],
  }),
  card({
    id: 'poland_apache_hunters',
    name: 'Apache Hunters',
    flavour: 'Low over the pine forest, a pop-up, a Hellfire, and down again.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [{ kind: 'strike_bonus', classes: ['air', 'drone'], percent: 25 }],
  }),
  card({
    id: 'poland_territorial_defence',
    name: 'Territorial Defence',
    flavour: 'The teacher, the bus driver and the vet put on their uniforms; the village will not be taken quietly.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 20, morale: 20 },
      { kind: 'stability', amount: 5 },
    ],
  }),
];

const DECK: readonly CardId[] = [
  'poland_east_shield',
  'poland_east_shield',
  'poland_black_panther',
  'poland_black_panther',
  'poland_chunmoo_salvo',
  'poland_krab_barrage',
  'poland_krab_barrage',
  'poland_apache_hunters',
  'poland_territorial_defence',
  'forced_march',
  'dig_in',
  'recon_flight',
  'requisition',
  'rally',
  'propaganda',
  'missile_barrage',
];

/** Poland's doctrine: six signature cards and a sixteen-card deck of armour, guns and the dug line. */
export const NATION_DOCTRINE: NationDoctrine = { nation: 'poland', cards: [...CARDS], deck: [...DECK] };

const L = (d: LeaderDef): LeaderDef => d;

/** The President: invented, like every leader in the game. */
export const LEADER: LeaderDef = L({
  id: 'poland_ostrowicz',
  name: 'Bogdan Ostrowicz',
  title: 'President',
  temperament: 'hawk',
  agenda: 'homeland',
  bio: 'A historian from Lublin who keeps his grandfather’s map of the border on the wall and every line of it in his head.',
  lines: {
    hostile: ['Poland has heard enough from {you}.', 'We have been here before, {you}. We know how it ends.'],
    wary: ['Speak, {you}. Warsaw has a long memory.', 'We are listening. We are also digging.'],
    neutral: ['What does {you} want of Poland?', 'Let us talk, {you}, while we can.'],
    cordial: ['Good to hear from {you}. Our door is open.', 'Poland remembers its friends, {you}.'],
    friendly: ['{you}! Brothers in arms. What do you need?', 'Za naszą i waszą wolność, {you}.'],
    accept: ['Agreed. Poland keeps its word.', 'Done. We will hold to it.'],
    reject_mood: ['Not with {you}. Not after this.', 'Trust is built over centuries, {you}, and lost in a day.'],
    reject_terms: ['Those terms are an insult.', 'Poland is not for sale, {you}.'],
    reject_strength: ['We have stood against worse than {you}.', 'Threats do not frighten Warsaw.'],
    took_city: ['{you} took a Polish city. We will take it back, street by street.', 'That city is ours, {you}.'],
    betrayed: ['{you} betrayed us. Again someone betrays Poland.', 'A treaty broken. We will not forget, {you}.'],
    winning: ['{you} grow too strong, and Poland has seen what follows.', 'No empire again, {you}.'],
    war: ['Then we fight, {you}. Poland has not perished yet.', 'To arms. You chose this, {you}.'],
    peace: ['Peace. We will keep our guns clean.', 'Good. Let the fields be farmed.'],
    deal: ['Signed. Let it stand.', 'An honest bargain, {you}.'],
    demand: ['Poland demands what it is owed, {you}.'],
    defied: ['{you} refused us. We will remember.'],
    paid: ['Take it. And leave us be.'],
  },
});
