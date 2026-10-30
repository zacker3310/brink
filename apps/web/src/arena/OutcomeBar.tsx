import type { CSSProperties } from 'react';
import { outcomes, type FireInfo, type Outcome, type UnitType } from '@brink/arena';

// The shot card's outcome bar: one stacked bar of how the shot can end, in the words the callouts
// use, with a band word for the gist and the exact shares printed beside it. Each outcome has its
// own pattern, so none is told by colour alone.

const LABEL: Record<Outcome, string> = { intercepted: 'Intercepted', miss: 'Miss', stopped: 'Stopped', bounce: 'Bounce', penetrate: 'Penetrate', knock_out: 'Knock Out', hit: 'Hit' };

const FILL: Record<Outcome, CSSProperties> = {
  intercepted: { backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.6) 0 1.5px, transparent 1.5px 4px)' },
  miss: { boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.5)' },
  stopped: { backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0 1.5px, transparent 1.5px 4px)' },
  bounce: { backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.75) 0 2px, transparent 2px 5px)' },
  penetrate: { backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.95) 1.1px, transparent 1.5px)', backgroundSize: '4px 4px' },
  knock_out: { background: '#ffffff' },
  hit: { background: '#ffffff' },
};

/** A drone hit is a drone down; a hit on armour is split by what it does. */
const killing = (t: UnitType) => !!t.armour || t.mobility === 'drone';
const labelOf = (o: Outcome, t: UnitType) => (o === 'hit' && t.mobility === 'drone' ? 'Shot Down' : LABEL[o]);

/** The gist in a word or two: how likely the shot does what it is for. */
export function bandOf(split: { outcome: Outcome; pct: number }[], t: UnitType): string {
  const pct = (o: Outcome) => split.find((x) => x.outcome === o)?.pct ?? 0;
  const kill = killing(t);
  const want = t.armour ? pct('knock_out') : pct('hit');
  if (want >= 80) return kill ? 'Sure Kill' : 'Sure Hit';
  if (want >= 55) return kill ? 'Likely Kill' : 'Likely Hit';
  if (want >= 35) return 'Even Odds';
  if (t.armour && pct('bounce') >= 30 && pct('bounce') > want) return 'Likely Bounce';
  return want >= 12 ? 'Long Shot' : 'Slim Chance';
}

export function OutcomeBar({ info, target }: { info: FireInfo; target: UnitType }) {
  const split = outcomes(info, target);
  return (
    <div className="mt-2" data-testid="shot-outcomes">
      <div className="flex h-3 overflow-hidden rounded-full bg-white/10" role="img" aria-label={split.map((s) => `${labelOf(s.outcome, target)} ${s.pct}%`).join(', ')}>
        {split.map((s) => (
          <div key={s.outcome} className="h-full border-r-2 border-ink-900 last:border-r-0" style={{ width: `${s.pct}%`, ...FILL[s.outcome] }} data-outcome={s.outcome} />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] leading-snug" aria-hidden>
        {split.map((s) => (
          <li key={s.outcome} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={FILL[s.outcome]} />
            <span>
              {labelOf(s.outcome, target)} <b className="tabular-nums">{s.pct}%</b>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
