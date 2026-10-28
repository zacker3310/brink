import { useState } from 'react';
import { readCareer } from '../arena/career';
import { SKIRMISHES, skirmishRequest } from '../arena/skirmish';
import { ScreenHeader } from '../chrome';
import { UnitGlyph } from '../glyphs';
import { useGame } from '../store';

// Practice battles and your record as a commander. Stars from campaign battles count too.

function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${n} of ${of} stars`}>
      {Array.from({ length: of }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" className={`h-4 w-4 ${i < n ? 'text-signal' : 'text-ink-700'}`} aria-hidden>
          <path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor" />
        </svg>
      ))}
    </span>
  );
}

export function Skirmish({ onBack }: { onBack: () => void }) {
  const fight = useGame((s) => s.fight);
  // Subscribed so the record is re-read when a battle closes: this screen stays mounted under the arena.
  useGame((s) => s.battle);
  const career = readCareer();
  const [attempt, setAttempt] = useState(0);
  return (
    <main className="safe-top safe-bottom flex min-h-full flex-col" data-testid="skirmish">
      <ScreenHeader kicker="Practice" title="Skirmish" onBack={onBack} />
      <div className="mx-auto w-full max-w-2xl p-4">
        <dl className="grid grid-cols-4 gap-2 text-center">
          {(
            [
              ['Stars', career.stars],
              ['Battles', career.battles],
              ['Won', career.wins],
              ['Wars won', career.warsWon.length],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-ink-900 py-2">
              <dd className="font-display text-2xl font-extrabold" data-testid={k === 'Stars' ? 'career-stars' : undefined}>
                {v}
              </dd>
              <dt className="text-[11px] text-faint uppercase">{k}</dt>
            </div>
          ))}
        </dl>
        <ul className="mt-4 space-y-2">
          {SKIRMISHES.map((s) => {
            const locked = career.stars < s.stars;
            const best = career.best[s.id] ?? 0;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setAttempt((a) => a + 1);
                    fight(skirmishRequest(s, attempt));
                  }}
                  className="w-full rounded-xl border border-line bg-ink-900 p-3 text-left active:bg-ink-850 disabled:opacity-45"
                  data-testid={`skirmish-${s.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-lg font-bold uppercase">{s.name}</span>
                    {locked ? <span className="text-[12px] text-faint">{s.stars}★ to unlock</span> : <Stars n={best} />}
                  </div>
                  <p className="text-[13px] text-muted">{s.text}</p>
                  <div className="mt-2 flex items-center gap-1 text-[11px] text-faint">
                    <span className="mr-1 capitalize">{s.terrain}{s.river ? ' · river' : ''}</span>
                    {s.yours.map((c, i) => (
                      <UnitGlyph key={`y${i}`} unitClass={c} color="#3fa796" className="h-4 w-5" />
                    ))}
                    <span className="mx-1">vs</span>
                    {s.theirs.map((c, i) => (
                      <UnitGlyph key={`t${i}`} unitClass={c} color="#c9733a" className="h-4 w-5" />
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
