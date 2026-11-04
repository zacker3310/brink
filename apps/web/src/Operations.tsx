import { useMemo } from 'react';
import { operationById, proposeOperations, type Operation, type OperationPhase } from '@brink/ai';
import { Icon } from './icons';
import { useGame } from './store';

// Operations: the staff's campaign plans. The sheet offers the best few, each with its phases,
// odds, time and what stands in the way; Launch makes it the staff's objective every turn until
// the prize falls. The strip over the map says where the running one stands.

const ODDS_TONE: Record<Operation['odds'], string> = {
  good: 'border-good/60 text-good',
  even: 'border-signal/60 text-signal',
  bad: 'border-hostile/60 text-hostile',
  unknown: 'border-line text-muted',
};
const ODDS_LABEL: Record<Operation['odds'], string> = { good: 'Likely win', even: 'Even fight', bad: 'Risky', unknown: 'Unscouted' };

function PhaseDot({ state }: { state: OperationPhase['state'] }) {
  if (state === 'done')
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good/90 text-ink-950">
        <Icon name="check" className="h-3 w-3" />
      </span>
    );
  return <span className={`h-5 w-5 shrink-0 rounded-full border-2 ${state === 'now' ? 'border-signal bg-signal/25' : 'border-line'}`} />;
}

function Phases({ phases }: { phases: OperationPhase[] }) {
  return (
    <ol className="mt-2 flex flex-col gap-1.5">
      {phases.map((p, i) => (
        <li key={p.id} className="flex items-start gap-2">
          <PhaseDot state={p.state} />
          <span className="min-w-0 leading-tight">
            <span className={`block text-[13px] font-semibold ${p.state === 'next' ? 'text-muted' : 'text-text'}`}>
              {i + 1}. {p.title}
              {p.state === 'now' && <span className="ml-1.5 font-mono text-[10px] text-signal uppercase">this turn</span>}
            </span>
            <span className="block text-[12px] text-muted">{p.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function OperationCard({ op, active, onLaunch, onShow }: { op: Operation; active: boolean; onLaunch: () => void; onShow: () => void }) {
  return (
    <article className={`rounded-xl border bg-ink-900 p-3 ${active ? 'border-signal' : 'border-line'}`} data-testid="operation">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-wide text-signal uppercase">{op.codename}</div>
          <h3 className="font-display text-xl leading-tight font-extrabold tracking-wide uppercase">{op.name}</h3>
          <div className="mt-0.5 text-[12px] text-muted">
            {op.kind === 'amphibious' ? 'Amphibious landing' : 'Overland assault'} · {op.victoryPoints} VP · ~{op.turns} turn{op.turns === 1 ? '' : 's'}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase ${ODDS_TONE[op.odds]}`}>{ODDS_LABEL[op.odds]}</span>
      </header>
      <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-text">
        {op.why.map((w) => (
          <li key={w}>· {w}</li>
        ))}
        {op.warnings.map((w) => (
          <li key={w} className="text-hostile">
            ! {w}
          </li>
        ))}
      </ul>
      <Phases phases={op.phases} />
      <div className="mt-2 font-mono text-[11px] text-muted">
        Force: {op.army.length} assault unit{op.army.length === 1 ? '' : 's'}
        {op.support.length > 0 && `, ${op.support.length} in support`}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onShow} className="h-11 flex-1 rounded-lg border border-line bg-ink-850 text-[13px] active:bg-ink-700">
          Show on map
        </button>
        <button
          type="button"
          onClick={onLaunch}
          disabled={active}
          className="font-display h-11 flex-[1.4] rounded-lg bg-signal text-[14px] font-extrabold tracking-wide text-ink-950 uppercase active:brightness-90 disabled:opacity-40"
          data-testid="operation-launch"
        >
          {active ? 'Running' : 'Launch'}
        </button>
      </div>
    </article>
  );
}

/** The staff's proposals, and the running operation first. */
export function OperationsSheet() {
  const open = useGame((s) => s.opsOpen);
  const setOpen = useGame((s) => s.setOpsOpen);
  const view = useGame((s) => s.view);
  const active = useGame((s) => s.operation);
  const launch = useGame((s) => s.launchOperation);
  const cancel = useGame((s) => s.cancelOperation);
  const focusOn = useGame((s) => s.focusOn);
  const ops = useMemo(() => {
    if (!open || !view) return [];
    const list = proposeOperations(view, 4);
    const running = active ? operationById(view, active.id, active.kind) : null;
    return running ? [running, ...list.filter((o) => o.id !== running.id)].slice(0, 4) : list;
  }, [open, view, active]);
  if (!open || !view) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-end justify-center bg-ink-950/70 sm:items-center" onClick={() => setOpen(false)} data-testid="operations">
      <div
        className="safe-bottom sheet-in max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-line bg-ink-950 p-3 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Operations"
      >
        <div className="mb-2 flex items-center gap-2">
          <Icon name="objective" className="h-5 w-5 text-signal" />
          <h2 className="font-display flex-1 text-lg font-black tracking-[0.08em] uppercase">Operations</h2>
          <button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg active:bg-ink-800" aria-label="Close">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-[13px] text-muted">
          Pick a prize and the staff runs the whole campaign for it: marching, loading the ships, the crossing, the landing and the assault. Every turn it drafts that turn&apos;s orders; you can change any of them. Ships, air wings and drones near the target fight in the battle as fire support.
        </p>
        {active && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-signal/50 bg-signal/10 px-3 py-2 text-[13px]">
            <span className="flex-1">
              Running: <b>{active.codename}</b>, {active.name}
            </span>
            <button type="button" onClick={cancel} className="h-10 rounded-lg border border-line px-3 text-[13px] active:bg-ink-800" data-testid="operation-cancel">
              Call off
            </button>
          </div>
        )}
        {ops.length === 0 && <p className="text-[13px] text-muted">No prize in reach: you are at war with no one, or nothing hostile is on the map you know.</p>}
        <div className="flex flex-col gap-3">
          {ops.map((op) => (
            <OperationCard
              key={op.id}
              op={op}
              active={active?.id === op.id}
              onLaunch={() => launch(op)}
              onShow={() => {
                setOpen(false);
                focusOn(op.at);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Where the running operation stands, or a nudge to pick one. Tapping opens the sheet. */
export function OperationStrip({ className = '' }: { className?: string }) {
  const view = useGame((s) => s.view);
  const active = useGame((s) => s.operation);
  const setOpen = useGame((s) => s.setOpsOpen);
  const op = useMemo(() => (view && active ? operationById(view, active.id, active.kind) : null), [view, active]);
  if (!view || view.victory) return null;
  if (!op || !active) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`pointer-events-auto flex items-center gap-2 rounded-full border border-signal/50 bg-ink-900/95 px-3 py-1.5 text-[13px] shadow-lg active:bg-ink-800 ${className}`}
        data-testid="operations-open"
      >
        <Icon name="objective" className="h-4 w-4 text-signal" />
        <span className="font-display font-bold tracking-wide uppercase">Plan an operation</span>
      </button>
    );
  }
  const n = op.phases.findIndex((p) => p.state === 'now');
  const now = op.phases[n];
  const done = op.phases.filter((p) => p.state === 'done').length;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-xl border border-signal/60 bg-ink-900/95 px-3 py-2 text-left shadow-lg active:bg-ink-800 ${className}`}
      data-testid="operation-strip"
    >
      <Icon name="objective" className="h-5 w-5 shrink-0 text-signal" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-mono text-[10px] tracking-wide text-signal uppercase">
          {active.codename} · {done}/{op.phases.length}
        </span>
        <span className="block truncate text-[13px] font-semibold">
          {op.name}: {now ? now.title : 'Assault'} · ~{op.turns} turn{op.turns === 1 ? '' : 's'}
        </span>
      </span>
      <span className="flex shrink-0 gap-0.5" aria-hidden>
        {op.phases.map((p) => (
          <span key={p.id} className={`h-1.5 w-3 rounded-full ${p.state === 'done' ? 'bg-good' : p.state === 'now' ? 'bg-signal' : 'bg-ink-600'}`} />
        ))}
      </span>
    </button>
  );
}
