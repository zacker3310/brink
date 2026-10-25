import { useState } from 'react';
import { GOVERNMENTS } from '@brink/game-data';
import { NATIONS, SCENARIOS } from '@brink/scenarios';
import { readSlot, SLOT_NAMES } from './saves';
import { useGame } from './store';
import { Button, Swatch } from './ui';

export function Menu() {
  const newGame = useGame((s) => s.newGame);
  const loadGame = useGame((s) => s.loadGame);
  const notify = useGame((s) => s.notify);
  const slots = useGame((s) => s.slots);
  const [nation, setNation] = useState<string>(NATIONS[0]!.id);
  const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 99999));
  const scenario = SCENARIOS[0]!;

  const loadFile = async (file: File) => loadGame(await file.text());

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-[11px] font-semibold tracking-[0.3em] text-signal uppercase">Strategic command</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">WORLD WAR</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every nation plans in secret. When orders lock, the world moves at once: six hours of war resolved against one shared
          battlefield.
        </p>
      </header>

      <section aria-labelledby="scenario" className="rounded-sm border border-line bg-ink-900 p-5">
        <h2 id="scenario" className="text-lg font-semibold">
          {scenario.name}
        </h2>
        <p className="mt-1 text-sm text-muted">{scenario.summary}</p>
        <p className="mt-1 text-xs text-faint">
          {scenario.nations} nations · {scenario.maxTurns} turns · win by holding 45% of victory points, outlasting every rival, or
          leading at the turn limit
        </p>

        <h3 className="mt-5 mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Choose your nation</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Nation">
          {NATIONS.map((n) => {
            const gov = GOVERNMENTS[n.government];
            const active = nation === n.id;
            return (
              <button
                key={n.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`nation-${n.id}`}
                onClick={() => setNation(n.id)}
                className={`rounded-sm border p-3 text-left transition-colors ${active ? 'border-signal bg-ink-800' : 'border-line bg-ink-850 hover:border-faint'}`}
              >
                <div className="flex items-center gap-2">
                  <Swatch color={n.color} />
                  <span className="font-semibold">{n.name}</span>
                </div>
                <div className="mt-1 text-xs text-signal">{gov.name}</div>
                <div className="mt-0.5 text-xs text-muted">{gov.summary}</div>
                <div className="mt-1 text-xs text-faint">Capital: {n.capital[2]}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted">
            Seed
            <input
              type="number"
              className="ml-2 w-28 rounded-sm border border-line bg-ink-850 px-2 py-1 font-mono text-text"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 1)}
              data-testid="seed"
            />
          </label>
          <Button tone="primary" onClick={() => void newGame(nation, seed)} testId="start-game">
            Begin campaign
          </Button>
        </div>
      </section>

      <section aria-labelledby="load" className="rounded-sm border border-line bg-ink-900 p-5">
        <h2 id="load" className="text-lg font-semibold">
          Resume
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {SLOT_NAMES.map((slot) => {
            const info = slots.find((s) => s.slot === slot);
            return (
              <li key={slot} className="rounded-sm border border-line bg-ink-850 p-3">
                <div className="text-xs font-semibold text-muted">{slot}</div>
                <div className="mt-1 text-sm">{info ? info.label : <span className="text-faint">Empty</span>}</div>
                {info && <div className="text-[11px] text-faint">{new Date(info.savedAt).toLocaleString()}</div>}
                <div className="mt-2">
                  <Button
                    disabled={!info}
                    testId={`load-${slot.replace(' ', '-').toLowerCase()}`}
                    onClick={() => {
                      const text = readSlot(slot);
                      if (text) void loadGame(text);
                      else notify('That slot could not be read', 'error');
                    }}
                  >
                    Load
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <label className="mt-3 inline-block cursor-pointer text-xs text-muted underline-offset-2 hover:underline">
          Load from file…
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
        </label>
      </section>
    </main>
  );
}
