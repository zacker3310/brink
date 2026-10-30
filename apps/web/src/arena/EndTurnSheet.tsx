import { useEffect, useState } from 'react';
import { advise, type Action, type Battle, type Unit } from '@brink/arena';

// End Turn with units still ready: each one by name with its best option (the advice, worked out a
// unit at a time so the sheet opens at once), Do It or Hold per unit, the crews acting for all of
// them, ending now, or Reset Turn when the turn can be taken back.

export interface ResetState {
  ok: boolean;
  /** Why it cannot reset, or what a reset would do. */
  note: string;
  onReset: () => void;
}

export function EndTurnSheet({
  b,
  version,
  describe,
  onDo,
  onHold,
  onAuto,
  onEnd,
  onClose,
  reset,
}: {
  b: Battle;
  /** Changes whenever a unit's position or state does: the advice is worked out again. */
  version: string;
  describe: (u: Unit, plan: Action[]) => string;
  onDo: (u: Unit, plan: Action[]) => void;
  onHold: (u: Unit) => void;
  onAuto: () => void;
  onEnd: () => void;
  onClose: () => void;
  reset: ResetState;
}) {
  const ready = b.units.filter((u) => u.side === 'blue' && u.alive && !u.acted && !u.carrier);
  const [plans, setPlans] = useState<Record<string, Action[]>>({});
  useEffect(() => {
    setPlans({});
    const ids = b.units.filter((u) => u.side === 'blue' && u.alive && !u.acted && !u.carrier).map((u) => u.id);
    let i = 0;
    let timer = 0;
    // One unit per task: each plan takes a moment, and the sheet should answer taps meanwhile.
    const next = () => {
      const id = ids[i++];
      if (!id) return;
      const plan = advise(b, id);
      setPlans((p) => ({ ...p, [id]: plan }));
      timer = window.setTimeout(next, 0);
    };
    timer = window.setTimeout(next, 30);
    return () => clearTimeout(timer);
  }, [b, version]);

  const n = ready.length;
  return (
    <div className="vercel absolute inset-0 z-20 flex items-end bg-black/60" data-testid="arena-end-confirm" onClick={onClose}>
      <div className="safe-bottom safe-x flex max-h-full w-full flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mx-2 mt-2 mb-2 flex min-h-0 flex-col rounded-2xl bg-ink-900 p-4">
          <div className="text-[17px] font-bold">{n === 0 ? 'Every Unit Has Acted' : n === 1 ? '1 Unit Still Ready' : `${n} Units Still Ready`}</div>
          <p className="mt-0.5 text-[14px] text-muted">{n === 0 ? 'End the turn when you are ready.' : 'Each has its best option: do it, hold the unit where it is, or let the crews act for all of them.'}</p>
          {n > 0 && (
            <ul className="mt-2 min-h-[64px] shrink divide-y divide-line overflow-y-auto" data-testid="end-ready">
              {ready.map((u) => {
                const plan = plans[u.id];
                return (
                  <li key={u.id} className="flex items-center gap-2 py-2" data-testid={`end-unit-${u.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{u.name}</div>
                      <div className="text-[13px] leading-snug text-muted">{plan ? (plan.length ? describe(u, plan) : 'Nothing worth doing from here.') : 'Working out its best option…'}</div>
                    </div>
                    {plan && plan.length > 0 && (
                      <button type="button" onClick={() => onDo(u, plan)} className="v-btn v-btn-primary h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold" data-testid={`end-do-${u.id}`}>
                        Do It
                      </button>
                    )}
                    <button type="button" onClick={() => onHold(u)} className="v-btn v-btn-secondary h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold" data-testid={`end-hold-${u.id}`}>
                      Hold
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex shrink-0 flex-col gap-2">
            {n > 0 ? (
              <>
                <button type="button" onClick={onAuto} className="v-btn v-btn-primary h-12 text-[16px] font-semibold" data-testid="arena-end-auto">
                  Crews Act, Then End Turn
                </button>
                <button type="button" onClick={onEnd} className="v-btn v-btn-secondary h-12 text-[15px]" data-testid="arena-end-now">
                  End Turn Now
                </button>
              </>
            ) : (
              <button type="button" onClick={onEnd} className="v-btn v-btn-primary h-12 text-[16px] font-semibold" data-testid="arena-end-now">
                End Turn
              </button>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={!reset.ok} onClick={reset.onReset} className="v-btn v-btn-secondary h-12 flex-1 text-[15px] disabled:opacity-40" data-testid="arena-reset">
                Reset Turn
              </button>
              <button type="button" onClick={onClose} className="v-btn v-btn-secondary h-12 flex-1 text-[15px]" data-testid="arena-end-cancel">
                Keep Playing
              </button>
            </div>
            <p className="text-[13px] text-muted" data-testid="arena-reset-note">
              {reset.note}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
