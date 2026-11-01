import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignLength, Difficulty, NationId } from '@brink/contracts';
import { CAMPAIGN_TURNS, GOVERNMENTS, UNITS, VICTORY } from '@brink/game-data';
import { NATIONS, THEATRES, createScenario } from '@brink/scenarios';
import { readCareer } from '../arena/career';
import { readPrefs, writePrefs } from '../saves';
import { Kbd, Mark, useKeys } from '../chrome';
import { CLASS_ORDER, DOCTRINE, dossier, operationName, randomSeed, traits, VICTORY_SHARE } from './intel';
import { Emblem, UnitGlyph } from '../glyphs';
import { MapPreview } from './MapPreview';

// The campaign briefing: a war-room screen in the title screen's language (engraved gold for
// command, the nation's colour for who you are). Classes are `.wr-*` in index.css, set outside the
// Console scope's resets so display type survives.

const DIFFICULTIES: { id: Difficulty; label: string; threat: number; text: string }[] = [
  { id: 'easy', label: 'Easy', threat: 1, text: 'One enemy, the rest at peace. +70% income, +40% attack, cheaper units.' },
  { id: 'normal', label: 'Normal', threat: 2, text: 'All three rivals at war with you. +30% income, +20% attack.' },
  { id: 'hard', label: 'Hard', threat: 3, text: 'Everyone at war, no edge, and the AI starts richer.' },
];

const LENGTHS: [CampaignLength, string][] = [
  ['quick', 'Quick'],
  ['standard', 'Standard'],
  ['epic', 'Epic'],
];

export function Setup({ onBack, onBegin }: { onBack: () => void; onBegin: (nation: NationId, seed: number, maxTurns: number, difficulty: Difficulty, theatre: string) => Promise<void> }) {
  const wars = readCareer().warsWon.length;
  const [theatreId, setTheatreId] = useState(() => {
    const t = THEATRES.find((x) => x.id === readPrefs().theatre);
    return t && t.unlock <= wars ? t.id : THEATRES[0]!.id;
  });
  const theatre = THEATRES.find((t) => t.id === theatreId)!;
  const pickTheatre = (id: string) => {
    setTheatreId(id);
    writePrefs({ theatre: id });
  };
  const [nation, setNation] = useState<NationId>(() => {
    const p = readPrefs().nation;
    return NATIONS.some((n) => n.id === p) ? p! : NATIONS[0]!.id;
  });
  const [seed, setSeed] = useState(randomSeed);
  const [starting, setStarting] = useState(false);
  const [length, setLength] = useState<CampaignLength>(() => readPrefs().length ?? 'quick');
  const turns = CAMPAIGN_TURNS[length];
  const [difficulty, setDifficulty] = useState<Difficulty>(() => readPrefs().difficulty ?? 'easy');
  const pickDifficulty = (d: Difficulty) => {
    setDifficulty(d);
    writePrefs({ difficulty: d });
  };
  const pickLength = (l: CampaignLength) => {
    setLength(l);
    writePrefs({ length: l });
  };

  const world = useMemo(() => createScenario(theatreId, seed), [theatreId, seed]);
  const spec = NATIONS.find((n) => n.id === nation)!;
  const gov = GOVERNMENTS[spec.government];
  const info = useMemo(() => dossier(world, nation), [world, nation]);
  const op = operationName(seed);
  const diff = DIFFICULTIES.find((d) => d.id === difficulty)!;
  const desk = useDesk();

  const pick = (id: NationId) => {
    setNation(id);
    writePrefs({ nation: id });
  };
  const begin = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await onBegin(nation, seed, turns, difficulty, theatreId);
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
    [nation, seed, starting, turns, difficulty, theatreId],
  );

  const incomes: [string, number][] = [
    ['Credits', info.income.credits],
    ['Industry', info.industry],
    ['Food', info.income.food],
    ['Materials', info.income.materials],
    ['Energy', info.income.energy],
    ['Research', info.research],
  ];
  const topIncome = Math.max(1, ...incomes.map(([, v]) => v));
  const coalition2 = VICTORY.coalitionBase + VICTORY.coalitionPerMember * 2;
  const coalition3 = VICTORY.coalitionBase + VICTORY.coalitionPerMember * 3;

  // On a phone the deploy bar is docked to the thumb. It is portalled to <body>: the menu's
  // entrance animation transforms an ancestor, which would trap a fixed element inside the scroller.
  const dock = (
    <div className="wr-dock">
      <div className="wr-dock-summary lg:hidden">
        <span className="v-dot" style={{ background: spec.color }} />
        <b>{spec.name}</b>
        <span>·</span>
        <span>{diff.label}</span>
        <span>·</span>
        <span>{turns} turns</span>
      </div>
      <button type="button" onClick={() => void begin()} disabled={starting} data-testid="start-game" className="wr-deploy">
        <span className="wr-deploy-hazard" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="wr-deploy-kicker">{starting ? 'Establishing command link' : `Operation ${op}`}</span>
          <span className="wr-deploy-label">{starting ? 'Deploying…' : 'Begin campaign'}</span>
        </span>
        <span className="wr-deploy-arrow" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 5l7 7-7 7M12 5l7 7-7 7" />
          </svg>
        </span>
      </button>
    </div>
  );

  return (
    <main className="wr flex min-h-full flex-col" style={{ ['--nation' as string]: spec.color }}>
      {/* Top bar */}
      <header className="wr-top safe-x sticky top-0 z-30">
        <div className="flex h-13 items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={onBack} className="wr-back" data-testid="menu-back" aria-label="Back to the title">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <Mark className="h-4.5 w-4.5" />
            <span>Brink</span>
          </button>
          <span className="wr-crumb">New campaign</span>
          <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-faint lg:flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> nation · <Kbd>R</Kbd> reroll · <Kbd>Enter</Kbd> deploy · <Kbd>Esc</Kbd>
          </span>
        </div>
      </header>

      <div className="wr-grid flex-1 px-4 pb-44 sm:px-6 lg:pb-8">
        {/* Hero: the theatre under the operation's codename */}
        <section aria-label="Theatre" className="wr-area-hero enter-1">
          <div className="wr-hero">
            <MapPreview world={world} focus={nation} labels forces className="wr-hero-map" />
            <div className="wr-hero-shade" aria-hidden />
            <div className="wr-hero-sweep" aria-hidden />
            <div className="wr-hero-copy">
              <div className="flex items-center gap-2">
                <span className="wr-stamp">Top secret</span>
                <span className="wr-kicker">{theatre.name}</span>
              </div>
              <p className="wr-kicker mt-3 opacity-80">Operation</p>
              <h1 key={op} className="wr-codename" data-testid="operation">
                {op}
              </h1>
              <p className="wr-meta">
                <span>Seed {seed}</span>
                <span>{turns} turns</span>
                <span>{diff.label}</span>
              </p>
            </div>
            <MapLegend />
          </div>
        </section>

        {/* Roster */}
        <section aria-labelledby="roster" className="wr-area-roster enter-2">
          <SectionHead id="roster" index="01">
            Choose your nation
          </SectionHead>
          <div className="grid grid-cols-4 gap-2 lg:grid-cols-1" role="radiogroup" aria-label="Nation">
            {NATIONS.map((n, i) => {
              const g = GOVERNMENTS[n.government];
              const active = n.id === nation;
              return (
                <button
                  key={n.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={n.name}
                  data-testid={`nation-${n.id}`}
                  data-active={active}
                  onClick={() => pick(n.id)}
                  className="wr-nation"
                  style={{ ['--c' as string]: n.color }}
                >
                  <Emblem color={n.color} government={n.government} className="h-9 w-9 lg:h-10 lg:w-10" />
                  <span className="min-w-0 flex-1 max-lg:text-center">
                    <span className="wr-nation-name">
                      <span className="wr-only-phone">{n.name.split(' ')[0]}</span>
                      <span className="wr-only-desk">{n.name}</span>
                    </span>
                    <span className="wr-nation-gov">{g.name}</span>
                    <span className="wr-nation-doctrine">{DOCTRINE[n.government]}</span>
                  </span>
                  <span className="wr-nation-key" aria-hidden>
                    {i + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Dossier */}
        <section aria-labelledby="dossier" className="wr-area-dossier enter-2 flex flex-col gap-3">
          <div className="wr-panel wr-dossier">
            <SectionHead id="dossier" index="02">
              Intelligence dossier
            </SectionHead>
            <div key={nation} className="dossier-swap">
              <div className="flex items-start gap-3">
                <Emblem color={spec.color} government={spec.government} className="wr-dossier-emblem h-14 w-14" />
                <div className="min-w-0">
                  <h2 className="wr-dossier-name" data-testid="dossier-name">
                    {spec.name}
                  </h2>
                  <p className="wr-dossier-gov">{gov.name}</p>
                </div>
              </div>
              <blockquote className="wr-doctrine">{DOCTRINE[spec.government]}</blockquote>
              <p className="mt-2 text-[13px] leading-snug text-muted">
                {gov.summary} Seat of government: <span className="text-text">{spec.capital[2]}</span>.
              </p>

              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="National traits">
                {traits(gov.modifiers).map((t) => (
                  <li key={t.label} className="wr-trait" data-good={t.good}>
                    <b>{t.value}</b>
                    {t.label}
                  </li>
                ))}
              </ul>

              <SubHead>Strategic posture</SubHead>
              <div className="wr-vp">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="wr-big">
                    {info.victoryPoints}
                    <small>VP</small>
                  </span>
                  <span className="text-right text-xs text-muted">
                    <b className="text-text">{info.vpShare}%</b> held · domination at <b className="wr-gold-text">{VICTORY_SHARE}%</b>
                  </span>
                </div>
                <div className="wr-vp-track" style={{ ['--held' as string]: `${Math.min(100, info.vpShare)}%`, ['--goal' as string]: `${VICTORY_SHARE}%` } as CSSProperties}>
                  <span className="wr-vp-fill" />
                  <span className="wr-vp-goal" />
                </div>
              </div>
              <dl className="wr-stats">
                <Stat label="Territory" value={info.hexes} unit="hex" />
                <Stat label="Cities" value={info.cities} />
                <Stat label="Population" value={(info.population / 1000).toFixed(1)} unit="M" />
                <Stat label="Stability" value={info.stability} meter={info.stability} />
                <Stat label="To objective" value={info.toObjective} unit="hex" />
                <Stat label="Formations" value={info.formations} />
              </dl>

              <SubHead>Income per turn</SubHead>
              <ul className="wr-income">
                {incomes.map(([label, v]) => (
                  <li key={label}>
                    <span className="text-muted">{label}</span>
                    <span className="wr-income-bar" aria-hidden>
                      <span style={{ width: `${Math.round((v * 100) / topIncome)}%` }} />
                    </span>
                    <span className="wr-income-v">+{v}</span>
                  </li>
                ))}
              </ul>

              <SubHead aside={`${info.formations} formations`}>Order of battle</SubHead>
              <ul className="wr-oob">
                {CLASS_ORDER.map((c) => (
                  <li key={c} title={UNITS[c].name} data-empty={info.forces[c] === 0}>
                    <UnitGlyph unitClass={c} color={spec.color} className="h-5 w-7" />
                    <span className="wr-oob-short">{UNITS[c].short}</span>
                    <span className="wr-oob-n">{info.forces[c]}</span>
                  </li>
                ))}
              </ul>

              <SubHead>Contested borders</SubHead>
              <div className="flex flex-wrap gap-1.5 text-[13px]">
                {info.fronts.length === 0 && <span className="text-faint">None. Every rival is beyond the basin.</span>}
                {info.fronts.map((f) => {
                  const r = NATIONS.find((n) => n.id === f)!;
                  return (
                    <span key={f} className="wr-front" style={{ ['--c' as string]: r.color }}>
                      <Emblem color={r.color} government={r.government} className="h-4.5 w-4.5" />
                      {r.name}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {desk && dock}
        </section>

        {/* Mission parameters */}
        <section aria-labelledby="params" className="wr-area-params enter-3 flex flex-col gap-3">
          <div className="wr-panel">
            <SectionHead id="params" index="03">
              Mission parameters
            </SectionHead>

            <SubHead first>Difficulty</SubHead>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Difficulty">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === d.id}
                  data-testid={`difficulty-${d.id}`}
                  data-threat={d.threat}
                  onClick={() => pickDifficulty(d.id)}
                  className="wr-choice"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="wr-choice-title">{d.label}</span>
                    <span className="wr-threat" aria-label={`Threat ${d.threat} of 3`}>
                      {[1, 2, 3].map((p) => (
                        <i key={p} data-on={p <= d.threat} />
                      ))}
                    </span>
                  </span>
                  <span className="wr-choice-text">{d.text}</span>
                </button>
              ))}
            </div>

            <SubHead>Theatre</SubHead>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Theatre">
              {THEATRES.map((t) => {
                const locked = t.unlock > wars;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={theatreId === t.id}
                    disabled={locked}
                    data-testid={`theatre-${t.id}`}
                    onClick={() => pickTheatre(t.id)}
                    className="wr-choice"
                  >
                    <span className="wr-choice-title">
                      {locked && (
                        <svg viewBox="0 0 24 24" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                          <rect x="5" y="11" width="14" height="10" rx="2" />
                          <path d="M8 11V8a4 4 0 018 0v3" />
                        </svg>
                      )}
                      {t.name.replace(/^The /, '')}
                    </span>
                    <span className="wr-choice-text">{locked ? `Win ${t.unlock} war${t.unlock === 1 ? '' : 's'} to unlock (${wars}/${t.unlock})` : t.summary}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-1">
              <div>
                <SubHead>Length</SubHead>
                <div className="wr-seg" role="radiogroup" aria-label="Campaign length">
                  {LENGTHS.map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={length === id} data-testid={`length-${id}`} onClick={() => pickLength(id)}>
                      {label} <span className="wr-seg-n">{CAMPAIGN_TURNS[id]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <SubHead>Seed</SubHead>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    className="wr-input w-28"
                    value={seed}
                    onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value))) || 1)}
                    data-testid="seed"
                    aria-label="Seed"
                  />
                  <button type="button" onClick={() => setSeed(randomSeed())} className="wr-icon-btn" title="Roll a new seed (R)" data-testid="seed-reroll" aria-label="Roll a new seed">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
                      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
                      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" />
                      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
                      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" />
                      <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="wr-panel">
            <SectionHead index="04">Conditions of victory</SectionHead>
            <ul className="wr-wins">
              <Win figure={`${VICTORY_SHARE}%`} name="Domination">
                of all victory points
              </Win>
              <Win figure={`${coalition2}/${coalition3}%`} name="Coalition">
                with two or three allies
              </Win>
              <Win figure={`${VICTORY.supremacyShare}%`} name="Supremacy">
                avg. land, army, output from turn {VICTORY.supremacyFromTurn}
              </Win>
              <Win figure={`T${turns}`} name="Score">
                best standing when time runs out
              </Win>
              <Win figure="1" name="Last standing">
                the only power left
              </Win>
            </ul>
          </div>
        </section>
      </div>
      {!desk &&
        createPortal(
          <div className="vercel vercel-mono wr-dock-host" style={{ ['--nation' as string]: spec.color }}>
            {dock}
          </div>,
          document.body,
        )}
    </main>
  );
}

const DESK = '(min-width: 1024px)';

/** True on a desk-width screen, tracking resizes. */
function useDesk(): boolean {
  const [desk, setDesk] = useState(() => window.matchMedia(DESK).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESK);
    const on = () => setDesk(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desk;
}

function SectionHead({ children, index, id }: { children: ReactNode; index: string; id?: string }) {
  return (
    <h2 className="wr-section">
      <span className="wr-section-index">{index}</span>
      <span id={id}>{children}</span>
      <span className="wr-section-rule" aria-hidden />
    </h2>
  );
}

function SubHead({ children, aside, first }: { children: ReactNode; aside?: string; first?: boolean }) {
  return (
    <h3 className={`wr-sub ${first ? 'mt-0' : ''}`}>
      <span>{children}</span>
      {aside && <span className="wr-sub-aside">{aside}</span>}
    </h3>
  );
}

function Stat({ label, value, unit, meter }: { label: string; value: number | string; unit?: string; meter?: number }) {
  return (
    <div className="wr-stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {unit && <small>{unit}</small>}
      </dd>
      {meter !== undefined && (
        <span className="wr-stat-meter" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </span>
      )}
    </div>
  );
}

function Win({ figure, name, children }: { figure: string; name: string; children: ReactNode }) {
  return (
    <li className="wr-win">
      <span className="wr-win-figure">{figure}</span>
      <span className="wr-win-name">{name}</span>
      <span className="wr-win-text">{children}</span>
    </li>
  );
}

function MapLegend() {
  return (
    <div className="wr-legend" aria-hidden>
      <span>★ capital</span>
      <span>■ city</span>
      <span>◇ depot</span>
      <span className="wr-gold-text">◎ objective</span>
      <span>• formation</span>
    </div>
  );
}
