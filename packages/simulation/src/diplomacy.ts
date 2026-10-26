import type { GameEvent, NationId, NationOrders, Proposal, WorldState } from '@brink/contracts';
import { pairKey, relationOf, sortedKeys } from './rules';

/** Pending proposals lapse after this many turns. */
const PROPOSAL_LIFETIME = 2;

/**
 * Phase 2. Declarations of war take effect at once. A peace or alliance takes effect when both
 * sides have proposed it, this turn or within the proposal's lifetime; who proposed first does
 * not matter. A pair that went to war this turn ignores proposals until next turn.
 */
export function resolveDiplomacy(world: WorldState, orders: Record<NationId, NationOrders>, events: GameEvent[]): void {
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
    }
  }

  const fresh: Proposal[] = [];
  for (const nation of sortedKeys(orders)) {
    for (const d of orders[nation]!.diplomacy) {
      if (d.action === 'declare_war') continue;
      fresh.push({ from: nation, to: d.target, kind: d.action === 'propose_peace' ? 'peace' : 'alliance', turn: world.turn });
    }
  }

  const stillValid = (p: Proposal) =>
    !declared.has(pairKey(p.from, p.to)) &&
    !world.nations[p.from]!.eliminated &&
    !world.nations[p.to]!.eliminated &&
    relationOf(world.relations, p.from, p.to) === (p.kind === 'peace' ? 'war' : 'peace');
  const pending = world.proposals.filter((p) => world.turn - p.turn <= PROPOSAL_LIFETIME && stillValid(p));
  const all = [...pending, ...fresh.filter(stillValid)];
  const has = (from: NationId, to: NationId, kind: Proposal['kind']) => all.some((p) => p.from === from && p.to === to && p.kind === kind);

  const accepted = new Set<string>();
  for (const p of [...all].sort((a, b) => (pairKey(a.from, a.to) + a.kind < pairKey(b.from, b.to) + b.kind ? -1 : 1))) {
    const key = `${pairKey(p.from, p.to)}|${p.kind}`;
    if (accepted.has(key) || !has(p.to, p.from, p.kind)) continue;
    accepted.add(key);
    const relation = p.kind === 'peace' ? 'peace' : 'alliance';
    world.relations[pairKey(p.from, p.to)] = relation;
    const [a, b] = p.from < p.to ? [p.from, p.to] : [p.to, p.from];
    events.push({ kind: 'diplomacy', a, b, relation, proposedBy: a });
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
}
