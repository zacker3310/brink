// Brazil: a Union the size of a continent. A power in the Americas (docs/americas.md). Its
// generals hold ground, keep the jungle supplied and dig in; its signature cards watch the Amazon
// from the air, fight in the forest, put Gripens over the front, fire the Astros rockets, pump the
// pre-salt oil and mobilise the nation. No marines to speak of, no saboteurs. Integers only; a
// change is a ruleset change. Registered in `commanders.ts`, `doctrine.ts`, `leaders.ts` and
// `blurbs.ts`; type-only imports keep that registration free of cycles.

import type { GovernmentId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** Brazil's government on every map that lists it. */
export const GOVERNMENT: GovernmentId = 'union';

/** How Brazil plays, for the setup dossier. */
export const BLURB =
  'A continent of its own. Depth, mass and patience: the Amazon is a wall nobody else can supply across, the Astros rockets and the Gripens cover the borders, the pre-salt oil pays for everything, and every city is far from the next enemy.';

/** Three fictional generals: a defender, a jungle quartermaster, a sapper of the borders. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Otavio Brandao',
    trait: 'ironside',
    bio: 'Commanded the southern army at Santa Maria; believes a line that does not move is a line that has not lost.',
  },
  {
    name: 'Luana Ferraz',
    trait: 'quartermaster',
    bio: 'Kept forty jungle garrisons fed by river barge and helicopter for a decade; knows every landing strip by its mud.',
  },
  {
    name: 'Severino Macedo',
    trait: 'sapper',
    bio: 'An engineer from Recife who has cut roads through forest that maps still show as blank.',
  },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards. Ids carry the `br_` prefix. The first effect is the one the AI values. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'br_amazon_shield',
    name: 'Amazon Shield',
    flavour: 'Radar towers, river patrols and a satellite pass every hour: the forest is no longer empty.',
    cost: 2,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 5 }],
  }),
  card({
    id: 'br_selva_brigade',
    name: 'Selva Brigade',
    flavour: 'The jungle infantry dig in under the canopy, and nothing from the air can find them.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 40, radius: 2 }],
  }),
  card({
    id: 'br_gripen_cover',
    name: 'Gripen Cover',
    flavour: 'Two squadrons up from Anapolis, data-linked to every gun on the border.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['air'], percent: 25 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
    ],
  }),
  card({
    id: 'br_astros_barrage',
    name: 'Astros Barrage',
    flavour: 'Sixteen tubes a launcher, six launchers a battery, and the grid square is gone.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 5, damage: 110 },
      { kind: 'arena_support', asset: 'himars', missions: 1 },
    ],
  }),
  card({
    id: 'br_pre_salt_oil',
    name: 'Pre-Salt Oil',
    flavour: 'Seven kilometres down off Santos, and the platforms never stop.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { energy: 80, materials: 40, credits: 40 } }],
  }),
  card({
    id: 'br_national_mobilisation',
    name: 'National Mobilisation',
    flavour: 'Two hundred million people, and the reservists report from Manaus to Porto Alegre.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 25, morale: 20 },
      { kind: 'stability', amount: 2 },
    ],
  }),
];

/** Seventeen cards: the Amazon watch, the jungle and the oil twice, on a union base. */
export const DECK: readonly string[] = [
  'br_amazon_shield',
  'br_amazon_shield',
  'br_selva_brigade',
  'br_selva_brigade',
  'br_pre_salt_oil',
  'br_pre_salt_oil',
  'br_gripen_cover',
  'br_astros_barrage',
  'br_national_mobilisation',
  'requisition',
  'rally',
  'dig_in',
  'recon_flight',
  'propaganda',
  'forced_march',
  'naval_bombardment',
  'air_superiority',
];

export const DOCTRINE: NationDoctrine = { nation: 'brazil', cards: [...CARDS], deck: [...DECK] };

/** Brazil's head of government: invented, like every leader. */
export const LEADER: LeaderDef = {
  id: 'brazil_amaral',
  name: 'Teodoro Amaral',
  title: 'President',
  temperament: 'opportunist',
  agenda: 'balance',
  bio: 'A trade minister turned president who believes no single power should ever be allowed to own the hemisphere.',
  lines: {
    hostile: ['Brazil has nothing to say to {you}.', 'We are a patient country, {you}. Our patience has ended.'],
    wary: ['Go on, {you}. Slowly.', 'We hear {you}. We do not yet believe you.'],
    neutral: ['Bom dia, {you}. Let us talk.', 'The continent is large enough, {you}, if nobody gets greedy.'],
    cordial: ['Good to hear from {you}.', 'Brazil values a steady neighbour, {you}.'],
    friendly: ['{you}! Our friend. What can we do?', 'Brazil and {you}: nobody can stand against that.'],
    accept: ['Agreed. A fair balance.', 'Done. Everybody wins a little.'],
    reject_mood: ['Not with {you}, not after that.', 'Our trust in {you} is spent.'],
    reject_terms: ['That tilts the scales too far, {you}.', 'No. Find a better balance.'],
    reject_strength: ['You will not frighten two hundred million people, {you}.', 'Brazil does not kneel.'],
    took_city: ['{you} took one of our cities. The whole country saw.', 'We will have it back, {you}.'],
    betrayed: ['{you} broke your word. Every capital will know.', 'Never again, {you}.'],
    winning: ['{you} are becoming too strong. The continent must be balanced.', 'Someone must check {you}, and it will be us.'],
    war: ['Then we fight, {you}, and we are very large.', 'You chose this, {you}.'],
    peace: ['Peace. Balance restored.', 'Good. Back to work.'],
    deal: ['Signed. A fair arrangement.', 'Agreed.'],
    demand: ['{you} owe the balance a little, and Brazil collects.', 'Pay your share, {you}.'],
    defied: ['{you} refused us. Noted.', 'We will remember that, {you}.'],
    paid: ['Thank you, {you}. Balance kept.', 'Received.'],
  },
};
