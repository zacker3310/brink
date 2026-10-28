import type { DiplomaticAction, OrderType, Resource, Stockpile } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { FACILITIES, TECHS, UNITS } from '@brink/game-data';
import { useKeys } from './chrome';
import { idleFormations, netChange, selfLedger } from './insight';
import { usePhone } from './phone';
import { recommendedTech, recruitCostFor } from './rules-view';
import { useGame } from './store';
import { costText } from './ui';

// The order review: what the turn commits before it commits it. Built from the draft, the engine's
// own legality check and last turn's ledger. Nothing here changes the orders; Commit sends them.

const ORDER_NAME: Record<OrderType, string> = { move: 'Move', attack: 'Attack', defend: 'Dig in', hold: 'Hold', recon: 'Scout', withdraw: 'Withdraw' };
const ACTION_NAME: Record<DiplomaticAction, string> = {
  declare_war: 'Declare war on',
  propose_peace: 'Offer peace to',
  propose_alliance: 'Offer an alliance to',
  propose_nonaggression: 'Offer a non-aggression pact to',
  propose_trade: 'Offer trade to',
  embargo: 'Embargo',
};
const RES_NAME: Record<Resource, string> = { credits: 'Credits', energy: 'Energy', materials: 'Materials', food: 'Food' };

type Warning = { tone: 'bad' | 'warn'; text: string };

export function OrderReview() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const report = useGame((s) => s.report);
  const rejected = useGame((s) => s.rejected);
  const close = useGame((s) => s.closeReview);
  const submit = useGame((s) => s.submit);
  const phone = usePhone();
  useKeys(
    (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    },
    [close, submit],
  );

  const orders = Object.values(draft.formations);
  const byType = new Map<OrderType, number>();
  for (const o of orders) byType.set(o.type, (byType.get(o.type) ?? 0) + 1);
  const idle = idleFormations(view, draft.formations);

  // Everything this turn spends up front: recruits and buildings, against what is in store.
  const spend: Stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
  for (const r of draft.recruit) {
    const c = recruitCostFor(view, r.unitClass);
    for (const res of RESOURCES) spend[res] += c[res];
  }
  for (const b of draft.build ?? []) for (const res of RESOURCES) spend[res] += FACILITIES[b.facility].cost[res];

  const warnings: Warning[] = [];
  for (const e of rejected) if (e.kind === 'order_rejected') warnings.push({ tone: 'bad', text: `Will be refused: ${e.reason}` });
  for (const res of RESOURCES) if (spend[res] > view.self.stockpile[res]) warnings.push({ tone: 'bad', text: `${RES_NAME[res]}: spending ${spend[res]} of ${view.self.stockpile[res]}. Something will be refused.` });
  const ledger = selfLedger(view, report);
  if (ledger) {
    const net = netChange(ledger);
    for (const res of RESOURCES) {
      const left = view.self.stockpile[res] - spend[res];
      if (net[res] < 0 && left + net[res] * 2 < 0) warnings.push({ tone: 'warn', text: `${RES_NAME[res]} runs out within two turns at last turn's rate (${net[res]} a turn, ${left} left after this turn's spending).` });
    }
  }
  const hungry = Object.values(view.formations).filter((f) => f.supply < 50);
  if (hungry.length) warnings.push({ tone: 'warn', text: `${hungry.length} unit${hungry.length === 1 ? ' is' : 's are'} under half supply: weaker in battle and slower to recover.` });
  if (idle.length) warnings.push({ tone: 'warn', text: `${idle.length} unit${idle.length === 1 ? ' has' : 's have'} no orders and will hold where ${idle.length === 1 ? 'it is' : 'they are'}.` });
  const research = draft.research ?? view.self.research.current;
  const auto = !research ? recommendedTech(view) : null;
  if (view.self.event && draft.eventChoice === undefined) warnings.push({ tone: 'warn', text: 'A decision is waiting: unanswered, its first option stands.' });

  const nation = (id: string) => view.nations[id]?.name ?? id;
  const row = 'flex items-baseline justify-between gap-3 py-1 text-[13px]';
  return (
    <div className={`vercel fixed inset-0 z-40 flex ${phone ? 'items-end' : 'items-center justify-center'} bg-ink-950/70`} data-testid="order-review" role="dialog" aria-label="Review orders">
      <div className={`${phone ? 'sheet-in safe-bottom w-full rounded-t-2xl border-t' : 'w-full max-w-lg rounded-2xl border'} flex max-h-[88dvh] flex-col border-line bg-ink-900`}>
        <header className="px-5 pt-4">
          <div className="font-display text-[11px] font-bold tracking-[0.1em] text-signal uppercase">
            Turn {view.turn} of {view.maxTurns}
          </div>
          <h2 className="font-display text-2xl font-extrabold uppercase">Review orders</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1.5" data-testid="review-warnings">
              {warnings.map((w, i) => (
                <li key={i} className={`rounded-lg border px-3 py-2 text-[13px] leading-snug ${w.tone === 'bad' ? 'border-hostile/60 bg-hostile/10 text-hostile' : 'border-signal/50 bg-signal/10 text-signal'}`}>
                  {w.text}
                </li>
              ))}
            </ul>
          )}

          <section className="mt-3">
            <h3 className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Forces · {Object.keys(view.formations).length} units</h3>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="review-orders">
              {[...byType].sort().map(([t, n]) => (
                <span key={t} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${t === 'attack' ? 'border-hostile/60 text-hostile' : 'border-line text-text'}`}>
                  {ORDER_NAME[t]} {n}
                </span>
              ))}
              {idle.length > 0 && <span className="rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] text-faint">Hold (no order) {idle.length}</span>}
            </div>
            {(draft.battles?.length ?? 0) > 0 && <p className="mt-1.5 text-[12px] text-good">{draft.battles!.length} battle{draft.battles!.length === 1 ? '' : 's'} fought by hand: their results replace the odds if the enemy there has not changed.</p>}
          </section>

          {(draft.recruit.length > 0 || (draft.build?.length ?? 0) > 0) && (
            <section className="mt-3">
              <h3 className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Production and construction</h3>
              <ul className="divide-y divide-line/50">
                {draft.recruit.map((r) => (
                  <li key={`r-${r.siteId}`} className={row}>
                    <span>
                      {UNITS[r.unitClass].name} at {view.sites[r.siteId]?.name}
                    </span>
                    <span className="font-mono text-[12px] text-muted">{costText(recruitCostFor(view, r.unitClass))}</span>
                  </li>
                ))}
                {(draft.build ?? []).map((b) => (
                  <li key={`b-${b.siteId}`} className={row}>
                    <span>
                      {FACILITIES[b.facility].name} at {view.sites[b.siteId]?.name}
                    </span>
                    <span className="font-mono text-[12px] text-muted">{costText(FACILITIES[b.facility].cost)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-3">
            <h3 className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Treasury after this turn's spending</h3>
            <div className="mt-1 grid grid-cols-4 gap-1.5 text-center" data-testid="review-treasury">
              {RESOURCES.map((res) => {
                const left = view.self.stockpile[res] - spend[res];
                return (
                  <div key={res} className="rounded-lg bg-ink-850 py-1.5">
                    <div className={`font-mono text-[15px] font-semibold ${left < 0 ? 'text-hostile' : ''}`}>{left}</div>
                    <div className="text-[10px] text-faint uppercase">{RES_NAME[res]}</div>
                    {spend[res] > 0 && <div className="text-[10px] text-muted">−{spend[res]}</div>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-3">
            <h3 className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">State</h3>
            <ul className="divide-y divide-line/50">
              <li className={row}>
                <span>Research</span>
                <span className="text-right text-muted">{research ? TECHS[research]?.name : auto ? `${TECHS[auto]?.name} (starts automatically)` : 'Nothing left to research'}</span>
              </li>
              {draft.diplomacy.map((d) => (
                <li key={d.target} className={row}>
                  <span className={d.action === 'declare_war' ? 'text-hostile' : ''}>
                    {ACTION_NAME[d.action]} {nation(d.target)}
                  </span>
                  <span className="text-right text-[12px] text-faint">{d.action === 'declare_war' || d.action === 'embargo' ? 'takes effect at once' : 'if they offer it too'}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <footer className="flex gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={close} className="v-btn v-btn-secondary h-12 flex-1" data-testid="review-back">
            Back to orders
          </button>
          <button type="button" onClick={() => void submit()} className="v-btn v-btn-primary h-12 flex-[1.4] text-[15px] font-semibold" data-testid="commit-turn">
            Commit orders
          </button>
        </footer>
      </div>
    </div>
  );
}
