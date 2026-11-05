// Saudi Arabia: the Commonwealth of the peninsula. The richest treasury on the map, a modern air
// force, layered missile defence and a long desert border to hold. Its generals keep the supply
// flowing, fly the jets and hold the line; its signature cards buy the war with oil revenue, put the
// F-15s over the battle, raise the missile shield, watch the desert from an AWACS and reach across
// the Gulf with the strategic missile force. Generals are fictional. Balance data: integers only.
// Registered in `commanders.ts` (`NATION_ROSTERS`) and `doctrine.ts` (`NATION_DOCTRINES`).

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how Saudi Arabia plays, for the nation picker and the briefing. */
export const BLURB =
  'Oil money and air power. Saudi Arabia out-buys every rival: the treasury pays for a modern air force, ' +
  'a missile shield over the cities and an army that can be rebuilt as fast as it is lost. It fights ' +
  'from the air first and on the ground second, across a desert big enough to trade for time.';

/** Saudi Arabia's generals, fictional: a quartermaster, an airman and a defender. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Khalid Al-Ghamdi',
    trait: 'quartermaster',
    bio: 'Built the desert logistics bases; believes the side with the most water and fuel at the front wins in the sand.',
  },
  {
    name: 'Noura Al-Shehri',
    trait: 'gunner',
    bio: 'Former strike-fighter wing commander who plans every sortie around the tanker, not the target.',
  },
  {
    name: 'Mansour Al-Dosari',
    trait: 'ironside',
    bio: 'Held the southern border posts for a decade; his outposts are dug into the rock above every wadi.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'saudi_f15_sorties',
    name: 'F-15SA Sorties',
    flavour: 'Eighty strike fighters, a tanker track over the desert, and the whole night ahead.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'strike_bonus', classes: ['air'], percent: 25 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
    ],
  },
  {
    id: 'saudi_patriot_shield',
    name: 'Patriot Shield',
    flavour: 'Batteries ring the cities. The sirens sound, the interceptors climb, and the markets open on time.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 15, morale: 10 },
      { kind: 'stability', amount: 4 },
    ],
  },
  {
    id: 'saudi_oil_revenue',
    name: 'Oil Revenue',
    flavour: 'Eleven million barrels a day, and every one of them pays for something with tracks.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { credits: 90, energy: 50, materials: 30 } }],
  },
  {
    id: 'saudi_strategic_missiles',
    name: 'Strategic Missile Force',
    flavour: 'A force nobody talks about, in silos nobody visits, with a range everybody has measured.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 8, damage: 115 }],
  },
  {
    id: 'saudi_border_berm',
    name: 'Border Berm',
    flavour: 'A wall of sand, a ditch, a fence and a camera every kilometre.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 40, radius: 2 }],
  },
  {
    id: 'saudi_sentry_patrol',
    name: 'Sentry Patrol',
    flavour: 'An AWACS orbit over the Empty Quarter sees everything that moves from the Gulf to the Red Sea.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 5 }],
  },
];

/** Saudi Arabia's doctrine: six signature cards and a seventeen-card deck of money and air power. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'saudi-arabia',
  cards: CARDS,
  deck: [
    'saudi_border_berm',
    'saudi_f15_sorties',
    'saudi_f15_sorties',
    'saudi_oil_revenue',
    'saudi_oil_revenue',
    'saudi_patriot_shield',
    'saudi_sentry_patrol',
    'saudi_strategic_missiles',
    'air_superiority',
    'dig_in',
    'missile_barrage',
    'naval_bombardment',
    'propaganda',
    'rally',
    'recon_flight',
    'requisition',
    'requisition',
  ],
};
