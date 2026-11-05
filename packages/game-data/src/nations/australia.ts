// Australia: the Commonwealth's island continent at the bottom of the map. Nothing reaches it, or
// leaves it, except by sea, so it fights from submarines, radar and the air, lands where the enemy
// is thin, and pays for the war out of the ground. Generals and the leader are invented. Every
// number is an integer; a change is a ruleset change.

import type { CardDef, NationDoctrine } from '../doctrine';
import type { GeneralDef } from '../commanders';
import type { LeaderDef } from '../leaders';

/** A few lines for the nation picker and the briefing. */
export const BLURB =
  'An island continent: safe behind the sea, and stuck behind it. Australia sees further than anyone ' +
  'with over-the-horizon radar, hunts with attack submarines and strike jets, and pays for it all ' +
  'out of its mines. Every war it fights starts with a landing.';

/** Three generals: the landing force, the long supply line, the staff college. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  { name: 'Fiona Cartwright', trait: 'marine', bio: 'Commanded the amphibious ready group; rehearses every landing twice, once on paper and once at night.' },
  { name: 'Liam Bancroft', trait: 'quartermaster', bio: 'Moved a division from Townsville to Darwin by road, rail and barge in a wet season, and did it on time.' },
  { name: 'Callum Reid', trait: 'scholar', bio: 'Staff college lecturer who wrote the book on the northern approaches and then got the job.' },
];

const card = (c: CardDef): CardDef => c;

/** The signature cards, prefixed `aus_` so no other nation's cards collide. */
export const CARDS: readonly CardDef[] = [
  card({
    id: 'aus_attack_submarines',
    name: 'Attack Submarines',
    flavour: 'Nuclear boats, shared secrets, and a coastline the enemy no longer sleeps beside.',
    cost: 4,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'fleet', range: 3, damage: 150 }],
  }),
  card({
    id: 'aus_jindalee_radar',
    name: 'Over-the-Horizon Radar',
    flavour: 'Three thousand kilometres of sky, bounced off the ionosphere, watched from the outback.',
    cost: 2,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 5 }],
  }),
  card({
    id: 'aus_strike_jets',
    name: 'Long-Range Strike',
    flavour: 'Tanker, fighters, a target a long way north, and home for breakfast.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['air', 'carrier'], percent: 25 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
    ],
  }),
  card({
    id: 'aus_amphibious_ready',
    name: 'Amphibious Ready Group',
    flavour: 'Two big decks, a battalion aboard, and a beach that did not expect them.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'amphibious' },
      { kind: 'arena_support', asset: 'naval_gun', missions: 2 },
    ],
  }),
  card({
    id: 'aus_resources_boom',
    name: 'Resources Boom',
    flavour: 'Iron ore out of the Pilbara by the trainload, and money back by the shipload.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { materials: 140, energy: 80, credits: 60 } }],
  }),
  card({
    id: 'aus_coastwatchers',
    name: 'Coastwatchers',
    flavour: 'A radio, a rifle and a hut above the beach, as in your grandfather’s war.',
    cost: 2,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 1 }],
  }),
];

/** Sixteen cards: the submarines and the landing twice, the rest once, on a commonwealth base. */
export const DOCTRINE: NationDoctrine = {
  nation: 'australia',
  cards: [...CARDS],
  deck: [
    'aus_attack_submarines',
    'aus_attack_submarines',
    'aus_jindalee_radar',
    'aus_strike_jets',
    'aus_amphibious_ready',
    'aus_amphibious_ready',
    'aus_resources_boom',
    'aus_coastwatchers',
    'air_superiority',
    'naval_bombardment',
    'amphibious_doctrine',
    'dig_in',
    'rally',
    'recon_flight',
    'requisition',
    'propaganda',
  ],
};

/** Australia's head of government: invented. */
export const LEADER: LeaderDef = {
  id: 'australia_delaney',
  name: 'Hamish Delaney',
  title: 'Prime Minister',
  temperament: 'opportunist',
  agenda: 'commerce',
  bio: 'A mining-town lawyer who sells ore to everyone and trusts nobody north of Darwin.',
  lines: {
    hostile: ['We are done here, {you}. The navy has the rest of the conversation.', 'Nothing to say to {you} that a submarine cannot.'],
    wary: ['Go on, {you}. Keep it short.', 'Listening, {you}. Not agreeing.'],
    neutral: ['Everything is negotiable, {you}, except the coastline.', 'What are you offering, {you}?'],
    cordial: ['Good to hear from {you}. Trade is better than trouble.', 'Our ports are open to {you}, mate. Mostly.'],
    friendly: ['{you}! Best neighbour we have got. What do you need?', 'Name it, {you}. We will sort it out.'],
    accept: ['Done. Fair dinkum.', 'Deal. We will hold up our end.'],
    reject_mood: ['After that? Not a chance, {you}.', 'You burned that bridge, {you}.'],
    reject_terms: ['Those numbers do not work, {you}.', 'Try again with a better offer.'],
    reject_strength: ['Threats from {you}? We have the whole ocean between us.', 'Canberra does not do ultimatums.'],
    took_city: ['{you} took one of ours. We will be coming for it.', 'That city is Australian, {you}. It will be again.'],
    betrayed: ['A deal is a deal, {you}. You broke it.', 'Nobody signs with {you} after this.'],
    winning: ['{you} are getting too big for this ocean.', 'Everyone is watching {you} now. So are we.'],
    war: ['Right then, {you}. You asked for it.', 'So be it, {you}.'],
    peace: ['Peace. Good. Back to business.', 'Right, that is sorted.'],
    deal: ['Signed. Pleasure doing business, {you}.', 'Good deal, {you}.'],
    demand: ['Pay up, {you}, or the shipping lanes get a lot less friendly.'],
    defied: ['You ignored us, {you}. Costly mistake.'],
    paid: ['Fine. Take it. We will not forget.'],
  },
};
