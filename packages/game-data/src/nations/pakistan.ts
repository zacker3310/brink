// Pakistan: the Directorate's power on the Indus. Smaller than its great neighbour and squeezed
// between it, Afghanistan and the Arabian Sea, it plays the short war: short-range missiles that hit
// hard, armour that moves before the other side is ready, fortress mountains in the north, and an
// intelligence service that works on the enemy's home front. Generals and the leader are invented.
// Every number is an integer; a change is a ruleset change.

import type { CardDef, NationDoctrine } from '../doctrine';
import type { GeneralDef } from '../commanders';
import type { LeaderDef } from '../leaders';

/** A few lines for the nation picker and the briefing. */
export const BLURB =
  'The short, sharp war. Pakistan strikes first with battlefield missiles and armour on the plains, ' +
  'holds the Karakoram as a fortress, and works on its enemies from inside. Outnumbered on paper; ' +
  'dangerous in the first ten turns, and harder to finish than it looks.';

/** Three generals: the armoured thrust, the rockets, the mountain posts. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  { name: 'Tariq Durrani', trait: 'firebrand', bio: 'Armoured corps commander who believes the first forty-eight hours decide everything after them.' },
  { name: 'Saima Qureshi', trait: 'gunner', bio: 'Strategic forces officer; plans her salvos around the enemy’s radar, not his map.' },
  { name: 'Haroon Afridi', trait: 'sapper', bio: 'Held the Siachen posts through three winters and says the glacier is the best ally he ever had.' },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards, prefixed `pak_` so no other nation's cards collide. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'pak_nasr_salvo',
    name: 'Nasr Salvo',
    flavour: 'Short range, short warning, and a long argument afterwards.',
    cost: 4,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 5, damage: 170 }],
  }),
  card({
    id: 'pak_armoured_thrust',
    name: 'Armoured Thrust',
    flavour: 'Across the canals at first light, before the bridges can be blown.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 2 },
      { kind: 'arena_support', asset: 'tornado', missions: 2 },
    ],
  }),
  card({
    id: 'pak_karakoram_fortress',
    name: 'Karakoram Fortress',
    flavour: 'The highest battlefield on earth, and every yard of it already registered for the guns.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 30, radius: 2 }],
  }),
  card({
    id: 'pak_isi_network',
    name: 'Deep Network',
    flavour: 'Friends in every bazaar, a file on every minister.',
    cost: 3,
    target: 'nation',
    duration: 1,
    effects: [{ kind: 'destabilize', amount: 7 }],
  }),
  card({
    id: 'pak_falcon_wing',
    name: 'Falcon Wing',
    flavour: 'Cheap fighters, well flown, in numbers the other side did not plan for.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'strike_bonus', classes: ['air', 'drone'], percent: 25 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
    ],
  }),
  card({
    id: 'pak_corridor',
    name: 'The Corridor',
    flavour: 'A road from the mountains to Gwadar, paved in somebody else’s money.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { materials: 100, energy: 60, credits: 40 } }],
  }),
];

/** Sixteen cards: the salvo and the thrust twice, the rest once, on a directorate base. */
export const DOCTRINE: NationDoctrine = {
  nation: 'pakistan',
  cards: [...CARDS],
  deck: [
    'pak_nasr_salvo',
    'pak_nasr_salvo',
    'pak_armoured_thrust',
    'pak_armoured_thrust',
    'pak_karakoram_fortress',
    'pak_isi_network',
    'pak_falcon_wing',
    'pak_corridor',
    'missile_barrage',
    'sabotage',
    'dig_in',
    'kamikaze_swarm',
    'rally',
    'recon_flight',
    'requisition',
    'disinformation',
  ],
};

/** Pakistan's head of government: invented. */
export const LEADER: LeaderDef = {
  id: 'pakistan_lodhi',
  name: 'Farhan Lodhi',
  title: 'Prime Minister',
  temperament: 'hawk',
  agenda: 'homeland',
  bio: 'A former corps commander who keeps the old map of the north on his office wall.',
  lines: {
    hostile: ['There is nothing to say to {you}. The army will speak.', 'We have fought bigger enemies than {you}.'],
    wary: ['Speak, {you}. Islamabad is not easily persuaded.', 'We have heard promises before, {you}.'],
    neutral: ['Respect our borders, {you}, and we will respect yours.', 'What do you want, {you}?'],
    cordial: ['A friend in a hard neighbourhood, {you}. Rare.', 'We can do business, {you}.'],
    friendly: ['{you}, our brothers. Ask, and it is yours.', 'Higher than the mountains, {you}, deeper than the sea.'],
    accept: ['Agreed. We keep our word.', 'Done. Let it be written.'],
    reject_mood: ['Not with {you}. Not after what you did.', 'No. Our people would not forgive it.'],
    reject_terms: ['Those terms insult us, {you}.', 'Bring a serious offer.'],
    reject_strength: ['We do not bend to threats, {you}. Ever.', 'Come and try, {you}.'],
    took_city: ['{you} took our city. We will take it back, and more.', 'That ground is ours, {you}. It will be ours again.'],
    betrayed: ['{you} stabbed us in the back. We will not forget it.', 'Treachery, {you}. Expect the same.'],
    winning: ['{you} want the whole region. You will not have it.', 'Every neighbour sees what {you} are becoming.'],
    war: ['Then it is war, {you}. We are ready.', 'You chose this, {you}. We will finish it.'],
    peace: ['Peace, for now. The army stays on the line.', 'Let the guns rest.'],
    deal: ['Signed. Do not break it.', 'A good arrangement, {you}.'],
    demand: ['Pay what you owe, {you}, or we come for it.'],
    defied: ['{you} defied us. You will regret it.'],
    paid: ['Take it. We will remember who asked.'],
  },
};
