import { useState, type ReactNode } from 'react';
import type { GameEvent, HexKey, NationView, TurnReport, UnitClass } from '@brink/contracts';
import { EVENTS, FACILITIES, TECHS, UNITS } from '@brink/game-data';
import { Label, useKeys } from './chrome';
import { UnitGlyph } from './glyphs';
import { arenaNote, atPlace, describeEffect, hexLabel, netChange, toPlace, treatyText, turnClock, VICTORY_HOW } from './insight';
import { useGame } from './store';
import { Swatch } from './ui';

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

interface Totals {
  lost: number;
  dealt: number;
  ourDestroyed: number;
  theirDestroyed: number;
  gained: number;
  ceded: number;
  battles: number;
}

/** Turn events into headline totals and report sections. Only what the nation was entitled to see arrives here. */
function digest(view: NationView, events: GameEvent[]): { totals: Totals; sections: [string, Row[]][] } {
  const me = view.self.id;
  const at = (k: HexKey) => hexLabel(view, k);
  const totals: Totals = { lost: 0, dealt: 0, ourDestroyed: 0, theirDestroyed: 0, gained: 0, ceded: 0, battles: 0 };
  const out: Record<string, Row[]> = {
    Engagements: [],
    Casualties: [],
    Territory: [],
    Movement: [],
    Economy: [],
    Production: [],
    Supply: [],
    Diplomacy: [],
    Intelligence: [],
    Orders: [],
  };
  // One intel row per enemy formation: sighting and movement merged.
  const sightings = new Map<string, { owner: string; unitClass: UnitClass; key: HexKey; moved: boolean }>();
  for (const e of events) {
    switch (e.kind) {
      case 'engagement': {
        const mine = e.participants.filter((p) => p.owner === me);
        const theirs = e.participants.filter((p) => p.owner !== me);
        const attacking = mine.some((p) => p.role === 'attacker');
        const result = { attacker_victory: 'attackers broke through', defender_held: 'defenders held', inconclusive: 'inconclusive' }[e.outcome];
        const lost = mine.reduce((a, p) => a + p.strengthLoss, 0);
        const dealt = theirs.reduce((a, p) => a + p.strengthLoss, 0);
        if (mine.length) {
          totals.lost += lost;
          totals.dealt += dealt;
          totals.battles += 1;
        }
        const good = attacking ? e.outcome === 'attacker_victory' : e.outcome === 'defender_held';
        out.Engagements!.push({
          at: e.location,
          tone: mine.length === 0 ? undefined : good ? 'good' : 'bad',
          text: (
            <>
              <span className="font-semibold">{e.type === 'meeting' ? 'Meeting engagement' : attacking ? 'Our assault' : mine.length ? 'Enemy assault on us' : 'Battle observed'}</span> {atPlace(view, e.location)}: {result}.{' '}
              {mine.length > 0 && (
                <span className="text-muted">
                  We lost {lost}, they lost {dealt}.{arenaNote(e.arena, attacking)}
                </span>
              )}
            </>
          ),
        });
        break;
      }
      case 'strike': {
        const dealt = e.victims.reduce((a, v) => a + (v.owner === me ? 0 : v.strengthLoss), 0);
        const lost = e.victims.reduce((a, v) => a + (v.owner === me ? v.strengthLoss : 0), 0) + (e.owner === me ? e.sourceLoss : 0);
        totals.dealt += dealt;
        totals.lost += lost;
        if (e.owner === me || e.victims.some((v) => v.owner === me)) totals.battles += 1;
        out.Engagements!.push({
          at: e.target,
          tone: e.owner === me ? 'good' : 'bad',
          text: `${e.owner === me ? 'Our' : `${nation(view, e.owner)}`} ${UNITS[e.unitClass].name.toLowerCase()} struck ${at(e.target)}: ${
            e.victims.length ? e.victims.map((v) => `${name(view, v.formation, v.owner)} −${v.strengthLoss}`).join(', ') : 'no confirmed hits'
          }${e.sourceLoss ? ` (lost ${e.sourceLoss} to air defense)` : ''}.`,
        });
        break;
      }
      case 'destroyed':
        if (e.owner === me) totals.ourDestroyed += 1;
        else totals.theirDestroyed += 1;
        out.Casualties!.push({ at: e.at, tone: e.owner === me ? 'bad' : 'good', text: `${name(view, e.formation, e.owner)} (${UNITS[e.unitClass].name}) destroyed ${atPlace(view, e.at)}.` });
        break;
      case 'retreat':
        out.Casualties!.push({ at: e.to, tone: e.owner === me ? 'bad' : 'good', text: `${name(view, e.formation, e.owner)} fell back from ${at(e.from)} ${toPlace(view, e.to)}.` });
        break;
      case 'movement':
        if (e.owner === me && (e.path.length > 0 || e.halted)) {
          const end = e.path.at(-1);
          out.Movement!.push({
            at: end,
            text: `${name(view, e.formation, e.owner)} ${e.path.length ? `moved ${e.path.length} hex${e.path.length === 1 ? '' : 'es'}` : 'did not move'}${end ? ` ${toPlace(view, end)}` : ''}${e.halted ? `, halted (${e.halted})` : ''}.`,
          });
        } else if (e.owner !== me && e.path.length) {
          sightings.set(e.formation, { owner: e.owner, unitClass: e.unitClass, key: e.path.at(-1)!, moved: true });
        }
        break;
      case 'intel':
        if (!sightings.has(e.formation)) sightings.set(e.formation, { owner: e.owner, unitClass: e.unitClass, key: e.key, moved: false });
        break;
      case 'site_captured':
        out.Territory!.push({
          at: e.key,
          tone: e.to === me ? 'good' : e.from === me ? 'bad' : undefined,
          text: `${view.sites[e.site]?.name ?? e.site} captured by ${nation(view, e.to)} from ${nation(view, e.from)}.`,
        });
        break;
      case 'territory':
        if (e.to === me) totals.gained += 1;
        if (e.from === me) totals.ceded += 1;
        break;
      case 'economy': {
        if (e.nation !== me) break;
        const l = e.ledger;
        const net = netChange(l);
        out.Economy!.push({
          text: `Net change: ${net.credits} credits, ${net.energy} energy, ${net.materials} materials, ${net.food} food. Industry ${l.industry}, research ${l.research}.`,
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
      case 'world_event':
        if (e.choice !== null) out.Production!.push({ text: `${EVENTS[e.event].title}: ${EVENTS[e.event].options[e.choice].label.toLowerCase()} (${describeEffect(EVENTS[e.event].options[e.choice].effect)}).` });
        else out.Production!.push({ tone: 'bad', text: `${EVENTS[e.event].title}: a decision awaits.` });
        break;
      case 'research':
        out.Production!.push({ tone: 'good', text: `Research complete: ${TECHS[e.tech]?.name ?? e.tech}.` });
        break;
      case 'supply':
        out.Supply!.push({ at: e.key, tone: 'bad', text: `${name(view, e.formation, e.nation)} at ${e.supply}% supply ${atPlace(view, e.key)}.` });
        break;
      case 'diplomacy':
        out.Diplomacy!.push({ tone: e.relation === 'war' && (e.a === me || e.b === me) ? 'bad' : undefined, text: `${nation(view, e.a)} and ${nation(view, e.b)} are now at ${e.relation}.` });
        break;
      case 'proposal':
        out.Diplomacy!.push({ text: `${nation(view, e.from)} proposes ${e.proposal === 'nonaggression' ? 'a non-aggression pact' : e.proposal} to ${nation(view, e.to)}.` });
        break;
      case 'treaty':
      case 'treaty_ended':
        out.Diplomacy!.push({ tone: e.a === me || e.b === me ? (e.kind === 'treaty' && e.treaty !== 'embargo' ? 'good' : 'bad') : undefined, text: treatyText(view, e) });
        break;
      case 'construction_queued':
        out.Production!.push({ text: `Construction started: ${FACILITIES[e.facility].name.toLowerCase()} at ${view.sites[e.site]?.name ?? e.site}.` });
        break;
      case 'facility_built':
        out.Production!.push({ tone: 'good', text: `${FACILITIES[e.facility].name} completed at ${view.sites[e.site]?.name ?? e.site}: ${FACILITIES[e.facility].summary.toLowerCase()}` });
        break;
      case 'construction_cancelled':
        out.Production!.push({ tone: 'bad', text: `${FACILITIES[e.facility].name} at ${view.sites[e.site]?.name ?? e.site} lost: ${e.reason}.` });
        break;
      case 'elimination':
        out.Diplomacy!.push({ tone: e.nation === me ? 'bad' : undefined, text: `${nation(view, e.nation)} has been eliminated.` });
        break;
      case 'victory':
        out.Diplomacy!.push({ tone: e.winner === me || e.coalition?.includes(me) ? 'good' : 'bad', text: `${nation(view, e.winner)} wins ${VICTORY_HOW[e.reason]}.` });
        break;
      case 'order_rejected':
        out.Orders!.push({ tone: 'bad', text: `Rejected${e.formation ? ` (${name(view, e.formation, me)})` : ''}: ${e.reason}.` });
        break;
    }
  }
  for (const [, s] of [...sightings].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out.Intelligence!.push({
      at: s.key,
      text: (
        <span className="inline-flex items-center gap-1.5">
          <UnitGlyph unitClass={s.unitClass} color={view.nations[s.owner]?.color ?? '#888'} />
          {nation(view, s.owner)} {UNITS[s.unitClass].name.toLowerCase()} {s.moved ? `moving ${toPlace(view, s.key)}` : `spotted ${atPlace(view, s.key)}`}.
        </span>
      ),
    });
  }
  if (totals.gained || totals.ceded) {
    out.Territory!.unshift({ text: `Hexes gained: ${totals.gained}. Hexes lost: ${totals.ceded}.`, tone: totals.gained >= totals.ceded ? 'good' : 'bad' });
  }
  return { totals, sections: Object.entries(out).filter(([, rows]) => rows.length > 0) };
}

function Kpi({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className="border border-line/70 bg-ink-850 px-3 py-2">
      <div className="font-display text-[9px] tracking-[0.06em] text-faint uppercase">{label}</div>
      <div className={`font-mono text-xl leading-tight font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

const COLLAPSE = 6;

function ReportSection({ title, rows, onShow }: { title: string; rows: Row[]; onShow: (k: HexKey) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, COLLAPSE);
  return (
    <section className="break-inside-avoid border border-line/60 bg-ink-900 p-3">
      <h3 className="mb-1.5 flex items-center justify-between">
        <Label>{title}</Label>
        <span className="font-mono text-[10px] text-faint">{rows.length}</span>
      </h3>
      <ul className="space-y-1">
        {shown.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-snug">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 ${r.tone === 'good' ? 'bg-good' : r.tone === 'bad' ? 'bg-hostile' : 'bg-faint'}`} aria-hidden />
            <span className="flex-1">{r.text}</span>
            {r.at && (
              <button type="button" className="shrink-0 text-[10px] font-semibold tracking-wide text-faint uppercase hover:text-signal" onClick={() => onShow(r.at!)}>
                show
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length > COLLAPSE && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1.5 text-[11px] text-signal hover:underline">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function previousVp(history: TurnReport[], turn: number): Record<string, number> | null {
  return history.find((h) => h.turn === turn - 1)?.victoryPoints ?? null;
}

export function Report() {
  const view = useGame((s) => s.view)!;
  const history = useGame((s) => s.history);
  const setShowReport = useGame((s) => s.setShowReport);
  const focusOn = useGame((s) => s.focusOn);
  const lastTurn = useGame((s) => s.lastTurn);
  const rewatch = useGame((s) => s.rewatch);
  const latest = useGame((s) => s.report);
  // Browse every past report; the newest by default.
  const turns = history.map((h) => h.turn);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = (picked !== null ? history.find((h) => h.turn === picked) : undefined) ?? latest;
  const at = shown ? turns.indexOf(shown.turn) : -1;
  const step = (d: number) => {
    const t = turns[at + d];
    if (t !== undefined) setPicked(t);
  };
  useKeys(
    (e) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    },
    [at, turns.length],
  );
  const report = shown;
  if (!report) return null;
  const { totals, sections } = digest(view, report.events);
  const vp = report.victoryPoints;
  const prev = previousVp(history, report.turn);
  const myVp = vp[view.self.id] ?? 0;
  const vpDelta = prev ? myVp - (prev[view.self.id] ?? 0) : null;
  const clock = turnClock(report.turn);
  const ranked = Object.entries(vp).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const scale = Math.max(view.victoryThreshold, ...ranked.map(([, v]) => v)) * 1.08;
  const show = (k: HexKey) => {
    setShowReport(false);
    focusOn(k);
  };
  const exchange = totals.dealt - totals.lost;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-950/75 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" aria-labelledby="report-title" data-testid="report">
      <div className="report-in flex max-h-full w-full max-w-5xl flex-col border border-line bg-ink-950 shadow-2xl">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5" style={{ background: `linear-gradient(90deg, ${view.self.color}22, transparent 60%)` }}>
          <div>
            <p className="font-display text-[10px] font-bold tracking-[0.1em] text-signal uppercase">
              Situation report · Day {clock.day}, {clock.hour}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={at <= 0} className="border border-line px-2 text-sm text-muted hover:text-text disabled:opacity-30" aria-label="Previous turn" data-testid="report-prev">
                ‹
              </button>
              <h2 id="report-title" className="font-display text-xl font-black tracking-tight">
              Turn {report.turn} resolved
            </h2>
              <button type="button" onClick={() => step(1)} disabled={at < 0 || at >= turns.length - 1} className="border border-line px-2 text-sm text-muted hover:text-text disabled:opacity-30" aria-label="Next turn" data-testid="report-next">
                ›
              </button>
              {at >= 0 && turns.length > 1 && <span className="font-mono text-[10px] text-faint">{at + 1}/{turns.length}</span>}
            </div>
          </div>
          {lastTurn && lastTurn.before.turn === report.turn && (
            <button type="button" onClick={rewatch} className="ml-auto border border-line px-3 py-2 text-xs whitespace-nowrap text-muted hover:border-faint hover:text-text">
              ⟲ Watch it again
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowReport(false)}
            data-testid="close-report"
            className="font-display ml-auto border border-signal bg-signal px-4 py-2 text-xs font-black tracking-wide whitespace-nowrap text-ink-950 uppercase hover:brightness-110"
          >
            Continue planning <span className="ml-1 font-mono text-[10px] font-normal opacity-70 max-sm:hidden">Esc</span>
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Kpi label="Victory points" value={myVp} sub={vpDelta === null ? `need ${view.victoryThreshold}` : vpDelta === 0 ? 'no change' : `${vpDelta > 0 ? '+' : ''}${vpDelta} this turn`} tone={vpDelta && vpDelta < 0 ? 'text-hostile' : vpDelta ? 'text-good' : ''} />
            <Kpi label="Ground" value={`${totals.gained - totals.ceded >= 0 ? '+' : ''}${totals.gained - totals.ceded}`} sub={`${totals.gained} taken · ${totals.ceded} lost`} tone={totals.gained - totals.ceded < 0 ? 'text-hostile' : totals.gained ? 'text-good' : ''} />
            <Kpi label="Engagements" value={totals.battles} sub={totals.battles ? `exchange ${exchange >= 0 ? '+' : ''}${exchange}` : 'quiet front'} tone={totals.battles ? (exchange >= 0 ? 'text-good' : 'text-hostile') : ''} />
            <Kpi label="Losses" value={totals.lost} sub={`${totals.ourDestroyed} formation${totals.ourDestroyed === 1 ? '' : 's'} destroyed`} tone={totals.lost ? 'text-hostile' : ''} />
            <Kpi label="Inflicted" value={totals.dealt} sub={`${totals.theirDestroyed} enemy destroyed`} tone={totals.dealt ? 'text-good' : ''} />
          </div>

          <div className="mt-3 border border-line/60 bg-ink-900 p-3">
            <div className="mb-1.5 flex justify-between">
              <Label>Victory race</Label>
              <span className="text-[10px] text-faint">{view.victoryThreshold} VP wins outright</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ranked.map(([n, v]) => {
                const d = prev ? v - (prev[n] ?? 0) : 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-xs">
                    <Swatch color={view.nations[n]?.color ?? '#888'} />
                    <span className={`w-36 truncate ${n === view.self.id ? 'font-bold' : ''}`}>{view.nations[n]?.name ?? n}</span>
                    <div className="relative h-1.5 flex-1 bg-ink-700">
                      <div className="h-full" style={{ width: `${(v / scale) * 100}%`, background: view.nations[n]?.color }} />
                      <div className="absolute -top-0.5 -bottom-0.5 w-px bg-text/70" style={{ left: `${(view.victoryThreshold / scale) * 100}%` }} />
                    </div>
                    <span className="w-14 text-right font-mono tabular-nums">
                      {v}
                      {d !== 0 && <span className={`ml-1 text-[10px] ${d > 0 ? 'text-good' : 'text-hostile'}`}>{d > 0 ? `+${d}` : d}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 gap-3 space-y-3 md:columns-2">
            {sections.map(([title, rows]) => (
              <ReportSection key={title} title={title} rows={rows} onShow={show} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
