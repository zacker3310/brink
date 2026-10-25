import type { ReactNode } from 'react';
import type { GameEvent, HexKey, NationView } from '@brink/contracts';
import { TECHS, UNITS } from '@brink/game-data';
import { useGame } from './store';
import { Button } from './ui';

interface Row {
  text: ReactNode;
  at?: HexKey;
  tone?: 'good' | 'bad';
}

function name(view: NationView, id: string, owner: string): string {
  return view.formations[id]?.name ?? (owner === view.self.id ? id : `${view.nations[owner]?.name ?? owner} formation`);
}

function nation(view: NationView, id: string | null): string {
  return id ? (view.nations[id]?.name ?? id) : 'nobody';
}

/** Turn events into report sections. Only what the nation was entitled to see arrives here. */
function sections(view: NationView, events: GameEvent[]): [string, Row[]][] {
  const me = view.self.id;
  const out: Record<string, Row[]> = {
    Engagements: [],
    Casualties: [],
    Movement: [],
    Territory: [],
    Economy: [],
    Production: [],
    Supply: [],
    Intelligence: [],
    Diplomacy: [],
    Orders: [],
  };
  for (const e of events) {
    switch (e.kind) {
      case 'engagement': {
        const mine = e.participants.filter((p) => p.owner === me);
        const theirs = e.participants.filter((p) => p.owner !== me);
        const attacking = mine.some((p) => p.role === 'attacker');
        const result = { attacker_victory: 'attackers broke through', defender_held: 'defenders held', inconclusive: 'inconclusive' }[e.outcome];
        const lost = mine.reduce((a, p) => a + p.strengthLoss, 0);
        const dealt = theirs.reduce((a, p) => a + p.strengthLoss, 0);
        const good = attacking ? e.outcome === 'attacker_victory' : e.outcome === 'defender_held';
        out.Engagements!.push({
          at: e.location,
          tone: mine.length === 0 ? undefined : good ? 'good' : 'bad',
          text: (
            <>
              {e.type === 'meeting' ? 'Meeting engagement' : attacking ? 'Our assault' : mine.length ? 'Enemy assault on us' : 'Battle observed'} at {e.location}: {result}.{' '}
              {mine.length > 0 && (
                <span className="text-muted">
                  We lost {lost}, they lost {dealt}.
                </span>
              )}
            </>
          ),
        });
        break;
      }
      case 'strike':
        out.Engagements!.push({
          at: e.target,
          tone: e.owner === me ? 'good' : 'bad',
          text: `${e.owner === me ? 'Our' : `${nation(view, e.owner)}`} ${UNITS[e.unitClass].name.toLowerCase()} struck ${e.target}: ${
            e.victims.length ? e.victims.map((v) => `${name(view, v.formation, v.owner)} -${v.strengthLoss}`).join(', ') : 'no confirmed hits'
          }${e.sourceLoss ? ` (lost ${e.sourceLoss} to air defense)` : ''}.`,
        });
        break;
      case 'destroyed':
        out.Casualties!.push({ at: e.at, tone: e.owner === me ? 'bad' : 'good', text: `${name(view, e.formation, e.owner)} (${UNITS[e.unitClass].name}) destroyed at ${e.at}.` });
        break;
      case 'retreat':
        out.Casualties!.push({ at: e.to, tone: e.owner === me ? 'bad' : 'good', text: `${name(view, e.formation, e.owner)} fell back from ${e.from} to ${e.to}.` });
        break;
      case 'movement':
        if (e.owner === me && (e.path.length > 0 || e.halted)) {
          out.Movement!.push({
            at: e.path.at(-1),
            text: `${name(view, e.formation, e.owner)} ${e.path.length ? `moved ${e.path.length} hex${e.path.length === 1 ? '' : 'es'}` : 'did not move'}${e.halted ? `, halted (${e.halted})` : ''}.`,
          });
        } else if (e.owner !== me) {
          out.Intelligence!.push({ at: e.path.at(-1), text: `${nation(view, e.owner)} ${UNITS[e.unitClass].name.toLowerCase()} seen moving to ${e.path.at(-1)}.` });
        }
        break;
      case 'site_captured':
        out.Territory!.push({
          at: e.key,
          tone: e.to === me ? 'good' : e.from === me ? 'bad' : undefined,
          text: `${view.sites[e.site]?.name ?? e.site} captured by ${nation(view, e.to)} from ${nation(view, e.from)}.`,
        });
        break;
      case 'territory':
        break;
      case 'economy': {
        const l = e.ledger;
        const net = (r: 'credits' | 'energy' | 'materials' | 'food') => l.income[r] - l.upkeep[r] - l.production[r] - l.logistics[r] - l.spending[r];
        out.Economy!.push({
          text: `Net change: ${net('credits')} credits, ${net('energy')} energy, ${net('materials')} materials, ${net('food')} food. Industry ${l.industry}, research ${l.research}.`,
        });
        if (l.shortages.length) out.Economy!.push({ tone: 'bad', text: `Shortages: ${l.shortages.join(', ')}. Upkeep went unpaid.` });
        break;
      }
      case 'recruitment_queued':
        out.Production!.push({ text: `${UNITS[e.unitClass].name} queued at ${view.sites[e.site]?.name ?? e.site}.` });
        break;
      case 'production':
        out.Production!.push({ at: e.key, tone: 'good', text: `${name(view, e.formation, e.nation)} (${UNITS[e.unitClass].name}) mustered at ${view.sites[e.site]?.name ?? e.site}.` });
        break;
      case 'production_cancelled':
        out.Production!.push({ tone: 'bad', text: `Production at ${view.sites[e.site]?.name ?? e.site} cancelled: ${e.reason}.` });
        break;
      case 'research':
        out.Production!.push({ tone: 'good', text: `Research complete: ${TECHS[e.tech]?.name ?? e.tech}.` });
        break;
      case 'supply':
        out.Supply!.push({ at: e.key, tone: 'bad', text: `${name(view, e.formation, e.nation)} at ${e.supply}% supply.` });
        break;
      case 'intel':
        out.Intelligence!.push({ at: e.key, text: `New contact: ${nation(view, e.owner)} ${UNITS[e.unitClass].name.toLowerCase()} at ${e.key}.` });
        break;
      case 'diplomacy':
        out.Diplomacy!.push({ text: `${nation(view, e.a)} and ${nation(view, e.b)} are now at ${e.relation}.` });
        break;
      case 'proposal':
        out.Diplomacy!.push({ text: `${nation(view, e.from)} proposes ${e.proposal} to ${nation(view, e.to)}.` });
        break;
      case 'elimination':
        out.Diplomacy!.push({ tone: e.nation === me ? 'bad' : undefined, text: `${nation(view, e.nation)} has been eliminated.` });
        break;
      case 'victory':
        out.Diplomacy!.push({ tone: e.winner === me ? 'good' : 'bad', text: `${nation(view, e.winner)} wins (${e.reason.replace('_', ' ')}).` });
        break;
      case 'order_rejected':
        out.Orders!.push({ tone: 'bad', text: `Rejected${e.formation ? ` (${name(view, e.formation, me)})` : ''}: ${e.reason}.` });
        break;
    }
  }
  const territory = events.filter((e) => e.kind === 'territory');
  const gained = territory.filter((e) => e.kind === 'territory' && e.to === me).length;
  const lost = territory.filter((e) => e.kind === 'territory' && e.from === me).length;
  if (gained || lost) out.Territory!.unshift({ text: `Hexes gained: ${gained}. Hexes lost: ${lost}.`, tone: gained >= lost ? 'good' : 'bad' });
  return Object.entries(out).filter(([, rows]) => rows.length > 0);
}

export function Report() {
  const view = useGame((s) => s.view)!;
  const report = useGame((s) => s.report);
  const setShowReport = useGame((s) => s.setShowReport);
  const focusOn = useGame((s) => s.focusOn);
  if (!report) return null;
  const vp = report.victoryPoints;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-950/70 p-6" role="dialog" aria-modal="true" aria-labelledby="report-title" data-testid="report">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-sm border border-line bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <p className="text-[10px] tracking-[0.2em] text-signal uppercase">After-action report</p>
            <h2 id="report-title" className="text-lg font-semibold">
              Turn {report.turn} resolved
            </h2>
          </div>
          <Button onClick={() => setShowReport(false)} testId="close-report">
            Continue planning
          </Button>
        </header>
        <div className="overflow-y-auto px-5 py-3">
          <section className="mb-3">
            <h3 className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Victory progress</h3>
            <p className="text-xs">
              {Object.entries(vp)
                .sort((a, b) => b[1] - a[1])
                .map(([n, v]) => `${view.nations[n]?.name ?? n} ${v}`)
                .join(' · ')}{' '}
              <span className="text-faint">(need {view.victoryThreshold})</span>
            </p>
          </section>
          {sections(view, report.events).map(([title, rows]) => (
            <section key={title} className="mb-3">
              <h3 className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{title}</h3>
              <ul className="space-y-0.5">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${r.tone === 'good' ? 'bg-friendly' : r.tone === 'bad' ? 'bg-hostile' : 'bg-faint'}`} aria-hidden />
                    <span className="flex-1">{r.text}</span>
                    {r.at && (
                      <button
                        type="button"
                        className="shrink-0 text-faint hover:text-signal"
                        onClick={() => {
                          setShowReport(false);
                          focusOn(r.at!);
                        }}
                      >
                        show
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
