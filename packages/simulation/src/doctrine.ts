import type {
  ActiveEffect,
  CardId,
  CardPlay,
  DoctrineState,
  FormationId,
  GameEvent,
  HexKey,
  Nation,
  NationId,
  NationOrders,
  Terrain,
  FormationClass,
  WorldState,
} from '@brink/contracts';
import { CARDS, deckFor, DOCTRINE, isLasting, UNITS, type CardDef, type CardEffect, type CardSupportAsset } from '@brink/game-data';
import { keyDistance, neighborKeys, rangeKeys } from '@brink/map';
import { roll } from './rng';
import { handSizeOf, techMovement } from './progression';
import { clamp, nationModifiers, pct, relationOf, sortedKeys } from './rules';

// Doctrine cards (contracts `doctrine.ts`, data in game-data `doctrine.ts`). Cards are checked with
// the turn's orders (`checkPlays`, from `lockOrders`), settle in the doctrine phase right after
// diplomacy (`resolveDoctrine`), and a lasting card is read where it applies: movement, strikes,
// logistics, vision, assaults from the sea, and the player's hand-fought battles.

/** What a play check needs to know of the board. A `WorldState` and a `NationView` both fit. */
export interface PlayBoard {
  turn: number;
  tiles: Record<HexKey, { terrain: Terrain | null; owner: NationId | null } | undefined>;
  sites: Record<string, { kind: string; owner: NationId | null; key: HexKey }>;
  /** Only the nation's own formations are read. */
  formations: Record<FormationId, { owner: NationId; unitClass: FormationClass; key: HexKey; aboard?: FormationId }>;
  nations: Record<NationId, { eliminated: boolean; minor?: boolean } | undefined>;
}

const byPlay = (a: CardPlay, b: CardPlay): number => {
  const ka = `${a.card}|${a.target ?? ''}|${a.nation ?? ''}`;
  const kb = `${b.card}|${b.target ?? ''}|${b.nation ?? ''}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/** A fresh doctrine: the deck, a drawn hand and the starting Command Points. */
export function newDoctrine(seed: number, nation: Pick<Nation, 'id' | 'government'>): DoctrineState {
  const d: DoctrineState = { cp: DOCTRINE.cpStart, hand: [], deck: deckFor(nation.id, nation.government), discard: [], effects: [] };
  draw(d, seed, 0, nation.id);
  return d;
}

/** Give every power that has none its doctrine (new campaigns and older saves). Minor states hold no cards. */
export function initDoctrine(world: WorldState): void {
  for (const id of sortedKeys(world.nations)) {
    const n = world.nations[id]!;
    if (n.minor || n.eliminated || n.doctrine) continue;
    n.doctrine = newDoctrine(world.seed, n);
  }
}

/** Fill the hand to `size` (`DOCTRINE.handSize`, more with Staff College). Each draw is addressed, so nothing about order or count elsewhere matters. */
function draw(d: DoctrineState, seed: number, turn: number, nation: NationId, size: number = DOCTRINE.handSize): void {
  let n = 0;
  while (d.hand.length < size) {
    if (d.deck.length === 0) {
      if (d.discard.length === 0) break;
      d.deck = [...d.discard].sort();
      d.discard = [];
    }
    const i = roll(seed, turn, 'draw', nation, n) % d.deck.length;
    d.hand.push(d.deck.splice(i, 1)[0]!);
    n += 1;
  }
  d.hand.sort();
}

/** Command Points a power gains a turn: the base, its capitals, and one for every few cities. */
export function cpIncome(board: Pick<PlayBoard, 'sites'>, nation: NationId): number {
  let capitals = 0;
  let cities = 0;
  for (const id of sortedKeys(board.sites)) {
    const s = board.sites[id]!;
    if (s.owner !== nation) continue;
    if (s.kind === 'capital') capitals += 1;
    if (s.kind === 'capital' || s.kind === 'city') cities += 1;
  }
  return DOCTRINE.cpBase + capitals * DOCTRINE.cpPerCapital + Math.floor(cities / DOCTRINE.citiesPerCp);
}

const isLand = (t: { terrain: Terrain | null } | undefined) => !!t && t.terrain !== null && t.terrain !== 'water';

/** A land hex beside the sea. */
export function isCoastal(board: Pick<PlayBoard, 'tiles'>, key: HexKey): boolean {
  return isLand(board.tiles[key]) && neighborKeys(key).some((k) => board.tiles[k]?.terrain === 'water');
}

/** Where `nation` can launch a card strike of this kind from. */
function launchers(board: PlayBoard, nation: NationId, from: 'capital_or_carrier' | 'fleet'): HexKey[] {
  const out: HexKey[] = [];
  if (from === 'capital_or_carrier') {
    for (const id of sortedKeys(board.sites)) {
      const s = board.sites[id]!;
      if (s.owner === nation && s.kind === 'capital') out.push(s.key);
    }
  }
  for (const id of sortedKeys(board.formations)) {
    const f = board.formations[id]!;
    if (f.owner !== nation) continue;
    if (from === 'fleet' ? f.unitClass === 'fleet' : f.unitClass === 'carrier') out.push(f.key);
  }
  return out;
}

/** Why `play` cannot aim where it does, ignoring hand and cost; null when it can. */
export function checkTarget(board: PlayBoard, nation: NationId, play: CardPlay): string | null {
  const def = CARDS[play.card];
  if (!def) return 'no such card';
  if (def.target === 'none') return play.target !== undefined || play.nation !== undefined ? `${def.name} takes no target` : null;
  if (def.target === 'nation') {
    if (typeof play.nation !== 'string' || play.target !== undefined) return `${def.name} is aimed at a power`;
    const t = board.nations[play.nation];
    if (!t || play.nation === nation) return `${def.name} needs a rival power`;
    if (t.eliminated) return 'that power has been eliminated';
    if (t.minor) return `${def.name} is aimed at a power, not a minor state`;
    return null;
  }
  if (typeof play.target !== 'string' || play.nation !== undefined) return `${def.name} needs a hex`;
  const tile = board.tiles[play.target];
  if (!tile) return 'no such hex';
  if (def.target === 'own-hex' && tile.owner !== nation) return `${def.name} is played on your own ground`;
  if (def.target === 'enemy-hex' && tile.owner === nation) return `${def.name} is played on ground you do not hold`;
  for (const e of def.effects) {
    if (e.kind !== 'card_strike') continue;
    if (e.from === 'fleet' && !isCoastal(board, play.target)) return `${def.name} needs a coastal hex`;
    const from = launchers(board, nation, e.from);
    if (!from.some((k) => keyDistance(k, play.target!) <= e.range)) {
      return e.from === 'fleet' ? `no fleet of yours within ${e.range} hexes` : `out of range: ${e.range} hexes from your capital or a carrier`;
    }
  }
  return null;
}

/**
 * The plays that stand, in a fixed order (by card, then target), and why each other one does not:
 * the card must be in hand (a copy per play), the Command Points must cover all of them, no more
 * than `DOCTRINE.maxPlays`, and each must have a legal target. The order the plays came in never matters.
 */
export function checkPlays(
  board: PlayBoard,
  nation: NationId,
  doctrine: DoctrineState | undefined,
  plays: readonly CardPlay[],
): { accepted: CardPlay[]; rejected: string[] } {
  const accepted: CardPlay[] = [];
  const rejected: string[] = [];
  const valid = plays.filter((p) => p && typeof p === 'object' && typeof p.card === 'string');
  if (valid.length !== plays.length) rejected.push('malformed card play');
  if (!doctrine) {
    if (valid.length > 0) rejected.push('no doctrine cards to play');
    return { accepted, rejected };
  }
  const hand = [...doctrine.hand];
  let cp = doctrine.cp;
  for (const p of [...valid].sort(byPlay)) {
    const def = CARDS[p.card];
    if (!def) {
      rejected.push('no such card');
      continue;
    }
    const at = hand.indexOf(p.card);
    if (at < 0) {
      rejected.push(`${def.name} is not in your hand`);
      continue;
    }
    if (accepted.length >= DOCTRINE.maxPlays) {
      rejected.push(`only ${DOCTRINE.maxPlays} cards a turn: ${def.name} waits`);
      continue;
    }
    if (def.cost > cp) {
      rejected.push(`not enough Command Points for ${def.name}`);
      continue;
    }
    const why = checkTarget(board, nation, p);
    if (why) {
      rejected.push(why);
      continue;
    }
    hand.splice(at, 1);
    cp -= def.cost;
    accepted.push({ card: p.card, ...(p.target !== undefined ? { target: p.target } : {}), ...(p.nation !== undefined ? { nation: p.nation } : {}) });
  }
  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Lasting effects, read where they apply.

/** A lasting effect in force on `turn`, with the card that made it. */
export interface InForce {
  def: CardDef;
  effect: CardEffect;
  target?: HexKey;
}

/**
 * Lasting effects `nation` has in force on `turn`: the ones in its state, and, before the doctrine
 * phase has settled them (validation, the planner), the cards it is playing this turn.
 */
export function effectsInForce(nation: Pick<Nation, 'doctrine'> | undefined, turn: number, plays: readonly CardPlay[] = []): InForce[] {
  const out: InForce[] = [];
  const add = (card: CardId, target: HexKey | undefined) => {
    const def = CARDS[card];
    if (!def) return;
    for (const effect of def.effects) if (isLasting(effect)) out.push({ def, effect, ...(target !== undefined ? { target } : {}) });
  };
  for (const e of nation?.doctrine?.effects ?? []) if (e.from <= turn && turn <= e.until) add(e.card, e.target);
  for (const p of plays) add(p.card, p.target);
  return out;
}

/**
 * Extra movement points for a formation of `unitClass`: a card's march (ground only, never aboard a
 * ship), and what research adds (Mobile Warfare for armour, Naval Engineering for ships).
 */
export function marchBonus(
  nation: (Pick<Nation, 'doctrine'> & { research?: Nation['research'] }) | undefined,
  turn: number,
  f: { unitClass: FormationClass; aboard?: FormationId },
  plays: readonly CardPlay[] = [],
): number {
  const tech = techMovement(nation?.research?.unlocked ?? [], f);
  if (!UNITS[f.unitClass].ground || f.aboard) return tech;
  let best = 0;
  for (const x of effectsInForce(nation, turn, plays)) if (x.effect.kind === 'movement') best = Math.max(best, x.effect.bonus);
  return best + tech;
}

/** Percent added to war-map strikes by `unitClass`. Cards of one kind do not stack: the best counts. */
export function strikeBonus(nation: Pick<Nation, 'doctrine'> | undefined, turn: number, unitClass: FormationClass): number {
  let best = 0;
  for (const x of effectsInForce(nation, turn)) if (x.effect.kind === 'strike_bonus' && (x.effect.classes as readonly FormationClass[]).includes(unitClass)) best = Math.max(best, x.effect.percent);
  return best;
}

/** Landings from ships pay no amphibious penalty this turn. */
export function amphibiousInForce(nation: Pick<Nation, 'doctrine'> | undefined, turn: number): boolean {
  return effectsInForce(nation, turn).some((x) => x.effect.kind === 'amphibious');
}

/**
 * Extra support for `nation`'s hand-fought battles this turn, from its lasting cards and the ones it
 * is playing. Cards add up: two Air Superiority cards bring four sorties.
 */
export function cardSupport(nation: Pick<Nation, 'doctrine'> | undefined, turn: number, plays: readonly CardPlay[] = []): { id: CardSupportAsset; missions: number }[] {
  const total = new Map<CardSupportAsset, number>();
  for (const x of effectsInForce(nation, turn, plays)) if (x.effect.kind === 'arena_support') total.set(x.effect.asset, (total.get(x.effect.asset) ?? 0) + x.effect.missions);
  return [...total.keys()].sort().map((id) => ({ id, missions: total.get(id)! }));
}

/** Hexes where `nation`'s formations get no supply this turn: enemies' sabotage around their targets. */
export function sabotagedHexes(world: WorldState, nation: NationId): Set<HexKey> {
  const out = new Set<HexKey>();
  for (const id of sortedKeys(world.nations)) {
    if (id === nation || relationOf(world.relations, id, nation) !== 'war') continue;
    for (const x of effectsInForce(world.nations[id], world.turn)) {
      if (x.effect.kind === 'sabotage' && x.target) for (const k of rangeKeys(x.target, x.effect.radius)) out.add(k);
    }
  }
  return out;
}

/**
 * Hexes a Recon Flight shows `nation`, seen and detected: from the turn it flew through the planning
 * that follows it (the doctrine phase of the next turn retires it before anything else is seen).
 */
export function revealedHexes(world: Pick<WorldState, 'turn' | 'nations'>, nation: NationId): HexKey[] {
  const out: HexKey[] = [];
  for (const e of world.nations[nation]?.doctrine?.effects ?? []) {
    if (!(e.from <= world.turn && world.turn <= e.until + 1) || !e.target) continue;
    for (const effect of CARDS[e.card]?.effects ?? []) if (effect.kind === 'reveal') out.push(...rangeKeys(e.target, effect.radius));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The doctrine phase.

/**
 * Phase 2c (after diplomacy). Spent effects retire; every locked play pays its Command Points and
 * goes to the discard; instant effects are computed from one snapshot and committed together
 * (strikes, digging in, rallies, stockpiles, stability); lasting ones are recorded with their last
 * turn; then every power gains its Command Points and draws back up to a full hand. Destroyed
 * formations are removed by the caller (`removeDestroyed`).
 */
export function resolveDoctrine(world: WorldState, orders: Record<NationId, NationOrders>, events: GameEvent[]): void {
  const turn = world.turn;
  for (const id of sortedKeys(world.nations)) {
    const d = world.nations[id]!.doctrine;
    if (d) d.effects = d.effects.filter((e) => e.until >= turn);
  }

  // Effects on formations, from the snapshot, committed below.
  const loss = new Map<FormationId, number>();
  const org = new Map<FormationId, number>();
  const morale = new Map<FormationId, number>();
  const dig = new Map<FormationId, number>();
  const stability = new Map<NationId, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const formations = sortedKeys(world.formations).map((id) => world.formations[id]!);

  for (const nation of sortedKeys(orders)) {
    const n = world.nations[nation]!;
    const d = n.doctrine;
    const plays = orders[nation]!.play ?? [];
    if (!d || plays.length === 0) continue;
    for (const play of plays) {
      const def = CARDS[play.card]!;
      d.cp -= def.cost;
      d.hand.splice(d.hand.indexOf(play.card), 1);
      d.discard = [...d.discard, play.card].sort();
      const victims: { formation: FormationId; owner: NationId; strengthLoss: number }[] = [];
      for (const e of def.effects) {
        switch (e.kind) {
          case 'card_strike':
            for (const f of formations) {
              if (f.key !== play.target || relationOf(world.relations, nation, f.owner) !== 'war') continue;
              const l = clamp(pct(e.damage, 100 - Math.floor(f.entrenchment / 2)), 0, f.strength);
              bump(loss, f.id, l);
              bump(org, f.id, Math.floor(l / 4));
              victims.push({ formation: f.id, owner: f.owner, strengthLoss: l });
            }
            break;
          case 'entrench':
            for (const f of formations) if (f.owner === nation && UNITS[f.unitClass].ground && !f.aboard && keyDistance(f.key, play.target!) <= e.radius) bump(dig, f.id, e.amount);
            break;
          case 'rally':
            for (const f of formations) {
              if (f.owner !== nation) continue;
              bump(org, f.id, -e.organization);
              bump(morale, f.id, e.morale);
            }
            break;
          case 'resources':
            for (const r of sortedKeys(e.gain)) n.stockpile[r] += e.gain[r] ?? 0;
            break;
          case 'stability':
            bump(stability, nation, e.amount);
            break;
          case 'destabilize':
            bump(stability, play.nation!, -e.amount);
            break;
          default:
            break;
        }
      }
      if (def.effects.some(isLasting)) {
        const effect: ActiveEffect = { card: play.card, from: turn, until: turn + Math.max(1, def.duration) - 1, ...(play.target !== undefined ? { target: play.target } : {}), ...(play.nation !== undefined ? { nation: play.nation } : {}) };
        d.effects.push(effect);
      }
      events.push({
        kind: 'card_played',
        nation,
        card: play.card,
        ...(play.target !== undefined ? { target: play.target } : {}),
        ...(play.nation !== undefined ? { targetNation: play.nation } : {}),
        ...(def.effects.some((e) => e.kind === 'card_strike') ? { victims } : {}),
      });
    }
    d.effects.sort((a, b) => (a.card < b.card ? -1 : a.card > b.card ? 1 : a.from - b.from));
  }

  // Commit, formation by formation in id order; nothing here depends on which nation came first.
  for (const f of formations) {
    const l = Math.min(f.strength, loss.get(f.id) ?? 0);
    f.strength -= l;
    if (l > 0) world.nations[f.owner]!.warLosses += l;
    f.organization = clamp(f.organization - (org.get(f.id) ?? 0), 0, 100);
    f.morale = clamp(f.morale + (morale.get(f.id) ?? 0), 0, 100);
    f.entrenchment = clamp(f.entrenchment + (dig.get(f.id) ?? 0), 0, 100);
  }
  for (const id of [...stability.keys()].sort()) {
    const n = world.nations[id];
    if (n) n.stability = clamp(n.stability + stability.get(id)!, 0, 100);
  }

  // Command Points, then the draw.
  for (const id of sortedKeys(world.nations)) {
    const n = world.nations[id]!;
    const d = n.doctrine;
    if (!d || n.eliminated) continue;
    d.cp = Math.min(DOCTRINE.cpCap, d.cp + cpIncome(world, id) + nationModifiers(n).commandPoints);
    draw(d, world.seed, turn, id, handSizeOf(n));
  }
}
