// Argentina: a Federation of plains, mountains and the far south. A power in the Americas
// (docs/americas.md). Its generals land marines, plan fire and lead from the front; its signature
// cards fire the Exocets, run the armour across the Pampas, cross the Andes as San Martin did,
// garrison Patagonia, sell the grain and put the naval infantry ashore. No drone swarms, no
// saboteurs. Integers only; a change is a ruleset change. Registered in `commanders.ts`,
// `doctrine.ts`, `leaders.ts` and `blurbs.ts`; type-only imports keep that registration free of cycles.

import type { GovernmentId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** Argentina's government on every map that lists it. */
export const GOVERNMENT: GovernmentId = 'federation';

/** How Argentina plays, for the setup dossier. */
export const BLURB =
  'Plains, mountains and a long southern coast. Fast and sharp: armour runs across the Pampas, the army crosses the Andes where nobody expects it, Exocets keep enemy fleets off the coast, and the marines go ashore wherever the beach is open.';

/** Three fictional generals: a marine, a gunner, a cavalry firebrand. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Facundo Iturbe',
    trait: 'marine',
    bio: 'Commanded the naval infantry at Puerto Belgrano; has landed on every beach between the Plate and Tierra del Fuego in exercise.',
  },
  {
    name: 'Valentina Echeverria',
    trait: 'gunner',
    bio: 'An artillery officer from Mendoza who plots fire across mountain valleys by ear.',
  },
  {
    name: 'Rodrigo Lanus',
    trait: 'firebrand',
    bio: 'Armoured cavalry; drove a squadron of tanks from Cordoba to the coast in a night and calls it a warm-up.',
  },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards. Ids carry the `ar_` prefix. The first effect is the one the AI values. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'ar_exocet_strike',
    name: 'Exocet Strike',
    flavour: 'Skimming the wave tops at the speed of sound. The first warning is the hull.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 6, damage: 120 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 1 },
    ],
  }),
  card({
    id: 'ar_pampas_armour',
    name: 'Pampas Armour',
    flavour: 'A thousand kilometres of flat grass and not a tree to stop a tank.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [{ kind: 'movement', bonus: 1 }],
  }),
  card({
    id: 'ar_crossing_of_the_andes',
    name: 'Crossing of the Andes',
    flavour: 'San Martin did it with mules. We have trucks, and the same passes.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'movement', bonus: 2 }],
  }),
  card({
    id: 'ar_patagonian_garrison',
    name: 'Patagonian Garrison',
    flavour: 'Wind, stone and a regiment that has dug into both.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 40, radius: 2 }],
  }),
  card({
    id: 'ar_beef_and_grain',
    name: 'Beef and Grain',
    flavour: 'The silos at Rosario are full, and the ships leave every tide.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { food: 90, credits: 40, materials: 20 } }],
  }),
  card({
    id: 'ar_infanteria_de_marina',
    name: 'Naval Infantry',
    flavour: 'They train in the coldest water on earth. Any other beach is a holiday.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'amphibious' },
      { kind: 'arena_support', asset: 'naval_gun', missions: 2 },
    ],
  }),
];

/** Seventeen cards: the Exocets, the armour and the Andes twice, on a federation base. */
export const DECK: readonly string[] = [
  'ar_exocet_strike',
  'ar_exocet_strike',
  'ar_pampas_armour',
  'ar_pampas_armour',
  'ar_crossing_of_the_andes',
  'ar_crossing_of_the_andes',
  'ar_patagonian_garrison',
  'ar_beef_and_grain',
  'ar_infanteria_de_marina',
  'requisition',
  'rally',
  'dig_in',
  'recon_flight',
  'propaganda',
  'air_superiority',
  'naval_bombardment',
  'amphibious_doctrine',
];

export const DOCTRINE: NationDoctrine = { nation: 'argentina', cards: [...CARDS], deck: [...DECK] };

/** Argentina's head of government: invented, like every leader. */
export const LEADER: LeaderDef = {
  id: 'argentina_quiroga',
  name: 'Delfina Quiroga',
  title: 'President',
  temperament: 'hawk',
  agenda: 'homeland',
  bio: 'A senator from Santa Cruz who keeps a map of every lost province on her office wall, and adds to it.',
  lines: {
    hostile: ['Argentina has nothing for {you} but contempt.', 'We will see you on the field, {you}.'],
    wary: ['Say it plainly, {you}.', 'We are watching {you}. Closely.'],
    neutral: ['Buenos Aires hears you, {you}.', 'What do {you} want from us?'],
    cordial: ['A good neighbour, {you}.', 'Argentina welcomes {you}, for now.'],
    friendly: ['{you}, our friend. Speak.', 'Argentina and {you}, shoulder to shoulder.'],
    accept: ['Agreed. Argentina keeps its word.', 'Done.'],
    reject_mood: ['Not with {you}. Not after that.', 'You have not earned it, {you}.'],
    reject_terms: ['Those terms are an insult to Argentina.', 'No, {you}.'],
    reject_strength: ['Threats? We have stood alone before, {you}.', 'Argentina does not yield.'],
    took_city: ['{you} took Argentine ground. We will have it back.', 'That city is ours, {you}, and it always will be.'],
    betrayed: ['{you} broke faith with Argentina. That is not forgiven.', 'Your word is worthless, {you}.'],
    winning: ['{you} want the whole continent. Not while Argentina stands.', 'Too strong, {you}. Far too strong.'],
    war: ['Then war, {you}. We are ready.', 'You chose this, {you}. We will finish it.'],
    peace: ['Peace, for now.', 'Enough. We stand down.'],
    deal: ['Signed.', 'Agreed, and kept.'],
    demand: ['{you} owe Argentina. Pay.', 'It is time, {you}.'],
    defied: ['{you} refused Argentina. We will not forget.', 'So be it, {you}.'],
    paid: ['Received. Wise of you, {you}.', 'Good.'],
  },
};
