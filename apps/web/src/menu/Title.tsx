import { useMemo, useState } from 'react';
import { RULESET_VERSION } from '@brink/game-data';
import { NATIONS, SCENARIOS, createScenario } from '@brink/scenarios';
import { readCareer } from '../arena/career';
import { tutorialDone } from '../coach';
import { latestSlot, type SlotInfo } from '../saves';
import { Kbd, Mark, relativeTime, useKeys } from '../chrome';
import { Icon } from '../icons';
import { MapPreview } from './MapPreview';

export type MenuScreen = 'title' | 'setup' | 'archive' | 'manual' | 'skirmish';

function skirmishSub(): string {
  const c = readCareer();
  return c.battles ? `${c.stars}★ earned · ${c.wins} of ${c.battles} battles won` : 'Practice battles: drive, shoot, earn stars';
}

interface Item {
  id: string;
  label: string;
  sub: string;
  icon: Parameters<typeof Icon>[0]['name'];
  go: () => void;
  disabled?: boolean;
}

// The title: a console landing page. The theatre itself, live, in a framed window; every way into
// the game as a card. Number keys or arrows and Enter work as before.
export function Title({ slots, go, onContinue, onTutorial }: { slots: SlotInfo[]; go: (s: MenuScreen) => void; onContinue: (slot: SlotInfo) => void; onTutorial: () => void }) {
  const scenario = SCENARIOS[0]!;
  // The backdrop is a real scenario world; seed 1 is the canonical look.
  const world = useMemo(() => createScenario(scenario.id, 1), [scenario.id]);
  const last = latestSlot(slots);
  const lastNation = last ? NATIONS.find((n) => n.id === last.nation) : undefined;

  // A first-time commander sees the guided match first; afterwards it sits below the campaign.
  const fresh = !last && !tutorialDone();
  const guided: Item = { id: 'tutorial', label: 'Guided first match', sub: fresh ? 'Recommended: learn on a real first turn, then keep playing' : 'Boot camp: a real campaign with a coach', icon: 'objective', go: onTutorial };
  const items: Item[] = [
    ...(fresh ? [guided] : []),
    ...(last ? [{ id: 'continue', label: 'Continue', sub: `${last.label} · ${relativeTime(last.savedAt)}`, icon: 'next' as const, go: () => onContinue(last) }] : []),
    { id: 'new', label: 'New campaign', sub: `${scenario.name} · you against three AI powers`, icon: 'capital', go: () => go('setup') },
    { id: 'skirmish', label: 'Skirmish', sub: skirmishSub(), icon: 'attack', go: () => go('skirmish') },
    ...(fresh ? [] : [guided]),
    { id: 'load', label: 'Load campaign', sub: slots.length ? `${slots.length} saved operation${slots.length === 1 ? '' : 's'} on file` : 'Save slots and files', icon: 'replay', go: () => go('archive') },
    { id: 'manual', label: 'Field manual', sub: 'Turns, victory, units and terrain', icon: 'report', go: () => go('manual') },
  ];
  const [cursor, setCursor] = useState(0);
  const primary = items[0]!;

  useKeys(
    (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 's') setCursor((c) => (c + 1) % items.length);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'w') setCursor((c) => (c - 1 + items.length) % items.length);
      else if (e.key === 'Enter' && document.activeElement === document.body) items[cursor]?.go();
      else {
        const n = Number(e.key);
        if (n >= 1 && n <= items.length) items[n - 1]!.go();
      }
    },
    [items.length, cursor, last?.slot],
  );

  return (
    <main className="vercel relative isolate min-h-full overflow-hidden bg-black">
      <div className="v-backdrop pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px]" aria-hidden />

      <nav className="safe-top safe-x relative z-10 border-b border-line/60" aria-label="Brink">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Mark className="h-6 w-6" />
          <span className="text-[15px] font-semibold tracking-tight" data-testid="wordmark">
            Brink
          </span>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted">v{RULESET_VERSION}</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => go('manual')} className="hidden h-9 rounded-md px-3 text-sm text-muted hover:text-text sm:block">
              Manual
            </button>
            <button type="button" onClick={() => go('skirmish')} className="hidden h-9 rounded-md px-3 text-sm text-muted hover:text-text sm:block">
              Skirmish
            </button>
          </div>
        </div>
      </nav>

      <div className="safe-x relative z-10">
        <div className="mx-auto max-w-6xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <button type="button" onClick={() => go('manual')} className="enter-1 mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-ink-900 px-3 py-1 text-[13px] text-muted hover:border-ink-600 hover:text-text">
              <span className="v-dot bg-good" aria-hidden />
              {scenario.name} · four powers · simultaneous turns
              <span aria-hidden>→</span>
            </button>
            <h1 className="enter-2 v-gradient-text mt-6 text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-6xl">
              Every order in secret.
              <br />
              The world moves at once.
            </h1>
            <p className="enter-3 mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Four nations plan their turn blind. When the clocks strike, every army moves together, and you learn what your rivals planned the moment their armour crosses your border.
            </p>
            <div className="enter-3 mt-8 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={primary.go} className="v-btn v-btn-primary h-11 px-5">
                {primary.label}
                <span aria-hidden>→</span>
              </button>
              <button type="button" onClick={() => go('manual')} className="v-btn v-btn-secondary h-11 px-5">
                How it plays
              </button>
            </div>
          </div>

          <div className="enter-4 mt-14 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {/* The theatre, live, in a console window. */}
            <figure className="v-card overflow-hidden">
              <div className="flex h-10 items-center gap-1.5 border-b border-line px-4">
                <span className="v-dot bg-ink-600" />
                <span className="v-dot bg-ink-600" />
                <span className="v-dot bg-ink-600" />
                <span className="ml-3 font-mono text-[12px] text-faint">meridian.theatre · seed 1</span>
              </div>
              <div className="relative aspect-[16/10] bg-black">
                <MapPreview world={world} forces labels className="absolute inset-0 h-full w-full opacity-90" />
              </div>
              <figcaption className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 font-mono text-[12px] text-faint">
                <span>{scenario.nations} powers</span>
                <span>{scenario.maxTurns} turns max</span>
                <span>deterministic engine</span>
              </figcaption>
            </figure>

            <nav aria-label="Main menu">
              <ul className="grid gap-2">
                {items.map((it, i) => {
                  const active = i === cursor;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        data-testid={`menu-${it.id}`}
                        onMouseEnter={() => setCursor(i)}
                        onFocus={() => setCursor(i)}
                        onClick={it.go}
                        className={`v-card v-card-link group flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left ${active ? 'border-ink-600 bg-ink-850' : ''}`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-black text-muted group-hover:text-text">
                          <Icon name={it.icon} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium text-text">{it.label}</span>
                          <span className="block truncate text-[13px] text-muted">
                            {it.id === 'continue' && lastNation && <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: lastNation.color }} />}
                            {it.sub}
                          </span>
                        </span>
                        <span className="hidden sm:block">
                          <Kbd>{i + 1}</Kbd>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <footer className="mt-16 flex flex-wrap justify-between gap-2 border-t border-line pt-6 font-mono text-[12px] text-faint">
            <span>
              Ruleset {RULESET_VERSION} · deterministic engine · {scenario.nations} powers · {scenario.maxTurns} turns
            </span>
            <span>All nations fictional.</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
