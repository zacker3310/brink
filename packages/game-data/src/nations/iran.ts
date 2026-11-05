// Iran: the Union behind the Zagros. A large conscript army that defends its mountains fiercely,
// a missile force that reaches across the Gulf, one-way drones in numbers, and fast boats in the
// Strait of Hormuz. Its generals fire missiles, fortify passes and raise the reserves; its signature
// cards are the salvo, the drone wave, the boats, the mountain line and the call-up. Generals are
// fictional. Balance data: integers only. Registered in `commanders.ts` (`NATION_ROSTERS`) and
// `doctrine.ts` (`NATION_DOCTRINES`); type-only imports keep that registration free of cycles.

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how Iran plays, for the nation picker and the briefing. */
export const BLURB =
  'A mountain fortress with a long reach. Iran holds the Zagros and the plateau behind it with a mass ' +
  'army, and hits back from a distance: ballistic missiles across the Gulf, waves of one-way drones, ' +
  'and fast boats that make the Strait of Hormuz the most dangerous water on the map.';

/** Iran's generals, fictional: a missileer, a fortifier of passes and a raiser of reserves. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Behrouz Sadeghi',
    trait: 'gunner',
    bio: 'Built the missile brigades in the tunnels under the Zagros; counts every launcher he can hide as one he will not lose.',
  },
  {
    name: 'Leyla Jafari',
    trait: 'sapper',
    bio: 'Engineer of the western passes; her minefields follow the old caravan roads, because so will the enemy.',
  },
  {
    name: 'Omid Kazemi',
    trait: 'beloved',
    bio: 'Commanded the reserve divisions of the south; his men say he remembers every name, and he does.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'iran_fateh_salvo',
    name: 'Fateh Salvo',
    flavour: 'The launchers come out of the mountain, fire, and are back inside before the satellite passes.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 8, damage: 125 }],
  },
  {
    id: 'iran_shahed_wave',
    name: 'Shahed Wave',
    flavour: 'Cheap, slow and many: the air defence runs out of missiles before the sky runs out of drones.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'kamikaze', missions: 2 },
      { kind: 'strike_bonus', classes: ['drone'], percent: 25 },
    ],
  },
  {
    id: 'iran_fast_boats',
    name: 'Fast Attack Craft',
    flavour: 'Forty boats out of the islands at fifty knots, each with a missile and a crew who know every reef.',
    cost: 2,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'fleet', range: 3, damage: 100 }],
  },
  {
    id: 'iran_zagros_line',
    name: 'Zagros Line',
    flavour: 'Three thousand kilometres of mountain wall, and every gate in it has a garrison.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 55, radius: 3 }],
  },
  {
    id: 'iran_mobilisation',
    name: 'National Mobilisation',
    flavour: 'The reserve is called up in every province, and the trains run west full.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 15, morale: 15 },
      { kind: 'stability', amount: 3 },
    ],
  },
  {
    id: 'iran_ghadir_radar',
    name: 'Ghadir Radar Net',
    flavour: 'An over-the-horizon radar sees ships and aircraft a thousand kilometres out.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 5 }],
  },
];

/** Iran's doctrine: six signature cards and a seventeen-card deck of missiles, drones and depth. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'iran',
  cards: CARDS,
  deck: [
    'iran_fast_boats',
    'iran_fateh_salvo',
    'iran_fateh_salvo',
    'iran_ghadir_radar',
    'iran_mobilisation',
    'iran_shahed_wave',
    'iran_shahed_wave',
    'iran_zagros_line',
    'iran_zagros_line',
    'dig_in',
    'disinformation',
    'missile_barrage',
    'propaganda',
    'rally',
    'recon_flight',
    'requisition',
    'requisition',
  ],
};
