import type { AiMemory, DealTerms, DiplomacyOrder, NationId, NationOrders, NationView, ProposalKind, Relation, Resource, SiteId, Stockpile } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { FACILITIES, LEADER_TUNING, leaderFor, type LineTrigger } from '@brink/game-data';
import { accordOpen, answerTo, bindingTreaty, checkDiplomacy, mirrors, pairKey, PROPOSAL_OF, recruitCost, sortedKeys, stockTotal, treatyIn } from '@brink/simulation';

// The leaders' side of the AI: how a rival's head of government answers an offer, what deals they
// seek themselves, and the restraint their mood puts on the war plan. Sees only its own NationView
// (its attitudes ride in it) and its memory. The same `consider` answers a human in the diplomacy
// screen at once and again when the turn resolves, so a leader who says yes signs.

const AI = LEADER_TUNING.ai;

/** An offer made to this leader: what it is, from whom, on what terms. */
export interface Offer {
  from: NationId;
  kind: ProposalKind;
  terms?: DealTerms;
}

/** Why a leader answered as they did; the screen turns it into one of their lines. */
export type VerdictReason = 'agreed' | 'mood' | 'terms' | 'strength' | 'focus' | 'cannot';

export interface Verdict {
  accept: boolean;
  reason: VerdictReason;
}

/** The line trigger a verdict speaks with. */
export function verdictLine(v: Verdict): LineTrigger {
  if (v.accept) return 'accept';
  return v.reason === 'strength' ? 'reject_strength' : v.reason === 'terms' || v.reason === 'cannot' ? 'reject_terms' : 'reject_mood';
}

export interface LeaderOptions {
  /** Nations (humans on Easy) this leader never starts a war with and always grants peace. */
  spare?: readonly NationId[];
  /** Offers made to this nation this turn, not yet in its view: the human's orders as they end the turn. */
  incoming?: readonly Offer[];
  /** A prize the army is ordered onto (an operation): its holder is the focus, whatever memory says. */
  target?: SiteId;
}

/** The offer a diplomatic order makes to its target, or null for war and embargoes. */
export function offerOf(from: NationId, d: DiplomacyOrder): Offer | null {
  const kind = PROPOSAL_OF[d.action];
  return kind ? { from, kind, ...(d.terms ? { terms: d.terms } : {}) } : null;
}

/** The view's public facts in the shape the engine's diplomacy checks read. */
function asWorld(view: NationView) {
  const relations: Record<string, Relation> = {};
  for (const n of sortedKeys(view.relations)) relations[pairKey(view.self.id, n)] = view.relations[n]!;
  return { relations, treaties: view.treaties, turn: view.turn, nations: view.nations, sites: view.sites, tiles: view.tiles, ...(view.blackFiles ? { blackFiles: view.blackFiles } : {}) };
}

/** Whether `n` has signed the Accord (Black Files). */
function inAccord(view: NationView, n: NationId): boolean {
  return !!view.blackFiles?.accord.includes(n);
}

function powers(view: NationView): NationId[] {
  return sortedKeys(view.nations).filter((n) => n !== view.self.id && !view.nations[n]!.eliminated && !view.nations[n]!.minor);
}

const moodOf = (view: NationView, n: NationId) => view.attitudes?.[n]?.mood ?? 0;
const standing = (view: NationView, n: NationId) => view.supremacy[n] ?? 0;

/** What `amount` of resource `r` is worth to this nation: dear when short, cheap when plentiful. */
function worth(view: NationView, s: Partial<Stockpile> | undefined): number {
  let total = 0;
  for (const r of RESOURCES) {
    const a = s?.[r] ?? 0;
    if (!a) continue;
    const have = view.self.stockpile[r];
    total += a * (have < 120 ? 200 : have > 500 ? 50 : 100);
  }
  return total;
}

/** The site this nation's army marches on (its memory's objective), and whose it is. */
function focusOf(view: NationView, memory: AiMemory, opts: LeaderOptions = {}): NationId | null {
  const id = opts.target ?? memory.objective;
  const s = id ? view.sites[id] : undefined;
  return s?.owner && s.owner !== view.self.id ? s.owner : null;
}

/**
 * How this leader answers `offer`. Pure: the same view, memory and offer always give the same
 * answer. It first checks the answer is one the engine would take (legal, affordable), then weighs
 * mood, temperament, the war and the terms.
 */
export function consider(view: NationView, memory: AiMemory, offer: Offer, opts: LeaderOptions = {}): Verdict {
  const self = view.self.id;
  const from = offer.from;
  const them = view.nations[from];
  if (!them || from === self || them.eliminated || them.minor || view.self.minor) return { accept: false, reason: 'cannot' };
  const answer = answerTo({ from, kind: offer.kind, ...(offer.terms ? { terms: offer.terms } : {}) });
  if (checkDiplomacy(asWorld(view), self, from, answer.action, answer.terms)) return { accept: false, reason: 'cannot' };
  const give = answer.action === 'propose_exchange' || answer.action === 'pay_tribute' ? answer.terms?.give : undefined;
  if (RESOURCES.some((r) => (give?.[r] ?? 0) > view.self.stockpile[r])) return { accept: false, reason: 'cannot' };

  const leader = leaderFor(self, view.self.government);
  const temper = leader.temperament;
  const mood = moodOf(view, from);
  const focus = focusOf(view, memory, opts);
  const enemies = powers(view).filter((n) => view.relations[n] === 'war');
  const losing = standing(view, self) + 5 < standing(view, from) || view.self.stability < 30;
  const yes: Verdict = { accept: true, reason: 'agreed' };

  switch (offer.kind) {
    case 'peace':
    case 'ceasefire': {
      if (opts.spare?.includes(from)) return yes;
      // An operation ordered onto their city is not called off by a peace offer.
      if (from === focus && opts.target) return { accept: false, reason: 'focus' };
      if (from === focus && !losing && standing(view, self) >= standing(view, from)) return { accept: false, reason: 'focus' };
      const score =
        mood + (enemies.length > 1 ? 30 : 0) + (losing ? 30 : 0) + (from !== focus ? 15 : 0) + (temper === 'dove' ? 15 : temper === 'hawk' ? -10 : 0);
      return score >= 10 ? yes : { accept: false, reason: 'mood' };
    }
    case 'alliance': {
      const x = offer.terms?.against;
      if (!x) return mood >= AI.allianceMood ? yes : { accept: false, reason: 'mood' };
      if (mood < AI.allianceMood - 10) return { accept: false, reason: 'mood' };
      const hate = view.relations[x] === 'war' || moodOf(view, x) <= -20;
      if (!hate) return { accept: false, reason: 'mood' };
      return standing(view, x) <= standing(view, self) + standing(view, from) ? yes : { accept: false, reason: 'strength' };
    }
    case 'nonaggression':
      if (opts.spare?.includes(from)) return yes;
      // A power pulling ahead of us asks for a pact to keep us off it while it wins: no.
      if (standing(view, from) >= standing(view, self) + AI.pactGap) return { accept: false, reason: 'strength' };
      return mood >= AI.pactMood && from !== focus ? yes : { accept: false, reason: from === focus ? 'focus' : 'mood' };
    case 'trade':
      return mood >= AI.tradeMood ? yes : { accept: false, reason: 'mood' };
    case 'exchange': {
      if (mood < AI.sulkMood) return { accept: false, reason: 'mood' };
      // What they hand over against what they ask, at this leader's prices; a warm leader asks less.
      const gets = worth(view, offer.terms?.give);
      const gives = worth(view, offer.terms?.get);
      const margin = Math.max(80, AI.exchangeMargin - Math.trunc(mood / 4));
      return gets * 100 >= gives * margin ? yes : { accept: false, reason: 'terms' };
    }
    case 'tribute': {
      // Paid to us: always welcome.
      if (stockTotal(offer.terms?.give) > 0) return yes;
      const asked = offer.terms?.get ?? {};
      if (RESOURCES.some((r) => (asked[r] ?? 0) * 100 > view.self.stockpile[r] * AI.tributeShare)) return { accept: false, reason: 'terms' };
      const gap = standing(view, from) - standing(view, self) + (enemies.length > 0 ? 5 : 0);
      const need = temper === 'hawk' ? AI.tributeGap * 2 : AI.tributeGap;
      return gap >= need ? yes : { accept: false, reason: 'strength' };
    }
    case 'joint_op':
      return mood >= AI.jointOpMood ? yes : { accept: false, reason: 'mood' };
    // Black Files: against the Visitors almost anyone will sign; only a leader who detests you will not.
    case 'accord':
      return mood > AI.accordMood ? yes : { accept: false, reason: 'mood' };
  }
}

/** The prize of a joint operation this nation is in, if any: its army marches on it. */
export function jointOpTarget(view: NationView): SiteId | undefined {
  const self = view.self.id;
  const t = view.treaties.find((x) => x.kind === 'joint_op' && (x.a === self || x.b === self) && x.site && view.sites[x.site]?.owner !== self);
  return t?.site;
}

/** A small, regular ask: grows with the war, capped. */
function tributeAsk(view: NationView): Partial<Stockpile> {
  return { credits: Math.min(160, 50 + view.turn * 4) };
}

/**
 * The leader's hand on the turn's diplomacy, given the war plan's own `planned` orders:
 * 1. Answers every offer made to it (this turn's from humans, and those pending), yes or no.
 * 2. Seeks its own deals where nothing else is planned: a ceasefire when a war goes badly, an
 *    exchange for what it lacks, a joint operation with a friend, a hawk's ultimatum to a weaker
 *    power, and war on one who defied it.
 * 3. Restrains the plan: no war a treaty forbids, no war a dove's warmth forbids, no treaty with a
 *    power it detests, nothing it just refused offered back.
 * Every order it returns is checked as the engine checks it; deals it hands over make room by
 * dropping recruits and buildings, so nothing is rejected.
 */
export function leaderDiplomacy(view: NationView, memory: AiMemory, planned: NationOrders, opts: LeaderOptions = {}): NationOrders {
  if (view.self.minor) return planned;
  const self = view.self.id;
  const world = asWorld(view);
  const leader = leaderFor(self, view.self.government);
  const temper = leader.temperament;
  const spare = opts.spare ?? [];

  // 1. Answers. This turn's offers first (the answer given in the screen is final), then the ones
  // waiting (where the war plan's own wish to agree carries the day).
  const offers: { offer: Offer; fresh: boolean }[] = (opts.incoming ?? []).map((offer) => ({ offer, fresh: true }));
  for (const p of view.proposals) if (p.to === self) offers.push({ offer: { from: p.from, kind: p.kind, ...(p.terms ? { terms: p.terms } : {}) }, fresh: false });
  const kindOf = (d: DiplomacyOrder) => PROPOSAL_OF[d.action];
  const answers: DiplomacyOrder[] = [];
  const refused = new Set<string>();
  const seen = new Set<string>();
  for (const { offer: o, fresh } of offers) {
    const key = `${o.from}|${o.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const asProposal = { from: o.from, to: self, kind: o.kind, ...(o.terms ? { terms: o.terms } : {}) };
    // Already answered in kind by an offer of ours still waiting: the engine will match it.
    if (view.proposals.some((p) => p.from === self && mirrors(asProposal, p))) continue;
    const v = consider(view, memory, o, opts);
    if (v.accept) answers.push(answerTo(asProposal));
    else if (fresh) refused.add(key);
  }

  // 3. Restraint on the plan.
  const restrained = planned.diplomacy.filter((d) => {
    const mood = moodOf(view, d.target);
    if (d.action === 'declare_war') {
      if (bindingTreaty(view, self, d.target)) return false;
      // The AI keeps the Accord: betrayal is a human's play.
      if (inAccord(view, self) && inAccord(view, d.target)) return false;
      if (temper === 'dove' && mood >= AI.doveRestraint) return false;
      return true;
    }
    const kind = kindOf(d);
    if (kind && refused.has(`${d.target}|${kind}`)) return false;
    // No peace, truce or pact with the power an ordered operation marches on.
    if (opts.target && d.target === focusOf(view, memory, opts) && (kind === 'peace' || kind === 'ceasefire' || kind === 'nonaggression')) return false;
    if ((d.action === 'propose_trade' || d.action === 'propose_nonaggression') && mood < AI.sulkMood) return false;
    return true;
  });

  // 2. Initiatives, only toward powers nothing else is planned for; at most one of each kind a turn.
  const taken = new Set([...answers, ...restrained].map((d) => d.target));
  const own: DiplomacyOrder[] = [];
  const pendingOwn = (n: NationId, kind: ProposalKind) => view.proposals.some((p) => p.from === self && p.to === n && p.kind === kind);
  const enemies = powers(view).filter((n) => view.relations[n] === 'war');
  // Free powers, the friendliest first.
  const free = powers(view)
    .filter((n) => !taken.has(n))
    .sort((a, b) => moodOf(view, b) - moodOf(view, a) || (a < b ? -1 : 1));
  const add = (d: DiplomacyOrder) => {
    if (!own.some((x) => x.target === d.target || x.action === d.action)) own.push(d);
  };
  // Black Files: once they have woken, the friendliest power not yet in the Accord with us is asked to sign.
  const bf = view.blackFiles;
  if (bf?.awake) {
    const ask = free.find((n) => accordOpen(bf, self, n) && !pendingOwn(n, 'accord') && moodOf(view, n) > AI.accordMood);
    if (ask) add({ target: ask, action: 'propose_accord' });
  }
  const defiedRecently = (n: NationId) => (view.attitudes?.[n]?.reasons ?? []).some((r) => r.id === 'defied' && r.value <= Math.trunc((LEADER_TUNING.memory.defied.weight * 110) / 100));
  for (const n of free) {
    const rel = view.relations[n];
    const mood = moodOf(view, n);
    if (rel === 'war') {
      // A war going badly against a power we are not marching on: a dove or an opportunist asks for a ceasefire.
      const losingBadly = standing(view, self) + AI.ceasefireGap <= standing(view, n);
      if (view.turn >= AI.ceasefireFromTurn && temper !== 'hawk' && losingBadly && n !== focusOf(view, memory, opts) && mood >= -70 && !pendingOwn(n, 'ceasefire') && !pendingOwn(n, 'peace')) {
        add({ target: n, action: 'propose_ceasefire' });
      }
      continue;
    }
    // Defied: a hawk answers with war, when it is free to.
    if (temper === 'hawk' && !spare.includes(n) && defiedRecently(n) && enemies.length < 2 && !bindingTreaty(view, self, n) && !(inAccord(view, self) && inAccord(view, n))) {
      add({ target: n, action: 'declare_war' });
      continue;
    }
    // An ultimatum to a much weaker power at peace: hawks and opportunists, now and then.
    const pressing = temper !== 'dove' && !spare.includes(n) && rel === 'peace' && standing(view, self) >= standing(view, n) + AI.tributeGap * 2;
    if (pressing && (view.turn + n.length) % 5 === 0 && !pendingOwn(n, 'tribute') && mood < LEADER_TUNING.stances.cordial) {
      add({ target: n, action: 'demand_tribute', terms: { get: tributeAsk(view) } });
      continue;
    }
    // A friend, while our army marches on a city of a power we are at war with: take it together.
    const prize = memory.objective;
    const holder = prize ? view.sites[prize]?.owner : null;
    if (prize && holder && holder !== n && view.relations[holder] === 'war' && mood > LEADER_TUNING.stances.neutral && !pendingOwn(n, 'joint_op')) {
      add({ target: n, action: 'propose_joint_op', terms: { site: prize } });
      continue;
    }
    // Short of one thing and long on another: offer a swap to anyone not hostile.
    const swap = (view.turn + self.length) % 3 === 0 ? exchangeFor(view) : null;
    if (swap && mood >= AI.tradeMood && !pendingOwn(n, 'exchange') && !treatyIn(view.treaties, 'embargo', self, n, view.turn)) add({ target: n, action: 'propose_exchange', terms: swap });
  }

  // Every order checked as the engine checks it, one per target, answers first.
  const all = [...answers, ...restrained, ...own].filter((d, i, list) => list.findIndex((x) => x.target === d.target) === i);
  const legal = all.filter((d) => view.nations[d.target] && !view.nations[d.target]!.minor && !checkDiplomacy(world, self, d.target, d.action, d.terms));

  // Make room for what we hand over: deals after recruits and buildings, as the validator reserves.
  const out: NationOrders = { ...planned, recruit: [...planned.recruit], ...(planned.build ? { build: [...planned.build] } : {}) };
  const gives = (d: DiplomacyOrder) => (d.action === 'propose_exchange' || d.action === 'pay_tribute' ? (d.terms?.give ?? {}) : {});
  const reservedBy = (o: NationOrders): Stockpile => {
    const r: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
    for (const x of o.recruit) for (const res of RESOURCES) r[res] += recruitCost(view.self, x.unitClass)[res];
    for (const b of o.build ?? []) for (const res of RESOURCES) r[res] += FACILITIES[b.facility].cost[res];
    return r;
  };
  const fits = (o: NationOrders, deals: DiplomacyOrder[]) => {
    const r = reservedBy(o);
    for (const d of deals) for (const res of RESOURCES) r[res] += gives(d)[res] ?? 0;
    return RESOURCES.every((res: Resource) => r[res] <= view.self.stockpile[res]);
  };
  // Our own swaps give way to the war chest; accepted answers take room from it.
  const needed = legal.filter((d) => !own.includes(d));
  let diplomacy = legal.filter((d) => !own.includes(d) || stockTotal(gives(d)) === 0 || fits(out, [...needed, d]));
  while (!fits(out, diplomacy) && (out.recruit.length > 0 || (out.build?.length ?? 0) > 0)) {
    if (out.recruit.length > 0) out.recruit.pop();
    else out.build!.pop();
  }
  if (out.build && out.build.length === 0) delete out.build;
  // A last resort that should never bite: drop deals we cannot cover, the last first.
  while (!fits(out, diplomacy)) {
    let i = diplomacy.length - 1;
    while (i >= 0 && stockTotal(gives(diplomacy[i]!)) === 0) i--;
    if (i < 0) break;
    diplomacy = diplomacy.filter((_, j) => j !== i);
  }
  out.diplomacy = diplomacy;
  return out;
}

/** An exchange to offer: 100 of what we have most of (over 450) for 80 of what we lack most (under 100). */
function exchangeFor(view: NationView): DealTerms | null {
  const s = view.self.stockpile;
  const rich = [...RESOURCES].filter((r) => s[r] > 450).sort((a, b) => s[b] - s[a] || (a < b ? -1 : 1))[0];
  const poor = [...RESOURCES].filter((r) => s[r] < 100).sort((a, b) => s[a] - s[b] || (a < b ? -1 : 1))[0];
  if (!rich || !poor || rich === poor) return null;
  return { give: { [rich]: 100 }, get: { [poor]: 80 } };
}
