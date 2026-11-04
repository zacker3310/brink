import { useState } from 'react';
import { RULESET_VERSION } from '@brink/game-data';
import { CRISES, NATIONS, SCENARIOS } from '@brink/scenarios';
import { readCareer } from '../arena/career';
import { tutorialDone } from '../coach';
import { latestSlot, type SlotInfo } from '../saves';
import { relativeTime, useKeys } from '../chrome';
import { isMuted, setMuted } from '../sfx';
import { TitleScene } from './TitleScene';
import './front.css';

export type MenuScreen = 'title' | 'setup' | 'archive' | 'manual' | 'skirmish' | 'settings';

interface Item {
  id: string;
  label: string;
  sub: string;
  go: () => void;
  /** A colour swatch before the sub line: the nation of a saved campaign. */
  swatch?: string;
  /** A small item in the row under the main menu. */
  minor?: boolean;
}

/** Played once a page load: the title's cold open (letterbox, logo, menu) runs only the first time. */
let opened = false;

// The home screen: the theatre at war behind a game title and a command menu. Arrow keys or the
// number keys pick, Enter goes. A wire crawls the crises of the theatre along the bottom.
export function Title({
  slots,
  go,
  onContinue,
  onTutorial,
  onQuickBattle,
}: {
  slots: SlotInfo[];
  go: (s: MenuScreen) => void;
  onContinue: (slot: SlotInfo) => void;
  onTutorial: () => void;
  onQuickBattle: () => void;
}) {
  const scenario = SCENARIOS[0]!;
  const last = latestSlot(slots);
  const lastNation = last ? NATIONS.find((n) => n.id === last.nation) : undefined;
  const career = readCareer();
  const [muted, setMute] = useState(isMuted());
  const [intro] = useState(() => {
    const first = !opened;
    opened = true;
    return first;
  });

  // A first-time commander sees the guided match first; afterwards it sits below the campaign.
  const fresh = !last && !tutorialDone();
  const guided: Item = { id: 'tutorial', label: 'Guided first turn', sub: fresh ? 'Learn the war by playing it: three minutes' : 'A real campaign with a coach', go: onTutorial };
  const items: Item[] = [
    ...(fresh ? [guided] : []),
    ...(last ? [{ id: 'continue', label: 'Continue', sub: `${lastNation?.name ?? last.nation} · turn ${last.turn} · ${relativeTime(last.savedAt)}`, swatch: lastNation?.color, go: () => onContinue(last) }] : []),
    { id: 'new', label: 'New campaign', sub: 'Choose a nation. Three AI powers want what you hold.', go: () => go('setup') },
    { id: 'quick', label: 'Quick battle', sub: 'Straight into the fight: one company, one objective', go: onQuickBattle },
    { id: 'skirmish', label: 'Skirmish', sub: career.battles ? `${career.stars}★ earned in battle` : 'Pick a battle. Earn stars.', go: () => go('skirmish') },
    ...(fresh ? [] : [guided]),
    { id: 'load', label: 'Load', sub: slots.length ? `${slots.length} on file` : 'Saves and files', go: () => go('archive'), minor: true },
    { id: 'manual', label: 'Manual', sub: 'How the war works', go: () => go('manual'), minor: true },
    { id: 'settings', label: 'Settings', sub: 'Sound, quality, motion', go: () => go('settings'), minor: true },
  ];
  const [cursor, setCursor] = useState(0);

  useKeys(
    (e) => {
      if (e.key === 'ArrowDown' || e.key === 's') setCursor((c) => (c + 1) % items.length);
      else if (e.key === 'ArrowUp' || e.key === 'w') setCursor((c) => (c - 1 + items.length) % items.length);
      else if (e.key === 'Enter' && document.activeElement === document.body) items[cursor]?.go();
      else {
        const n = Number(e.key);
        if (n >= 1 && n <= items.length) items[n - 1]!.go();
      }
    },
    [items.length, cursor, last?.slot],
  );

  const wire = CRISES.map((c) => `${c.name}: ${c.hook}`);
  const row = (it: Item, i: number) => (
    <button
      type="button"
      data-testid={`menu-${it.id}`}
      data-active={i === cursor}
      onMouseEnter={() => setCursor(i)}
      onFocus={() => setCursor(i)}
      onClick={it.go}
      className={it.minor ? 'home-minor' : `home-item ${i === 0 ? 'home-item-lead' : ''}`}
      title={it.minor ? it.sub : undefined}
    >
      <span className="home-item-label">{it.label}</span>
      {!it.minor && (
        <span className="home-item-sub">
          {it.swatch && <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: it.swatch }} />}
          {it.sub}
        </span>
      )}
      <span className="home-item-key" aria-hidden>
        {i + 1}
      </span>
    </button>
  );

  return (
    <main className={`home relative isolate h-full min-h-full overflow-hidden ${intro ? 'home-intro' : ''}`} data-testid="title">
      <TitleScene className="home-scene absolute inset-0 -z-20" />
      <div className="home-shade pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="home-scan pointer-events-none absolute inset-0 -z-10" aria-hidden />
      {intro && <div className="home-letterbox pointer-events-none" aria-hidden />}

      <div className="safe-top safe-bottom safe-x flex h-full flex-col">
        <div className="home-wire" aria-label="Theatre wire" data-testid="home-wire">
          <span className="home-wire-live">
            <i aria-hidden />
            Live
          </span>
          <div className="home-wire-track">
            <div className="home-wire-crawl" aria-hidden>
              {[0, 1].map((n) => (
                <span key={n}>
                  {wire.map((w) => (
                    <span key={w} className="home-wire-item">
                      {w}
                    </span>
                  ))}
                </span>
              ))}
            </div>
            <span className="sr-only">{wire.join('. ')}</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 pt-5 pb-3 sm:px-14 sm:pt-10 lg:justify-center lg:pt-0">
          <header className="home-rise">
            <p className="home-kicker">
              {scenario.name} <span className="home-kicker-sep">·</span> Four powers <span className="home-kicker-sep">·</span> One turn
            </p>
            <h1 className="home-logo" data-testid="wordmark">
              Brink
            </h1>
            <p className="home-tagline">Every order in secret. The world moves at once. Then you fight it out.</p>
          </header>

          <nav className="home-rise-late mt-auto w-full max-w-[460px] lg:mt-10" aria-label="Main menu">
            <ul className="flex flex-col gap-0.5">
              {items.map((it, i) =>
                it.minor ? null : (
                  <li key={it.id} className="home-li">
                    {row(it, i)}
                  </li>
                ),
              )}
            </ul>
            <ul className="home-minor-row mt-2 flex gap-2">
              {items.map((it, i) =>
                it.minor ? (
                  <li key={it.id} className="flex-1">
                    {row(it, i)}
                  </li>
                ) : null,
              )}
            </ul>
          </nav>
        </div>

        <footer className="home-foot flex items-end justify-between gap-4 px-6 pb-3 sm:px-14 sm:pb-8">
          <dl className="flex gap-5" aria-label="Your record">
            {(
              [
                ['Stars', career.stars],
                ['Battles won', career.wins],
                ['Wars won', career.warsWon.length],
              ] as const
            ).map(([k, n]) => (
              <div key={k}>
                <dd className="home-stat">{n}</dd>
                <dt className="home-stat-label">{k}</dt>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-3">
            <span className="home-version">v{RULESET_VERSION}</span>
            <button
              type="button"
              className="home-icon"
              aria-pressed={!muted}
              aria-label={muted ? 'Sound off' : 'Sound on'}
              data-testid="home-sound"
              onClick={() => {
                setMuted(!muted);
                setMute(!muted);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
                {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" />}
              </svg>
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
