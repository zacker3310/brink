// The United Kingdom: an island power at the edge of Europe that fights from the sea and the air. Its
// generals hold the Channel, put Royal Marines on a hostile shore and keep a long war supplied; its
// signature cards are the carrier strike group, Storm Shadow, the Typhoon, the listeners at the
// doughnut and the marines. Balance data: integers only; a change is a ruleset change. Registered in
// `commanders.ts` (`NATION_ROSTERS`), `doctrine.ts` (`NATION_DOCTRINES`), `blurbs.ts` and
// `leaders.ts`; type-only imports keep that registration free of cycles. Every person is fictional.

import type { CardId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** A few lines on how the United Kingdom plays, for the setup dossier. */
export const BLURB =
  'An island with a long reach. Carriers and Storm Shadow strike across the North Sea, the Typhoons hold the sky, ' +
  'the Royal Marines land where the line is thin, and the listeners find the enemy before he moves.';

/** Three fictional generals: the marines, the guns and the quartermaster of a war over the water. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Philippa Hartley-Rowe',
    trait: 'marine',
    bio: 'Commando Brigade officer who trained in Norway every winter and treats a fjord as a front door.',
  },
  {
    name: 'Alasdair Kincaid',
    trait: 'gunner',
    bio: 'Gunner from the Royal Artillery who plans a fire mission to the second and a war to the shell.',
  },
  {
    name: 'Gareth Pennant',
    trait: 'quartermaster',
    bio: 'Ran the sealift to the Baltic exercises; says the Channel is a moat only for those who cannot load a ship.',
  },
];

const card = (c: CardDef): CardDef => c;

export const CARDS: readonly CardDef[] = [
  card({
    id: 'uk_carrier_strike_group',
    name: 'Carrier Strike Group',
    flavour: 'Sixty-five thousand tonnes in the North Sea, and a deck of jets the enemy cannot find.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
      { kind: 'strike_bonus', classes: ['air', 'carrier'], percent: 25 },
    ],
  }),
  card({
    id: 'uk_storm_shadow',
    name: 'Storm Shadow',
    flavour: 'Released two hundred miles out, terrain-hugging all the way, through the bunker roof.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 7, damage: 130 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 1 },
    ],
  }),
  card({
    id: 'uk_typhoon_patrol',
    name: 'Typhoon Patrol',
    flavour: 'Quick reaction alert from Lossiemouth; the intruder turns for home with two jets on his wing.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
      { kind: 'strike_bonus', classes: ['air', 'drone'], percent: 20 },
    ],
  }),
  card({
    id: 'uk_royal_marines',
    name: 'Royal Marines',
    flavour: 'Landing craft in the dark, a cliff climbed by dawn, the port taken from behind.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }, { kind: 'arena_support', asset: 'naval_gun', missions: 1 }],
  }),
  card({
    id: 'uk_listening_post',
    name: 'Listening Post',
    flavour: 'The doughnut hears a radio key three times in a forest, and a brigade has a map reference.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 4 }],
  }),
  card({
    id: 'uk_finest_hour',
    name: 'Finest Hour',
    flavour: 'A broadcast from the bunker under Whitehall: we shall go on to the end.',
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
  'uk_carrier_strike_group',
  'uk_carrier_strike_group',
  'uk_storm_shadow',
  'uk_storm_shadow',
  'uk_typhoon_patrol',
  'uk_royal_marines',
  'uk_listening_post',
  'uk_listening_post',
  'uk_finest_hour',
  'air_superiority',
  'naval_bombardment',
  'recon_flight',
  'requisition',
  'rally',
  'dig_in',
  'propaganda',
];

/** The United Kingdom's doctrine: six signature cards and a sixteen-card deck of sea, air and intelligence. */
export const NATION_DOCTRINE: NationDoctrine = { nation: 'uk', cards: [...CARDS], deck: [...DECK] };

const L = (d: LeaderDef): LeaderDef => d;

/** The Prime Minister: invented, like every leader in the game. */
export const LEADER: LeaderDef = L({
  id: 'uk_ashcombe',
  name: 'Rhodri Ashcombe',
  title: 'Prime Minister',
  temperament: 'opportunist',
  agenda: 'balance',
  bio: 'A former diplomat who holds that no single power may own the continent, least of all a friend.',
  lines: {
    hostile: ['We have nothing further to discuss, {you}.', 'His Majesty’s Government regards {you} as an enemy. Plainly.'],
    wary: ['Go on, {you}. We are listening, with some reservations.', 'Say what you came to say.'],
    neutral: ['Shall we see whether there is a bargain to be had, {you}?', 'The Channel is quiet. Let us keep it so.'],
    cordial: ['Good to hear from {you}. Tea, and then business?', 'We have always found {you} reasonable.'],
    friendly: ['{you}! Whatever you need, London will see what can be done.', 'Old friends, {you}. Shoulder to shoulder.'],
    accept: ['Agreed. We shall hold to it.', 'Very well. That serves us both.'],
    reject_mood: ['After what {you} did? I think not.', 'Trust is earned, {you}, and you have spent yours.'],
    reject_terms: ['Those terms will not do.', 'You ask a great deal and offer very little, {you}.'],
    reject_strength: ['We have been threatened by better than {you}.', 'Britain does not bargain at gunpoint.'],
    took_city: ['{you} took one of our cities. We will have it back.', 'That was British soil, {you}. Remember that.'],
    betrayed: ['{you} broke your word. Europe will hear of it.', 'A treaty torn up. Nobody will sign with {you} again.'],
    winning: ['{you} grow too strong for the comfort of the continent.', 'No one power may rule Europe, {you}. Not even you.'],
    war: ['So be it, {you}. We will fight on the beaches if we must.', 'You chose this, {you}.'],
    peace: ['Peace. Let us not waste it.', 'The guns fall silent. Good.'],
    deal: ['Signed. A sensible arrangement.', 'A good day’s work, {you}.'],
    demand: ['We require compensation, {you}. Promptly.'],
    defied: ['{you} ignored a fair request. That will be remembered.'],
    paid: ['Take it. This changes nothing between us.'],
  },
});
