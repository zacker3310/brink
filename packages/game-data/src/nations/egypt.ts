// Egypt: the Directorate on the Nile. The largest army in the region, armour in depth, massed
// artillery, a modern strike-fighter wing, two helicopter carriers and the Suez Canal under its
// guns. Its generals lead the armour, fire the guns and bridge the water; its signature cards mass
// the artillery, put the Rafales up, sail the Mistral group, bridge a crossing, hold the Western
// Desert and bank the canal's tolls. Generals are fictional. Balance data: integers only.
// Registered in `commanders.ts` (`NATION_ROSTERS`) and `doctrine.ts` (`NATION_DOCTRINES`).

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how Egypt plays, for the nation picker and the briefing. */
export const BLURB =
  'The biggest army on the map and the canal every navy needs. Egypt fights in mass: armour in depth, ' +
  'the guns massed behind it, Rafales overhead, and two helicopter carriers to put troops on any shore ' +
  'of the Red Sea or the Mediterranean. Hold Suez and the sea lanes of half the theatre are yours.';

/** Egypt's generals, fictional: a tank commander, a gunner and an engineer. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Hesham Fawzy',
    trait: 'firebrand',
    bio: 'Commanded an armoured division in the Western Desert; trains his crews to fight at night and move before dawn.',
  },
  {
    name: 'Mona Saleh',
    trait: 'gunner',
    bio: 'Artillery officer who drilled her batteries to fire, move and fire again inside four minutes.',
  },
  {
    name: 'Karim Abdelaziz',
    trait: 'sapper',
    bio: 'Built the canal-zone bridges and tunnels; says there is no river an engineer cannot make into a road.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'egypt_massed_guns',
    name: 'Massed Guns',
    flavour: 'Two thousand barrels along a forty-kilometre front, and a fire plan timed to the second.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'strike_bonus', classes: ['artillery'], percent: 35 },
      { kind: 'arena_support', asset: 'tornado', missions: 1 },
    ],
  },
  {
    id: 'egypt_rafale_wing',
    name: 'Rafale Wing',
    flavour: 'Twin engines, a cruise missile under each wing, and a target bank three hundred kilometres deep.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
      { kind: 'strike_bonus', classes: ['air'], percent: 20 },
    ],
  },
  {
    id: 'egypt_mistral_group',
    name: 'Mistral Group',
    flavour: 'Two helicopter carriers off the coast, the landing craft in the well decks, the gunships on deck.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }, { kind: 'arena_support', asset: 'naval_gun', missions: 1 }],
  },
  {
    id: 'egypt_bridging_engineers',
    name: 'Bridging Engineers',
    flavour: 'Pontoons in the water at midnight; the first tanks across before the coffee is cold.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'movement', bonus: 2 }],
  },
  {
    id: 'egypt_western_desert_line',
    name: 'Western Desert Line',
    flavour: 'Minefields from the coast to the Qattara Depression, as there have been for eighty years.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 50, radius: 3 }],
  },
  {
    id: 'egypt_canal_revenue',
    name: 'Canal Revenue',
    flavour: 'Fifty ships a day through Suez, and every one of them pays the toll.',
    cost: 1,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { credits: 70, materials: 20 } }],
  },
];

/** Egypt's doctrine: six signature cards and a seventeen-card deck of mass, guns and the canal. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'egypt',
  cards: CARDS,
  deck: [
    'egypt_bridging_engineers',
    'egypt_canal_revenue',
    'egypt_canal_revenue',
    'egypt_massed_guns',
    'egypt_massed_guns',
    'egypt_mistral_group',
    'egypt_rafale_wing',
    'egypt_western_desert_line',
    'dig_in',
    'forced_march',
    'missile_barrage',
    'naval_bombardment',
    'propaganda',
    'rally',
    'rally',
    'recon_flight',
    'requisition',
  ],
};
