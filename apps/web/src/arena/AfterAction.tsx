import { ROUND_LIMIT, roundLosses, sideValue, startValue, turningPoint, type Battle } from '@brink/arena';

// The after-action grade on the verdict: Speed (rounds used), Power (their strength destroyed, as
// far as you saw it go), Technique (your own strength kept), and the round that turned the battle,
// read from the event log.

type Grade = 'S' | 'A' | 'B' | 'C';

const grade = (v: number, cuts: [number, number, number]): Grade => (v >= cuts[0] ? 'S' : v >= cuts[1] ? 'A' : v >= cuts[2] ? 'B' : 'C');
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);

/** The turning point in one sentence. */
function turning(b: Battle): string {
  const tp = turningPoint(b);
  if (!tp) return 'No round turned it: neither side lost anything you saw.';
  const theirs = `${pct(tp.red) ? `${pct(tp.red)}% of their strength` : 'nothing you saw'}${tp.killed ? ` (${tp.killed} knocked out)` : ''}`;
  const yours = `${pct(tp.blue) ? `${pct(tp.blue)}% of your strength` : 'nothing'}${tp.lost ? ` (${tp.lost} ${tp.lost === 1 ? 'unit' : 'units'})` : ''}`;
  return tp.red >= tp.blue ? `Round ${tp.round} turned it: they lost ${theirs} and you lost ${yours}.` : `Round ${tp.round} went against you: you lost ${yours} and they lost ${theirs}.`;
}

export function AfterAction({ battle: b }: { battle: Battle }) {
  const rounds = Math.min(ROUND_LIMIT, b.round);
  const kept = sideValue(b, 'blue') / Math.max(1, startValue(b, 'blue'));
  const destroyed = roundLosses(b).reduce((s, r) => s + r.red, 0);
  const rows: [string, Grade, string][] = [
    ['Speed', grade(-rounds, [-5, -8, -12]), `${rounds} of ${ROUND_LIMIT} rounds`],
    ['Power', grade(destroyed, [0.85, 0.6, 0.35]), `${pct(destroyed)}% of theirs destroyed`],
    ['Technique', grade(kept, [0.9, 0.75, 0.5]), `${pct(kept)}% of yours kept`],
  ];
  return (
    <div className="mt-4 w-full" data-testid="arena-grades">
      <dl className="grid grid-cols-3 gap-2">
        {rows.map(([k, g, line]) => (
          <div key={k} className="rounded-xl bg-ink-900 px-2 py-2.5" data-testid={`grade-${k.toLowerCase()}`}>
            <dt className="text-[13px] font-semibold text-muted">{k}</dt>
            <dd className="text-[28px] leading-tight font-bold" aria-label={`${k} grade ${g}`}>
              {g}
            </dd>
            <dd className="text-[12px] leading-tight text-muted">{line}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[14px] leading-snug" data-testid="arena-turning">
        {turning(b)}
      </p>
    </div>
  );
}
