import { useMemo, useState } from 'react';
import type { NationId } from '@brink/contracts';
import { GOVERNMENTS, UNITS } from '@brink/game-data';
import { NATIONS, SCENARIOS, createScenario } from '@brink/scenarios';
import { readPrefs, writePrefs } from '../saves';
import { Swatch } from '../ui';
import { Frame, Kbd, Label, ScreenHeader, useKeys } from '../chrome';
import { CLASS_ORDER, DOCTRINE, dossier, operationName, randomSeed, traits, VICTORY_SHARE } from './intel';
import { Emblem, UnitGlyph } from '../glyphs';
import { MapPreview } from './MapPreview';

/** The quick campaign: the same war, decided sooner. */
const QUICK_TURNS = 20;

export function Setup({ onBack, onBegin }: { onBack: () => void; onBegin: (nation: NationId, seed: number, maxTurns: number) => Promise<void> }) {
  const scenario = SCENARIOS[0]!;
  const [nation, setNation] = useState<NationId>(() => {
    const p = readPrefs().nation;
    return NATIONS.some((n) => n.id === p) ? p! : NATIONS[0]!.id;
  });
  const [seed, setSeed] = useState(randomSeed);
  const [starting, setStarting] = useState(false);
  const [length, setLength] = useState<'quick' | 'standard'>(() => readPrefs().length ?? 'quick');
  const turns = length === 'quick' ? Math.min(QUICK_TURNS, scenario.maxTurns) : scenario.maxTurns;
  const pickLength = (l: 'quick' | 'standard') => {
    setLength(l);
    writePrefs({ length: l });
  };

  const world = useMemo(() => createScenario(scenario.id, seed), [scenario.id, seed]);
  const spec = NATIONS.find((n) => n.id === nation)!;
  const gov = GOVERNMENTS[spec.government];
  const info = useMemo(() => dossier(world, nation), [world, nation]);
  const op = operationName(seed);

  const pick = (id: NationId) => {
    setNation(id);
    writePrefs({ nation: id });
  };
  const begin = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await onBegin(nation, seed, turns);
    } finally {
      setStarting(false);
    }
  };

  useKeys(
    (e) => {
      const i = NATIONS.findIndex((n) => n.id === nation);
      if (e.key === 'Escape') onBack();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(NATIONS[(i + 1) % NATIONS.length]!.id);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(NATIONS[(i - 1 + NATIONS.length) % NATIONS.length]!.id);
      else if (e.key === 'r') setSeed(randomSeed());
      else if (e.key === 'Enter' && document.activeElement === document.body) void begin();
      else {
        const n = Number(e.key);
        if (n >= 1 && n <= NATIONS.length) pick(NATIONS[n - 1]!.id);
      }
    },
    [nation, seed, starting, turns],
  );

  return (
    <main className="setup-screen flex min-h-full flex-col max-lg:pb-28" style={{ ['--nation' as string]: spec.color }}>
      <ScreenHeader
        kicker="New campaign"
        title={scenario.name}
        onBack={onBack}
        right={
          <div className="text-right leading-tight">
            <div className="font-display text-[10px] tracking-[0.06em] text-faint uppercase">Operation</div>
            <div className="font-mono text-sm font-semibold tracking-wide text-signal uppercase" data-testid="operation">
              {op}
            </div>
          </div>
        }
      />

      <div className="grid flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
        {/* Roster */}
        <section aria-labelledby="roster" className="enter-1 flex flex-col gap-2">
          <Label className="mb-1">
            <span id="roster">Choose your nation</span>
          </Label>
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-col" role="radiogroup" aria-label="Nation">
            {NATIONS.map((n, i) => {
              const g = GOVERNMENTS[n.government];
              const active = n.id === nation;
              return (
                <button
                  key={n.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`nation-${n.id}`}
                  onClick={() => pick(n.id)}
                  className={`nation-card group relative overflow-hidden border p-3 pl-4 text-left transition-all ${
                    active ? 'border-[color:var(--c)] bg-ink-800' : 'border-line bg-ink-900/70 hover:border-faint hover:bg-ink-850'
                  }`}
                  style={{ ['--c' as string]: n.color }}
                >
                  <span className="absolute inset-y-0 left-0 w-1 transition-all group-hover:w-1.5" style={{ background: n.color }} aria-hidden />
                  {active && <span className="nation-card-glow" aria-hidden />}
                  <div className="relative flex items-center gap-2">
                    <Emblem color={n.color} government={n.government} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{n.name}</div>
                      <div className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: n.color }}>
                        {g.name}
                      </div>
                    </div>
                    <span className="max-lg:hidden">
                      <Kbd>{i + 1}</Kbd>
                    </span>
                  </div>
                  <p className="relative mt-2 text-xs leading-snug text-muted max-sm:hidden">{DOCTRINE[n.government]}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-1 hidden gap-1.5 text-[11px] text-faint lg:flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> cycle · <Kbd>R</Kbd> new seed · <Kbd>Enter</Kbd> begin
          </p>
        </section>

        {/* Theatre */}
        <section aria-label="Theatre" className="enter-2 flex min-w-0 flex-col gap-3">
          <Frame className="relative flex-1 overflow-hidden p-2" accent={spec.color}>
            <div className="font-display pointer-events-none absolute top-3 left-4 z-10 text-[10px] tracking-[0.06em] text-faint uppercase">
              Theatre map · seed <span className="font-mono text-muted">{seed}</span>
            </div>
            <MapPreview world={world} focus={nation} labels forces className="setup-map h-full max-h-[62vh] min-h-[220px] w-full sm:min-h-[280px]" />
            <div className="scanlines opacity-40" aria-hidden />
            <MapLegend />
          </Frame>

          <Frame className="flex flex-wrap items-end gap-x-6 gap-y-3 p-4">
            <div>
              <Label>Seed</Label>
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  className="w-28 border border-line bg-ink-850 px-2 py-1.5 font-mono text-sm text-text focus:border-signal focus:outline-none"
                  value={seed}
                  onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value))) || 1)}
                  data-testid="seed"
                  aria-label="Seed"
                />
                <button
                  type="button"
                  onClick={() => setSeed(randomSeed())}
                  className="border border-line bg-ink-800 px-2 py-1.5 text-sm text-muted hover:border-faint hover:text-text"
                  title="Roll a new seed (R)"
                  data-testid="seed-reroll"
                  aria-label="Roll a new seed"
                >
                  ⚄
                </button>
              </div>
            </div>
            <div>
              <Label>Length</Label>
              <div className="mt-1 flex" role="radiogroup" aria-label="Campaign length">
                {(
                  [
                    ['quick', 'Quick', Math.min(QUICK_TURNS, scenario.maxTurns)],
                    ['standard', 'Full', scenario.maxTurns],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={length === id}
                    data-testid={`length-${id}`}
                    onClick={() => pickLength(id)}
                    className={`border px-3 py-1.5 text-sm ${length === id ? 'border-signal bg-signal/15 text-signal' : 'border-line text-muted hover:text-text'}`}
                  >
                    {label} <span className="font-mono text-xs opacity-70">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <Fact label="Rivals" value={`${scenario.nations - 1} AI powers`} />
            <div className="min-w-[220px] flex-1">
              <Label>Victory</Label>
              <p className="mt-1 text-xs leading-snug text-muted">
                Hold <span className="text-text">{VICTORY_SHARE}% of victory points</span>, be the{' '}
                <span className="text-text">last power standing</span>, or <span className="text-text">lead at turn {turns}</span>.
              </p>
            </div>
          </Frame>
        </section>

        {/* Dossier */}
        <section aria-labelledby="dossier" className="enter-3 flex flex-col gap-3">
          <Frame className="flex-1 p-4" accent={spec.color}>
            <Label>
              <span id="dossier">Intelligence dossier</span>
            </Label>
            <div key={nation} className="dossier-swap">
              <h2 className="font-display mt-2 text-2xl leading-tight font-black tracking-tight" style={{ color: spec.color }} data-testid="dossier-name">
                {spec.name}
              </h2>
              <p className="text-xs font-semibold tracking-wide text-text/80 uppercase">{gov.name}</p>
              <p className="mt-1 text-xs text-muted">
                {gov.summary} Seat of government: <span className="text-text">{spec.capital[2]}</span>.
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {traits(gov.modifiers).map((t) => (
                  <span
                    key={t.label}
                    className={`border px-1.5 py-0.5 font-mono text-[11px] ${t.good ? 'border-good/40 bg-good/10 text-good' : 'border-hostile/40 bg-hostile/10 text-hostile'}`}
                  >
                    {t.value} <span className="font-sans text-text/70">{t.label}</span>
                  </span>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <Big label="Territory" value={info.hexes} unit="hex" />
                <Big label="Cities" value={info.cities} />
                <Big label="VP held" value={info.victoryPoints} unit={`${info.vpShare}%`} />
                <Big label="Population" value={`${(info.population / 1000).toFixed(1)}`} unit="M" />
                <Big label="Stability" value={info.stability} />
                <Big label="To objective" value={info.toObjective} unit="hex" />
              </div>

              <Label className="mt-4">Income per turn</Label>
              <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
                <Res label="Credits" v={info.income.credits} />
                <Res label="Energy" v={info.income.energy} />
                <Res label="Materials" v={info.income.materials} />
                <Res label="Food" v={info.income.food} />
                <Res label="Industry" v={info.industry} />
                <Res label="Research" v={info.research} />
              </div>

              <Label className="mt-4">Order of battle · {info.formations} formations</Label>
              <ul className="mt-1.5 grid grid-cols-3 gap-1.5">
                {CLASS_ORDER.map((c) => (
                  <li key={c} className="flex items-center gap-1.5 border border-line/70 bg-ink-850 px-1.5 py-1" title={UNITS[c].name}>
                    <UnitGlyph unitClass={c} color={spec.color} />
                    <span className="font-mono text-[10px] text-muted">{UNITS[c].short}</span>
                    <span className="ml-auto font-mono text-xs font-semibold">×{info.forces[c]}</span>
                  </li>
                ))}
              </ul>

              <Label className="mt-4">Contested borders</Label>
              <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                {info.fronts.length === 0 && <span className="text-faint">None. Every rival is beyond the basin.</span>}
                {info.fronts.map((f) => {
                  const r = NATIONS.find((n) => n.id === f)!;
                  return (
                    <span key={f} className="flex items-center gap-1.5 border border-line/70 bg-ink-850 px-1.5 py-0.5">
                      <Swatch color={r.color} />
                      {r.name}
                    </span>
                  );
                })}
              </div>
            </div>
          </Frame>

          <button
            type="button"
            onClick={() => void begin()}
            disabled={starting}
            data-testid="start-game"
            className="begin-btn group relative overflow-hidden border border-signal bg-signal px-5 py-4 text-left text-ink-950 shadow-2xl transition-all hover:brightness-110 disabled:opacity-70 max-lg:fixed max-lg:inset-x-3 max-lg:bottom-[max(env(safe-area-inset-bottom),12px)] max-lg:z-30"
          >
            <span className="relative z-10 flex items-center justify-between">
              <span>
                <span className="font-display block text-[10px] font-bold tracking-[0.1em] uppercase opacity-70">{starting ? 'Establishing command link' : `Operation ${op}`}</span>
                <span className="font-display block text-lg font-black tracking-wide uppercase">{starting ? 'Deploying…' : 'Begin campaign'}</span>
              </span>
              <span className="text-2xl transition-transform group-hover:translate-x-1" aria-hidden>
                ▸
              </span>
            </span>
          </button>
        </section>
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Big({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <div className="border border-line/70 bg-ink-850/80 px-2 py-1.5">
      <div className="font-display text-[9px] tracking-[0.06em] text-faint uppercase">{label}</div>
      <div className="font-mono text-lg leading-tight font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function Res({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between border-b border-line/40 py-0.5">
      <span className="font-sans text-muted">{label}</span>
      <span className="text-good">+{v}</span>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 flex flex-wrap gap-x-3 gap-y-1 border border-line/70 bg-ink-950/80 px-2 py-1 text-[10px] text-muted">
      <span>★ capital</span>
      <span>■ city</span>
      <span>◇ depot</span>
      <span className="text-signal">◎ objective</span>
      <span>• formation</span>
    </div>
  );
}
