import type { GameEvent, NationId, NationOrders, Proposal, ProposalKind, Treaty, TreatyKind, WorldState } from '@brink/contracts';
import { TREATIES } from '@brink/game-data';
import { pairKey, relationOf, sortedKeys, treatyIn } from './rules';

/** Pending proposals lapse after this many turns. */
const PROPOSAL_LIFETIME = 2;

/**
 * Whether `from` may still offer `kind` to `to`: peace needs a war, an alliance or a pact needs
 * peace, trade needs no war and no embargo. A pact or trade already running cannot be offered
 * again until its last turn (an offer then renews it).
 */
export function canPropose(world: Pick<WorldState, 'relations' | 'treaties' | 'turn'>, from: NationId, to: NationId, kind: ProposalKind): boolean {
  const rel = relationOf(world.relations, from, to);
  const running = (k: TreatyKind) => {
    const t = treatyIn(world.treaties, k, from, to, world.turn);
    return !!t && t.until > world.turn;
  };
  switch (kind) {
    case 'peace':
      return rel === 'war';
    case 'alliance':
      return rel === 'peace';
    case 'nonaggression':
      return rel === 'peace' && !running('nonaggression');
    case 'trade':
      return rel !== 'war' && !treatyIn(world.treaties, 'embargo', from, to, world.turn) && !running('trade');
  }
}

function sign(world: WorldState, kind: TreatyKind, a: NationId, b: NationId, turns: number, events: GameEvent[], by?: NationId): void {
  const [x, y] = a < b ? [a, b] : [b, a];
  world.treaties = world.treaties.filter((t) => !(t.kind === kind && t.a === x && t.b === y));
  const t: Treaty = { kind, a: x, b: y, from: world.turn, until: world.turn + turns - 1, ...(by ? { by } : {}) };
  world.treaties.push(t);
  events.push({ kind: 'treaty', treaty: kind, a: x, b: y, until: t.until, ...(by ? { by } : {}) });
}

function end(world: WorldState, kinds: readonly TreatyKind[], a: NationId, b: NationId, reason: 'war' | 'embargo', events: GameEvent[]): void {
  const [x, y] = a < b ? [a, b] : [b, a];
  for (const t of world.treaties) {
    if (t.a === x && t.b === y && kinds.includes(t.kind) && t.until >= world.turn) events.push({ kind: 'treaty_ended', treaty: t.kind, a: x, b: y, reason });
  }
  world.treaties = world.treaties.filter((t) => !(t.a === x && t.b === y && kinds.includes(t.kind)));
}

/**
 * Phase 2, in this order:
 * 1. Treaties past their last turn lapse, and any with an eliminated party go.
 * 2. Declarations of war take effect at once and end trade (and, defensively, any pact) between
 *    the two. Validation already refuses war on a pact partner, so a pact is binding.
 * 3. Embargoes take effect at once: trade between the two ends and is barred while it lasts.
 * 4. Proposals: peace, alliance, a non-aggression pact or trade takes effect when both sides have
 *    offered it, this turn or within the offer's lifetime; who offered first does not matter. A
 *    pair that went to war this turn ignores offers until next turn. Everything agreed is in force
 *    from this turn's resolution on.
 */
export function resolveDiplomacy(world: WorldState, orders: Record<NationId, NationOrders>, events: GameEvent[]): void {
  const keep: Treaty[] = [];
  for (const t of world.treaties) {
    const gone = world.nations[t.a]?.eliminated || world.nations[t.b]?.eliminated;
    if (t.until < world.turn || gone) {
      if (t.until < world.turn) events.push({ kind: 'treaty_ended', treaty: t.kind, a: t.a, b: t.b, reason: 'expired' });
    } else keep.push(t);
  }
  world.treaties = keep;

  const declared = new Set<string>();
  for (const nation of sortedKeys(orders)) {
    for (const d of orders[nation]!.diplomacy) {
      if (d.action !== 'declare_war') continue;
      const key = pairKey(nation, d.target);
      if (declared.has(key)) continue;
      declared.add(key);
      const was = relationOf(world.relations, nation, d.target);
      world.relations[key] = 'war';
      events.push({ kind: 'diplomacy', a: nation, b: d.target, relation: 'war', proposedBy: nation, ...(was === 'peace' || was === 'alliance' ? { broke: was } : {}) });
      end(world, ['trade', 'nonaggression'], nation, d.target, 'war', events);
    }
  }

  for (const nation of sortedKeys(orders)) {
    for (const d of orders[nation]!.diplomacy) {
      if (d.action !== 'embargo') continue;
      end(world, ['trade'], nation, d.target, 'embargo', events);
      sign(world, 'embargo', nation, d.target, TREATIES.embargoTurns, events, nation);
    }
  }

  const KINDS: Record<string, ProposalKind> = { propose_peace: 'peace', propose_alliance: 'alliance', propose_nonaggression: 'nonaggression', propose_trade: 'trade' };
  const fresh: Proposal[] = [];
  for (const nation of sortedKeys(orders)) {
    for (const d of orders[nation]!.diplomacy) {
      const kind = KINDS[d.action];
      if (kind) fresh.push({ from: nation, to: d.target, kind, turn: world.turn });
    }
  }

  const stillValid = (p: Proposal) =>
    !declared.has(pairKey(p.from, p.to)) && !world.nations[p.from]!.eliminated && !world.nations[p.to]!.eliminated && canPropose(world, p.from, p.to, p.kind);
  const pending = world.proposals.filter((p) => world.turn - p.turn <= PROPOSAL_LIFETIME && stillValid(p));
  const all = [...pending, ...fresh.filter(stillValid)];
  const has = (from: NationId, to: NationId, kind: Proposal['kind']) => all.some((p) => p.from === from && p.to === to && p.kind === kind);

  const accepted = new Set<string>();
  for (const p of [...all].sort((a, b) => (pairKey(a.from, a.to) + a.kind < pairKey(b.from, b.to) + b.kind ? -1 : 1))) {
    const key = `${pairKey(p.from, p.to)}|${p.kind}`;
    if (accepted.has(key) || !has(p.to, p.from, p.kind) || !canPropose(world, p.from, p.to, p.kind)) continue;
    accepted.add(key);
    const [a, b] = p.from < p.to ? [p.from, p.to] : [p.to, p.from];
    if (p.kind === 'peace' || p.kind === 'alliance') {
      world.relations[pairKey(a, b)] = p.kind;
      events.push({ kind: 'diplomacy', a, b, relation: p.kind, proposedBy: a });
    } else {
      sign(world, p.kind, a, b, p.kind === 'nonaggression' ? TREATIES.nonaggressionTurns : TREATIES.tradeTurns, events);
    }
  }

  const remaining = all.filter((p) => !accepted.has(`${pairKey(p.from, p.to)}|${p.kind}`) && stillValid(p));
  for (const p of fresh) if (remaining.includes(p)) events.push({ kind: 'proposal', from: p.from, to: p.to, proposal: p.kind });
  // One pending proposal per direction and kind.
  const dedup = new Map<string, Proposal>();
  for (const p of remaining) {
    const k = `${p.from}>${p.to}|${p.kind}`;
    const cur = dedup.get(k);
    if (!cur || p.turn > cur.turn) dedup.set(k, p);
  }
  world.proposals = [...dedup.keys()].sort().map((k) => dedup.get(k)!);
  world.treaties.sort((x, y) => (x.a + x.b + x.kind < y.a + y.b + y.kind ? -1 : x.a + x.b + x.kind > y.a + y.b + y.kind ? 1 : x.from - y.from));
}
