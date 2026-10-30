import { useState } from 'react';
import { readCareer } from '../arena/career';
import { clearResume, readResume, resumeRequest } from '../arena/resume';
import { ROUND_LIMIT, typeOf, type Role } from '@brink/arena';
import type { UnitClass } from '@brink/contracts';
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

function classOf(role: Role): UnitClass {
  if (role === 'mbt') return 'armor';
  if (role === 'ifv' || role === 'apc' || role === 'arv' || role === 'spaa') return 'mechanized';
  if (role === 'light_tank' || role === 'tank_hunter') return 'recon';
  if (role === 'spg' || role === 'mortar') return 'artillery';
  if (role === 'attack_heli' || role === 'gunship' || role === 'scout_heli' || role === 'transport_heli') return 'air';
  if (role === 'recon_drone' || role === 'fpv_team' || role === 'loiter_team') return 'drone';
  return 'infantry';
}

const TIME = { dawn: 'dawn', day: 'day', dusk: 'dusk', night: 'night' } as const;

/** "9:04 PM" today, else the day as well. */
function savedWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
const BIOME = { temperate: 'Temperate', steppe: 'Steppe', desert: 'Desert', winter: 'Winter', urban: 'City' } as const;

export function Skirmish({ onBack }: { onBack: () => void }) {
  const fight = useGame((s) => s.fight);
  // Subscribed so the record is re-read when a battle closes: this screen stays mounted under the arena.
  useGame((s) => s.battle);
  const career = readCareer();
  const [attempt, setAttempt] = useState(0);
  // A battle the page was closed in the middle of (saved at every order and turn: arena/resume.ts).
  const [, setAbandoned] = useState(0);
  const saved = readResume('skirmish');
  return (
    <main className="safe-top safe-bottom flex min-h-full flex-col" data-testid="skirmish">
      <ScreenHeader kicker="Practice" title="Skirmish" onBack={onBack} />
      <div className="mx-auto w-full max-w-2xl p-4">
        {saved && (
          <section className="mb-4 rounded-xl border border-line bg-ink-900 p-3" data-testid="skirmish-saved">
            <div className="text-[12px] font-semibold text-muted">Battle in Progress</div>
            <div className="font-display text-lg font-bold uppercase">{saved.request.title}</div>
            <p className="text-[13px] text-muted">
              Round {saved.round} of {ROUND_LIMIT}, saved {savedWhen(saved.savedAt)}. Starting another battle replaces it.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => fight(resumeRequest(saved))} className="v-btn v-btn-primary h-11 flex-1 text-[15px] font-semibold" data-testid="skirmish-resume">
                Resume Battle
              </button>
              <button
                type="button"
                onClick={() => {
                  clearResume('skirmish');
                  setAbandoned((n) => n + 1);
                }}
                className="v-btn v-btn-secondary h-11 px-4 text-[15px]"
                data-testid="skirmish-abandon"
              >
                Abandon
              </button>
            </div>
          </section>
        )}
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
          {[...SKIRMISHES].sort((a, b) => a.stars - b.stars).map((s) => {
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
                    {locked ? <span className="text-[12px] text-muted">{s.stars}★ to unlock</span> : <Stars n={best} />}
                  </div>
                  <p className="text-[13px] text-muted">{s.text}</p>
                  <div className="mt-1.5 text-[12px] text-muted">
                    {BIOME[s.biome]}, {TIME[s.time]}
                    {s.weather !== 'clear' ? `, ${s.weather}` : ''}
                    {s.river ? ', river' : ''} · {s.yours.length} units against {s.theirs.length}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-0.5" aria-hidden>
                    {s.yours.map((c, i) => (
                      <UnitGlyph key={`y${i}`} unitClass={classOf(typeOf(c).role)} color="#3fa796" className="h-4 w-5" />
                    ))}
                    <span className="mx-1 text-[12px] text-muted">vs</span>
                    {s.theirs.map((c, i) => (
                      <UnitGlyph key={`t${i}`} unitClass={classOf(typeOf(c).role)} color="#c9733a" className="h-4 w-5" />
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
