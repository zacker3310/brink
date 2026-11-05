// Doctrine cards: balance data. A power holds a hand of cards drawn from its deck and plays them
// with its orders, paid for in Command Points. Every number here is an integer; a change is a
// ruleset change. Rules: `packages/simulation/src/doctrine.ts`. State: contracts `doctrine.ts`.
//
// Adding a nation's signature cards and deck: write `nations/<id>.ts` exporting a `NationDoctrine`,
// then import it below and add it to `NATION_DOCTRINES`. Its cards join `CARDS`; its deck replaces
// the government's for that nation.

import type { CardId, GovernmentId, NationId, Resource, UnitClass } from '@brink/contracts';
import { DOCTRINE as china } from './nations/china';
import { NATION_DOCTRINE as russia } from './nations/russia';
import { NATION_DOCTRINE as japan } from './nations/japan';
import { DOCTRINE as usa } from './nations/usa';
import { NATION_DOCTRINE as egypt } from './nations/egypt';
import { NATION_DOCTRINE as iran } from './nations/iran';
import { NATION_DOCTRINE as nigeria } from './nations/nigeria';
import { NATION_DOCTRINE as saudiArabia } from './nations/saudi-arabia';
import { NATION_DOCTRINE as southAfrica } from './nations/south-africa';
import { NATION_DOCTRINE as turkey } from './nations/turkey';

export const DOCTRINE = {
  /** Cards held at the end of a turn, after the draw. */
  handSize: 3,
  /** Cards one power may play in a turn. */
  maxPlays: 2,
  /** Command Points a power starts with. */
  cpStart: 3,
  /** Command Points banked at most. */
  cpCap: 8,
  /** Command Points every turn, before what a power holds adds to it. */
  cpBase: 1,
  /** More for holding a capital (its own or another's). */
  cpPerCapital: 1,
  /** One more for every this many cities and capitals held. */
  citiesPerCp: 4,
} as const;

/** What a card aims at. `hex`: any hex; `enemy-hex`: one you do not own; `nation`: a rival power. */
export type CardTargetKind = 'none' | 'own-hex' | 'enemy-hex' | 'hex' | 'nation';

/** Off-map assets a card can put over the player's hand-fought battles (arena `SupportId`). */
export type CardSupportAsset = 'himars' | 'tornado' | 'naval_gun' | 'cruise_missile' | 'strike_jet' | 'kamikaze';

/**
 * One thing a card does. Instant effects settle in the doctrine phase; lasting effects (marked)
 * are kept on the nation from the turn played for the card's `duration` and read where they apply.
 */
export type CardEffect =
  /** Lasting. The player's hand-fought battles get these extra support missions. */
  | { kind: 'arena_support'; asset: CardSupportAsset; missions: number }
  /** Lasting. War-map strikes by these classes hit `percent` harder. */
  | { kind: 'strike_bonus'; classes: UnitClass[]; percent: number }
  /**
   * Instant. Every enemy formation in the target hex loses `damage` strength (of 1000), halved by
   * half its entrenchment. The hex must lie within `range` of an own capital or carrier
   * (`capital_or_carrier`) or of an own fleet (`fleet`; the hex must then be coastal).
   */
  | { kind: 'card_strike'; from: 'capital_or_carrier' | 'fleet'; range: number; damage: number }
  /** Lasting. Ground formations get this many more movement points. */
  | { kind: 'movement'; bonus: number }
  /** Instant. Own ground formations within `radius` of the target dig in by `amount` (of 100). */
  | { kind: 'entrench'; amount: number; radius: number }
  /** Instant. Every own formation regains organization and morale (of 100). */
  | { kind: 'rally'; organization: number; morale: number }
  /** Instant. Resources into the stockpile. */
  | { kind: 'resources'; gain: Partial<Record<Resource, number>> }
  /** Instant. Own stability, capped at 100. */
  | { kind: 'stability'; amount: number }
  /** Instant. The target nation loses stability, never below 0. */
  | { kind: 'destabilize'; amount: number }
  /** Lasting. Enemy formations within `radius` of the target get no supply in the logistics phase. */
  | { kind: 'sabotage'; radius: number }
  /** Lasting. Everything within `radius` of the target is seen and detected, cover or not. */
  | { kind: 'reveal'; radius: number }
  /** Lasting. Landings from ships pay no amphibious assault penalty. */
  | { kind: 'amphibious' };

export interface CardDef {
  id: CardId;
  name: string;
  /** One line of colour, shown in italics under the name. */
  flavour: string;
  /** Command Points. */
  cost: number;
  target: CardTargetKind;
  /** Turns a lasting effect works, counting the turn played. Instant-only cards: 1. */
  duration: number;
  effects: CardEffect[];
}

const card = (c: CardDef): CardDef => c;

/** The generic cards every power can draw. */
export const GENERIC_CARDS: Record<CardId, CardDef> = {
  air_superiority: card({
    id: 'air_superiority',
    name: 'Air Superiority',
    flavour: 'Own the sky for six hours and everything under it is yours.',
    cost: 3,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'arena_support', asset: 'strike_jet', missions: 2 },
      { kind: 'strike_bonus', classes: ['air', 'carrier'], percent: 25 },
    ],
  }),
  naval_bombardment: card({
    id: 'naval_bombardment',
    name: 'Naval Bombardment',
    flavour: 'The battleship age never ended for the men on the beach.',
    cost: 2,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'fleet', range: 2, damage: 90 }],
  }),
  missile_barrage: card({
    id: 'missile_barrage',
    name: 'Missile Barrage',
    flavour: 'Launch codes confirmed. Impact in four minutes.',
    cost: 3,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'card_strike', from: 'capital_or_carrier', range: 6, damage: 120 }],
  }),
  forced_march: card({
    id: 'forced_march',
    name: 'Forced March',
    flavour: 'Sleep is for the reserve.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'movement', bonus: 2 }],
  }),
  dig_in: card({
    id: 'dig_in',
    name: 'Dig In',
    flavour: 'Shovels before rifles.',
    cost: 1,
    target: 'own-hex',
    duration: 1,
    effects: [{ kind: 'entrench', amount: 40, radius: 2 }],
  }),
  rally: card({
    id: 'rally',
    name: 'Rally',
    flavour: 'The general walks the line, and the line stands straighter.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'rally', organization: 25, morale: 20 }],
  }),
  requisition: card({
    id: 'requisition',
    name: 'Requisition',
    flavour: 'Every truck in the province now belongs to the army.',
    cost: 1,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'resources', gain: { materials: 50, energy: 30 } }],
  }),
  propaganda: card({
    id: 'propaganda',
    name: 'Propaganda',
    flavour: 'Victory is near. It is always near.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'stability', amount: 6 }],
  }),
  sabotage: card({
    id: 'sabotage',
    name: 'Sabotage',
    flavour: 'A bridge, a rail junction, a fuel depot: three men and a night.',
    cost: 2,
    target: 'enemy-hex',
    duration: 1,
    effects: [{ kind: 'sabotage', radius: 1 }],
  }),
  recon_flight: card({
    id: 'recon_flight',
    name: 'Recon Flight',
    flavour: 'One pass at forty thousand feet. Develop the film by dawn.',
    cost: 1,
    target: 'hex',
    duration: 1,
    effects: [{ kind: 'reveal', radius: 3 }],
  }),
  amphibious_doctrine: card({
    id: 'amphibious_doctrine',
    name: 'Amphibious Doctrine',
    flavour: 'The beach is a door. Kick it.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [{ kind: 'amphibious' }],
  }),
  kamikaze_swarm: card({
    id: 'kamikaze_swarm',
    name: 'Kamikaze Swarm',
    flavour: 'Two hundred dollars of plastic, one tank.',
    cost: 2,
    target: 'none',
    duration: 1,
    effects: [
      { kind: 'arena_support', asset: 'kamikaze', missions: 2 },
      { kind: 'strike_bonus', classes: ['drone'], percent: 25 },
    ],
  }),
  disinformation: card({
    id: 'disinformation',
    name: 'Disinformation',
    flavour: 'Nobody believes the news any more. Make sure it is theirs.',
    cost: 2,
    target: 'nation',
    duration: 1,
    effects: [{ kind: 'destabilize', amount: 5 }],
  }),
};

/** A nation's own doctrine: its signature cards and the deck it draws from. */
export interface NationDoctrine {
  nation: NationId;
  cards: CardDef[];
  /** Card ids, repeats for several copies. Generic and signature cards alike. */
  deck: CardId[];
}

/** Signature decks by nation: one import and one entry each (see the header). */
export const NATION_DOCTRINES: Record<NationId, NationDoctrine> = {
  china,
  russia,
  japan,
  usa,
  egypt,
  iran,
  nigeria,
  'saudi-arabia': saudiArabia,
  'south-africa': southAfrica,
  turkey,
};

/** Every card the game knows: the generic ones and every nation's signature cards. */
export const CARDS: Record<CardId, CardDef> = (() => {
  const out: Record<CardId, CardDef> = { ...GENERIC_CARDS };
  for (const id of Object.keys(NATION_DOCTRINES).sort()) for (const c of NATION_DOCTRINES[id]!.cards) out[c.id] = c;
  return out;
})();

/** The generic deck: sixteen cards, the cheap ones twice. */
export const GENERIC_DECK: readonly CardId[] = [
  'air_superiority',
  'amphibious_doctrine',
  'dig_in',
  'dig_in',
  'disinformation',
  'forced_march',
  'kamikaze_swarm',
  'missile_barrage',
  'naval_bombardment',
  'propaganda',
  'rally',
  'recon_flight',
  'recon_flight',
  'requisition',
  'requisition',
  'sabotage',
];

/** A government's leaning: two more cards on top of the generic deck. */
export const GOVERNMENT_DECKS: Record<GovernmentId, readonly CardId[]> = {
  commonwealth: [...GENERIC_DECK, 'air_superiority', 'naval_bombardment'],
  directorate: [...GENERIC_DECK, 'missile_barrage', 'sabotage'],
  federation: [...GENERIC_DECK, 'amphibious_doctrine', 'rally'],
  union: [...GENERIC_DECK, 'forced_march', 'propaganda'],
};

/** The deck a power starts with, sorted: its own if it has one, else its government's. */
export function deckFor(nation: NationId, government: GovernmentId): CardId[] {
  return [...(NATION_DOCTRINES[nation]?.deck ?? GOVERNMENT_DECKS[government] ?? GENERIC_DECK)].sort();
}

/** Whether an effect lasts on the nation (read where it applies) rather than settling at once. */
export function isLasting(e: CardEffect): boolean {
  return e.kind === 'arena_support' || e.kind === 'strike_bonus' || e.kind === 'movement' || e.kind === 'sabotage' || e.kind === 'reveal' || e.kind === 'amphibious';
}

const ASSET_NAME: Record<CardSupportAsset, string> = {
  himars: 'rocket strike',
  tornado: 'rocket strike',
  naval_gun: 'naval gunfire mission',
  cruise_missile: 'cruise missile',
  strike_jet: 'strike jet sortie',
  kamikaze: 'kamikaze drone swarm',
};

const CLASS_NAME: Partial<Record<UnitClass, string>> = { air: 'air wing', carrier: 'carrier', drone: 'drone', artillery: 'artillery', fleet: 'fleet' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One effect in plain words. */
export function describeEffect(e: CardEffect): string {
  switch (e.kind) {
    case 'arena_support':
      return `Battles you fight by hand: +${plural(e.missions, ASSET_NAME[e.asset])}.`;
    case 'strike_bonus':
      return `${e.classes.map((c) => CLASS_NAME[c] ?? c).join(' and ')} strikes on the map +${e.percent}%.`.replace(/^./, (x) => x.toUpperCase());
    case 'card_strike':
      return e.from === 'fleet'
        ? `Shell a coast within ${e.range} of your fleet: enemies there lose up to ${e.damage / 10}% strength.`
        : `Hit a hex within ${e.range} of your capital or a carrier: enemies there lose up to ${e.damage / 10}% strength.`;
    case 'movement':
      return `Ground units move ${e.bonus} points further.`;
    case 'entrench':
      return `Your ground units within ${e.radius} hexes dig in +${e.amount}.`;
    case 'rally':
      return `Every unit regains ${e.organization} organization and ${e.morale} morale.`;
    case 'resources':
      return `Gain ${Object.entries(e.gain)
        .filter(([, v]) => v)
        .map(([r, v]) => `${v} ${r}`)
        .join(' and ')}.`;
    case 'stability':
      return `Stability +${e.amount}.`;
    case 'destabilize':
      return `A rival power loses ${e.amount} stability.`;
    case 'sabotage':
      return `Enemy units within ${e.radius} hex${e.radius === 1 ? '' : 'es'} of the target get no supply.`;
    case 'reveal':
      return `See everything within ${e.radius} hexes of the target, even in cover.`;
    case 'amphibious':
      return 'Landings from ships pay no beach penalty.';
  }
}

/** A card's effect in plain words, with how long it lasts. */
export function describeCard(c: CardDef): string {
  const text = c.effects.map(describeEffect).join(' ');
  const lasting = c.effects.some(isLasting);
  if (!lasting) return text;
  return `${c.duration === 1 ? 'This turn: ' : `For ${c.duration} turns: `}${text}`;
}
