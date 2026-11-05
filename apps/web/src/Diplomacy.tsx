import { useState } from 'react';
import type { DealTerms, DiplomaticAction, NationId, NationView, ProposalKind, Resource, TurnReport } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { AGENDA_TEXT, LEADER_TUNING, RULES, TEMPERAMENT_TEXT } from '@brink/game-data';
import { verdictLine, type Verdict } from '@brink/ai';
import { answerTo, checkDiplomacy, diplomacyWorldOf } from '@brink/simulation';
import { Label } from './chrome';
import { engine } from './engine';
import { Emblem } from './glyphs';
import { ACTION_TEXT, blockedText, dealText, initials, leaderOfNation, leaderReactions, lineOf, reasonText, refusalText, STANCE_TEXT, stockText, TREATY_TEXT } from './leaders';
import { diplomacyBlocked } from './rules-view';
import { sfx } from './sfx';
import { useGame } from './store';
import { powersOf } from './ui';

// The diplomacy screen: the rival leaders, how each feels about you and why, what they offer, and
// the deals you can put to them. A leader answers an offer at once (the same judgement they make
// when the turn resolves), so "Agreed" is a deal signed at the end of the turn.

const RELATION: Record<string, { label: string; tone: string }> = {
  war: { label: 'At war', tone: 'bg-hostile text-white' },
  peace: { label: 'At peace', tone: 'bg-good text-ink-950' },
  alliance: { label: 'Allies', tone: 'bg-friend text-ink-950' },
};

const RES_NAME: Record<Resource, string> = { credits: 'Credits', energy: 'Energy', materials: 'Materials', food: 'Food' };

const big = 'h-11 rounded-lg px-3 text-[14px] font-semibold';

function Portrait({ view, nation, size = 'h-12 w-12' }: { view: NationView; nation: NationId; size?: string }) {
  const n = view.nations[nation]!;
  const leader = leaderOfNation(view, nation);
  return (
    <span
      className={`relative flex ${size} shrink-0 items-center justify-center rounded-full border-2 font-display text-[16px] font-black text-white`}
      style={{ borderColor: n.color, background: `radial-gradient(circle at 35% 30%, ${n.color}, #0d1114 78%)` }}
      aria-hidden
    >
      {initials(leader.name)}
      <span className="absolute -right-1 -bottom-1 rounded-full bg-ink-950 p-px">
        <Emblem color={n.color} government={n.government} className="h-4 w-4" />
      </span>
    </span>
  );
}

/** -100..100 as a bar from the middle: right and green is warm, left and red is cold. */
function MoodBar({ mood, bar }: { mood: number; bar: string }) {
  const w = Math.min(50, Math.abs(mood) / 2);
  return (
    <div className="relative h-2 w-full rounded-full bg-ink-700" role="meter" aria-valuenow={mood} aria-valuemin={-100} aria-valuemax={100} aria-label="Mood toward you">
      <span className="absolute top-0 left-1/2 h-2 w-px bg-faint" aria-hidden />
      <span className={`absolute top-0 h-2 rounded-full ${bar}`} style={mood >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
    </div>
  );
}

function signedText(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function Diplomacy() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const advice = useGame((s) => s.staffAdvice);
  const setDiplomacy = useGame((s) => s.setDiplomacy);
  const [open, setOpen] = useState<NationId | null>(null);
  const rivals = powersOf(view).filter((n) => n.id !== view.self.id);
  const wars = rivals.filter((n) => !n.eliminated && view.relations[n.id] === 'war').length;
  const alive = rivals.filter((n) => !n.eliminated).length;
  // The staff never makes peace for you: it advises, and one tap takes its advice.
  const advised = advice && advice.turn === view.turn ? advice.orders.filter((d) => view.relations[d.target] === 'war' && !draft.diplomacy.some((x) => x.target === d.target)) : [];
  if (open && view.nations[open] && !view.nations[open]!.eliminated) return <LeaderScreen view={view} nation={open} onBack={() => setOpen(null)} />;
  return (
    <section className="px-3 py-3" data-testid="diplomacy">
      <header className="mb-2 flex items-center justify-between">
        <Label>Leaders</Label>
        <span className="font-mono text-[11px] text-faint">{wars === 0 ? 'At peace with all' : `${wars} at war`}</span>
      </header>
      <p className="mb-3 text-[13px] leading-snug text-muted">
        Every rival is run by a leader with a temper and a memory. Tap one to see how they feel about you and why, and to put a deal to them.
        {view.difficulty === 'easy' ? ' On Easy, any leader grants you peace.' : ''}
      </p>
      {alive > 0 && wars === alive && (
        <p className="mb-3 rounded-lg border border-signal/50 bg-ink-850 p-2.5 text-[13px] leading-snug" data-testid="peace-first-all">
          You are at war with every power. An alliance or a joint operation needs peace first: open a leader and propose peace.
        </p>
      )}
      {advised.length > 0 && (
        <ul className="mb-3 space-y-2" data-testid="staff-advice">
          {advised.map((d) => (
            <li key={d.target} className="flex items-center gap-2 rounded-lg border border-friend/60 bg-friend/10 p-2.5" data-testid={`staff-advice-${d.target}`}>
              <span className="min-w-0 flex-1 text-[13px] leading-snug">
                Staff advises {d.action === 'propose_ceasefire' ? 'a ceasefire' : 'peace'} with {view.nations[d.target]?.name}: one front fewer for the army.
              </span>
              <button
                type="button"
                className={`${big} shrink-0 bg-signal text-ink-950`}
                data-testid={`staff-advice-accept-${d.target}`}
                onClick={() => {
                  setDiplomacy(d.target, d.action);
                  sfx.order();
                }}
              >
                {d.action === 'propose_ceasefire' ? 'Offer ceasefire' : 'Offer peace'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-2">
        {rivals.map((n) => {
          const leader = leaderOfNation(view, n.id);
          const mood = view.moods?.[n.id];
          const rel = view.relations[n.id] ?? 'war';
          const incoming = view.proposals.filter((p) => p.from === n.id && p.to === view.self.id).length;
          const planned = draft.diplomacy.find((d) => d.target === n.id);
          const st = mood ? STANCE_TEXT[mood.stance] : null;
          return (
            <li key={n.id} data-testid={`nation-card-${n.id}`}>
              <button
                type="button"
                disabled={n.eliminated}
                onClick={() => {
                  sfx.select();
                  setOpen(n.id);
                }}
                className="flex min-h-[64px] w-full items-center gap-3 rounded-lg border border-line bg-ink-850 p-3 text-left active:bg-ink-800 disabled:opacity-50"
                style={{ borderLeft: `4px solid ${n.color}` }}
                data-testid={`leader-card-${n.id}`}
              >
                <Portrait view={view} nation={n.id} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[15px] font-bold">
                    {leader.title} {leader.name}
                  </span>
                  <span className="block truncate text-[12px] text-faint">
                    {n.name} · {TEMPERAMENT_TEXT[leader.temperament].name} · {n.victoryPoints} VP
                  </span>
                  {mood && st && !n.eliminated && (
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="w-24 shrink-0">
                        <MoodBar mood={mood.mood} bar={st.bar} />
                      </span>
                      <span className={`font-mono text-[11px] font-semibold uppercase ${st.tone}`} data-testid={`mood-${n.id}`}>
                        {st.label} {signedText(mood.mood)}
                      </span>
                    </span>
                  )}
                  {(incoming > 0 || planned) && !n.eliminated && (
                    <span className="mt-1 block truncate text-[12px] font-semibold text-signal">
                      {incoming > 0 ? `${incoming} offer${incoming > 1 ? 's' : ''} waiting` : `${ACTION_TEXT[planned!.action]} them at turn end`}
                    </span>
                  )}
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${n.eliminated ? 'bg-ink-700 text-faint' : RELATION[rel]!.tone}`}>{n.eliminated ? 'Defeated' : RELATION[rel]!.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A deal the player can build. `needs` says which terms it asks for. */
interface DealOption {
  action: DiplomaticAction;
  kind?: ProposalKind;
  label: string;
  needs?: 'exchange' | 'tribute' | 'against' | 'site';
  tone?: 'danger';
}

function optionsFor(rel: string): DealOption[] {
  // At war, peace comes first; the deals that need it stay in sight, each saying so.
  if (rel === 'war')
    return [
      { action: 'propose_peace', kind: 'peace', label: 'Peace' },
      { action: 'propose_ceasefire', kind: 'ceasefire', label: 'Ceasefire' },
      { action: 'propose_alliance', kind: 'alliance', label: 'Alliance' },
      { action: 'propose_alliance', kind: 'alliance', label: 'Alliance against…', needs: 'against' },
      { action: 'propose_joint_op', kind: 'joint_op', label: 'Joint operation', needs: 'site' },
      { action: 'propose_trade', kind: 'trade', label: 'Trade agreement' },
      { action: 'embargo', label: 'Embargo', tone: 'danger' },
    ];
  return [
    { action: 'propose_trade', kind: 'trade', label: 'Trade agreement' },
    { action: 'propose_nonaggression', kind: 'nonaggression', label: 'Non-aggression' },
    { action: 'propose_exchange', kind: 'exchange', label: 'Exchange', needs: 'exchange' },
    { action: 'propose_alliance', kind: 'alliance', label: 'Alliance' },
    { action: 'propose_alliance', kind: 'alliance', label: 'Alliance against…', needs: 'against' },
    { action: 'propose_joint_op', kind: 'joint_op', label: 'Joint operation', needs: 'site' },
    { action: 'demand_tribute', kind: 'tribute', label: 'Demand tribute', needs: 'tribute' },
    { action: 'embargo', label: 'Embargo', tone: 'danger' },
    { action: 'declare_war', label: 'Declare war', tone: 'danger' },
  ];
}

function Stepper({ label, value, onChange, max, min }: { label: string; value: number; onChange: (v: number) => void; max: number; min?: number }) {
  const step = 20;
  const floor = min ?? step;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[12px] text-muted">{label}</span>
      <button type="button" className={`${big} w-11 border border-line bg-ink-800 px-0`} onClick={() => onChange(Math.max(floor, value - step))} aria-label={`Less ${label}`}>
        −
      </button>
      <span className="w-12 text-center font-mono text-[15px] tabular-nums">{value}</span>
      <button type="button" className={`${big} w-11 border border-line bg-ink-800 px-0`} onClick={() => onChange(Math.min(max, value + step))} aria-label={`More ${label}`}>
        +
      </button>
    </div>
  );
}

function ResourcePicker({ value, onChange, testId }: { value: Resource; onChange: (r: Resource) => void; testId: string }) {
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" data-testid={testId}>
      {RESOURCES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={`h-11 rounded-lg border text-[12px] font-semibold ${value === r ? 'border-friend bg-friend/15 text-friend' : 'border-line bg-ink-800 text-muted'}`}
        >
          {RES_NAME[r]}
        </button>
      ))}
    </div>
  );
}

function LeaderScreen({ view, nation, onBack }: { view: NationView; nation: NationId; onBack: () => void }) {
  const draft = useGame((s) => s.draft)!;
  const setDiplomacy = useGame((s) => s.setDiplomacy);
  const report = useGame((s) => s.report);
  const me = view.self.id;
  const them = view.nations[nation]!;
  const leader = leaderOfNation(view, nation);
  const mood = view.moods?.[nation];
  const rel = view.relations[nation] ?? 'war';
  const planned = draft.diplomacy.find((d) => d.target === nation) ?? null;
  const incoming = view.proposals.filter((p) => p.from === nation && p.to === me);
  const outgoing = view.proposals.filter((p) => p.from === me && p.to === nation);
  const treaties = view.treaties.filter((t) => (t.a === me && t.b === nation) || (t.b === me && t.a === nation));

  const [deal, setDeal] = useState<DealOption | null>(null);
  const [give, setGive] = useState<{ r: Resource; n: number }>({ r: 'credits', n: 60 });
  const [get, setGet] = useState<{ r: Resource; n: number }>({ r: 'materials', n: 60 });
  const [against, setAgainst] = useState<NationId | null>(null);
  const [site, setSite] = useState<string | null>(null);
  // An optional sweetener on an alliance against a power or a joint operation: 0 is none.
  const [sweet, setSweet] = useState<{ r: Resource; n: number }>({ r: 'credits', n: 0 });
  const [reply, setReply] = useState<{ verdict: Verdict; kind?: ProposalKind; order: { action: DiplomaticAction; terms?: DealTerms } } | null>(null);
  const [asking, setAsking] = useState(false);

  // The leader greets by stance; after an answer they speak to it; after the turn they react to it.
  const reaction = report ? leaderReactions(view, report as TurnReport, 4).find((q) => q.nation === nation) : undefined;
  const speech = reply ? lineOf(leader.id, verdictLine(reply.verdict), view.self.name, view.turn) : (reaction?.text ?? lineOf(leader.id, mood?.stance ?? 'neutral', view.self.name, view.turn));

  const termsFor = (o: DealOption): DealTerms | undefined => {
    if (o.needs === 'exchange') return { give: { [give.r]: give.n }, get: { [get.r]: get.n } };
    if (o.needs === 'tribute') return { get: { [get.r]: get.n } };
    const bonus = sweet.n > 0 ? { give: { [sweet.r]: sweet.n } } : {};
    if (o.needs === 'against') return against ? { against, ...bonus } : undefined;
    if (o.needs === 'site') return site ? { site, ...bonus } : undefined;
    return undefined;
  };
  // Why a deal cannot be offered, in plain words (null when it can).
  const whyNot = (action: DiplomaticAction, t?: DealTerms) => blockedText(view, nation, action, t, diplomacyBlocked(view, nation, action, t));
  // Prizes: the cities of third powers you know of, those a joint operation can take first.
  const prizes = Object.values(view.sites)
    .filter((s) => s.owner && s.owner !== me && s.owner !== nation && !view.nations[s.owner]?.minor && (s.kind === 'capital' || s.kind === 'city') && view.tiles[s.key]?.visibility !== 'unknown')
    .map((s) => ({ s, why: whyNot('propose_joint_op', { site: s.id }) }))
    .sort((a, b) => Number(!!a.why) - Number(!!b.why) || b.s.victoryPoints - a.s.victoryPoints || (a.s.name < b.s.name ? -1 : 1))
    .slice(0, 8);
  const thirdPowers = powersOf(view)
    .filter((n) => n.id !== me && n.id !== nation && !n.eliminated)
    .map((n) => ({ n, why: whyNot('propose_alliance', { against: n.id }) }));
  // A whole kind of deal that cannot be offered now, and why.
  const optionWhy = (o: DealOption): string | null => {
    if (o.needs === 'site') return prizes.some((p) => !p.why) ? null : (prizes[0]?.why ?? `No city of a power you or ${them.name} fight is known`);
    if (o.needs === 'against') return thirdPowers.some((p) => !p.why) ? null : (thirdPowers[0]?.why ?? 'No other power to ally against');
    if (o.needs === 'exchange') return whyNot(o.action, { give: { credits: 20 }, get: { food: 20 } });
    if (o.needs === 'tribute') return whyNot(o.action, { get: { credits: 20 } });
    return whyNot(o.action);
  };
  const options = optionsFor(rel);

  const terms = deal ? termsFor(deal) : undefined;
  const ready = deal && (!deal.needs || terms);
  const blocked = deal && ready ? whyNot(deal.action, terms) : null;
  const sweetShort = (deal?.needs === 'against' || deal?.needs === 'site') && sweet.n > view.self.stockpile[sweet.r] ? `You hold only ${view.self.stockpile[sweet.r]} ${RES_NAME[sweet.r].toLowerCase()}` : null;
  const short = deal?.needs === 'exchange' && view.self.stockpile[give.r] < give.n ? `You hold only ${view.self.stockpile[give.r]} ${RES_NAME[give.r].toLowerCase()}` : null;

  const ask = async () => {
    if (!deal || !ready || blocked || short || sweetShort) return;
    if (!deal.kind) {
      // War and embargoes are not offers: they take effect when the turn resolves.
      setDiplomacy(nation, deal.action);
      sfx.order();
      setDeal(null);
      return;
    }
    setAsking(true);
    const r = await engine.call({ type: 'negotiate', from: me, to: nation, kind: deal.kind, ...(terms ? { terms } : {}) });
    setAsking(false);
    if (r.type !== 'verdict') return;
    const order = { action: deal.action, ...(terms ? { terms } : {}) };
    setReply({ verdict: r.verdict, kind: deal.kind, order });
    if (r.verdict.accept) {
      setDiplomacy(nation, deal.action, terms);
      sfx.order();
    }
    setDeal(null);
  };

  return (
    <section className="px-3 py-3" data-testid="leader-detail">
      <button type="button" onClick={onBack} className="-ml-1 mb-2 flex h-11 items-center gap-1 px-1 text-[13px] font-semibold text-muted" data-testid="leader-back">
        <span aria-hidden>‹</span> All leaders
      </button>
      <div className="flex items-center gap-3">
        <Portrait view={view} nation={nation} size="h-16 w-16" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[12px] text-faint">
            {leader.title} of {them.name}
          </div>
          <div className="truncate text-[18px] font-bold">{leader.name}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold" title={TEMPERAMENT_TEXT[leader.temperament].means}>
              {TEMPERAMENT_TEXT[leader.temperament].name}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold" title={AGENDA_TEXT[leader.agenda].means}>
              {AGENDA_TEXT[leader.agenda].name}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${RELATION[rel]!.tone}`}>{RELATION[rel]!.label}</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-faint">{leader.bio}</p>

      <blockquote className="relative mt-3 rounded-lg border border-line bg-ink-800 px-3 py-2.5 text-[14px] leading-snug italic" style={{ borderLeft: `3px solid ${them.color}` }} data-testid="leader-line">
        “{speech}”
      </blockquote>
      {reply && (
        <div className={`mt-2 rounded-lg border p-2.5 text-[13px] ${reply.verdict.accept ? 'border-good/60 text-good' : 'border-hostile/60 text-hostile'}`} data-testid={reply.verdict.accept ? 'deal-agreed' : 'deal-refused'}>
          {reply.verdict.accept ? 'Agreed. It is signed when the turn ends.' : `${leader.name} said no.`}
          {!reply.verdict.accept && (
            <p className="mt-1 text-[13px] text-text" data-testid="deal-refused-why">
              {reply.verdict.reason === 'cannot' && reply.kind
                ? (() => {
                    // Their side of it: the answer they would have to give, checked as the engine checks it.
                    const answer = answerTo({ from: me, kind: reply.kind, ...(reply.order.terms ? { terms: reply.order.terms } : {}) });
                    const why = checkDiplomacy(diplomacyWorldOf(view), nation, me, answer.action, answer.terms);
                    return why ? `${them.name} cannot: ${why}.` : refusalText(view, nation, 'cannot', reply.kind, reply.order.terms);
                  })()
                : refusalText(view, nation, reply.verdict.reason, reply.kind ?? 'peace', reply.order.terms)}
            </p>
          )}
          {!reply.verdict.accept && reply.verdict.reason !== 'cannot' && (
            <button
              type="button"
              className={`${big} mt-2 w-full border border-line bg-ink-850 text-text`}
              data-testid="deal-send-anyway"
              onClick={() => {
                setDiplomacy(nation, reply.order.action, reply.order.terms);
                setReply(null);
              }}
            >
              Send it anyway: it waits {2} turns for an answer
            </button>
          )}
        </div>
      )}

      {mood && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <Label>Mood toward you</Label>
            <span className={`font-mono text-[12px] font-bold uppercase ${STANCE_TEXT[mood.stance].tone}`} data-testid="leader-mood">
              {STANCE_TEXT[mood.stance].label} {signedText(mood.mood)}
            </span>
          </div>
          <div className="mt-1.5">
            <MoodBar mood={mood.mood} bar={STANCE_TEXT[mood.stance].bar} />
          </div>
          <ul className="mt-2 divide-y divide-line/60 rounded-lg border border-line" data-testid="mood-reasons">
            {mood.reasons.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No strong feelings either way.</li>}
            {mood.reasons.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">{reasonText(r, leader)}</span>
                <span className={`font-mono font-bold tabular-nums ${r.value > 0 ? 'text-good' : 'text-hostile'}`}>{signedText(r.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {treaties.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`treaties-${nation}`}>
          {treaties.map((t) => (
            <span key={t.kind} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${t.kind === 'embargo' ? 'border-hostile/50 text-hostile' : 'border-good/50 text-good'}`}>
              {TREATY_TEXT[t.kind]}
              {t.site ? ` on ${view.sites[t.site]?.name ?? t.site}` : ''} · to turn {t.until}
            </span>
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="mt-3">
          <Label>They propose</Label>
          <ul className="mt-1.5 space-y-2">
            {incoming.map((p) => {
              const answer = answerTo(p);
              const why = diplomacyBlocked(view, nation, answer.action, answer.terms);
              const taken = planned && planned.action === answer.action;
              const demand = p.kind === 'tribute' && !!p.terms?.get;
              return (
                <li key={`${p.kind}-${p.turn}`} className="rounded-lg border border-signal/50 bg-ink-850 p-2.5">
                  <p className="text-[13px] font-semibold text-signal">{demand ? `${leader.name} demands ${stockText(p.terms?.get)}, or else.` : `${leader.name} offers ${dealText(view, p.kind, p.terms)}.`}</p>
                  <button
                    type="button"
                    disabled={!!why || !!taken}
                    data-testid={`offer-accept-${p.kind}`}
                    onClick={() => {
                      setDiplomacy(nation, answer.action, answer.terms);
                      sfx.order();
                    }}
                    className={`${big} mt-2 w-full bg-signal text-ink-950 disabled:opacity-50`}
                  >
                    {taken ? 'Accepted: signed at turn end' : why ? `Cannot: ${why}` : demand ? `Pay ${stockText(p.terms?.get)}` : 'Accept'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {outgoing.length > 0 && !planned && (
        <p className="mt-2 text-[12px] text-faint">Waiting for their answer: {outgoing.map((p) => dealText(view, p.kind, p.terms)).join('; ')}.</p>
      )}

      {planned && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-friend/60 bg-friend/10 p-2.5" data-testid="planned-deal">
          <span className="min-w-0 flex-1 text-[13px]">
            At turn end: {ACTION_TEXT[planned.action].toLowerCase()} {them.name}
            {planned.terms && planned.action !== 'propose_alliance' ? ` (${dealText(view, (planned.action === 'demand_tribute' || planned.action === 'pay_tribute' ? 'tribute' : planned.action === 'propose_joint_op' ? 'joint_op' : 'exchange') as ProposalKind, planned.terms)})` : ''}
            {planned.action === 'declare_war' && rel !== 'war' ? ` · −${RULES.perfidy[rel === 'alliance' ? 'alliance' : 'peace']} stability` : ''}
          </span>
          <button type="button" className={`${big} shrink-0 border border-line bg-ink-850`} data-testid="planned-cancel" onClick={() => setDiplomacy(nation, null)}>
            Cancel
          </button>
        </div>
      )}

      <div className="mt-4">
        <Label>Put a deal to {leader.name.split(' ')[0]}</Label>
        <p className="mt-1 text-[12px] text-faint">One move toward each power a turn{planned ? ': this replaces the one above' : ''}.</p>
        {rel === 'war' && (
          <p className="mt-2 rounded-lg border border-signal/50 bg-ink-850 p-2.5 text-[13px] leading-snug" data-testid="peace-first">
            You are at war with {them.name}. An alliance, a joint operation or trade needs peace first: propose peace.
          </p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {options.map((o) => {
            const on = deal?.label === o.label;
            const slug = o.label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
            const why = optionWhy(o);
            return (
              <button
                key={o.label}
                type="button"
                aria-pressed={on}
                disabled={!!why}
                title={why ?? undefined}
                data-testid={`deal-${slug}`}
                onClick={() => {
                  setReply(null);
                  setDeal(on ? null : o);
                }}
                className={`min-h-11 rounded-lg border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-60 ${on ? 'border-friend bg-friend/15 text-friend' : o.tone === 'danger' ? 'border-hostile/60 text-hostile' : 'border-line bg-ink-800'}`}
              >
                <span className="block">{o.label}</span>
                {why && (
                  <span className="block text-[11px] leading-tight font-normal text-faint" data-testid={`deal-why-${slug}`}>
                    {why}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {deal && (
          <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-ink-850 p-3" data-testid="deal-builder">
            {deal.needs === 'exchange' && (
              <>
                <div className="text-[12px] font-semibold text-muted">You give</div>
                <ResourcePicker value={give.r} onChange={(r) => setGive({ ...give, r })} testId="give-resource" />
                <Stepper label="Amount" value={give.n} onChange={(n) => setGive({ ...give, n })} max={LEADER_TUNING.dealMax} />
                <div className="text-[12px] font-semibold text-muted">You ask for</div>
                <ResourcePicker value={get.r} onChange={(r) => setGet({ ...get, r })} testId="get-resource" />
                <Stepper label="Amount" value={get.n} onChange={(n) => setGet({ ...get, n })} max={LEADER_TUNING.dealMax} />
              </>
            )}
            {deal.needs === 'tribute' && (
              <>
                <div className="text-[12px] font-semibold text-muted">You demand</div>
                <ResourcePicker value={get.r} onChange={(r) => setGet({ ...get, r })} testId="get-resource" />
                <Stepper label="Amount" value={get.n} onChange={(n) => setGet({ ...get, n })} max={LEADER_TUNING.dealMax} />
                <p className="text-[12px] text-faint">If they let it lapse, they defy you: hawks expect a war over less.</p>
              </>
            )}
            {deal.needs === 'against' && (
              <div className="grid grid-cols-2 gap-1.5">
                {thirdPowers.map(({ n, why }) => (
                  <button
                    key={n.id}
                    type="button"
                    aria-pressed={against === n.id}
                    disabled={!!why}
                    title={why ?? undefined}
                    data-testid={`against-${n.id}`}
                    onClick={() => setAgainst(n.id)}
                    className={`min-h-11 rounded-lg border px-2 py-1 text-[13px] font-semibold disabled:opacity-60 ${against === n.id ? 'border-friend bg-friend/15 text-friend' : 'border-line bg-ink-800'}`}
                  >
                    <span className="block">Against {n.name}</span>
                    {view.relations[n.id] === 'war' && !why && <span className="block text-[11px] font-normal text-faint">you are at war with them</span>}
                    {why && <span className="block text-[11px] leading-tight font-normal text-faint">{why}</span>}
                  </button>
                ))}
              </div>
            )}
            {deal.needs === 'site' && (
              <div className="grid grid-cols-2 gap-1.5">
                {prizes.map(({ s, why }) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={site === s.id}
                    disabled={!!why}
                    title={why ?? undefined}
                    data-testid={`prize-${s.id}`}
                    onClick={() => setSite(s.id)}
                    className={`min-h-11 rounded-lg border px-2 py-1 text-[13px] font-semibold disabled:opacity-60 ${site === s.id ? 'border-friend bg-friend/15 text-friend' : 'border-line bg-ink-800'}`}
                  >
                    <span className="block truncate">
                      {s.name} · {s.victoryPoints} VP
                    </span>
                    <span className="block truncate text-[11px] leading-tight font-normal text-faint">{why ?? view.nations[s.owner!]?.name}</span>
                  </button>
                ))}
              </div>
            )}
            {(deal.needs === 'against' || deal.needs === 'site') && (
              <>
                <div className="text-[12px] font-semibold text-muted">Sweeten it (optional): you give on signing</div>
                <ResourcePicker value={sweet.r} onChange={(r) => setSweet({ ...sweet, r })} testId="sweet-resource" />
                <Stepper label="Amount" value={sweet.n} onChange={(n) => setSweet({ ...sweet, n })} max={LEADER_TUNING.dealMax} min={0} />
                <p className="text-[12px] text-faint">
                  {deal.needs === 'site'
                    ? `Both armies march on the city for ${LEADER_TUNING.jointOpTurns} turns; whoever of you is not at war with its holder goes to war on signing, and you share what you see of it.`
                    : 'Whoever of you is not yet at war with them goes to war on signing.'}
                </p>
              </>
            )}
            <p className="text-[13px] text-muted">
              {deal.action === 'declare_war'
                ? `War when the turn ends.${rel !== 'war' ? ` Breaking the ${rel} costs ${RULES.perfidy[rel === 'alliance' ? 'alliance' : 'peace']} stability, and ${leader.name} will not forget it.` : ''}`
                : deal.action === 'embargo'
                  ? 'Ends any trade at once and bars it for a while. They will resent it.'
                  : ready
                    ? `You propose ${dealText(view, deal.kind!, terms)}.`
                    : 'Choose the terms.'}
            </p>
            {(blocked || short || sweetShort) && (
              <p className="text-[13px] font-semibold text-hostile" data-testid="deal-blocked">
                {short ?? sweetShort ?? blocked}
              </p>
            )}
            <button
              type="button"
              disabled={!ready || !!blocked || !!short || !!sweetShort || asking}
              onClick={() => void ask()}
              data-testid="deal-ask"
              className={`${big} w-full disabled:opacity-50 ${deal.tone === 'danger' ? 'bg-hostile text-white' : 'bg-signal text-ink-950'}`}
            >
              {asking ? `${leader.name.split(' ')[0]} is considering…` : deal.kind ? `Put it to ${leader.name}` : deal.action === 'declare_war' ? 'Declare war at turn end' : 'Embargo at turn end'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The rival leaders' reactions to the turn, as short quotes: the debrief and the report show them. */
export function LeaderQuotes({ view, report, max = 2 }: { view: NationView; report: TurnReport; max?: number }) {
  const quotes = leaderReactions(view, report, max);
  if (quotes.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1" data-testid="leader-quotes">
      {quotes.map((q) => (
        <li key={q.nation} className="flex items-start gap-2">
          <Portrait view={view} nation={q.nation} size="h-8 w-8" />
          <p className="min-w-0 flex-1 text-[12px] leading-snug">
            <span className="font-semibold">{q.leader.name}:</span> <span className={`italic ${q.tone === 'bad' ? 'text-hostile' : q.tone === 'good' ? 'text-good' : 'text-muted'}`}>“{q.text}”</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
