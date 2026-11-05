import type { DealTerms, DiplomaticAction, GameEvent, NationId, NationOrders, NationView, Proposal, ProposalKind, Relation, SiteId, Stockpile, Treaty, TreatyKind, WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { LEADER_TUNING, PASSAGE, TREATIES } from '@brink/game-data';
import { facilityCost } from './progression';
import { pairKey, recruitCost, relationOf, sortedKeys, treatyIn } from './rules';

/** Pending proposals lapse after this many turns. */
export const PROPOSAL_LIFETIME = 2;

/** The proposal each offering action makes. Tribute is one kind: a demand and the payment that meets it. */
export const PROPOSAL_OF: Partial<Record<DiplomaticAction, ProposalKind>> = {
  propose_peace: 'peace',
  propose_alliance: 'alliance',
  propose_nonaggression: 'nonaggression',
  propose_trade: 'trade',
  propose_ceasefire: 'ceasefire',
  propose_exchange: 'exchange',
  demand_tribute: 'tribute',
  pay_tribute: 'tribute',
  propose_joint_op: 'joint_op',
  propose_passage: 'passage',
};

/** The terms the other side offers to agree to `t`: what one gives the other gets. */
export function mirrorTerms(t: DealTerms | undefined): DealTerms | undefined {
  if (!t) return undefined;
  const out: DealTerms = {};
  if (t.get) out.give = { ...t.get };
  if (t.give) out.get = { ...t.give };
  if (t.against) out.against = t.against;
  if (t.site) out.site = t.site;
  return out;
}

/** The order that answers `p` in kind: a payment meets a demand, anything else is offered back. */
export function answerTo(p: Pick<Proposal, 'from' | 'kind' | 'terms'>): { target: NationId; action: DiplomaticAction; terms?: DealTerms } {
  const terms = mirrorTerms(p.terms);
  const action: DiplomaticAction =
    p.kind === 'tribute' ? (stockTotal(p.terms?.get) > 0 ? 'pay_tribute' : 'demand_tribute') : (Object.keys(PROPOSAL_OF) as DiplomaticAction[]).find((a) => PROPOSAL_OF[a] === p.kind)!;
  return { target: p.from, action, ...(terms ? { terms } : {}) };
}

/** Total of a partial stockpile. */
export function stockTotal(s: Partial<Stockpile> | undefined): number {
  return s ? RESOURCES.reduce((a, r) => a + (s[r] ?? 0), 0) : 0;
}

function sameStock(a: Partial<Stockpile> | undefined, b: Partial<Stockpile> | undefined): boolean {
  return RESOURCES.every((r) => (a?.[r] ?? 0) === (b?.[r] ?? 0));
}

/** Whether `q` answers `p`: the reverse direction, the same kind, the mirrored terms. */
export function mirrors(p: Pick<Proposal, 'from' | 'to' | 'kind' | 'terms'>, q: Pick<Proposal, 'from' | 'to' | 'kind' | 'terms'>): boolean {
  if (q.from !== p.to || q.to !== p.from || q.kind !== p.kind) return false;
  if (p.kind === 'exchange' || p.kind === 'tribute') return sameStock(p.terms?.give, q.terms?.get) && sameStock(p.terms?.get, q.terms?.give);
  // An alliance, a joint operation or a right of passage may carry a sweetener: what one hands over
  // the other receives.
  const sweet = sameStock(p.terms?.give, q.terms?.get) && sameStock(p.terms?.get, q.terms?.give);
  if (p.kind === 'alliance' || p.kind === 'passage') return (p.terms?.against ?? null) === (q.terms?.against ?? null) && sweet;
  if (p.kind === 'joint_op') return p.terms?.site === q.terms?.site && sweet;
  return true;
}

/** What `action` hands over from the stockpile of the nation that orders it (reserved like a recruit's cost). */
export function dealGives(action: DiplomaticAction, terms: DealTerms | undefined): Partial<Stockpile> {
  return action === 'propose_exchange' || action === 'pay_tribute' || action === 'propose_alliance' || action === 'propose_joint_op' || action === 'propose_passage' ? (terms?.give ?? {}) : {};
}

/**
 * Why a deal's terms are malformed for `action`, or null. Amounts are whole, at least zero and at
 * most `LEADER_TUNING.dealMax` of a resource; an exchange names both sides, a demand only what it
 * asks, a payment only what it hands over, a joint operation its prize.
 */
export function termsProblem(action: DiplomaticAction, terms: DealTerms | undefined): string | null {
  const stock = (s: Partial<Stockpile> | undefined): string | null => {
    if (s === undefined) return null;
    if (!s || typeof s !== 'object') return 'malformed terms';
    for (const [k, v] of Object.entries(s)) {
      if (!(RESOURCES as readonly string[]).includes(k)) return `unknown resource ${k}`;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > LEADER_TUNING.dealMax) return `a deal moves 0 to ${LEADER_TUNING.dealMax} of a resource`;
    }
    return null;
  };
  if (terms !== undefined && (!terms || typeof terms !== 'object')) return 'malformed terms';
  const bad = stock(terms?.give) ?? stock(terms?.get);
  if (bad) return bad;
  const give = stockTotal(terms?.give);
  const get = stockTotal(terms?.get);
  switch (action) {
    case 'propose_exchange':
      return give > 0 && get > 0 ? null : 'an exchange gives something and asks for something';
    case 'demand_tribute':
      return get > 0 && give === 0 ? null : 'a demand names only what it asks for';
    case 'pay_tribute':
      return give > 0 && get === 0 ? null : 'a payment names only what it hands over';
    case 'propose_joint_op':
      return typeof terms?.site === 'string' ? null : 'a joint operation names its prize';
    case 'propose_alliance':
    case 'propose_passage':
      return terms?.against === undefined || typeof terms.against === 'string' ? null : 'malformed terms';
    default:
      return null;
  }
}

/** Only the parts of `terms` that `action` uses, copied; undefined when it uses none. */
export function cleanTerms(action: DiplomaticAction, terms: DealTerms | undefined): DealTerms | undefined {
  if (!terms) return undefined;
  const pick = (s: Partial<Stockpile> | undefined): Partial<Stockpile> | undefined => {
    if (!s) return undefined;
    const out: Partial<Stockpile> = {};
    for (const r of RESOURCES) if ((s[r] ?? 0) > 0) out[r] = s[r]!;
    return Object.keys(out).length ? out : undefined;
  };
  const give = pick(terms.give);
  const get = pick(terms.get);
  switch (action) {
    case 'propose_exchange':
      return { ...(give ? { give } : {}), ...(get ? { get } : {}) };
    case 'demand_tribute':
      return get ? { get } : undefined;
    case 'pay_tribute':
      return give ? { give } : undefined;
    case 'propose_joint_op':
    case 'propose_alliance':
    case 'propose_passage': {
      // The prize, the common enemy or whom the passage is for, and any sweetener either way.
      const out: DealTerms = { ...(action === 'propose_joint_op' && terms.site ? { site: terms.site } : {}), ...(action !== 'propose_joint_op' && terms.against ? { against: terms.against } : {}), ...(give ? { give } : {}), ...(get ? { get } : {}) };
      return Object.keys(out).length ? out : undefined;
    }
    default:
      return undefined;
  }
}

/** A view's public facts in the shape diplomacy reads: every pair's relation, the treaties, the sites as last seen. */
export function diplomacyWorldOf(view: NationView): DiplomacyWorld & { nations: NationView['nations'] } {
  const relations: Record<string, Relation> = { ...(view.publicRelations ?? {}) };
  for (const n of sortedKeys(view.relations)) relations[pairKey(view.self.id, n)] = view.relations[n]!;
  return { relations, treaties: view.treaties, turn: view.turn, nations: view.nations, sites: view.sites, tiles: view.tiles };
}

/** What diplomacy reads: a world, or a view's public facts recast as one. */
export type DiplomacyWorld = Pick<WorldState, 'relations' | 'treaties' | 'turn'> & {
  nations?: Record<NationId, { eliminated: boolean; minor?: boolean }>;
  sites?: Record<SiteId, { owner: NationId | null; key: string }>;
  /** A view's tiles: a joint operation is only offered on a prize seen now (its holder may have changed). */
  tiles?: Record<string, { key: string; visibility?: 'visible' | 'observed' | 'unknown' }>;
};

/**
 * Why a joint operation between `from` and `to` on `site` cannot be agreed, as a code, or null.
 * The prize is a third power's; the two are not at war with each other; at least one of them
 * already fights its holder (the other goes to war on signing, as an alliance against a power does);
 * neither is bound by a pact or ceasefire with the holder.
 */
export function jointOpProblem(world: DiplomacyWorld, from: NationId, to: NationId, site: SiteId | undefined): 'no_prize' | 'not_third' | 'partners_at_war' | 'neither_at_war' | 'bound' | null {
  const owner = site ? world.sites?.[site]?.owner : undefined;
  if (!site || !world.sites?.[site]) return 'no_prize';
  if (!owner || owner === from || owner === to || world.nations?.[owner]?.eliminated) return 'not_third';
  if (relationOf(world.relations, from, to) === 'war') return 'partners_at_war';
  if (bindingTreaty(world, from, owner) || bindingTreaty(world, to, owner)) return 'bound';
  if (relationOf(world.relations, from, owner) !== 'war' && relationOf(world.relations, to, owner) !== 'war') return 'neither_at_war';
  return null;
}

/** A treaty in force between `a` and `b` that forbids war: a non-aggression pact or a ceasefire. */
export function bindingTreaty(world: Pick<WorldState, 'treaties' | 'turn'>, a: NationId, b: NationId): Treaty | undefined {
  return treatyIn(world.treaties, 'nonaggression', a, b, world.turn) ?? treatyIn(world.treaties, 'ceasefire', a, b, world.turn);
}

/**
 * Whether `from` may still offer `kind` to `to`: peace or a ceasefire needs a war, an alliance or a
 * pact needs peace, trade and exchanges need no war and no embargo, a demand needs peace. A pact,
 * trade or joint operation already running cannot be offered again until its last turn (an offer
 * then renews it). An alliance against a common enemy needs no war between the two and no pact or
 * ceasefire with the enemy; a joint operation needs one of the two at war with the prize's holder
 * and neither bound to it by a pact or ceasefire (`jointOpProblem`).
 */
export function canPropose(world: DiplomacyWorld, from: NationId, to: NationId, kind: ProposalKind, terms?: DealTerms): boolean {
  const rel = relationOf(world.relations, from, to);
  function running(k: TreatyKind): boolean {
    const t = treatyIn(world.treaties, k, from, to, world.turn);
    return !!t && t.until > world.turn;
  }
  switch (kind) {
    case 'peace':
    case 'ceasefire':
      return rel === 'war';
    case 'alliance': {
      const x = terms?.against;
      if (x === undefined) return rel === 'peace';
      const foe = world.nations?.[x];
      if (x === from || x === to || (world.nations && (!foe || foe.eliminated || foe.minor))) return false;
      return rel !== 'war' && !bindingTreaty(world, from, x) && !bindingTreaty(world, to, x);
    }
    case 'nonaggression':
      return rel === 'peace' && !running('nonaggression');
    case 'trade':
      return rel !== 'war' && !treatyIn(world.treaties, 'embargo', from, to, world.turn) && !running('trade');
    case 'exchange':
      return rel !== 'war' && !treatyIn(world.treaties, 'embargo', from, to, world.turn);
    case 'tribute':
      return rel === 'peace';
    // Allies already share their ground: passage is between powers merely at peace.
    case 'passage':
      return rel === 'peace' && !running('passage');
    case 'joint_op':
      return !jointOpProblem(world, from, to, terms?.site) && !running('joint_op');
  }
}

function sign(world: WorldState, kind: TreatyKind, a: NationId, b: NationId, turns: number, events: GameEvent[], by?: NationId, site?: SiteId): void {
  const [x, y] = a < b ? [a, b] : [b, a];
  world.treaties = world.treaties.filter((t) => !(t.kind === kind && t.a === x && t.b === y));
  const t: Treaty = { kind, a: x, b: y, from: world.turn, until: world.turn + turns - 1, ...(by ? { by } : {}), ...(site ? { site } : {}) };
  world.treaties.push(t);
  events.push({ kind: 'treaty', treaty: kind, a: x, b: y, until: t.until, ...(by ? { by } : {}), ...(site ? { site } : {}) });
}

function end(world: WorldState, kinds: readonly TreatyKind[], a: NationId, b: NationId, reason: 'war' | 'embargo', events: GameEvent[]): void {
  const [x, y] = a < b ? [a, b] : [b, a];
  for (const t of world.treaties) {
    if (t.a === x && t.b === y && kinds.includes(t.kind) && t.until >= world.turn) events.push({ kind: 'treaty_ended', treaty: t.kind, a: x, b: y, reason });
  }
  world.treaties = world.treaties.filter((t) => !(t.a === x && t.b === y && kinds.includes(t.kind)));
}

/** War between `declarer` and `target`, at once: it ends trade and any pact, truce or joint operation between them. */
function goToWar(world: WorldState, declarer: NationId, target: NationId, events: GameEvent[]): void {
  const was = relationOf(world.relations, declarer, target);
  world.relations[pairKey(declarer, target)] = 'war';
  events.push({ kind: 'diplomacy', a: declarer, b: target, relation: 'war', proposedBy: declarer, ...(was === 'peace' || was === 'alliance' ? { broke: was } : {}) });
  end(world, ['trade', 'nonaggression', 'ceasefire', 'joint_op', 'passage'], declarer, target, 'war', events);
}

/** Hand over what each side agreed to give, if both still can: all or nothing. */
function settleDeal(world: WorldState, p: Proposal, events: GameEvent[], committed: Record<NationId, Stockpile>): void {
  const tribute = p.kind === 'tribute';
  // `a` hands over `aGives`: the proposer's `give`, or the payer of a demand.
  const demand = tribute && stockTotal(p.terms?.get) > 0;
  const a = demand ? p.to : p.from;
  const b = demand ? p.from : p.to;
  const aGives: Partial<Stockpile> = { ...(demand ? p.terms?.get : p.terms?.give) };
  const bGives: Partial<Stockpile> = demand ? {} : { ...p.terms?.get };
  const sa = world.nations[a]!.stockpile;
  const sb = world.nations[b]!.stockpile;
  // What this turn's recruits and buildings already hold is not on offer: a deal agreed on an
  // earlier turn settles now, after validation reserved those costs, and may not spend them.
  const ca = committed[a];
  const cb = committed[b];
  const can = RESOURCES.every((r) => sa[r] - (ca?.[r] ?? 0) >= (aGives[r] ?? 0) && sb[r] - (cb?.[r] ?? 0) >= (bGives[r] ?? 0));
  if (can) {
    for (const r of RESOURCES) {
      sa[r] += (bGives[r] ?? 0) - (aGives[r] ?? 0);
      sb[r] += (aGives[r] ?? 0) - (bGives[r] ?? 0);
    }
  }
  events.push({ kind: 'exchange', a, b, aGave: aGives, bGave: bGives, ...(tribute ? { tribute: true as const } : {}), ...(can ? {} : { void: true as const }) });
}

/** Pay an alliance's, joint operation's or passage's sweetener, if it has one, told from the side of the one who pays. */
function sweeten(world: WorldState, p: Proposal, events: GameEvent[], committed: Record<NationId, Stockpile>): void {
  if (stockTotal(p.terms?.give) + stockTotal(p.terms?.get) === 0) return;
  const payer = stockTotal(p.terms?.give) > 0 ? p : { ...p, from: p.to, to: p.from, ...(p.terms ? { terms: mirrorTerms(p.terms)! } : {}) };
  settleDeal(world, payer, events, committed);
}

/** A deep copy of terms: they ride in events and proposals and are never shared. */
function copyTerms(t: DealTerms): DealTerms {
  return JSON.parse(JSON.stringify(t)) as DealTerms;
}

/**
 * Phase 2, in this order:
 * 1. Treaties past their last turn lapse, and any with an eliminated party go.
 * 2. Declarations of war take effect at once and end trade (and, defensively, any pact, ceasefire
 *    or joint operation) between the two. Validation already refuses war on a pact or ceasefire
 *    partner, so both are binding.
 * 3. Embargoes take effect at once: trade between the two ends and is barred while it lasts.
 * 4. A demand that waited its whole lifetime unpaid lapses: an ultimatum defied.
 * 5. Proposals: anything agreed takes effect when both sides have offered it in kind (mirrored
 *    terms), this turn or within the offer's lifetime; who offered first does not matter. A pair that
 *    went to war this turn ignores offers until next turn. Peace and alliances change the relation
 *    (an alliance against a common enemy takes both to war with it), a ceasefire makes peace and
 *    binds it for a few turns, exchanges and tribute move resources at once (all or nothing), the
 *    rest are timed treaties. Everything agreed is in force from this turn's resolution on.
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
      goToWar(world, nation, d.target, events);
    }
  }

  for (const nation of sortedKeys(orders)) {
    for (const d of orders[nation]!.diplomacy) {
      if (d.action !== 'embargo') continue;
      end(world, ['trade'], nation, d.target, 'embargo', events);
      sign(world, 'embargo', nation, d.target, TREATIES.embargoTurns, events, nation);
    }
  }

  // Each nation's recruits and buildings this turn, paid in production after diplomacy.
  const committed: Record<NationId, Stockpile> = {};
  for (const nation of sortedKeys(orders)) {
    const n = world.nations[nation];
    if (!n) continue;
    const c: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
    for (const r of orders[nation]!.recruit) {
      const cost = recruitCost(n, r.unitClass);
      for (const res of RESOURCES) c[res] += cost[res];
    }
    for (const b of orders[nation]!.build ?? []) {
      const cost = facilityCost(n, b.facility);
      for (const res of RESOURCES) c[res] += cost[res];
    }
    committed[nation] = c;
  }

  const fresh: Proposal[] = [];
  for (const nation of sortedKeys(orders)) {
    for (const d of orders[nation]!.diplomacy) {
      const kind = PROPOSAL_OF[d.action];
      if (kind) fresh.push({ from: nation, to: d.target, kind, turn: world.turn, ...(d.terms ? { terms: copyTerms(d.terms) } : {}) });
    }
  }

  const stillValid = (p: Proposal) =>
    !declared.has(pairKey(p.from, p.to)) && !world.nations[p.from]!.eliminated && !world.nations[p.to]!.eliminated && canPropose(world, p.from, p.to, p.kind, p.terms);
  for (const p of world.proposals) {
    if (world.turn - p.turn > PROPOSAL_LIFETIME && p.kind === 'tribute' && stockTotal(p.terms?.get) > 0 && stillValid(p)) {
      events.push({ kind: 'proposal_lapsed', from: p.from, to: p.to, proposal: p.kind, ...(p.terms ? { terms: copyTerms(p.terms) } : {}) });
    }
  }
  const pending = world.proposals.filter((p) => world.turn - p.turn <= PROPOSAL_LIFETIME && stillValid(p));
  const all = [...pending, ...fresh.filter(stillValid)];
  const answered = (p: Proposal) => all.some((q) => mirrors(p, q));

  const accepted = new Set<string>();
  const dealKey = (p: Proposal) => `${pairKey(p.from, p.to)}|${p.kind}`;
  const order = (x: Proposal, y: Proposal) => {
    const kx = dealKey(x);
    const ky = dealKey(y);
    return kx < ky ? -1 : kx > ky ? 1 : x.from < y.from ? -1 : x.from > y.from ? 1 : y.turn - x.turn;
  };
  for (const p of [...all].sort(order)) {
    const key = dealKey(p);
    // A pair this turn's signing took to war (an alliance against one of them, a joint operation
    // on its city) ignores offers until next turn, as one that declared does.
    if (accepted.has(key) || declared.has(pairKey(p.from, p.to)) || !answered(p) || !canPropose(world, p.from, p.to, p.kind, p.terms)) continue;
    accepted.add(key);
    const [a, b] = p.from < p.to ? [p.from, p.to] : [p.to, p.from];
    switch (p.kind) {
      case 'peace':
      case 'alliance': {
        world.relations[pairKey(a, b)] = p.kind;
        events.push({ kind: 'diplomacy', a, b, relation: p.kind, proposedBy: a });
        // An alliance against a common enemy: whichever partner is not yet at war with it goes to war.
        const x = p.kind === 'alliance' ? p.terms?.against : undefined;
        if (x) {
          for (const n of [a, b]) {
            if (relationOf(world.relations, n, x) === 'war') continue;
            declared.add(pairKey(n, x));
            goToWar(world, n, x, events);
          }
        }
        if (p.kind === 'alliance') sweeten(world, p, events, committed);
        break;
      }
      case 'ceasefire':
        world.relations[pairKey(a, b)] = 'peace';
        events.push({ kind: 'diplomacy', a, b, relation: 'peace', proposedBy: a });
        sign(world, 'ceasefire', a, b, LEADER_TUNING.ceasefireTurns, events);
        break;
      case 'exchange':
      case 'tribute':
        settleDeal(world, p, events, committed);
        break;
      case 'joint_op': {
        // Whichever partner is not yet at war with the prize's holder goes to war (perfidy applies).
        const holder = world.sites[p.terms!.site!]!.owner!;
        for (const n of [a, b]) {
          if (relationOf(world.relations, n, holder) === 'war') continue;
          declared.add(pairKey(n, holder));
          goToWar(world, n, holder, events);
        }
        sign(world, 'joint_op', a, b, LEADER_TUNING.jointOpTurns, events, undefined, p.terms!.site!);
        sweeten(world, p, events, committed);
        break;
      }
      case 'passage':
        sign(world, 'passage', a, b, PASSAGE.turns, events);
        sweeten(world, p, events, committed);
        break;
      case 'nonaggression':
      case 'trade':
        sign(world, p.kind, a, b, p.kind === 'nonaggression' ? TREATIES.nonaggressionTurns : TREATIES.tradeTurns, events);
        break;
    }
  }

  const remaining = all.filter((p) => !accepted.has(dealKey(p)) && stillValid(p));
  for (const p of fresh) if (remaining.includes(p)) events.push({ kind: 'proposal', from: p.from, to: p.to, proposal: p.kind, ...(p.terms ? { terms: copyTerms(p.terms) } : {}) });
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

/**
 * Phase 11c, before memories: a joint operation whose prize one of its partners now holds is
 * fulfilled and ends.
 */
export function resolveJointOps(world: WorldState, events: GameEvent[]): void {
  const done = world.treaties.filter((t) => t.kind === 'joint_op' && !!t.site && (world.sites[t.site]?.owner === t.a || world.sites[t.site]?.owner === t.b));
  if (done.length === 0) return;
  for (const t of done) events.push({ kind: 'treaty_ended', treaty: 'joint_op', a: t.a, b: t.b, reason: 'fulfilled' });
  world.treaties = world.treaties.filter((t) => !done.includes(t));
}
