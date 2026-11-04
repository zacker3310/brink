// Japan: an island power that fights from the sea and the shore. Its generals hold islands, fight
// fleets and put marines on beaches; its signature cards dig the islands in, cover them with AEGIS
// destroyers, find the enemy with maritime patrol aircraft and hit him with shore-based missiles
// before he lands. Balance data: integers only. Registered in `commanders.ts` (`NATION_ROSTERS`)
// and `doctrine.ts` (`NATION_DOCTRINES`); type-only imports keep that registration free of cycles.

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how Japan plays, for a nation picker or a briefing. */
export const BLURB =
  'An island fortress with a blue-water navy. Japan wins by not being landed on: dig the home islands in, ' +
  'see the enemy first, sink him at sea with shore missiles and AEGIS fleets, then strike back from the ' +
  'sea with carrier jets and the amphibious brigade. Few formations, every one of them good.';

/** Japan's generals, fictional: an admiral, a marine and an island defender. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Kenji Takamura',
    trait: 'gunner',
    bio: 'Former captain of an AEGIS destroyer; plans every battle as a missile engagement at sea.',
  },
  {
    name: 'Haruka Sonoda',
    trait: 'marine',
    bio: 'Raised the Amphibious Rapid Deployment Brigade at Sasebo; believes a beach is taken in the first hour or not at all.',
  },
  {
    name: 'Daisuke Ishiguro',
    trait: 'sapper',
    bio: 'Spent twenty years fortifying the southwestern islands; his tunnels are rumoured to have tunnels.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'japan_aegis_umbrella',
    name: 'AEGIS Umbrella',
    flavour: 'Four destroyers on station, every radar lit. Nothing falls on the home islands tonight.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 20, morale: 15 },
      { kind: 'stability', amount: 4 },
    ],
  },
  {
    id: 'japan_type12_battery',
    name: 'Type 12 Coastal Battery',
    flavour: 'The launchers roll out of the tunnel, fire, and are gone before the splash.',
    cost: 2,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 5, damage: 110 }],
  },
  {
    id: 'japan_izumo_air_wing',
    name: 'Izumo Air Wing',
    flavour: 'Short take-off, vertical landing, and a flight deck the enemy did not count.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
      { kind: 'strike_bonus', classes: ['air', 'carrier', 'drone'], percent: 20 },
    ],
  },
  {
    id: 'japan_island_fortress',
    name: 'Island Fortress',
    flavour: 'Every ridge a bunker, every bunker connected. Come and find us.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 50, radius: 3 }],
  },
  {
    id: 'japan_rapid_deployment',
    name: 'Rapid Deployment Brigade',
    flavour: 'Amphibious vehicles in the water at dawn; the island is ours by noon.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }, { kind: 'arena_support', asset: 'naval_gun', missions: 1 }],
  },
  {
    id: 'japan_p1_sub_hunt',
    name: 'P-1 Sub Hunt',
    flavour: 'Twelve hours on patrol, sonobuoys in a line across the strait. Something is down there.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 4 }],
  },
];

/** Japan's doctrine: six signature cards and a seventeen-card deck that leans on sea and shore. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'japan',
  cards: CARDS,
  deck: [
    'japan_aegis_umbrella',
    'japan_island_fortress',
    'japan_island_fortress',
    'japan_izumo_air_wing',
    'japan_p1_sub_hunt',
    'japan_p1_sub_hunt',
    'japan_rapid_deployment',
    'japan_type12_battery',
    'japan_type12_battery',
    'air_superiority',
    'dig_in',
    'missile_barrage',
    'naval_bombardment',
    'propaganda',
    'recon_flight',
    'requisition',
    'requisition',
  ],
};
