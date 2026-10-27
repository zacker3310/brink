import { useEffect } from 'react';
import { Kbd } from './chrome';
import { STEPS, useCoach, type CoachSnap } from './coach';
import { idleFormations } from './insight';
import { useGame } from './store';
import { usePhone } from './phone';

/** What the coach reads from the game, as plain numbers and flags. */
function useSnap(): CoachSnap | null {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const resolving = useGame((s) => s.resolving);
  const playback = useGame((s) => s.playback);
  const showReport = useGame((s) => s.showReport);
  const showThreat = useGame((s) => s.showThreat);
  const panelOpen = useGame((s) => s.panelOpen);
  const tab = useGame((s) => s.tab);
  const start = useCoach((s) => s.start);
  const reportSeen = useCoach((s) => s.reportSeen);
  if (!view || !draft) return null;
  const orders = Object.values(draft.formations);
  return {
    nation: view.self.name,
    turn: view.turn,
    maxTurns: view.maxTurns,
    start,
    ordered: orders.filter((o) => o.type !== 'hold').length,
    idle: idleFormations(view, draft.formations).length,
    recruiting: draft.recruit.length > 0,
    resolving,
    playback: playback !== null,
    showReport,
    reportSeen,
    showThreat,
    attackOrdered: orders.some((o) => o.type === 'attack'),
    diplomacyOpen: panelOpen && tab === 'diplomacy',
  };
}

/** A shortcut for the step: put the thing it talks about in front of the player. */
function useShowMe(id: string): { label: string; run: () => void } | null {
  const view = useGame((s) => s.view);
  const g = useGame.getState;
  if (!view) return null;
  if (id === 'move' || id === 'all') return { label: 'Select a unit', run: () => g().nextIdle() };
  if (id === 'build') {
    const capital = Object.values(view.sites).find((s) => s.owner === view.self.id && s.kind === 'capital');
    if (!capital) return null;
    return {
      label: 'Open the capital',
      run: () => {
        g().focusOn(capital.key);
        g().openCity(capital.id);
      },
    };
  }
  if (id === 'attack') {
    const enemy = Object.values(view.contacts).find((c) => c.confirmed && view.relations[c.owner] === 'war');
    return enemy ? { label: 'Show me an enemy', run: () => g().focusOn(enemy.key) } : null;
  }
  if (id === 'report') return { label: 'Open the summary', run: () => g().setShowReport(true) };
  if (id === 'threat') return { label: 'Show threats', run: () => g().toggleThreat() };
  if (id === 'diplomacy') return { label: 'Open Diplomacy', run: () => g().setTab('diplomacy') };
  return null;
}

export function Coach() {
  const active = useCoach((s) => s.active);
  const step = useCoach((s) => s.step);
  const next = useCoach((s) => s.next);
  const finish = useCoach((s) => s.finish);
  const snap = useSnap();
  const showReport = useGame((s) => s.showReport);
  const shifted = useGame((s) => s.panelOpen || s.selectedCity !== null);
  const cityOpen = useGame((s) => s.selectedCity !== null);
  const phone = usePhone();
  const def = STEPS[step];
  const showMe = useShowMe(def?.id ?? '');
  const complete = active && def?.done && snap ? def.done(snap) : false;

  const sawReport = useCoach((s) => s.sawReport);
  useEffect(() => {
    if (active && def?.id === 'report' && showReport) sawReport();
  }, [active, def?.id, showReport, sawReport]);

  // A step the player has already done moves on by itself.
  useEffect(() => {
    if (complete) next();
  }, [complete, next]);

  if (!active || !def || !snap) return null;
  const body = phone && def.touch ? def.touch(snap) : def.body(snap);
  // Over the turn summary (or, on a phone, a city sheet) the coach shrinks to a strip out of the way.
  if (showReport || (phone && cityOpen)) {
    return (
      <section className={`coach fixed left-1/2 z-40 w-[min(720px,calc(100%-24px))] -translate-x-1/2 ds-panel border-signal/70 px-3 py-2 shadow-2xl ${phone ? 'top-[calc(env(safe-area-inset-top)+6px)]' : 'bottom-3'}`} data-testid="coach" data-step={def.id} aria-live="polite" aria-label="Guided first match">
        <span className="ds-label mr-2 text-signal">
          {step + 1}/{STEPS.length} · {def.title}
        </span>
        <span className="text-xs text-muted">{body}</span>
      </section>
    );
  }
  const place = phone
    ? 'top-[calc(env(safe-area-inset-top)+88px)] left-2 right-2'
    : shifted ? 'bottom-36 left-[calc(50%+180px)] w-[380px] -translate-x-1/2' : 'bottom-3 left-1/2 w-[420px] -translate-x-1/2';
  return (
    <section className={`coach panel-in fixed z-40 ds-panel border-signal/70 shadow-2xl ${phone ? 'px-3 py-2' : 'p-3'} ${place}`} data-testid="coach" data-step={def.id} aria-live="polite" aria-label="Guided first match">
      <div className="flex items-center justify-between gap-2">
        <span className="ds-label text-signal">
          Boot camp · {step + 1}/{STEPS.length}
        </span>
        <button type="button" onClick={finish} className="text-[10px] text-faint uppercase hover:text-text" data-testid="coach-skip-all">
          End guide
        </button>
      </div>
      <div className="mt-1 h-0.5 bg-ink-700">
        <div className="h-full bg-signal transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <h2 className="font-display mt-2 text-lg leading-tight font-bold tracking-wide uppercase" data-testid="coach-title">
        {def.title}
      </h2>
      <p className={`mt-1 text-xs text-muted ${phone ? 'leading-snug' : 'leading-relaxed'}`}>{body}</p>
      {def.keys && !phone && (
        <div className="mt-2 flex flex-wrap gap-1">
          {def.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </div>
      )}
      <div className={`flex items-center justify-end gap-2 ${phone ? 'mt-1.5' : 'mt-3'}`}>
        {showMe && !snap.resolving && (
          <button type="button" onClick={showMe.run} className="border border-line px-2.5 py-1 text-[11px] text-muted hover:border-faint hover:text-text" data-testid="coach-show">
            {showMe.label}
          </button>
        )}
        {def.skippable && (
          <button type="button" onClick={next} className="px-2 py-1 text-[11px] text-faint hover:text-text" data-testid="coach-skip">
            Later
          </button>
        )}
        {!def.done && (
          <button type="button" onClick={next} className="bg-signal px-3 py-1 font-display text-sm font-bold tracking-wide text-ink-950 uppercase hover:brightness-110" data-testid="coach-next">
            {step === STEPS.length - 1 ? 'Dismissed' : 'Got it'}
          </button>
        )}
      </div>
    </section>
  );
}
