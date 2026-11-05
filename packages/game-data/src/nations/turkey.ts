// Turkey: the power that holds the straits between Europe and Asia, and the one nation two theatres
// share: a power in Europe and in the Middle East and Africa, the same file in both (one deck, one set
// of generals, one leader). Its generals run the drones, the marines and the line in the mountains;
// its signature cards are the Bayraktar, the Tayfun missile, the Anadolu drone carrier, the closed
// straits, KORAL jamming and the soldier the country calls Mehmetçik. Both maps give it the
// Industrial Directorate (`government` in europe.map.json and mideast.map.json): the drone and arms
// industry of its own (+20% industry), a doctrine of cross-border offensives (+10% attack) and a home
// front worn by inflation and a divided vote (-8 stability). Balance data: integers only; a change is
// a ruleset change. Registered in `commanders.ts`, `doctrine.ts`, `blurbs.ts` and `leaders.ts`;
// type-only imports keep that free of cycles. Every person is fictional.

import type { CardId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** A few lines on how Turkey plays, for the setup dossier. */
export const BLURB =
  'The keeper of the straits. Drones hunt the enemy from Anatolia to the Caucasus and the Syrian desert, the Tayfun reaches ' +
  'across the Black Sea and the Levant, KORAL blinds the enemy column, the Anadolu puts marines and drones on any shore, ' +
  'and whoever holds the Bosphorus decides who sails it.';

/** Three fictional generals: the drone gunner, the marine and the mountain defender. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Kerem Aydınlı',
    trait: 'gunner',
    bio: 'Flew armed drones over three wars before he commanded a brigade; still watches every strike feed himself.',
  },
  {
    name: 'Selin Karaca',
    trait: 'marine',
    bio: 'Commanded the amphibious brigade at Foça; has landed on every beach of the Aegean in exercises.',
  },
  {
    name: 'Orhan Tezcan',
    trait: 'ironside',
    bio: 'Spent a career on the eastern frontier; holds a mountain pass the way other men hold a door shut.',
  },
];

const card = (c: CardDef): CardDef => c;

export const CARDS: readonly CardDef[] = [
  card({
    id: 'turkey_bayraktar_hunt',
    name: 'Bayraktar Hunt',
    flavour: 'A propeller drone at twenty thousand feet, a laser spot, and the air-defence battery is gone.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [
      { kind: 'strike_bonus', classes: ['drone'], percent: 35 },
      { kind: 'arena_support', asset: 'kamikaze', missions: 1 },
    ],
  }),
  card({
    id: 'turkey_tayfun_missile',
    name: 'Tayfun Missile',
    flavour: 'Ballistic, home-built, and long enough in range to make the far shore of the Black Sea nervous.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 8, damage: 130 }],
  }),
  card({
    id: 'turkey_anadolu_landing',
    name: 'Anadolu Landing',
    flavour: 'The drone carrier stands off the beach: drones overhead, landing craft in the water.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }, { kind: 'arena_support', asset: 'kamikaze', missions: 1 }],
  }),
  card({
    id: 'turkey_straits_closed',
    name: 'The Straits Closed',
    flavour: 'Montreux invoked: the Bosphorus is shut to warships, and the coastal batteries are loaded.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'fleet', range: 3, damage: 110 },
      { kind: 'arena_support', asset: 'naval_gun', missions: 1 },
    ],
  }),
  card({
    id: 'turkey_koral_jamming',
    name: 'KORAL Jamming',
    flavour: 'The enemy radars light up, then fill with snow. The convoys lose the road.',
    cost: 3,
    target: 'enemy-hex',
    duration: 2,
    effects: [{ kind: 'sabotage', radius: 2 }],
  }),
  card({
    id: 'turkey_mehmetcik',
    name: 'Mehmetçik',
    flavour: 'The conscript from every village in Anatolia; the line he is told to hold does not move.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'rally', organization: 25, morale: 25 }],
  }),
];

const DECK: readonly CardId[] = [
  'turkey_bayraktar_hunt',
  'turkey_bayraktar_hunt',
  'turkey_bayraktar_hunt',
  'turkey_tayfun_missile',
  'turkey_anadolu_landing',
  'turkey_straits_closed',
  'turkey_koral_jamming',
  'turkey_mehmetcik',
  'turkey_mehmetcik',
  'missile_barrage',
  'sabotage',
  'disinformation',
  'recon_flight',
  'requisition',
  'dig_in',
  'propaganda',
];

/** Turkey's doctrine: six signature cards and a sixteen-card deck of drones, missiles, jamming and the straits. */
export const NATION_DOCTRINE: NationDoctrine = { nation: 'turkey', cards: [...CARDS], deck: [...DECK] };

const L = (d: LeaderDef): LeaderDef => d;

/** The President: invented, like every leader in the game. */
export const LEADER: LeaderDef = L({
  id: 'turkey_ekinci',
  name: 'Tarık Ekinci',
  title: 'President',
  temperament: 'opportunist',
  agenda: 'strength',
  bio: 'A shipbuilder from the Black Sea coast who sells to everyone, trusts no one and keeps the straits as his best card.',
  lines: {
    hostile: ['Ankara has nothing to say to {you}.', 'You will regret this, {you}.'],
    wary: ['Speak, {you}. Briefly.', 'We hear you. That does not mean we believe you.'],
    neutral: ['Everyone needs the straits, {you}. What will you give for them?', 'Let us bargain, {you}.'],
    cordial: ['Welcome, {you}. There is business to be done.', 'Our friendship is useful to us both, {you}.'],
    friendly: ['{you}, my friend! Ankara is at your service.', 'Between friends, {you}, everything is possible.'],
    accept: ['Agreed. A good bargain.', 'Done, {you}. Turkey keeps its side.'],
    reject_mood: ['After what {you} did? No.', 'You have not earned our trust, {you}.'],
    reject_terms: ['Too little, {you}. Much too little.', 'The straits are worth more than that.'],
    reject_strength: ['Threats, {you}? We have drones for threats.', 'Turkey bows to no one.'],
    took_city: ['{you} took a Turkish city. It will cost you dearly.', 'That city is ours, {you}.'],
    betrayed: ['{you} broke your word. The whole region will know.', 'A betrayal, {you}. We will answer it.'],
    winning: ['{you} grow too strong. Turkey will balance that.', 'Nobody rules both shores, {you}.'],
    war: ['So be it, {you}. The straits are closed to you.', 'You wanted this, {you}.'],
    peace: ['Peace. Trade can flow again.', 'Good. The ships may pass.'],
    deal: ['Signed. Profitable for all.', 'A fine deal, {you}.'],
    demand: ['Pay the toll, {you}, or the straits stay shut.'],
    defied: ['{you} did not pay. That was unwise.'],
    paid: ['Paid. The ships may pass.'],
  },
});
