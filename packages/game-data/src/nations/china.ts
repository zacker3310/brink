// China: the People's Liberation Army. Mass, reach and the strait. Its hand is built around one
// operation, Take Taipei: the Rocket Force reaches the island from Beijing (7 hexes; the generic
// Missile Barrage reaches 6), satellites find the garrison, the blockade starves it, and the
// Joint Island Landing puts the army ashore twice without the beach penalty. Generals are
// fictional. Balance data: integers only; a change is a ruleset change.

import type { CardDef, NationDoctrine } from '../doctrine';
import type { GeneralDef } from '../commanders';

/** A few lines for the nation picker and the briefing. */
export const BLURB =
  'The largest army on the map and the rockets to reach across the strait. China plays the long ' +
  'game: blind the enemy from orbit, starve the island, rain missiles on the garrison, then land ' +
  'in waves. Slow to start, crushing once the machine is moving.';

/** Three generals: the landing, the rockets, the long supply line. */
export const ROSTER: readonly GeneralDef[] = [
  { name: 'Lin Haoyu', trait: 'marine' },
  { name: 'Zhao Weiguo', trait: 'gunner' },
  { name: 'Qiao Jianmin', trait: 'quartermaster' },
];

/** One line on each general, for the commander card. */
export const BIOS: Readonly<Record<string, string>> = {
  'Lin Haoyu': 'Eastern Theatre amphibious brigade commander; has rehearsed the strait crossing on Dongshan beaches for twenty years.',
  'Zhao Weiguo': 'Former Rocket Force base commander who counts targets in salvos, not sorties.',
  'Qiao Jianmin': 'Joint Logistics Support Force: moves an army group a thousand kilometres by rail and ferry without losing a truck.',
};

const card = (c: CardDef): CardDef => c;

export const CARDS: readonly CardDef[] = [
  card({
    id: 'rocket_force_salvo',
    name: 'Rocket Force Salvo',
    flavour: 'Second Artillery became the Rocket Force. The arithmetic did not change.',
    cost: 4,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 8, damage: 150 }],
  }),
  card({
    id: 'carrier_killer',
    name: 'Carrier Killer',
    flavour: 'DF-21D: a thousand miles of sea that no admiral wants to cross.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'strike_bonus', classes: ['artillery', 'air', 'drone'], percent: 20 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 2 },
    ],
  }),
  card({
    id: 'joint_island_landing',
    name: 'Joint Island Landing',
    flavour: 'Fishing ferries, roll-on barges, and a hundred thousand men who have practised this beach.',
    cost: 3,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'amphibious' },
      { kind: 'arena_support', asset: 'naval_gun', missions: 2 },
    ],
  }),
  card({
    id: 'strait_blockade',
    name: 'Strait Blockade',
    flavour: 'No declaration, no shots. Just no ships getting through.',
    cost: 3,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 2 }],
  }),
  card({
    id: 'yaogan_satellites',
    name: 'Yaogan Satellites',
    flavour: 'Three birds in formation, a pass every ninety minutes. Nothing on that island moves unseen.',
    cost: 2,
    target: 'hex',
    duration: 2,
    effects: [{ kind: 'reveal', radius: 4 }],
  }),
  card({
    id: 'three_warfares',
    name: 'Three Warfares',
    flavour: 'Public opinion, psychology, the law: win the war before the first shot.',
    cost: 3,
    target: 'nation',
    duration: 1,
    effects: [
      { kind: 'destabilize', amount: 7 },
      { kind: 'stability', amount: 2 },
    ],
  }),
];

/** Seventeen cards: the Rocket Force and the landing twice, the rest once, on a union base. */
export const DOCTRINE: NationDoctrine = {
  nation: 'china',
  cards: [...CARDS],
  deck: [
    'rocket_force_salvo',
    'rocket_force_salvo',
    'joint_island_landing',
    'joint_island_landing',
    'carrier_killer',
    'strait_blockade',
    'yaogan_satellites',
    'three_warfares',
    'requisition',
    'requisition',
    'forced_march',
    'dig_in',
    'naval_bombardment',
    'rally',
    'propaganda',
    'recon_flight',
    'kamikaze_swarm',
  ],
};
