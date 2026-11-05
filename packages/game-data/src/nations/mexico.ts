// Mexico: a Union of mass and mountains. A minor state in the Pacific, a power in the Americas
// (docs/americas.md). Its generals lead from the front, keep the men's hearts and the trains
// running; its signature cards raise the National Guard, dig into the Sierra Madre, pump Pemex
// harder, land the Navy's marines and move the army by rail. No missiles, no carriers. Integers
// only; a change is a ruleset change. Registered in `commanders.ts`, `doctrine.ts`, `leaders.ts`
// and `blurbs.ts`; type-only imports keep that registration free of cycles.

import type { GovernmentId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** Mexico's government on every map that lists it (the Pacific's too). */
export const GOVERNMENT: GovernmentId = 'union';

/** How Mexico plays, for the setup dossier. */
export const BLURB =
  'Mass, mountains and oil. A cheap army that fights hardest at home: the National Guard fills the line, the Sierra Madre swallows invaders, Pemex pays for it all, and the Navy\'s marines can go ashore on either coast.';

/** Three fictional generals: a firebrand, a soldier the ranks would follow anywhere, a railwayman. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Ignacio Valdes Ruiz',
    trait: 'firebrand',
    bio: 'Led the paratroop brigade in the floods of the south and has never once waited for the second wave.',
  },
  {
    name: 'Ximena Arreola',
    trait: 'beloved',
    bio: 'A sergeant\'s daughter from Puebla who eats with the privates and knows half of them by name.',
  },
  {
    name: 'Bernardo Quintanilla',
    trait: 'quartermaster',
    bio: 'Ran the national railways before the war; can move a division from Tijuana to Merida in four days.',
  },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards. Ids carry the `mx_` prefix. The first effect is the one the AI values. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'mx_guardia_nacional',
    name: 'Guardia Nacional',
    flavour: 'A hundred thousand in grey, every town a garrison by nightfall.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 20, morale: 25 },
      { kind: 'stability', amount: 3 },
    ],
  }),
  card({
    id: 'mx_sierra_madre',
    name: 'Sierra Madre',
    flavour: 'Every army that has come through these mountains has learned to hate them.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 45, radius: 2 }],
  }),
  card({
    id: 'mx_pemex_surge',
    name: 'Pemex Surge',
    flavour: 'Cantarell runs at full pressure, and the refineries at Salina Cruz never close.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { energy: 90, credits: 40, materials: 20 } }],
  }),
  card({
    id: 'mx_infanteria_de_marina',
    name: 'Infanteria de Marina',
    flavour: 'Two oceans, two fleets, one corps of marines who have landed on both.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'amphibious' },
      { kind: 'arena_support', asset: 'naval_gun', missions: 1 },
    ],
  }),
  card({
    id: 'mx_informants',
    name: 'Informants',
    flavour: 'Somebody\'s cousin works at the depot. Somebody always does.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 3 }],
  }),
  card({
    id: 'mx_ferrocarril',
    name: 'Ferrocarril',
    flavour: 'The old lines still run north. Tonight they run nothing but troop trains.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [{ kind: 'movement', bonus: 1 }],
  }),
];

/** Seventeen cards: the Guard, the mountains and the oil twice, the rest once, on a union base. */
export const DECK: readonly string[] = [
  'mx_guardia_nacional',
  'mx_guardia_nacional',
  'mx_sierra_madre',
  'mx_sierra_madre',
  'mx_pemex_surge',
  'mx_pemex_surge',
  'mx_infanteria_de_marina',
  'mx_informants',
  'mx_ferrocarril',
  'requisition',
  'rally',
  'dig_in',
  'recon_flight',
  'propaganda',
  'forced_march',
  'kamikaze_swarm',
  'sabotage',
];

export const DOCTRINE: NationDoctrine = { nation: 'mexico', cards: [...CARDS], deck: [...DECK] };

/** Mexico's head of government: invented, like every leader. */
export const LEADER: LeaderDef = {
  id: 'mexico_arrieta',
  name: 'Rosalba Arrieta',
  title: 'President',
  temperament: 'opportunist',
  agenda: 'homeland',
  bio: 'A former governor of Sonora who won three elections on water rights and has never forgiven a border.',
  lines: {
    hostile: ['We have nothing to discuss, {you}.', 'Mexico remembers every insult, {you}. Every one.'],
    wary: ['Speak, {you}. We are counting.', 'Careful, {you}. We are not as patient as we look.'],
    neutral: ['Buenos dias, {you}. Business, then.', 'Every friendship has a price, {you}. What is yours?'],
    cordial: ['A pleasure, {you}. Sit down.', 'Our markets are open to {you}.'],
    friendly: ['{you}, my friend! What do you need?', 'Between us, {you}, anything is possible.'],
    accept: ['Hecho. It is a deal.', 'Agreed. Do not make me regret it.'],
    reject_mood: ['After what {you} did? No.', 'Ask me again when we have forgotten. We will not forget.'],
    reject_terms: ['That price is an insult, {you}.', 'No. Bring me something better.'],
    reject_strength: ['Mexico has been threatened by better than {you}.', 'You will not frighten us off our own land.'],
    took_city: ['{you} took one of our cities. We will take it back, street by street.', 'That city is Mexican, {you}, and it will be again.'],
    betrayed: ['{you} broke your word. We will not trust you again.', 'A treaty with {you} is worth the paper. Less.'],
    winning: ['{you} want the whole continent. You will not have it.', 'Too big, {you}. Far too big.'],
    war: ['Then come, {you}. The mountains are waiting.', 'So it is war, {you}.'],
    peace: ['Peace. For now.', 'Enough. The harvest is waiting.'],
    deal: ['Agreed and signed.', 'Good business.'],
    demand: ['{you} owe us. Pay.', 'It is time to settle accounts, {you}.'],
    defied: ['{you} said no to Mexico. Remember that you did.', 'We will collect another way, {you}.'],
    paid: ['Received. We are even, for now.', 'Good. That was wise, {you}.'],
  },
};
