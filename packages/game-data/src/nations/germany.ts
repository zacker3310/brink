// Germany: the industrial heart of the continent, rearming. Its generals run the logistics, lead the
// armour and study the war; its signature cards are the Leopard 2A7, Taurus, the PzH 2000, MARS
// rockets, IRIS-T over the cities and the factories turning to war. Balance data: integers only; a
// change is a ruleset change. Registered in `commanders.ts`, `doctrine.ts`, `blurbs.ts` and
// `leaders.ts`; type-only imports keep that free of cycles. Every person is fictional.

import type { CardId } from '@brink/contracts';
import type { GeneralDef } from '../commanders';
import type { CardDef, NationDoctrine } from '../doctrine';
import type { LeaderDef } from '../leaders';

/** A few lines on how Germany plays, for the setup dossier. */
export const BLURB =
  'The workshop of Europe goes to war. The economy out-builds every rival, the Leopards break through and roll on, ' +
  'the PzH 2000 and MARS rockets clear the way, Taurus reaches the bridges, and IRIS-T keeps the cities standing.';

/** Three fictional generals: the quartermaster, the tank commander and the staff officer. */
export const ROSTER: readonly (GeneralDef & { bio: string })[] = [
  {
    name: 'Konstanze Brehm',
    trait: 'quartermaster',
    bio: 'Ran the logistics command in Ulm; can move a division across Europe by rail in a week and says so.',
  },
  {
    name: 'Matthias Vollrath',
    trait: 'firebrand',
    bio: 'Panzer officer who won the tank competition twice and drives the lead Leopard himself.',
  },
  {
    name: 'Friederike Ahlers',
    trait: 'scholar',
    bio: 'General staff officer who reads Moltke on the train and writes the plan before the crisis starts.',
  },
];

const card = (c: CardDef): CardDef => c;

export const CARDS: readonly CardDef[] = [
  card({
    id: 'germany_leopard_spearhead',
    name: 'Leopard Spearhead',
    flavour: 'A 2A7 battalion through the gap at forty kilometres an hour, and the reserve behind it.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'movement', bonus: 2 },
      { kind: 'rally', organization: 15, morale: 10 },
    ],
  }),
  card({
    id: 'germany_taurus_strike',
    name: 'Taurus Strike',
    flavour: 'Five hundred kilometres, a tandem warhead, and a bridge that will not carry tanks again.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [
      { kind: 'card_strike', from: 'capital_or_carrier', range: 8, damage: 130 },
      { kind: 'arena_support', asset: 'cruise_missile', missions: 1 },
    ],
  }),
  card({
    id: 'germany_pzh_fire',
    name: 'PzH 2000 Fire',
    flavour: 'Three rounds in nine seconds, all landing at once, forty kilometres away.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'strike_bonus', classes: ['artillery'], percent: 40 }],
  }),
  card({
    id: 'germany_mars_rockets',
    name: 'MARS Rockets',
    flavour: 'Twelve guided rockets ripple off the launcher; the command post goes dark.',
    cost: 2,
    target: 'none',
    duration: 2,
    effects: [{ kind: 'arena_support', asset: 'himars', missions: 2 }],
  }),
  card({
    id: 'germany_iris_t_shield',
    name: 'IRIS-T Shield',
    flavour: 'The drones come in at night, and the night sky over the city lights up and stays empty.',
    cost: 2,
    target: 'own-hex',
    duration: 1,
    effects: [
      { kind: 'entrench', amount: 40, radius: 2 },
      { kind: 'stability', amount: 4 },
    ],
  }),
  card({
    id: 'germany_war_economy',
    name: 'War Economy',
    flavour: 'The car plants retool for shells; the order books fill for a decade.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { credits: 60, materials: 80, energy: 40 } }],
  }),
];

const DECK: readonly CardId[] = [
  'germany_leopard_spearhead',
  'germany_leopard_spearhead',
  'germany_taurus_strike',
  'germany_pzh_fire',
  'germany_pzh_fire',
  'germany_mars_rockets',
  'germany_iris_t_shield',
  'germany_war_economy',
  'germany_war_economy',
  'air_superiority',
  'forced_march',
  'recon_flight',
  'requisition',
  'rally',
  'dig_in',
  'propaganda',
];

/** Germany's doctrine: six signature cards and a sixteen-card deck of armour, guns and industry. */
export const NATION_DOCTRINE: NationDoctrine = { nation: 'germany', cards: [...CARDS], deck: [...DECK] };

const L = (d: LeaderDef): LeaderDef => d;

/** The Chancellor: invented, like every leader in the game. */
export const LEADER: LeaderDef = L({
  id: 'germany_westerkamp',
  name: 'Annelie Westerkamp',
  title: 'Chancellor',
  temperament: 'dove',
  agenda: 'commerce',
  bio: 'An engineer turned party leader who believes trade binds nations better than tanks, and is building the tanks anyway.',
  lines: {
    hostile: ['Berlin has nothing more to say to {you}.', 'Our patience with {you} has ended.'],
    wary: ['We will hear you, {you}. Carefully.', 'Your words, {you}. Then we will see your deeds.'],
    neutral: ['Let us find an arrangement, {you}.', 'Europe works when it trades. What do you offer?'],
    cordial: ['Good to speak with {you}. Our markets are open.', 'We value our partnership, {you}.'],
    friendly: ['{you}, a true partner. Berlin stands with you.', 'Whatever we can do for {you}, we will.'],
    accept: ['Agreed. It will be honoured to the letter.', 'Einverstanden. We accept.'],
    reject_mood: ['Not while {you} behave as you do.', 'Trust takes time, {you}. You have not given it any.'],
    reject_terms: ['The numbers do not work, {you}.', 'That is not a fair contract.'],
    reject_strength: ['We will not be pressured, {you}.', 'Germany does not sign under threat.'],
    took_city: ['{you} took a German city. We will not rest until it is returned.', 'You will pay for that, {you}.'],
    betrayed: ['{you} broke a treaty. Europe will close its doors to you.', 'A broken contract, {you}. Unforgivable.'],
    winning: ['{you} are growing too powerful for the continent.', 'Europe has seen one power try to rule it, {you}.'],
    war: ['With a heavy heart, Germany will defend itself.', 'You leave us no choice, {you}.'],
    peace: ['Peace. Now we rebuild.', 'Thank you, {you}. Let us trade again.'],
    deal: ['Signed. Good business for both of us.', 'A fair arrangement, {you}.'],
    demand: ['We must ask {you} for compensation.'],
    defied: ['{you} refused a reasonable request. Noted.'],
    paid: ['Paid. Let us not do this again.'],
  },
});
