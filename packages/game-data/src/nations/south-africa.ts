// South Africa: the Commonwealth of the south. Mineral wealth, a defence industry that builds its
// own long-range guns and mine-proof vehicles, special forces with a long reach, and a tradition of
// fast mechanised columns over vast distances. Its generals drive the columns, fire the guns and
// lead the raids; its signature cards are the G6 batteries, the platinum reserves, the recce raid,
// the mechanised column, the Mokopa strike and the call to national unity. Generals are fictional.
// Balance data: integers only. Registered in `commanders.ts` (`NATION_ROSTERS`) and `doctrine.ts`.

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how South Africa plays, for the nation picker and the briefing. */
export const BLURB =
  'Far from everyone and richer than most. South Africa pays for its war with the mines, out-ranges its ' +
  'enemies with its own long guns, and fights the way its army always has: fast mechanised columns over ' +
  'huge distances, with special forces ahead of them cutting the roads.';

/** South Africa's generals, fictional: a column commander, a gunner and a special-forces officer. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Pieter van Rooyen',
    trait: 'firebrand',
    bio: 'Mechanised infantry officer who measures an advance in hundreds of kilometres and a halt in minutes.',
  },
  {
    name: 'Nomvula Zungu',
    trait: 'gunner',
    bio: 'Commanded a G6 regiment; her batteries shoot from forty kilometres and are gone before the reply lands.',
  },
  {
    name: 'Sizwe Mahlangu',
    trait: 'lucky',
    bio: 'Twenty years in the special forces, and walked out of every operation; nobody can explain it, least of all him.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'southafrica_g6_battery',
    name: 'G6 Battery',
    flavour: 'A self-propelled howitzer that drives at eighty on the road and hits at forty kilometres.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'strike_bonus', classes: ['artillery'], percent: 35 },
      { kind: 'arena_support', asset: 'himars', missions: 1 },
    ],
  },
  {
    id: 'southafrica_platinum_reserves',
    name: 'Platinum Reserves',
    flavour: 'Three quarters of the world’s platinum comes out of one escarpment, and the buyers pay in advance.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { credits: 80, materials: 60 } }],
  },
  {
    id: 'southafrica_recce_raid',
    name: 'Recce Raid',
    flavour: 'A team of six walks two hundred kilometres in the dark, and the enemy’s fuel depot is gone.',
    cost: 3,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 2 }],
  },
  {
    id: 'southafrica_mechanised_column',
    name: 'Mechanised Column',
    flavour: 'Wheeled armour, its own fuel and water, and a thousand kilometres of bush ahead.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'movement', bonus: 2 }],
  },
  {
    id: 'southafrica_mokopa_strike',
    name: 'Mokopa Strike',
    flavour: 'Attack helicopters at treetop height, a missile each for the tanks at the river crossing.',
    cost: 2,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 5, damage: 105 }],
  },
  {
    id: 'southafrica_national_unity',
    name: 'National Unity',
    flavour: 'Eleven languages, one anthem, and a crowd in every stadium singing it.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'stability', amount: 5 },
      { kind: 'rally', organization: 10, morale: 10 },
    ],
  },
];

/** South Africa's doctrine: six signature cards and a seventeen-card deck of guns, money and reach. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'south-africa',
  cards: CARDS,
  deck: [
    'southafrica_g6_battery',
    'southafrica_g6_battery',
    'southafrica_mechanised_column',
    'southafrica_mechanised_column',
    'southafrica_mokopa_strike',
    'southafrica_national_unity',
    'southafrica_platinum_reserves',
    'southafrica_recce_raid',
    'air_superiority',
    'dig_in',
    'forced_march',
    'naval_bombardment',
    'propaganda',
    'rally',
    'recon_flight',
    'requisition',
    'requisition',
  ],
};
