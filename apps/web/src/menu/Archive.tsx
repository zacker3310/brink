import { NATIONS, SCENARIOS } from '@brink/scenarios';
import { latestSlot, readSlot, SLOT_NAMES, type SlotInfo } from '../saves';
import { Frame, Label, relativeTime, ScreenHeader, useKeys } from '../chrome';

export function Archive({
  slots,
  onBack,
  onLoad,
  onError,
}: {
  slots: SlotInfo[];
  onBack: () => void;
  onLoad: (text: string) => void;
  onError: (text: string) => void;
}) {
  const maxTurns = SCENARIOS[0]!.maxTurns;
  const latest = latestSlot(slots);
  useKeys((e) => e.key === 'Escape' && onBack(), [onBack]);

  return (
    <main className="flex min-h-full flex-col">
      <ScreenHeader kicker="Operations archive" title="Load campaign" onBack={onBack} />
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        <ul className="grid gap-3 sm:grid-cols-3">
          {SLOT_NAMES.map((slot, i) => {
            const info = slots.find((s) => s.slot === slot);
            const nation = info ? NATIONS.find((n) => n.id === info.nation) : undefined;
            const progress = info ? Math.min(100, ((info.turn - 1) / maxTurns) * 100) : 0;
            return (
              <li key={slot} className={`enter-${i + 1}`}>
                <Frame className="flex h-full flex-col overflow-hidden" accent={nation?.color}>
                  <div className="h-1" style={{ background: nation?.color ?? 'transparent' }} aria-hidden />
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-center justify-between">
                      <Label>{slot}</Label>
                      {info && info.slot === latest?.slot && <span className="font-display text-[10px] font-semibold tracking-[0.2em] text-signal uppercase">Latest</span>}
                    </div>
                    {info ? (
                      <>
                        <div className="mt-2 text-lg leading-tight font-bold" style={{ color: nation?.color }}>
                          {nation?.name ?? info.nation}
                        </div>
                        <div className="text-xs text-muted">{info.label}</div>
                        <div className="mt-3 flex items-baseline justify-between font-mono text-xs">
                          <span className="text-muted">
                            Turn {Math.min(info.turn, maxTurns)} / {maxTurns}
                          </span>
                          <span className="text-faint">{relativeTime(info.savedAt)}</span>
                        </div>
                        <div className="mt-1 h-1 bg-ink-700" role="meter" aria-label="Campaign progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full" style={{ width: `${progress}%`, background: nation?.color ?? 'var(--color-signal)' }} />
                        </div>
                        <div className="mt-1 text-[10px] text-faint">{new Date(info.savedAt).toLocaleString()}</div>
                      </>
                    ) : (
                      <div className="mt-2 flex flex-1 items-center justify-center border border-dashed border-line/70 py-8 text-xs text-faint">No operation on file</div>
                    )}
                    <button
                      type="button"
                      disabled={!info}
                      data-testid={`load-${slot.replace(' ', '-').toLowerCase()}`}
                      onClick={() => {
                        const text = readSlot(slot);
                        if (text) onLoad(text);
                        else onError('That slot could not be read');
                      }}
                      className="font-display mt-4 border border-signal/70 bg-signal/10 px-3 py-2 text-xs font-bold tracking-[0.2em] text-signal uppercase transition-colors hover:bg-signal hover:text-ink-950 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-faint"
                    >
                      Resume
                    </button>
                  </div>
                </Frame>
              </li>
            );
          })}
        </ul>

        <Frame className="enter-4 mt-4 p-4">
          <label className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
            <span className="font-display border border-line bg-ink-800 px-3 py-2 text-xs font-semibold tracking-[0.16em] uppercase hover:border-faint">Import file…</span>
            <span className="text-xs text-muted">Load a campaign exported as JSON. The engine validates it before play resumes.</span>
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              data-testid="load-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(onLoad);
              }}
            />
          </label>
        </Frame>
      </div>
    </main>
  );
}
