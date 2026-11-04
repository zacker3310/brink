import type { CardPlay, FormationId, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { CARDS, DOCTRINE, UNITS, type CardDef } from '@brink/game-data';
import { keyDistance } from '@brink/map';
import { checkPlays, checkTarget, sortedKeys } from '@brink/simulation';

// The AI's cards: a simple utility for each card in hand, from its own view and the orders it has
// just written, best first while the Command Points last. Every play is put through the engine's
// own check on the same view, so the validator never refuses one (the soak counts that).

interface Candidate {
  play: CardPlay;
  value: number;
}

/** Hexes where enemies at war with us were seen this turn, with the strength seen there. */
function enemyHexes(view: NationView): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
  for (const id of sortedKeys(view.contacts)) {
    const c = view.contacts[id]!;
    if (!c.confirmed || view.relations[c.owner] !== 'war' || UNITS[c.unitClass].naval) continue;
    out.set(c.key, (out.get(c.key) ?? 0) + c.estimatedStrength);
  }
  return out;
}

/** The best target hex for a card from a list scored by `score`, legal on this view. */
function bestHex(view: NationView, card: CardDef, scored: Map<HexKey, number>): Candidate | null {
  let best: Candidate | null = null;
  for (const key of [...scored.keys()].sort()) {
    const value = scored.get(key)!;
    const play = { card: card.id, target: key };
    if (checkTarget(view, view.self.id, play)) continue;
    if (!best || value > best.value) best = { play, value };
  }
  return best;
}

function candidate(view: NationView, card: CardDef, orders: Record<FormationId, FormationOrder>): Candidate | null {
  const self = view.self;
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
  const attacking = (classes: readonly string[]) => own.filter((f) => classes.includes(f.unitClass) && orders[f.id]?.type === 'attack').length;
  const enemies = enemyHexes(view);
  const effect = card.effects[0]!;
  switch (effect.kind) {
    case 'resources': {
      const low = self.stockpile.materials < 150 || self.stockpile.energy < 100;
      return { play: { card: card.id }, value: low ? 5 : 2 };
    }
    case 'stability':
      return { play: { card: card.id }, value: self.stability < 55 ? 6 : self.stability < 75 ? 2 : 0 };
    case 'rally': {
      const shaken = own.filter((f) => f.organization < 50 || f.morale < 50).length;
      return { play: { card: card.id }, value: shaken * 2 };
    }
    case 'destabilize': {
      const rivals = sortedKeys(view.nations).filter((n) => n !== self.id && view.relations[n] === 'war' && !view.nations[n]!.minor && !view.nations[n]!.eliminated);
      const leader = rivals.sort((a, b) => view.nations[b]!.victoryPoints - view.nations[a]!.victoryPoints || (a < b ? -1 : 1))[0];
      return leader ? { play: { card: card.id, nation: leader }, value: 3 } : null;
    }
    case 'card_strike':
      // Worth it on a big target: about one full formation seen there.
      return bestHex(view, card, new Map([...enemies].filter(([, s]) => s >= 600).map(([k, s]) => [k, Math.floor(s / 100)])));
    case 'sabotage':
      return bestHex(view, card, new Map([...enemies].filter(([, s]) => s >= 1000).map(([k, s]) => [k, Math.floor(s / 200)])));
    case 'entrench': {
      // Dig in where own ground units stand within reach of seen enemies.
      const scored = new Map<HexKey, number>();
      for (const f of own) {
        if (!UNITS[f.unitClass].ground || f.aboard || f.entrenchment >= 60) continue;
        const near = [...enemies.keys()].filter((k) => keyDistance(k, f.key) <= 2).length;
        if (near > 0) scored.set(f.key, (scored.get(f.key) ?? 0) + 2 + near);
      }
      return bestHex(view, card, scored);
    }
    case 'reveal': {
      // Look where enemies were last seen and are not seen now.
      const scored = new Map<HexKey, number>();
      for (const id of sortedKeys(view.contacts)) {
        const c = view.contacts[id]!;
        if (c.confirmed || view.relations[c.owner] !== 'war' || view.turn - c.lastSeen > 3) continue;
        scored.set(c.key, (scored.get(c.key) ?? 0) + 2);
      }
      return bestHex(view, card, scored);
    }
    case 'arena_support':
    case 'strike_bonus': {
      const classes = card.effects.flatMap((e) => (e.kind === 'strike_bonus' ? e.classes : []));
      return { play: { card: card.id }, value: attacking(classes) * 3 };
    }
    case 'movement': {
      // The AI plans its moves at the usual pace; the card mostly turns the hand over.
      const marching = own.filter((f) => UNITS[f.unitClass].ground && orders[f.id]?.type === 'move').length;
      return { play: { card: card.id }, value: marching >= 4 ? 1 : 0 };
    }
    case 'amphibious': {
      const landings = own.filter((f) => f.aboard && UNITS[f.unitClass].ground && orders[f.id]?.type === 'attack').length;
      return { play: { card: card.id }, value: landings * 5 };
    }
  }
}

/**
 * The cards to play this turn: each card's best use, worth something, best first, while the
 * Command Points and the turn's limit last, then checked as the engine will check them.
 */
export function planCards(view: NationView, orders: Record<FormationId, FormationOrder>): CardPlay[] {
  const d = view.self.doctrine;
  if (!d || d.hand.length === 0) return [];
  const seen = new Set<string>();
  const options: Candidate[] = [];
  for (const id of d.hand) {
    const card = CARDS[id];
    if (!card || seen.has(id)) continue;
    seen.add(id);
    const c = candidate(view, card, orders);
    if (c && c.value > 0) options.push(c);
  }
  options.sort((a, b) => b.value - a.value || (a.play.card < b.play.card ? -1 : 1));
  const chosen: CardPlay[] = [];
  let cp = d.cp;
  for (const o of options) {
    if (chosen.length >= DOCTRINE.maxPlays) break;
    const cost = CARDS[o.play.card]!.cost;
    // Keep a little in the bank for a better hand, unless the bank is full anyway.
    if (cost > cp || (o.value < 3 && cp - cost < 2 && cp < DOCTRINE.cpCap)) continue;
    chosen.push(o.play);
    cp -= cost;
  }
  return checkPlays(view, view.self.id, d, chosen).accepted;
}
