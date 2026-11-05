// Nigeria: the Union of West Africa. The largest population on the continent, the oil of the
// Niger Delta, an army with long experience of peacekeeping and counter-insurgency, and a riverine
// navy. Its generals raise the levies, keep the long roads open and lead from the front; its
// signature cards call up the mass, deploy the regional standby brigade, ship the crude, fly the
// Alpha Jets, work the creeks and the coast, and patrol the Sahel. Generals are fictional. Balance
// data: integers only. Registered in `commanders.ts` (`NATION_ROSTERS`) and `doctrine.ts`.

import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';

/** A few lines on how Nigeria plays, for the nation picker and the briefing. */
export const BLURB =
  "Africa's giant. Nigeria fights with numbers and endurance: the biggest population on the map fills " +
  'the ranks faster than anyone can thin them, the Delta pays for the war, and an army used to long ' +
  'patrols across the Sahel moves where others need roads. Slow to strike, very hard to stop.';

/** Nigeria's generals, fictional: a leader of men, a quartermaster and a hard driver. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Emeka Nwosu',
    trait: 'beloved',
    bio: 'Led a peacekeeping brigade for three years; his soldiers call him the headmaster, and mean it kindly.',
  },
  {
    name: 'Aisha Bello',
    trait: 'quartermaster',
    bio: 'Kept the convoys moving from Kano to the lake through two rainy seasons; knows every bridge that floods.',
  },
  {
    name: 'Tunde Adeyemi',
    trait: 'firebrand',
    bio: 'A cavalry officer by temperament if not by branch; would rather attack at dawn than wait for the report.',
  },
];

const CARDS: CardDef[] = [
  {
    id: 'nigeria_mass_levy',
    name: 'Mass Levy',
    flavour: 'Two hundred million people. The recruiting offices open on Monday and are full by noon.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'rally', organization: 20, morale: 20 },
      { kind: 'stability', amount: 2 },
    ],
  },
  {
    id: 'nigeria_standby_brigade',
    name: 'Standby Brigade',
    flavour: 'Packed, briefed and on the trucks: the regional brigade can be across a border by tomorrow.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 1 },
      { kind: 'rally', organization: 10, morale: 10 },
    ],
  },
  {
    id: 'nigeria_delta_crude',
    name: 'Delta Crude',
    flavour: 'The terminals at Bonny load around the clock, and the money goes north to the army.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { credits: 70, energy: 70 } }],
  },
  {
    id: 'nigeria_alpha_jets',
    name: 'Alpha Jet Squadron',
    flavour: 'Old airframes, new sights, and pilots who have flown more close support than anyone on the continent.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['air'], percent: 15 },
      { kind: 'arena_support', asset: 'strike_jet', missions: 1 },
    ],
  },
  {
    id: 'nigeria_riverine_ops',
    name: 'Riverine Operations',
    flavour: 'Patrol boats up the creeks at slack tide; the shore party is ashore before anyone hears the engines.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }, { kind: 'arena_support', asset: 'naval_gun', missions: 1 }],
  },
  {
    id: 'nigeria_sahel_patrols',
    name: 'Sahel Patrols',
    flavour: 'Pickups and camels and a drone overhead: nothing crosses the frontier unseen for a week.',
    cost: 1,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 4 }],
  },
];

/** Nigeria's doctrine: six signature cards and a seventeen-card deck of mass, oil and endurance. */
export const NATION_DOCTRINE: NationDoctrine = {
  nation: 'nigeria',
  cards: CARDS,
  deck: [
    'nigeria_alpha_jets',
    'nigeria_delta_crude',
    'nigeria_delta_crude',
    'nigeria_mass_levy',
    'nigeria_mass_levy',
    'nigeria_riverine_ops',
    'nigeria_sahel_patrols',
    'nigeria_standby_brigade',
    'nigeria_standby_brigade',
    'dig_in',
    'dig_in',
    'forced_march',
    'missile_barrage',
    'propaganda',
    'rally',
    'recon_flight',
    'requisition',
  ],
};
