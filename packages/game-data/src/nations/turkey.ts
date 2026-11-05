// Turkey: the Federation of the Anatolian bridge. A drone industry of its own, a NATO-trained army,
// an amphibious assault ship and the high plateau at its back. Its generals fly drones, land
// marines and keep the supply moving; its signature cards send the strike drones over the line,
// jam the enemy's radios, reach past the front with Bora missiles and dig the plateau in. Generals
// are fictional. Balance data: integers only. Registered in `commanders.ts` (`NATION_ROSTERS`) and
// `doctrine.ts` (`NATION_DOCTRINES`); type-only imports keep that registration free of cycles.

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how Turkey plays, for the nation picker and the briefing. */
export const BLURB =
  'The bridge between three seas. Turkey fights with its own drones overhead and the Anatolian plateau ' +
  'behind it: strike drones find and kill the enemy column, jammers blind it, Bora missiles reach past ' +
  'the front, and an amphibious brigade sails from Izmir to wherever the coast is thin.';

/** Turkey's generals, fictional: a drone commander, a marine and a quartermaster. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Murat Ersoy',
    trait: 'gunner',
    bio: 'Flew the first armed drone squadron out of Batman; plans a battle as a list of targets and a list of loiter hours.',
  },
  {
    name: 'Elif Karaca',
    trait: 'marine',
    bio: 'Commanded the amphibious brigade at Foça; believes a landing is a supply problem with a beach at the end.',
  },
  {
    name: 'Selim Aktaş',
    trait: 'quartermaster',
    bio: 'Ran the rail and road lift across the plateau; can move a corps from Thrace to the Syrian border in a week.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'turkey_akinci_strike',
    name: 'Akıncı Strike',
    flavour: 'A strike drone at forty thousand feet, a laser on the column, and twenty-four hours of fuel.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['drone', 'air'], percent: 25 },
      { kind: 'arena_support', asset: 'kamikaze', missions: 1 },
    ],
  },
  {
    id: 'turkey_bora_missile',
    name: 'Bora Missile',
    flavour: 'A short-range ballistic missile out of a hangar in the hills; the headquarters it was meant for had moved, but not far enough.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 7, damage: 120 }],
  },
  {
    id: 'turkey_anadolu_group',
    name: 'Anadolu Group',
    flavour: 'An assault ship with drones on deck instead of jets, and a marine battalion below.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }, { kind: 'arena_support', asset: 'naval_gun', missions: 1 }],
  },
  {
    id: 'turkey_koral_jamming',
    name: 'KORAL Jamming',
    flavour: 'The enemy radars light up, then fill with snow. The convoys lose the road.',
    cost: 3,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 2 }],
  },
  {
    id: 'turkey_anatolian_redoubt',
    name: 'Anatolian Redoubt',
    flavour: 'Every pass on the plateau has been fortified since before your grandfather was born.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 50, radius: 3 }],
  },
  {
    id: 'turkey_armoured_column',
    name: 'Armoured Column',
    flavour: 'Tank transporters on the highway by night, the brigade in its start lines by dawn.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 1 },
      { kind: 'rally', organization: 10, morale: 10 },
    ],
  },
];

/** Turkey's doctrine: six signature cards and a seventeen-card deck of drones, missiles and depth. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'turkey',
  cards: CARDS,
  deck: [
    'turkey_akinci_strike',
    'turkey_akinci_strike',
    'turkey_anadolu_group',
    'turkey_anatolian_redoubt',
    'turkey_armoured_column',
    'turkey_bora_missile',
    'turkey_bora_missile',
    'turkey_koral_jamming',
    'air_superiority',
    'dig_in',
    'kamikaze_swarm',
    'naval_bombardment',
    'propaganda',
    'rally',
    'recon_flight',
    'requisition',
    'requisition',
  ],
};
