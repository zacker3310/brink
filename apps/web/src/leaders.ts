import type { DealTerms, DiplomaticAction, GameEvent, MoodReason, NationId, NationView, ProposalKind, Stance, TreatyKind, TurnReport } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { LEADER_TUNING, LEADERS, leaderFor, PASSAGE, TREATIES, type LeaderDef, type LineTrigger } from '@brink/game-data';

// Words for the leaders and their deals: what each reason for a mood means, what each deal is,
// and the lines a leader speaks. Everything here reads the player's NationView only.

export const STANCE_TEXT: Record<Stance, { label: string; tone: string; bar: string }> = {
  hostile: { label: 'Hostile', tone: 'text-hostile', bar: 'bg-hostile' },
  wary: { label: 'Wary', tone: 'text-signal', bar: 'bg-signal' },
  neutral: { label: 'Neutral', tone: 'text-muted', bar: 'bg-faint' },
  cordial: { label: 'Cordial', tone: 'text-good', bar: 'bg-good' },
  friendly: { label: 'Friendly', tone: 'text-good', bar: 'bg-good' },
};

export const PROPOSAL_TEXT: Record<ProposalKind, string> = {
  peace: 'peace',
  alliance: 'an alliance',
  nonaggression: `a non-aggression pact (${TREATIES.nonaggressionTurns} turns)`,
  trade: `trade (+${TREATIES.tradeIncome.credits} cr +${TREATIES.tradeIncome.materials} mat a turn each, ${TREATIES.tradeTurns} turns)`,
  ceasefire: `a ceasefire (peace, no war for ${LEADER_TUNING.ceasefireTurns} turns)`,
  exchange: 'an exchange of resources',
  tribute: 'tribute',
  joint_op: `a joint operation (${LEADER_TUNING.jointOpTurns} turns)`,
  passage: `right of passage (${PASSAGE.turns} turns: march through, supply across, base aircraft)`,
};

export const ACTION_TEXT: Record<DiplomaticAction, string> = {
  declare_war: 'Declare war on',
  propose_peace: 'Offer peace to',
  propose_alliance: 'Offer an alliance to',
  propose_nonaggression: 'Offer a non-aggression pact to',
  propose_trade: 'Offer trade to',
  embargo: 'Embargo',
  propose_ceasefire: 'Offer a ceasefire to',
  propose_exchange: 'Offer an exchange to',
  demand_tribute: 'Demand tribute from',
  pay_tribute: 'Pay tribute to',
  propose_joint_op: 'Offer a joint operation to',
  propose_passage: 'Ask for passage from',
};

export const TREATY_TEXT: Record<TreatyKind, string> = {
  nonaggression: 'non-aggression pact',
  trade: 'trade agreement',
  embargo: 'embargo',
  ceasefire: 'ceasefire',
  joint_op: 'joint operation',
  passage: 'right of passage',
};

const RES_SHORT: Record<string, string> = { credits: 'cr', energy: 'en', materials: 'mat', food: 'food' };

/** "120 cr, 40 mat". */
export function stockText(s: DealTerms['give']): string {
  return RESOURCES.filter((r) => (s?.[r] ?? 0) > 0)
    .map((r) => `${s![r]} ${RES_SHORT[r]}`)
    .join(', ');
}

/** A deal in a phrase, from the proposer's side. */
export function dealText(view: Pick<NationView, 'nations' | 'sites'>, kind: ProposalKind, terms?: DealTerms): string {
  if (kind === 'exchange') return `${stockText(terms?.give)} for ${stockText(terms?.get)}`;
  if (kind === 'tribute') return terms?.get ? `tribute of ${stockText(terms.get)}` : `a payment of ${stockText(terms?.give)}`;
  if (kind === 'alliance' && terms?.against) return `an alliance against ${view.nations[terms.against]?.name ?? terms.against}`;
  if (kind === 'joint_op' && terms?.site) return `a joint operation on ${view.sites[terms.site]?.name ?? terms.site}`;
  if (kind === 'passage' && terms?.against) return `right of passage toward ${view.nations[terms.against]?.name ?? terms.against}`;
  return PROPOSAL_TEXT[kind];
}

/** One line of a mood's reasons, in words. `them` is the leader's nation, `you` the listener's. */
export function reasonText(r: MoodReason, leader: LeaderDef): string {
  const n = r.count && r.count > 1 ? ` (x${r.count})` : '';
  switch (r.id) {
    case 'temperament':
      return leader.temperament === 'hawk' ? 'A hawk: suspicious by nature' : leader.temperament === 'dove' ? 'A dove: inclined to trust' : 'An opportunist';
    case 'at_war':
      return 'We are at war';
    case 'allied':
      return 'We are allies';
    case 'trade':
      return 'Our trade agreement';
    case 'pact':
      return 'Our non-aggression pact';
    case 'ceasefire':
      return 'The ceasefire holds';
    case 'joint_op':
      return 'Our joint operation';
    case 'embargo':
      return 'You embargoed them';
    case 'common_enemy':
      return 'We fight a common enemy';
    case 'feared':
      return 'They fear your power';
    case 'agenda_balance':
      return 'Balance of Power: you lead the race';
    case 'agenda_commerce':
      return r.value > 0 ? 'Open Seas: they love a trading partner' : 'Open Seas: they hate your embargo';
    case 'agenda_honour':
      return r.value > 0 ? 'A Word Kept: you honour your treaty' : 'A Word Kept: you broke your word';
    case 'agenda_strength_respect':
      return 'Iron Respect: you are strong';
    case 'agenda_strength_contempt':
      return 'Iron Respect: you are weak';
    case 'agenda_homeland':
      return `Lost Provinces: you hold ${r.count ?? 1} of their cities`;
    case 'betrayed':
      return `You betrayed them${n}`;
    case 'declared_war':
      return `You declared war on them${n}`;
    case 'took_city':
      return `You took their cities${n}`;
    case 'made_peace':
      return `You made peace${n}`;
    case 'dealt':
      return `Deals honoured${n}`;
    case 'extorted':
      return `You forced tribute from them${n}`;
    case 'paid_us':
      return `They paid you tribute${n}`;
    case 'defied':
      return `They defied your demand${n}`;
    case 'comrades':
      return `Comrades in arms${n}`;
  }
}

/** A small stable number from strings, to vary which line is spoken (display only). */
function salt(...parts: (string | number)[]): number {
  let h = 7;
  for (const ch of parts.join('|')) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return h;
}

/** What a leader says on `trigger`, to `you`. */
export function lineOf(leaderId: string, trigger: LineTrigger, you: string, turn: number): string {
  const leader = LEADERS[leaderId];
  const lines = leader?.lines[trigger] ?? [];
  if (lines.length === 0) return '';
  return lines[salt(leaderId, trigger, turn) % lines.length]!.replaceAll('{you}', you);
}

export function leaderOfNation(view: NationView, n: NationId): LeaderDef {
  const p = view.nations[n]!;
  return leaderFor(n, p.government);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export interface Quote {
  nation: NationId;
  leader: LeaderDef;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

/**
 * The rival leaders' reactions to the turn just resolved, as short quotes for the debrief: you
 * took their city, broke a treaty, made peace or a deal, met or defied a demand; or, failing all
 * that, the most worried leader when you are running away with the war. One quote per leader,
 * the gravest first, at most `max`.
 */
export function leaderReactions(view: NationView, report: Pick<TurnReport, 'events' | 'turn'>, max = 2): Quote[] {
  const me = view.self.id;
  const rival = (n: NationId | null | undefined): n is NationId => !!n && n !== me && !!view.nations[n] && !view.nations[n]!.minor;
  const found: { nation: NationId; trigger: LineTrigger; rank: number; tone: Quote['tone'] }[] = [];
  const push = (nation: NationId, trigger: LineTrigger, rank: number, tone: Quote['tone']) => found.push({ nation, trigger, rank, tone });
  for (const e of report.events as GameEvent[]) {
    switch (e.kind) {
      case 'site_captured':
        if (e.to === me && rival(e.from)) push(e.from, 'took_city', 1, 'bad');
        break;
      case 'diplomacy': {
        const other = e.a === me ? e.b : e.b === me ? e.a : null;
        if (!rival(other)) break;
        if (e.relation === 'war') push(other, e.broke && e.proposedBy === me ? 'betrayed' : 'war', e.broke && e.proposedBy === me ? 0 : 2, 'bad');
        else push(other, e.relation === 'peace' ? 'peace' : 'deal', 3, 'good');
        break;
      }
      case 'treaty': {
        const other = e.a === me ? e.b : e.b === me ? e.a : null;
        if (rival(other) && e.treaty !== 'embargo') push(other, 'deal', 4, 'good');
        break;
      }
      case 'exchange': {
        if (e.void) break;
        const other = e.a === me ? e.b : e.b === me ? e.a : null;
        if (!rival(other)) break;
        push(other, e.tribute && e.a === other ? 'paid' : 'deal', 4, e.tribute && e.a === other ? 'info' : 'good');
        break;
      }
      case 'proposal':
        if (e.to === me && rival(e.from) && e.proposal === 'tribute' && e.terms?.get) push(e.from, 'demand', 2, 'bad');
        break;
      case 'proposal_lapsed':
        if (e.to === me && rival(e.from) && e.proposal === 'tribute') push(e.from, 'defied', 1, 'bad');
        break;
    }
  }
  // Nothing happened between us: the leader who fears us most says so, now and then.
  if (found.length === 0 && report.turn % 3 === 0) {
    const worried = Object.keys(view.moods ?? {})
      .filter((n) => view.moods![n]!.reasons.some((r) => r.id === 'feared'))
      .sort()[0];
    if (worried) push(worried, 'winning', 5, 'info');
  }
  found.sort((a, b) => a.rank - b.rank || (a.nation < b.nation ? -1 : 1));
  const out: Quote[] = [];
  for (const f of found) {
    if (out.some((q) => q.nation === f.nation) || out.length >= max) continue;
    const leader = leaderOfNation(view, f.nation);
    out.push({ nation: f.nation, leader, text: lineOf(leader.id, f.trigger, view.self.name, report.turn), tone: f.tone });
  }
  return out;
}
