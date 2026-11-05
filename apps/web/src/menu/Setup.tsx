import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignLength, Difficulty, NationId } from '@brink/contracts';
import { CAMPAIGN_TURNS, GOVERNMENTS, NATION_BLURB, UNITS, VICTORY, victoryBars } from '@brink/game-data';
import { classicOnly, crisisOf, dealCrisis, FIRST_CONTACT, THEATRES, createScenario, theatreCrises, theatreMinors, theatrePowers, type CrisisId } from '@brink/scenarios';
import { readCareer } from '../arena/career';
import { readPrefs, writePrefs } from '../saves';
import { Kbd, Mark, useKeys } from '../chrome';
import { CLASS_ORDER, DOCTRINE, dossier, operationName, randomSeed, traits } from './intel';
import { Emblem, UnitGlyph } from '../glyphs';
import { MapPreview } from './MapPreview';
import { LeaderCard } from './Leader';

// The campaign briefing: a war-room screen in the title screen's language (engraved gold for
// command, the nation's colour for who you are). Classes are `.wr-*` in index.css, set outside the
// Console scope's resets so display type survives.

// Each level in one plain line (what it means for you), then the numbers behind it.
const DIFFICULTIES: { id: Difficulty; label: string; threat: number; means: string; text: string }[] = [
  { id: 'easy', label: 'Easy', threat: 1, means: 'Learn the game: one enemy, an ally beside you, and a big edge.', text: '+75% income, +55% attack, cheaper units.' },
  { id: 'normal', label: 'Normal', threat: 2, means: 'A real war: every rival against you, with a smaller edge.', text: '+40% income, +30% attack.' },
  { id: 'hard', label: 'Hard', threat: 3, means: 'No help at all: everyone at war with you, and the AI starts richer.', text: 'No edge for you.' },
];

const LENGTHS: [CampaignLength, string][] = [
  ['quick', 'Quick'],
  ['standard', 'Standard'],
  ['epic', 'Epic'],
  ['total', 'Total War'],
];

/** The classic opening, shown as a card like a crisis: no story edits, the difficulty sets the wars. */
const CLASSIC = {
  id: 'classic',
  name: 'Classic War',
  hook: 'Everyone against everyone.',
  story: 'No spark, no story: every power is at war from the first hour and the minor states are fair game. The way Brink was first played.',
  setup: 'Every power is at war with every other (on Easy, with just one of them). Minor states hold their own cities.',
  threat: 2 as const,
  recommended: null as NationId | null,
};

/** The powers on the ice in Black Files: First Contact; a player of another power leads its first (the United States) there. */
const ON_THE_ICE: readonly NationId[] = FIRST_CONTACT.powers.map((n) => n.id);

export function Setup({ onBack, onBegin }: { onBack: () => void; onBegin: (nation: NationId, seed: number, maxTurns: number, difficulty: Difficulty, theatre: string, crisis?: string, blackFiles?: boolean) => Promise<void> }) {
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
  // Each theatre has its own powers, minor states and crises; a nation the theatre does not have
  // falls back to its first power.
  const nations = theatrePowers(theatreId);
  const minors = theatreMinors(theatreId);
  const CRISES = theatreCrises(theatreId);
  const [chosen, setNation] = useState<NationId>(() => readPrefs().nation ?? nations[0]!.id);
  const nation = nations.some((n) => n.id === chosen) ? chosen : nations[0]!.id;
  const [seed, setSeed] = useState(randomSeed);
  const [starting, setStarting] = useState(false);
  const [length, setLength] = useState<CampaignLength>(() => readPrefs().length ?? 'quick');
  const turns = CAMPAIGN_TURNS[length];
  // The bars the campaign will be won by: by its length and the theatre's count of powers.
  const bars = victoryBars(turns, nations.length);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => readPrefs().difficulty ?? 'easy');
  const pickDifficulty = (d: Difficulty) => {
    setDifficulty(d);
    writePrefs({ difficulty: d });
  };
  const pickLength = (l: CampaignLength) => {
    setLength(l);
    writePrefs({ length: l });
  };

  // The Opening Crisis: picked, or dealt from the seed (so a shared seed opens the same way).
  // 'none' is the classic opening: no crisis, every war set by the difficulty.
  const [crisisPick, setCrisisPick] = useState<'random' | 'none' | CrisisId>(() => {
    const p = readPrefs().crisis;
    return p && (p === 'random' || p === 'none' || crisisOf(p)) ? (p as 'random' | 'none' | CrisisId) : 'random';
  });
  const pickCrisis = (c: 'random' | 'none' | CrisisId) => {
    setCrisisPick(c);
    writePrefs({ crisis: c });
  };
  // A theatre with no crises of its own opens the classic way.
  const crisis = crisisPick === 'none' || classicOnly(theatreId) ? CLASSIC : crisisOf(crisisPick === 'random' ? dealCrisis(seed) : crisisPick)!;
  /** The next crisis in the deck from this one: a fresh deal that never repeats the current one. */
  const dealAnother = () => {
    if (CRISES.length < 2) return;
    const i = Math.max(0, CRISES.findIndex((c) => c.id === crisis.id));
    pickCrisis(CRISES[(i + 1 + (seed % (CRISES.length - 1))) % CRISES.length]!.id);
  };
  const world = useMemo(() => createScenario(theatreId, seed), [theatreId, seed]);
  const spec = nations.find((n) => n.id === nation)!;
  const gov = GOVERNMENTS[spec.government];
  const info = useMemo(() => dossier(world, nation), [world, nation]);
  const op = operationName(seed);
  const diff = DIFFICULTIES.find((d) => d.id === difficulty)!;
  const desk = useDesk();
  // Command marks are gold, unless the nation itself wears gold: then they go platinum, so who you
  // are and what you command never read as one colour.
  const command = nearGold(spec.color) ? 'platinum' : 'gold';

  const pick = (id: NationId) => {
    setNation(id);
    writePrefs({ nation: id });
  };
  // The Black Files: seeded into this campaign by the toggle (off by default) in a theatre whose map
  // has their sites, or played on their own.
  const [blackFilesPick, setBlackFiles] = useState(() => readPrefs().blackFiles === true);
  const blackFiles = blackFilesPick && theatre.blackFiles;
  const toggleBlackFiles = () => {
    setBlackFiles(!blackFiles);
    writePrefs({ blackFiles: !blackFiles });
  };
  const firstContact = FIRST_CONTACT;
  const iceNation = ON_THE_ICE.includes(nation) ? nation : ON_THE_ICE[0]!;
  const begin = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await onBegin(nation, seed, turns, difficulty, theatreId, crisis.id === 'classic' ? undefined : crisis.id, blackFiles);
    } finally {
      setStarting(false);
    }
  };
  const beginFirstContact = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await onBegin(iceNation, seed, FIRST_CONTACT.maxTurns, difficulty, FIRST_CONTACT.id);
    } finally {
      setStarting(false);
    }
  };

  useKeys(
    (e) => {
      const i = nations.findIndex((n) => n.id === nation);
      if (e.key === 'Escape') onBack();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(nations[(i + 1) % nations.length]!.id);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(nations[(i - 1 + nations.length) % nations.length]!.id);
      else if (e.key === 'r') setSeed(randomSeed());
      else if (e.key === 'Enter' && document.activeElement === document.body) void begin();
      else {
        const n = Number(e.key);
        if (n >= 1 && n <= nations.length) pick(nations[n - 1]!.id);
      }
    },
    [nation, seed, starting, turns, difficulty, theatreId, nations],
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
        <span className="wr-deploy-sheen" aria-hidden />
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
    <main className="wr flex min-h-full flex-col" data-command={command} style={{ ['--nation' as string]: spec.color }}>
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
            <div className="wr-hero-stage">
              <MapPreview world={world} focus={nation} labels forces className="wr-hero-map" />
              <div className="wr-hero-shade" aria-hidden />
              <div className="wr-hero-sweep" aria-hidden />
              <span className="wr-reg tl" aria-hidden />
              <span className="wr-reg tr" aria-hidden />
              <span className="wr-reg bl" aria-hidden />
              <span className="wr-reg br" aria-hidden />
            </div>
            <div className="wr-hero-copy">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="wr-stamp">Top secret</span>
                  <span className="wr-kicker">{theatre.name}</span>
                </div>
                <p className="wr-kicker wr-kicker-dim mt-3">Operation</p>
                <h1 key={op} className="wr-codename" data-testid="operation">
                  {op}
                </h1>
                <p className="wr-crisis-line" data-testid="hero-crisis">
                  <b>{crisis.name}.</b> {crisis.hook}
                </p>
                <p className="wr-meta">
                  <span>Seed {seed}</span>
                  <span>{turns} turns</span>
                  <span>{diff.label}</span>
                </p>
              </div>
              <MapLegend />
            </div>
          </div>
        </section>

        {/* Roster */}
        <section aria-labelledby="roster" className="wr-area-roster enter-2">
          <SectionHead id="roster" index="01">
            Choose your nation
          </SectionHead>
          <div className={`grid ${nations.length > 4 ? 'grid-cols-3' : 'grid-cols-4'} gap-2 lg:grid-cols-1`} role="radiogroup" aria-label="Nation">
            {nations.map((n, i) => {
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
                      <span className="wr-only-phone">{n.short}</span>
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
              <LeaderCard government={spec.government} />
              {NATION_BLURB[spec.id] && (
                <p className="wr-blurb" data-testid="dossier-blurb">
                  {NATION_BLURB[spec.id]}
                </p>
              )}
              <p className="mt-2 text-[13px] leading-snug text-muted">
                {gov.summary} Theatre command: <span className="text-text">{spec.capital[2]}</span>.
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
                    <Num v={info.victoryPoints} />
                    <small>VP</small>
                  </span>
                  <span className="text-right text-xs text-muted">
                    <b className="text-text">{info.vpShare}%</b> held · domination at <b className="wr-goal-text">{bars.dominationShare}%</b>
                  </span>
                </div>
                <div className="wr-vp-track" style={{ ['--held' as string]: `${Math.min(100, info.vpShare)}%`, ['--goal' as string]: `${bars.dominationShare}%` } as CSSProperties}>
                  <span className="wr-vp-fill" />
                  <span className="wr-vp-goal" />
                  <span className="wr-vp-goal-label" aria-hidden>
                    Win
                  </span>
                </div>
              </div>
              <dl className="wr-stats">
                <Stat label="Territory" value={info.hexes} unit="hex" />
                <Stat label="Cities" value={info.cities} />
                <Stat label="Population" value={info.population / 1000} decimals={1} unit="M" />
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
                    <span className="wr-income-v">
                      +<Num v={v} />
                    </span>
                  </li>
                ))}
              </ul>

              <SubHead aside={`${info.formations} formations`}>Order of battle</SubHead>
              <ul className="wr-oob">
                {CLASS_ORDER.map((c) => (
                  <li key={c} title={UNITS[c].name} data-empty={info.forces[c] === 0}>
                    <UnitGlyph unitClass={c} color={spec.color} className="h-5 w-7" />
                    <span className="wr-oob-short">{UNITS[c].short}</span>
                    <span className="wr-oob-n">
                      <Num v={info.forces[c]} />
                    </span>
                  </li>
                ))}
              </ul>

              <SubHead>Contested borders</SubHead>
              <div className="flex flex-wrap gap-1.5 text-[13px]">
                {info.fronts.length === 0 && <span className="text-faint">None. Every rival is across the sea.</span>}
                {info.fronts.map((f) => {
                  const r = [...nations, ...minors].find((n) => n.id === f)!;
                  return (
                    <span key={f} className="wr-front" style={{ ['--c' as string]: r.color }}>
                      <Emblem color={r.color} government={r.government} className="h-4.5 w-4.5" />
                      {r.name}
                      {r.minor && <span className="wr-front-tag">neutral</span>}
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

            <SubHead first aside={classicOnly(theatreId) ? 'none in this theatre' : crisis.id === 'classic' ? 'no crisis' : crisisPick === 'random' ? 'dealt from the seed' : 'your pick'}>
              Opening crisis
            </SubHead>
            <div className="wr-crisis" data-testid="crisis-card" data-crisis={crisis.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="wr-crisis-name">{crisis.name}</div>
                  <div className="wr-crisis-hook">{crisis.hook}</div>
                </div>
                <span className="wr-threat shrink-0" data-threat={crisis.threat} aria-label={`Threat ${crisis.threat} of 3`}>
                  {[1, 2, 3].map((p) => (
                    <i key={p} data-on={p <= crisis.threat} />
                  ))}
                </span>
              </div>
              <p className="wr-crisis-story">{crisis.story}</p>
              <p className="wr-crisis-setup">
                <b>On turn 1:</b> {crisis.setup}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {crisis.recommended && crisis.recommended !== nation && (
                  <button type="button" className="wr-chip" onClick={() => pick(crisis.recommended!)} data-testid="crisis-play-as">
                    Play as {nations.find((n) => n.id === crisis.recommended)!.name}
                  </button>
                )}
                {crisis.recommended === nation && <span className="wr-chip wr-chip-on">Recommended side</span>}
                {CRISES.length > 1 && (
                  <button type="button" className="wr-chip" onClick={dealAnother} data-testid="crisis-deal">
                    Deal another
                  </button>
                )}
              </div>
            </div>
            {/* A theatre with no Opening Crisis of its own (`classicOnly`) opens the classic way: no deck to pick from. */}
            {!classicOnly(theatreId) && (
              <div className="wr-crisis-deck" role="radiogroup" aria-label="Opening crisis">
                <button type="button" role="radio" aria-checked={crisisPick === 'random'} onClick={() => pickCrisis('random')} data-testid="crisis-random">
                  Random
                </button>
                <button type="button" role="radio" aria-checked={crisisPick === 'none'} onClick={() => pickCrisis('none')} data-testid="crisis-none">
                  Classic war
                </button>
                {CRISES.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={crisisPick === c.id} onClick={() => pickCrisis(c.id)} data-testid={`crisis-${c.id}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            <SubHead>Difficulty</SubHead>
            <p className="wr-choice-text -mt-1 mb-2" data-testid="difficulty-advice">
              New to Brink? Start on Easy: one war to win, with the staff to help you plan it.
            </p>
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
                    <span className="wr-choice-title">
                      {d.label}
                      {d.id === 'easy' && (
                        <span className="ml-2 rounded-full border border-current px-1.5 py-px align-middle font-mono text-[10px] tracking-wide uppercase" data-testid="difficulty-recommended">
                          First game
                        </span>
                      )}
                    </span>
                    <span className="wr-threat" aria-label={`Threat ${d.threat} of 3`}>
                      {[1, 2, 3].map((p) => (
                        <i key={p} data-on={p <= d.threat} />
                      ))}
                    </span>
                  </span>
                  <span className="wr-choice-text" data-testid={`difficulty-means-${d.id}`}>
                    <b className="font-semibold text-text">{d.means}</b> {d.text}
                  </span>
                </button>
              ))}
            </div>

            {/* The Black Files (MASTER-PLAN Phase 8): a toggle for this campaign where the theatre's map has
                their sites, and a scenario of their own. */}
            <SubHead aside={!theatre.blackFiles ? 'not in this theatre' : blackFiles ? 'classified: on' : 'off'}>The Black Files</SubHead>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="black-files-panel">
              {theatre.blackFiles && (
                <button type="button" role="switch" aria-checked={blackFiles} data-testid="black-files" onClick={toggleBlackFiles} className="wr-choice">
                  <span className="flex items-center justify-between gap-2">
                    <span className="wr-choice-title">Black Files</span>
                    <span className="wr-chip" data-on={blackFiles}>{blackFiles ? 'On' : 'Off'}</span>
                  </span>
                  <span className="wr-choice-text">Seed the anomaly into this campaign: Area 51, Tunguska, a Gobi site and a Bermuda deep site; digs in the Yukon, the Gobi and the steppe. Dig too deep and something wakes.</span>
                </button>
              )}
              <button type="button" data-testid="first-contact" onClick={() => void beginFirstContact()} disabled={starting} className="wr-choice">
                <span className="wr-choice-title">{firstContact.name}</span>
                <span className="wr-choice-text">
                  {firstContact.about} {firstContact.maxTurns} turns, as {iceNation === nation ? spec.name : `the ${firstContact.powers[0]!.name}`}.
                </span>
              </button>
            </div>

            {/* The theatre picker: every listed theatre (`THEATRES`); First Contact has its button above. */}
            {THEATRES.length > 1 && <SubHead>Theatre</SubHead>}
            <div className={`grid gap-2 sm:grid-cols-3 ${THEATRES.length > 1 ? '' : 'hidden'}`} role="radiogroup" aria-label="Theatre">
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
              <Win figure={`${bars.dominationShare}%`} name="Domination">
                of all victory points
              </Win>
              <Win figure={`${coalition2}/${coalition3}%`} name="Coalition">
                with two or three allies
              </Win>
              <Win figure={`${bars.supremacyShare}%`} name="Supremacy">
                avg. land, army, output from turn {bars.supremacyFromTurn}
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
          <div className="vercel vercel-mono wr-dock-host" data-command={command} style={{ ['--nation' as string]: spec.color }}>
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

function Stat({ label, value, unit, meter, decimals = 0 }: { label: string; value: number; unit?: string; meter?: number; decimals?: number }) {
  return (
    <div className="wr-stat">
      <dt>{label}</dt>
      <dd>
        <Num v={value} decimals={decimals} />
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

/** A figure that counts to its value (from wherever it was) when it changes; still under reduced motion. */
function Num({ v, decimals = 0 }: { v: number; decimals?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (start === v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = v;
      setShown(v);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 520);
      const x = start + (v - start) * (1 - (1 - k) ** 3);
      from.current = x;
      setShown(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <>{decimals ? shown.toFixed(decimals) : Math.round(shown)}</>;
}

/** True for a colour in the gold-to-olive band, where it would read as the command accent. */
function nearGold(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.3) return false;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const hue = (h * 60 + 360) % 360;
  return hue >= 34 && hue <= 72;
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
