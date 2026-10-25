import { useEffect, useMemo, useState } from 'react';
import { RULESET_VERSION } from '@brink/game-data';
import { NATIONS, SCENARIOS, createScenario } from '@brink/scenarios';
import { latestSlot, type SlotInfo } from '../saves';
import { Kbd, relativeTime, useKeys } from '../chrome';
import { MapPreview } from './MapPreview';

export type MenuScreen = 'title' | 'setup' | 'archive' | 'manual';

const HEADLINES = [
  'VESSA — Free city council suspends the treaty assembly as columns mass on the basin road',
  'HALDEN FIELDS — Pipeline output falls 40% after unexplained pressure loss',
  'KORVAGRAD — Directorate calls a third class of reservists to the colours',
  'PORT ASTER — Commonwealth exchange closes early; war-risk premiums triple',
  'CORRIN MINES — Federation and Union survey teams turned back at the Spine passes',
  'DREVANSK — Union assembly votes emergency grain requisitions',
  'SELMAR — Federation signals directorate goes dark across all public channels',
  'THE SPINE — Ridge-line observation posts report vehicle lights moving without headlamps',
];

interface Item {
  id: string;
  label: string;
  sub: string;
  go: () => void;
  disabled?: boolean;
}

export function Title({ slots, go, onContinue }: { slots: SlotInfo[]; go: (s: MenuScreen) => void; onContinue: (slot: SlotInfo) => void }) {
  const scenario = SCENARIOS[0]!;
  // The backdrop is a real scenario world; seed 1 is the canonical look.
  const world = useMemo(() => createScenario(scenario.id, 1), [scenario.id]);
  const last = latestSlot(slots);
  const lastNation = last ? NATIONS.find((n) => n.id === last.nation) : undefined;

  const items: Item[] = [
    ...(last
      ? [
          {
            id: 'continue',
            label: 'Continue',
            sub: `${last.label} · ${relativeTime(last.savedAt)}`,
            go: () => onContinue(last),
          },
        ]
      : []),
    { id: 'new', label: 'New campaign', sub: `${scenario.name} · choose a nation and a seed`, go: () => go('setup') },
    { id: 'load', label: 'Load campaign', sub: slots.length ? `${slots.length} saved operation${slots.length === 1 ? '' : 's'} on file` : 'Save slots and files', go: () => go('archive') },
    { id: 'manual', label: 'Field manual', sub: 'Turns, victory, units and terrain', go: () => go('manual') },
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

  return (
    <main className="title-screen relative isolate min-h-full overflow-hidden">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <MapPreview world={world} forces className="title-map h-full w-full" />
        <div className="title-sweep" />
        <div className="title-vignette" />
        <div className="scanlines" />
      </div>

      <div className="relative z-10 flex min-h-full flex-col px-4 pt-6 pb-4 sm:px-10 sm:pt-10">
        <div className="font-display flex items-center gap-3 text-[10px] font-semibold tracking-[0.3em] uppercase">
          <span className="rounded-[2px] bg-hostile/90 px-1.5 py-0.5 text-ink-950">Top secret</span>
          <span className="text-muted">Strategic command // eyes only</span>
          <Clock />
        </div>

        <div className="mt-[8vh] max-w-xl">
          <p className="font-display enter-1 text-[11px] font-semibold tracking-[0.42em] text-signal uppercase">{scenario.name}</p>
          <h1 className="font-display enter-2 title-wordmark mt-2 text-7xl leading-[0.9] font-black tracking-[0.04em] sm:text-9xl" data-testid="wordmark">
            BRINK
          </h1>
          <p className="enter-3 mt-4 max-w-md text-sm leading-relaxed text-muted">
            Four nations. Every order written in secret. When the clocks strike, the whole world moves at once, and you learn what your
            rivals planned the same moment their armour crosses your border.
          </p>
        </div>

        <nav className="enter-4 mt-8 w-full max-w-md" aria-label="Main menu">
          <ul className="flex flex-col gap-1.5">
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
                    className={`menu-item group relative flex w-full items-center gap-4 border px-4 py-3 text-left transition-all ${
                      active ? 'border-signal/70 bg-signal/10' : 'border-line/60 bg-ink-900/60 hover:border-faint'
                    }`}
                  >
                    <span className={`font-mono text-[11px] ${active ? 'text-signal' : 'text-faint'}`}>{String(i + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-base font-bold tracking-wide uppercase ${active ? 'text-text' : 'text-text/85'}`}>{it.label}</span>
                      <span className="block truncate text-xs text-muted">
                        {it.id === 'continue' && lastNation && (
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-[1px] align-middle" style={{ background: lastNation.color }} />
                        )}
                        {it.sub}
                      </span>
                    </span>
                    <span className={`text-signal transition-all ${active ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'}`} aria-hidden>
                      ▸
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 hidden gap-2 text-[11px] text-faint sm:flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> select <Kbd>Enter</Kbd> confirm <Kbd>1</Kbd>–<Kbd>{items.length}</Kbd> jump
          </p>
        </nav>

        <div className="mt-auto pt-10">
          <div className="ticker border-y border-line/60 bg-ink-950/70 py-1.5 text-[11px] text-muted" aria-hidden>
            <div className="ticker-track">
              {[...HEADLINES, ...HEADLINES].map((h, i) => (
                <span key={i} className="mx-6 whitespace-nowrap">
                  <span className="mr-2 text-hostile">●</span>
                  {h}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-faint">
            <span>
              Ruleset {RULESET_VERSION} · deterministic engine · {scenario.nations} powers · {scenario.maxTurns} turns
            </span>
            <span>All nations fictional. Any resemblance to a real war is the point.</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="ml-auto font-mono tracking-[0.12em] text-faint tabular-nums">
      {now.toISOString().slice(11, 19)}Z <span className="text-good">● LINK</span>
    </span>
  );
}
