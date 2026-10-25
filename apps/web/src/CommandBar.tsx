import { useEffect, useState, type ReactNode } from 'react';
import type { FormationOrder, SupplyPriority } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import type { AssaultPreview, StrikePreview } from '@brink/simulation';
import { Kbd } from './chrome';
import { engine } from './engine';
import { UnitGlyph } from './glyphs';
import { idleFormations } from './insight';
import { describeOrder, hostilesAt, type Mode } from './planning';
import { useGame } from './store';

function usePreview(order: FormationOrder | undefined, fid: string | null) {
  const [preview, setPreview] = useState<{ assault?: AssaultPreview | null; strike?: StrikePreview | null } | null>(null);
  useEffect(() => {
    let live = true;
    setPreview(null);
    if (!fid || order?.type !== 'attack') return;
    const view = useGame.getState().view!;
    const ranged = UNITS[view.formations[fid]!.unitClass].range > 0;
    void engine.call(ranged ? { type: 'previewStrike', source: fid, target: order.target } : { type: 'previewAssault', attackers: [fid], target: order.target }).then((r) => {
      if (!live) return;
      if (r.type === 'assault') setPreview({ assault: r.preview });
      if (r.type === 'strike') setPreview({ strike: r.preview });
    });
    return () => {
      live = false;
    };
  }, [order, fid]);
  return preview;
}

const OUTCOME: Record<string, { text: string; tone: string }> = {
  attacker_victory: { text: 'Breakthrough', tone: 'text-friendly' },
  inconclusive: { text: 'Stalemate', tone: 'text-signal' },
  defender_held: { text: 'Repulsed', tone: 'text-hostile' },
};

function Seg({
  children,
  active,
  onClick,
  disabled,
  testId,
  hotkey,
  title,
  danger,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  hotkey?: string;
  title?: string;
  danger?: boolean;
}) {
  const on = danger ? 'border-hostile bg-hostile/20 text-hostile' : 'border-signal bg-signal/15 text-signal';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      aria-pressed={active}
      className={`group relative -ml-px border px-2.5 py-1.5 text-xs font-semibold transition-colors first:ml-0 disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? `z-10 ${on}` : 'border-line bg-ink-850 text-text/90 hover:z-10 hover:border-faint hover:bg-ink-800'
      }`}
    >
      {children}
      {hotkey && <span className="ml-1.5 font-mono text-[9px] font-normal text-faint group-hover:text-muted">{hotkey}</span>}
    </button>
  );
}

/** Two bars, our loss against theirs, drawn as ranges on a shared scale. */
function LossBars({ ours, theirs }: { ours: readonly [number, number]; theirs: readonly [number, number] }) {
  const max = Math.max(ours[1], theirs[1], 1);
  const bar = (r: readonly [number, number], color: string) => (
    <div className="relative h-1.5 w-28 bg-ink-700">
      <div className="absolute inset-y-0 opacity-40" style={{ left: 0, width: `${(r[1] / max) * 100}%`, background: color }} />
      <div className="absolute inset-y-0" style={{ left: 0, width: `${(r[0] / max) * 100}%`, background: color }} />
    </div>
  );
  return (
    <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-2 gap-y-0.5 font-mono text-[10px]">
      <span className="text-muted">Us</span>
      {bar(ours, 'var(--color-hostile)')}
      <span>
        −{ours[0]}–{ours[1]}
      </span>
      <span className="text-muted">Them</span>
      {bar(theirs, 'var(--color-friendly)')}
      <span>
        −{theirs[0]}–{theirs[1]}
      </span>
    </div>
  );
}

export function CommandBar() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const fid = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const setMode = useGame((s) => s.setMode);
  const setOrder = useGame((s) => s.setOrder);
  const setPriority = useGame((s) => s.setPriority);
  const submit = useGame((s) => s.submit);
  const nextIdle = useGame((s) => s.nextIdle);
  const resolving = useGame((s) => s.resolving);
  const rejected = useGame((s) => s.rejected);
  const report = useGame((s) => s.report);
  const setShowReport = useGame((s) => s.setShowReport);
  const f = fid ? view.formations[fid] : undefined;
  const order = fid ? draft.formations[fid] : undefined;
  const preview = usePreview(order, fid);
  const total = Object.keys(view.formations).length;
  const idle = idleFormations(view, draft.formations).length;
  const over = view.victory !== null;
  const def = f ? UNITS[f.unitClass] : undefined;
  const modes: [Mode, string, string][] = [
    ['move', 'Move', 'M'],
    ['attack', def && def.range > 0 ? 'Strike' : 'Attack', 'A'],
    ['recon', 'Recon', 'R'],
    ['withdraw', 'Withdraw', 'W'],
  ];
  const priority: SupplyPriority = (f && (draft.supplyPriority?.[f.id] ?? f.supplyPriority)) || 'normal';

  return (
    <footer className="relative border-t border-line bg-ink-900" data-testid="command-bar">
      {rejected.length > 0 && (
        <ul className="border-b border-hostile/40 bg-hostile/10 px-4 py-1 text-[11px] text-hostile" data-testid="rejections">
          {rejected.slice(0, 3).map((e, i) => (
            <li key={i}>⚠ {e.kind === 'order_rejected' ? `${e.formation ? `${view.formations[e.formation]?.name ?? e.formation}: ` : ''}${e.reason}` : ''}</li>
          ))}
        </ul>
      )}
      <div className="flex min-h-[64px] items-center gap-4 px-4 py-2">
        {f && def ? (
          <>
            <div className="flex w-56 shrink-0 items-center gap-2.5">
              <div className="flex h-10 w-12 items-center justify-center border border-line" style={{ background: `${view.self.color}22` }}>
                <UnitGlyph unitClass={f.unitClass} color={view.self.color} className="h-5 w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{f.name}</div>
                <div className="mt-0.5 h-1 bg-ink-700">
                  <div className={`h-full ${f.strength < 400 ? 'bg-hostile' : 'bg-friendly'}`} style={{ width: `${f.strength / 10}%` }} />
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted" data-testid="planned-order">
                  <span className={order ? 'text-signal' : ''}>{describeOrder(order, view)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex" role="toolbar" aria-label="Orders">
                <Seg onClick={() => setOrder(f.id, { type: 'hold' })} active={order?.type === 'hold'} testId="order-hold" disabled={resolving} hotkey="H">
                  Hold
                </Seg>
                <Seg onClick={() => setOrder(f.id, { type: 'defend' })} active={order?.type === 'defend'} testId="order-defend" disabled={resolving || !def.ground} hotkey="D">
                  Defend
                </Seg>
                <span className="w-2" aria-hidden />
                {modes.map(([m, label, key]) => (
                  <Seg key={m} onClick={() => setMode(m)} active={mode === m} danger={m === 'attack'} testId={`mode-${m}`} disabled={resolving || (!def.ground && m !== 'attack' && m !== 'move')} hotkey={key} title={`Then click the map to ${label.toLowerCase()}`}>
                    {label}
                  </Seg>
                ))}
                <span className="w-2" aria-hidden />
                <Seg onClick={() => setOrder(f.id, null)} disabled={resolving || !order} hotkey="X" testId="order-clear">
                  Clear
                </Seg>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-faint">
                <span className="tracking-[0.16em] uppercase">Supply</span>
                <div className="flex">
                  {(['high', 'normal', 'low'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(f.id, p)}
                      disabled={resolving}
                      aria-pressed={priority === p}
                      className={`-ml-px border px-1.5 py-px first:ml-0 ${priority === p ? 'z-10 border-signal/70 text-signal' : 'border-line text-muted hover:text-text'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <span>
                  move {def.movement || '—'} · atk {def.softAttack}/{def.hardAttack} · def {def.defense}
                  {def.range ? ` · range ${def.range}` : ''}
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              {preview?.assault && (
                <div className="flex items-center gap-3" data-testid="preview">
                  {preview.assault.defenders === 0 ? (
                    <span className="text-[11px] text-muted">No enemy seen there: you will try to take the hex.</span>
                  ) : (
                    <>
                      <LossBars ours={preview.assault.attackerLoss} theirs={preview.assault.defenderLoss} />
                      <div className="text-[11px] leading-tight">
                        <div className="text-[9px] tracking-[0.16em] text-faint uppercase">Likely · {preview.assault.confidence} intel</div>
                        {preview.assault.outcomes.map((o) => (
                          <div key={o} className={`font-bold ${OUTCOME[o]?.tone}`}>
                            {OUTCOME[o]?.text}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {preview?.strike && (
                <div className="text-[11px]" data-testid="preview">
                  <div className="text-[9px] tracking-[0.16em] text-faint uppercase">Strike estimate · {preview.strike.confidence} intel</div>
                  {preview.strike.targets === 0 ? (
                    <span className="text-muted">No confirmed targets.</span>
                  ) : (
                    <span>
                      {preview.strike.targets} target{preview.strike.targets === 1 ? '' : 's'}, <span className="font-mono text-friendly">−{preview.strike.loss[0]}–{preview.strike.loss[1]}</span> strength each
                    </span>
                  )}
                </div>
              )}
              {order?.type === 'attack' && hostilesAt(view, order.target).length === 0 && !preview && <span className="text-[11px] text-faint">No contact at target.</span>}
            </div>
          </>
        ) : (
          <div className="flex-1 text-xs text-muted">
            Select a formation on the map or in Military to give it orders. <Kbd>N</Kbd> jumps to the next unit without orders.
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {report && (
            <button type="button" onClick={() => setShowReport(true)} data-testid="open-report" className="border border-line px-2.5 py-1.5 text-xs text-muted hover:border-faint hover:text-text">
              Turn {report.turn} report
            </button>
          )}
          <button
            type="button"
            onClick={nextIdle}
            disabled={idle === 0 || resolving}
            data-testid="next-idle"
            className="border border-line px-2.5 py-1.5 text-left text-xs leading-tight hover:border-faint disabled:opacity-40"
            title="Select the next formation without orders (N)"
          >
            <div className="font-mono">
              <span className={idle ? 'text-signal' : 'text-friendly'}>{total - idle}</span>
              <span className="text-faint">/{total}</span>
            </div>
            <div className="text-[10px] text-muted">{idle ? `${idle} idle · N` : 'all ordered'}</div>
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={resolving || over}
            data-testid="end-turn"
            className="end-turn group relative overflow-hidden border border-signal bg-signal px-4 py-2 text-left text-ink-950 transition-all hover:brightness-110 disabled:opacity-60"
          >
            <div className="text-[9px] font-bold tracking-[0.24em] uppercase opacity-70">{resolving ? 'Orders locked' : over ? 'Campaign over' : 'Ctrl + Enter'}</div>
            <div className="text-sm font-black tracking-wide uppercase">{resolving ? 'Resolving…' : over ? 'Match over' : `End turn ${view.turn}`}</div>
          </button>
        </div>
      </div>
    </footer>
  );
}
