import { useEffect } from 'react';
import './menu/front.css';
import { Kbd, useKeys } from './chrome';
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
  const planned = useGame((s) => s.planned.length);
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
    planned,
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

/** A shortcut for the step: do (or show) the thing it talks about. */
function useShowMe(id: string): { label: string; run: () => void } | null {
  const view = useGame((s) => s.view);
  const g = useGame.getState;
  if (!view) return null;
  if (id === 'move') return { label: 'Select a unit', run: () => g().nextIdle() };
  if (id === 'plan') return { label: 'Let the staff plan', run: () => void g().autoCommand() };
  if (id === 'end') return { label: 'Review orders', run: () => g().openReview() };
  if (id === 'done') return { label: 'Turn summary', run: () => g().setShowReport(true) };
  return null;
}

/** Five pips: done, current, to come. */
function Pips({ step }: { step: number }) {
  return (
    <span className="coach-pips" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <i key={s.id} data-state={i < step ? 'done' : i === step ? 'now' : 'next'} />
      ))}
    </span>
  );
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
    if (active && showReport) sawReport();
  }, [active, showReport, sawReport]);

  // On a keyboard the coach's own buttons have keys: P lets the staff plan, Enter dismisses a step
  // that waits for "Got it". Not over the review, the summary or the replay, which own Enter.
  useKeys(
    (e) => {
      if (!active || !def || phone || e.ctrlKey || e.metaKey || e.altKey) return;
      const g = useGame.getState();
      if (g.review || g.showReport || g.playback || g.selectedCity) return;
      if (def.id === 'plan' && e.key.toLowerCase() === 'p') showMe?.run();
      else if (!def.done && e.key === 'Enter' && !document.activeElement?.closest('button, a, input, select, textarea')) next();
    },
    [active, def?.id, phone, showMe?.label],
  );

  // A step the player has already done moves on by itself.
  useEffect(() => {
    if (complete) next();
  }, [complete, next]);

  if (!active || !def || !snap) return null;
  const body = phone && def.touch ? def.touch(snap) : def.body(snap);
  const action = phone && def.touchAction ? def.touchAction(snap) : def.action?.(snap);
  // Over the turn summary (or, on a phone, a city sheet) the coach shrinks to a strip out of the way.
  if (showReport || (phone && cityOpen)) {
    return (
      <section
        className={`coach coach-strip fixed left-1/2 z-40 w-[min(720px,calc(100%-24px))] -translate-x-1/2 ${phone ? 'top-[calc(env(safe-area-inset-top)+6px)]' : 'bottom-3'}`}
        data-testid="coach"
        data-step={def.id}
        aria-live="polite"
        aria-label="Guided first match"
      >
        <span className="coach-kicker mr-2">
          {step + 1}/{STEPS.length} · {def.title}
        </span>
        <span className="text-xs text-muted">{action ?? body}</span>
      </section>
    );
  }
  const place = phone
    ? 'top-[calc(env(safe-area-inset-top)+104px)] left-2 right-2'
    : shifted
      ? 'bottom-36 left-[calc(50%+180px)] w-[400px] -translate-x-1/2'
      : 'bottom-3 left-1/2 w-[440px] -translate-x-1/2';
  return (
    <section
      key={def.id}
      className={`coach coach-card panel-in fixed z-40 ${phone ? 'coach-compact' : ''} ${place}`}
      data-testid="coach"
      data-step={def.id}
      aria-live="polite"
      aria-label="Guided first match"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="coach-kicker flex items-center gap-2">
          Boot camp
          <Pips step={step} />
        </span>
        <button type="button" onClick={finish} className="min-h-6 text-[10px] text-faint uppercase hover:text-text" data-testid="coach-skip-all">
          End guide
        </button>
      </div>
      <h2 className="coach-title" data-testid="coach-title">
        {def.title}
      </h2>
      <p className="coach-body">{body}</p>
      {action && (
        <p className="coach-action" data-testid="coach-action">
          <svg viewBox="0 0 12 12" className="coach-action-arrow" aria-hidden>
            <path d="M3 1.5L8.5 6 3 10.5z" fill="currentColor" />
          </svg>
          {action}
        </p>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${phone ? 'mt-1.5' : 'mt-2.5'}`}>
        {def.keys && !phone && def.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
        <span className="flex-1" />
        {showMe && !snap.resolving && (
          <button type="button" onClick={showMe.run} className="coach-btn" data-testid="coach-show">
            {showMe.label}
          </button>
        )}
        {def.skippable && (
          <button type="button" onClick={next} className="coach-btn coach-btn-quiet" data-testid="coach-skip">
            Later
          </button>
        )}
        {!def.done && (
          <button type="button" onClick={next} className="coach-btn coach-btn-go" data-testid="coach-next">
            {step === STEPS.length - 1 ? 'Dismissed' : 'Got it'}
          </button>
        )}
      </div>
    </section>
  );
}
