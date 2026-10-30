import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ABILITIES,
  BREAK_AT,
  DIFFICULTY,
  act,
  advise,
  arenaResult,
  autoTurn,
  bestFire,
  buildForce,
  CAPTURE_ROUNDS,
  createBattle,
  endTurn,
  fireInfo,
  fitMen,
  pickConditions,
  RANKS,
  reachable,
  retreat,
  ROUND_LIMIT,
  strikeInfo,
  suppLevel,
  supportChance,
  typeOf,
  undoable,
  unitAt,
  usableWeapons,
  unitValue,
  visibleTo,
  WITHDRAW_AT,
  whyNot,
  woundedMen,
  type AbilityId,
  type Action,
  type ArenaResult,
  type Battle,
  type Difficulty,
  type FireInfo,
  type Point,
  type Role,
  type StrikeInfo,
  type Unit,
  type Weapon,
} from '@brink/arena';
import { UnitGlyph } from '../glyphs';
import { loadLibrary, type Library } from './assets';
import type { BattleRequest } from './battle';
import { readSettings, writeSettings, type ArenaSettings, type Quality } from './quality';
import { BattleStage, feelOf, type Overlay } from './stage';
import { roundNews, type RoundNews } from './report';
import { RoundReport } from './RoundReport';
import { classOf, health } from './units';

// One battle, fought in turns: a brief, the fight, the verdict. On your turn tap a unit, tap a lit
// cell to move it, tap a ringed enemy to see the odds, Fire to shoot; the unit card has the rest
// (overwatch, hunker, smoke, dismount, split, call fire...). End turn and the enemy moves.
// The safe-* classes set padding outside Tailwind's layers and win over px-*/pt-*, so padding goes
// on an inner element.

export type BattleOutcome = { kind: 'fought'; result: ArenaResult } | { kind: 'quick' } | { kind: 'back' };

declare global {
  interface Window {
    __arena?: {
      arena: () => Battle | null;
      /** A cell's centre on screen. */
      toScreen: (x: number, y: number) => Point;
      /** True when nothing is animating, the camera has settled, and it is your turn. */
      ready: () => boolean;
      win: () => void;
      lose: () => void;
      perf: (reset?: boolean) => ReturnType<BattleStage['perf']> | null;
      /** What the field overlay shows now. */
      overlay: () => ReturnType<BattleStage['overlayCounts']> | null;
      /** The film's queue (steps waiting, action cam, clock). */
      film: () => ReturnType<BattleStage['filmState']> | null;
    };
  }
}

/** Skip held this long (ms) fast-forwards instead. */
const HOLD_MS = 300;

const MODE_TEXT = {
  destroy: ['Destroy Them', 'Knock out their company, or break it: they pull back under a third of their strength.'],
  capture: ['Take the Ground', `End ${CAPTURE_ROUNDS} rounds in the amber circle with none of them in it, or break them.`],
} as const;

const TIME_TEXT = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' } as const;
const WEATHER_TEXT = { clear: 'clear', overcast: 'overcast', rain: 'rain', fog: 'fog', snow: 'snow' } as const;
const BIOME_TEXT = { temperate: 'Temperate', steppe: 'Steppe', desert: 'Desert', winter: 'Winter', urban: 'City' } as const;

function statusLine(u: Unit): string {
  const t = typeOf(u.type);
  const bits: string[] = [];
  if (t.mobility === 'foot') {
    bits.push(`${fitMen(u)} fit`);
    const w = woundedMen(u);
    if (w) bits.push(`${w} wounded`);
  } else if (t.crew) bits.push(`Crew ${u.crew}/${t.crew}`);
  if (u.mobilityKill) bits.push(t.mobility === 'heli' ? 'Damaged' : 'Immobilised');
  if (u.firepowerKill) bits.push('Gun out');
  if (u.optics) bits.push('Optics hit');
  const lvl = suppLevel(u.supp);
  if (lvl !== 'steady') bits.push(lvl === 'suppressed' ? 'Suppressed' : lvl === 'pinned' ? 'Pinned' : 'Broken');
  if (u.carrier) bits.push('Aboard');
  if (u.passengers.length) bits.push(`${u.passengers.length} squad aboard`);
  bits.push(u.acted ? 'Done' : u.moved ? 'Moved, can act' : 'Ready');
  return bits.join(' · ');
}

/** "Abrams x4, Bradley, Squad" from a list of names. */
function tally(names: string[]): string {
  const n = new Map<string, number>();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].map(([k, c]) => (c > 1 ? `${k} x${c}` : k)).join(', ');
}

const KIND_WORDS: [Role[], string][] = [
  [['mbt'], 'tanks'],
  [['ifv', 'apc'], 'armoured carriers'],
  [['light_tank', 'tank_hunter'], 'tank hunters'],
  [['rifle_squad', 'fireteam'], 'infantry'],
  [['at_team'], 'anti-tank teams'],
  [['aa_team', 'spaa'], 'air defence'],
  [['mortar', 'spg'], 'artillery'],
  [['attack_heli', 'gunship', 'scout_heli', 'transport_heli'], 'helicopters'],
  [['recon_drone', 'fpv_team', 'loiter_team'], 'drones'],
  [['sniper'], 'snipers'],
];

/** "Tanks, infantry and anti-tank teams" from a list of roles. */
function kinds(roles: Role[]): string {
  const words = KIND_WORDS.filter(([rs]) => roles.some((r) => rs.includes(r))).map(([, w]) => w);
  if (!words.length) return 'Unknown';
  const s = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!;
  return s[0]!.toUpperCase() + s.slice(1);
}

const PLACE: Partial<Record<number, string>> = { 1: 'the road', 2: 'the trees', 4: 'the bridge', 5: 'the building', 6: 'the rubble', 8: 'the rocks' };

/** The advised plan in words: "Move 4 cells into the trees, then fire at the T-72B3 (64%)." */
function adviceText(b: Battle, me: Unit, plan: Action[], known: Set<string>): string {
  const bits: string[] = [];
  let from: Point = me;
  const t = typeOf(me.type);
  for (const a of plan) {
    if (a.type === 'move') {
      const steps = Math.max(Math.abs(a.to.x - from.x), Math.abs(a.to.y - from.y));
      const place = PLACE[b.map.cells[a.to.y * b.map.w + a.to.x] ?? 0];
      bits.push(`${a.dash ? 'dash' : 'move'} ${steps} ${steps === 1 ? 'cell' : 'cells'}${place ? ` into ${place}` : ''}`);
      from = a.to;
    } else if (a.type === 'fire') {
      const target = b.units.find((u) => u.id === a.target);
      const w = t.weapons.find((x) => x.id === a.weapon);
      const info = target && w ? fireInfo(b, me, target, w, from, false, known) : null;
      bits.push(`fire at the ${target ? typeOf(target.type).short : 'enemy'}${info ? ` (${info.chance}%)` : ''}`);
    } else if (a.type === 'strike') bits.push(a.smoke ? 'lay smoke' : 'call fire on their position');
    else if (a.type === 'overwatch') bits.push('go on overwatch');
    else if (a.type === 'hunker') bits.push('hunker down');
    else if (a.type === 'smoke') bits.push('pop smoke');
    else if (a.type === 'face') bits.push('turn to face them');
    else if (a.type === 'dismount') bits.push('dismount the squad');
    else if (a.type === 'embark') bits.push('board the carrier');
    else if (a.type === 'treat') bits.push('treat the wounded');
    else if (a.type === 'repair') bits.push('repair the damaged vehicle');
    else if (a.type === 'breach') bits.push('breach the wall');
    else if (a.type === 'mine') bits.push('lay mines');
    else if (a.type === 'split') bits.push('split into fireteams');
    else if (a.type === 'merge') bits.push('join up');
  }
  const s = bits.length > 1 ? `${bits.slice(0, -1).join(', ')}, then ${bits.at(-1)}` : (bits[0] ?? 'hold');
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

/** A move being looked at: how far, into what, what it could hit from there, and who could hit it. */
function MoveCard({ b, me, at, dash, known, onCancel, onMove }: { b: Battle; me: Unit; at: Point; dash: boolean; known: Set<string>; onCancel: () => void; onMove: () => void }) {
  const steps = Math.max(Math.abs(at.x - me.x), Math.abs(at.y - me.y));
  const cell = b.map.cells[at.y * b.map.w + at.x] ?? 0;
  const place = PLACE[cell];
  const cover = cell === 2 || cell === 5 || cell === 6 || cell === 8;
  const there = { ...me, x: at.x, y: at.y, moved: true, dashed: dash };
  const enemies = b.units.filter((u) => u.side === 'red' && u.alive && known.has(u.id));
  const shots = dash
    ? []
    : enemies
        .map((u) => ({ u, info: bestFire(b, there, u, at, false, known) }))
        .filter((x): x is { u: Unit; info: FireInfo } => !!x.info)
        .sort((p, q) => q.info.chance - p.info.chance);
  // Who of the enemies you know could hit it there, assuming they see it.
  const threats = enemies
    .map((u) => ({ u, info: bestFire(b, u, there, u, false, new Set([me.id])) }))
    .filter((x): x is { u: Unit; info: FireInfo } => !!x.info)
    .sort((p, q) => q.info.chance - p.info.chance);
  const list = (xs: { u: Unit; info: FireInfo }[]) =>
    xs
      .slice(0, 3)
      .map((x) => `${typeOf(x.u.type).short} ${x.info.chance}%`)
      .join(', ');
  return (
    <div className="mb-2 rounded-xl bg-ink-900 p-3" data-testid="move-card">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[16px] font-bold">
          {dash ? 'Dash' : 'Move'} {steps} {steps === 1 ? 'cell' : 'cells'}
          {place ? ` into ${place}` : ''}
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-muted">{cover ? 'Cover' : 'In the open'}</span>
      </div>
      <dl className="mt-1.5 space-y-1 text-[14px] leading-snug">
        <div className="flex gap-2">
          <dt className="w-[92px] shrink-0 text-muted">From there</dt>
          <dd className="min-w-0" data-testid="move-shots">{dash ? 'A dash ends its turn: no shot' : shots.length ? list(shots) : 'Nothing you know of in sight'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[92px] shrink-0 text-muted">Can hit it</dt>
          <dd className="min-w-0" data-testid="move-threats">{threats.length ? list(threats) : 'None you know of'}</dd>
        </div>
      </dl>
      <div className="mt-2.5 flex gap-2">
        <button type="button" className="v-btn v-btn-secondary h-11 flex-1 text-[15px]" onClick={onCancel} data-testid="move-cancel">
          Cancel
        </button>
        <button type="button" className="v-btn v-btn-primary h-11 flex-[1.6] text-[15px] font-semibold" onClick={onMove} data-testid="arena-move">
          {dash ? 'Dash' : 'Move'}
        </button>
      </div>
    </div>
  );
}

function Tile({ u, active, onClick }: { u: Unit; active: boolean; onClick: () => void }) {
  const t = typeOf(u.type);
  const h = health(u);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!u.alive || !!u.carrier}
      className={`flex h-[58px] w-[54px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border bg-ink-900 ${active ? 'border-white' : 'border-line'} ${!u.alive ? 'opacity-30' : u.carrier ? 'opacity-50' : u.acted ? 'opacity-60' : ''}`}
      aria-pressed={active}
      aria-label={`Select ${u.name}`}
      data-testid={`arena-unit-${u.id}`}
    >
      <UnitGlyph unitClass={classOf(t.role)} color="#e8e8e8" className="h-5 w-7" />
      <span className="max-w-full truncate px-0.5 text-[10px] leading-none font-semibold text-text">{t.short}</span>
      <span className="h-1 w-9 rounded-full bg-white/15">
        <span className="block h-full rounded-full bg-white" style={{ width: `${h * 100}%` }} />
      </span>
    </button>
  );
}

/** A deep copy of the battle: it is plain JSON (no structuredClone needed on older iPhones). */
function copyBattle(b: Battle): Battle {
  return JSON.parse(JSON.stringify(b)) as Battle;
}

/** Your strength exactly; theirs as far as you have seen it fall. */
function strengths(b: Battle): { blue: number; red: number } {
  const start = (side: 'blue' | 'red') => b.units.filter((u) => u.side === side).reduce((s, u) => s + u.startValue, 0) || 1;
  const blue = b.units.filter((u) => u.side === 'blue').reduce((s, u) => s + unitValue(u), 0) / start('blue');
  // Theirs: start from all of them, take off what was seen destroyed and what the badges show.
  const gone = new Set(b.events.filter((e) => e.type === 'destroyed' && e.seen).map((e) => (e as { unit: string }).unit));
  const seen = visibleTo(b, 'blue');
  let red = start('red');
  for (const u of b.units) {
    if (u.side !== 'red') continue;
    if (gone.has(u.id)) red -= u.startValue;
    else if (seen.has(u.id)) red -= u.startValue - unitValue(u);
  }
  return { blue: Math.max(0, blue), red: Math.max(0, red / start('red')) };
}

function Strength({ label, value, mark, side }: { label: string; value: number; mark: number; side: 'blue' | 'red' }) {
  return (
    <div className="min-w-0" aria-label={`${label}: ${Math.round(value * 100)}%`}>
      <div className="flex items-baseline justify-between text-[11px] leading-tight font-semibold">
        <span className="truncate text-muted">{label}</span>
        <span className="text-white tabular-nums">{Math.round(value * 100)}%</span>
      </div>
      <div className="relative mt-0.5 h-1.5 rounded-full bg-white/15">
        <div className={`h-full rounded-full transition-[width] duration-500 ${side === 'blue' ? 'bg-[#9cc6ee]' : 'bg-[#e0705e]'}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
        <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-white" style={{ left: `${mark * 100}%` }} title={side === 'blue' ? 'You break here' : 'They pull back here'} />
      </div>
    </div>
  );
}

function CamButton({ label, testid, onClick, pressed, children }: { label: string; testid: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} className={`flex h-11 w-11 items-center justify-center rounded-full shadow-lg ${pressed ? 'bg-white text-black' : 'bg-ink-900 text-white'}`} data-testid={testid}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** What a difficulty does, in a line. */
function difficultyText(d: Difficulty): string {
  const def = DIFFICULTY[d];
  const pts = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
  const bits = [`Your crews ${pts(def.aim)} to hit, theirs ${pts(def.enemyAim)}`];
  if (def.enemyUnits < 1) bits.push(`about ${Math.round((1 - def.enemyUnits) * 100)}% fewer of them`);
  if (def.skill > 0) bits.push('and they play sharper');
  else if (def.skill < 0) bits.push('and they play loose');
  return `${bits.join(', ')}.`;
}

function Brief({ req, onDifficulty, onFight, onQuick, onBack }: { req: BattleRequest; onDifficulty?: (d: Difficulty) => void; onFight: () => void; onQuick: () => void; onBack: () => void }) {
  const difficulty = req.setup.difficulty ?? 'normal';
  const s = req.setup;
  const cond = useMemo(() => pickConditions(s), [s]);
  const mine = useMemo(() => buildForce(s, 'blue'), [s]);
  // What reconnaissance would tell you before an attack: roughly how many, and of what kinds.
  const theirs = useMemo(() => buildForce(s, 'red'), [s]);
  const mode = s.site === 'capital' || s.site === 'city' || s.site === 'objective' ? 'capture' : 'destroy';
  const [title, text] = MODE_TEXT[mode];
  return (
    <div className="vercel safe-top safe-bottom safe-x absolute inset-0 overflow-y-auto bg-black" data-testid="arena-brief">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-4">
        <div className="mt-5 text-[13px] font-semibold text-muted">
          {BIOME_TEXT[cond.biome]} · {TIME_TEXT[cond.time]}, {WEATHER_TEXT[cond.weather]}
          {s.river ? ' · river' : ''}
        </div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{req.title}</h1>
        <div className="mt-3 rounded-2xl bg-ink-900 p-4">
          <div className="text-[17px] font-semibold">{title}</div>
          <p className="mt-0.5 text-[15px] text-muted">{text}</p>
        </div>
        <div className="mt-5 text-[13px] font-semibold text-muted">Difficulty</div>
        {onDifficulty ? (
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-ink-900 p-1" role="radiogroup" aria-label="Difficulty" data-testid="arena-difficulty">
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={difficulty === d} onClick={() => onDifficulty(d)} className={`h-11 rounded-lg text-[15px] font-semibold ${difficulty === d ? 'bg-white text-black' : 'text-text'}`} data-testid={`difficulty-${d}`}>
                {DIFFICULTY[d].name}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-1.5 rounded-2xl bg-ink-900 px-4 py-3 text-[15px] font-semibold" data-testid="arena-difficulty">
            {DIFFICULTY[difficulty].name}, as your campaign
          </div>
        )}
        <p className="mt-1.5 px-1 text-[14px] text-muted">{difficultyText(difficulty)}</p>
        <div className="mt-5 text-[13px] font-semibold text-muted">Your Company</div>
        <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-2xl bg-ink-900">
          {s.attackers.map((f) => {
            const units = mine.units.filter((u) => u.formation === f.id);
            return (
              <li key={f.id} className="px-4 py-3">
                {s.attackers.length > 1 && <div className="text-[15px] font-semibold">{f.name}</div>}
                <div className={s.attackers.length > 1 ? 'text-[14px] text-muted' : 'text-[15px]'}>{tally(units.map((u) => typeOf(u.type).short))}</div>
              </li>
            );
          })}
          {mine.support.map((x) => (
            <li key={x.id} className="px-4 py-3">
              <div className="text-[15px] font-semibold">{x.id === 'himars' ? 'HIMARS' : 'Tornado-G'}</div>
              <div className="text-[14px] text-muted">
                Rockets on call, {x.missions} {x.missions === 1 ? 'mission' : 'missions'}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-5 text-[13px] font-semibold text-muted">What Scouts Report</div>
        <div className="mt-1.5 rounded-2xl bg-ink-900 px-4 py-3" data-testid="arena-intel">
          <div className="text-[15px] font-semibold">About {theirs.units.length} units, dug in toward the far edge</div>
          <div className="text-[14px] text-muted">{kinds(theirs.units.map((u) => typeOf(u.type).role))}</div>
        </div>
        <ul className="mt-5 space-y-2 text-[15px] text-muted">
          <li>Each unit moves, then acts. Tap a unit, tap inside its outline to move, tap a red badge for the odds.</li>
          <li>Hit them in the side or rear: their front armour is far thicker. Smoke hides you for a turn.</li>
          <li>Pinch or use the plus and minus buttons to zoom; the target button brings the camera back to your unit, the map button shows the whole field.</li>
          {s.abilities.length > 0 && <li>From your research: {s.abilities.map((a) => ABILITIES[a].name).join(', ')}.</li>}
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-6 pb-4">
          <button type="button" onClick={onFight} className="v-btn v-btn-primary h-14 text-[17px] font-semibold" data-testid="arena-fight">
            Fight It
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onBack} className="v-btn v-btn-secondary h-12 flex-1 text-[15px]" data-testid="arena-back">
              {req.skirmish ? 'Back' : 'Back to Map'}
            </button>
            {!req.skirmish && (
              <button type="button" onClick={onQuick} className="v-btn v-btn-secondary h-12 flex-1 text-[15px]" data-testid="arena-quick">
                Quick Resolve
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Verdict({ result, req, battle, onDone }: { result: ArenaResult; req: BattleRequest; battle: Battle; onDone: () => void }) {
  const lost = battle.units.filter((u) => u.side === 'blue' && !u.alive).length;
  const killed = battle.units.filter((u) => u.side === 'red' && !u.alive).length;
  const acc = result.stats.blue.shots ? Math.round((result.stats.blue.hits / result.stats.blue.shots) * 100) : 0;
  return (
    <div className="vercel screen-in safe-top safe-bottom absolute inset-0 z-20 overflow-y-auto bg-black/90" data-testid="arena-verdict">
      <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center px-5 py-6 text-center">
        <div className="text-[44px] font-bold tracking-tight">{result.won ? 'Victory' : 'Repulsed'}</div>
        <div className="mt-2 flex gap-2" aria-label={`${result.stars} of 3 stars`} data-testid="arena-stars">
          {[1, 2, 3].map((i) => (
            <svg key={i} viewBox="0 0 24 24" className={`star-in h-11 w-11 ${i <= result.stars ? 'text-signal' : 'text-ink-700'}`} style={{ animationDelay: `${i * 160}ms` }} aria-hidden>
              <path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor" />
            </svg>
          ))}
        </div>
        <div className="mt-2 text-[13px] text-muted">Win · lose under a tenth of your force · win by round 9</div>
        <dl className="mt-5 grid w-full grid-cols-4 gap-2">
          {(
            [
              ['Destroyed', killed],
              ['Lost', lost],
              ['Rounds', result.rounds],
              ['Hits', `${acc}%`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-ink-900 py-2.5">
              <dd className="text-[20px] font-bold tabular-nums">{v}</dd>
              <dt className="text-[12px] text-muted">{k}</dt>
            </div>
          ))}
        </dl>
        <ul className="mt-4 w-full divide-y divide-line overflow-hidden rounded-xl bg-ink-900 text-left">
          {req.setup.attackers.map((f) => (
            <li key={f.id} className="flex justify-between px-4 py-2.5 text-[14px]">
              <span className="font-semibold">{f.name}</span>
              <span className="text-muted tabular-nums">{Math.round((result.kept[f.id] ?? 0) / 10)}% left</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[14px] text-muted">
          {req.skirmish ? 'Practice battle: nothing on the war map changes.' : result.won ? 'The hex is yours when the turn ends, unless they reinforce it first.' : 'Your losses stand. The hex stays theirs.'}
        </p>
        <button type="button" onClick={onDone} className="v-btn v-btn-primary mt-6 h-12 w-full text-[16px] font-semibold" data-testid="arena-continue">
          {req.skirmish ? 'Done' : 'Back to the War'}
        </button>
      </div>
    </div>
  );
}

type Mode = { kind: 'none' } | { kind: 'strike'; smoke: boolean } | { kind: 'face' } | { kind: 'breach' } | { kind: 'mine' } | { kind: 'support'; asset: 'himars' | 'tornado' } | { kind: 'ability'; id: AbilityId };
type Card = { kind: 'fire'; target: string; weapon: string } | { kind: 'strike'; at: Point; smoke: boolean } | { kind: 'support'; asset: 'himars' | 'tornado'; at: Point } | { kind: 'move'; at: Point; dash: boolean } | null;

function Field({ req, onEnd }: { req: BattleRequest; onEnd: (r: ArenaResult, b: Battle) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const battleRef = useRef<Battle | null>(null);
  const stageRef = useRef<BattleStage | null>(null);
  const libRef = useRef<Library | null>(null);
  const cursor = useRef(0);
  const labelsRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  /** Danger Area: every seen enemy's reach shaded on the field. */
  const [danger, setDanger] = useState(false);
  /** One enemy's reach (a long-press on it), or null. */
  const [reachOf, setReachOf] = useState<string | null>(null);
  /** The enemy's turn (or the opening) is playing: orders wait for it. Your own film never blocks you. */
  const [waiting, setWaiting] = useState(true);
  const waitingRef = useRef(true);
  const fastRef = useRef(true);
  /** A unit to bring the camera to once the film in progress has played. */
  const pendingFocus = useRef<string | null>(null);
  /** Ending the turn with units still ready asks first. */
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** The unit card shows its three most useful actions; More shows the rest. */
  const [more, setMore] = useState(false);
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<Card>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [dash, setDash] = useState(false);
  const [menu, setMenu] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  /** What happened since your last turn, under the round banner; after a skipped turn it waits for Done. */
  const [report, setReport] = useState<{ news: RoundNews; sticky: boolean } | null>(null);
  /** Where in the log the last report ended. */
  const reportFrom = useRef(0);
  /** Their turn was skipped: the report it lands on waits for you. */
  const skipped = useRef(false);
  /** Skip held down: their turn plays four times as fast until it is let go. */
  const holdRef = useRef(false);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(0);
  /** When Skip went down (the event's own time), and whether the press that ended was a hold, so its click is no skip. */
  const pressAt = useRef(0);
  const wasHold = useRef(false);
  const lastSeen = useRef<Set<string> | null>(null);
  /** What the screen last drew: your turn, with a unit selected (for the ready hook). */
  const drawn = useRef({ myTurn: false, selected: false });
  /** The strength bars, read when the film is still so they never run ahead of it. */
  const [bars, setBars] = useState({ blue: 1, red: 1 });
  const [settings, setSettings] = useState<ArenaSettings>(() => readSettings());
  fastRef.current = settings.fastEnemy;
  const [thermal, setThermal] = useState(false);
  const [overview, setOverview] = useState(false);
  const [feed, setFeed] = useState<{ id: number; text: string; tone: 'good' | 'bad' | 'plain' }[]>([]);
  const feedId = useRef(0);
  const lastNoop = useRef<{ t: number; x: number; y: number } | null>(null);
  /** The battle before the last step, while that step can be taken back. */
  const undoRef = useRef<{ snap: Battle; unit: string } | null>(null);
  const refresh = () => setTick((t) => t + 1);
  /** A line in the kill feed under the title, for a few seconds. */
  const pushFeed = (text: string, tone: 'good' | 'bad' | 'plain') => {
    const id = ++feedId.current;
    setFeed((f) => [...f.slice(-2), { id, text, tone }]);
    setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 3600);
  };
  const arsenal = req.setup.arsenal;

  /** Hand everything the engine has logged since last time to the film. */
  const flush = () => {
    const b = battleRef.current;
    const s = stageRef.current;
    if (!b || !s) return;
    s.play(b.events.slice(cursor.current));
    cursor.current = b.events.length;
    // Busy only if there is something to play: overwatch and hunker log nothing, and a busy flag
    // set by hand for them was never cleared (the battle sat on "Wait" for good).
    setBusy(s.busy);
    refresh();
  };

  /** How much of the screen the header and footer cover now, as fractions of its height. */
  const hudNow = (): [number, number] => {
    const box = host.current?.getBoundingClientRect();
    const head = headerRef.current?.getBoundingClientRect();
    const foot = footerRef.current?.getBoundingClientRect();
    if (!box || !box.height) return [0.15, 0.3];
    return [head ? (head.bottom - box.top) / box.height : 0.15, foot ? (box.bottom - foot.top) / box.height : 0.3];
  };
  // The camera keeps the unit you are working with in the middle of the field you can see, as the
  // cards at the bottom grow and shrink.
  useEffect(() => {
    const ro = new ResizeObserver(() => stageRef.current?.setHud(...hudNow()));
    if (headerRef.current) ro.observe(headerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, []);

  const buildStage = (b: Battle, lib: Library | null, quality: Quality) => {
    const el = host.current!;
    stageRef.current?.dispose();
    const s = new BattleStage(el, b, { quality, settings, lib, arsenal, onFeed: pushFeed });
    s.setHud(...hudNow(), true);
    stageRef.current = s;
    return s;
  };

  useEffect(() => {
    let dead = false;
    let raf = 0;
    let ended = 0;
    let wasBusy = true;
    const el = host.current!;
    const battle = createBattle(req.setup);
    battleRef.current = battle;
    // The Apache and the props when they load in time; the battle is built in code either way.
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 15000));
    void Promise.race([loadLibrary().catch(() => null), timeout]).then(async (lib: Library | null) => {
      if (dead) return;
      libRef.current = lib;
      await buildStage(battle, lib, settings.quality).warm();
      if (dead) return;
      setReady(true);
      setBanner('Your Turn');
      flush();
      let last = performance.now();
      let shownTurn = battle.turnIndex;
      const frame = (now: number) => {
        // The next frame is asked for first, so nothing below can ever stop the loop.
        raf = requestAnimationFrame(frame);
        // Frame timestamps can run behind the clock on some browsers: never step backwards. A slow
        // device plays the film at real speed in bigger steps rather than in slow motion.
        const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
        last = now;
        const stage = stageRef.current;
        if (!stage) return;
        try {
          // Their turn at double speed if you like it brisk (the default), four times while Skip is held.
          const rate = waitingRef.current ? (holdRef.current ? 4 : fastRef.current ? 2 : 1) : 1;
          stage.rate = rate;
          if (!document.hidden) stage.frame(dt * rate);
        } catch (e) {
          console.warn('battle frame failed; the film is put right', e);
          stage.recover();
        }
        // Odds labels ride over their targets as the camera moves.
        const box = el.getBoundingClientRect();
        for (const n of labelsRef.current?.children ?? []) {
          const [x, y] = (n as HTMLElement).dataset.at!.split(',').map(Number);
          const at = stage.toScreen(x!, y!, 0.7);
          (n as HTMLElement).style.transform = `translate(${at.x - box.left}px, ${at.y - box.top}px) translate(-50%, -100%)`;
        }
        const b = stage.busy;
        if (!b && waitingRef.current) {
          waitingRef.current = false;
          setWaiting(false);
          holdRef.current = false;
          setHolding(false);
        }
        if (!b && pendingFocus.current) {
          const u = battle.units.find((x) => x.id === pendingFocus.current);
          pendingFocus.current = null;
          if (u) stage.recenter(u);
        }
        if (b !== wasBusy) {
          wasBusy = b;
          setBusy(b);
          if (!b) setBars(strengths(battle));
          // The round banner once per turn of yours, not after each of your own actions.
          if (!b && !battle.ended && battle.turn === 'blue' && battle.turnIndex !== shownTurn) {
            shownTurn = battle.turnIndex;
            setBanner(`Round ${battle.round} · Your Turn`);
            // Every loss and change of state since your last turn (theirs as seen), from the log.
            const news = roundNews(battle, reportFrom.current);
            reportFrom.current = news.to;
            setReport(battle.round > 1 ? { news, sticky: skipped.current } : null);
            skipped.current = false;
          }
        }
        if (battle.ended && !b && !ended) ended = now;
        if (ended && now - ended > 700) {
          cancelAnimationFrame(raf);
          onEnd(arenaResult(battle), battle);
        }
      };
      raf = requestAnimationFrame(frame);
      window.__arena = {
        arena: () => battleRef.current,
        toScreen: (x, y) => stageRef.current!.toScreen(x, y),
        ready: () => !!stageRef.current && !stageRef.current.busy && stageRef.current.settled && battle.turn === 'blue' && !battle.ended && drawn.current.myTurn && drawn.current.selected,
        win: () => {
          for (const u of battle.units) if (u.side === 'red') u.alive = false;
          battle.ended = 'won';
          battle.endReason = 'destroyed';
          battle.events.push({ type: 'end', won: true, reason: 'destroyed' });
          flush();
          stageRef.current?.skip();
        },
        lose: () => {
          retreat(battle);
          flush();
          stageRef.current?.skip();
        },
        perf: (reset) => stageRef.current?.perf(reset) ?? null,
        overlay: () => stageRef.current?.overlayCounts() ?? null,
        film: () => stageRef.current?.filmState() ?? null,
      };
    });
    const onResize = () => stageRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      stageRef.current?.dispose();
      stageRef.current = null;
      delete window.__arena;
    };
    // The battle is built once.
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), report ? 2400 : 1400);
    return () => clearTimeout(t);
  }, [banner]);
  // The report stays a moment longer for each line it has; after a skipped turn, until Done.
  useEffect(() => {
    if (!report || report.sticky) return;
    const t = setTimeout(() => setReport(null), Math.min(9000, 2400 + 700 * report.news.rows.length));
    return () => clearTimeout(t);
  }, [report]);

  const b = battleRef.current;
  // Your turn, even while your own last order is still playing out on screen.
  const myTurn = !!b && ready && !waiting && b.turn === 'blue' && !b.ended;
  const me = b && selected ? b.units.find((u) => u.id === selected && u.alive && !u.carrier) : undefined;
  // Your side's picture as the battle stands on your turn; during theirs, the last one you had.
  const visible = useMemo(() => (b && myTurn ? visibleTo(b, 'blue') : (lastSeen.current ?? new Set<string>())), [b, myTurn, b?.events.length]);
  lastSeen.current = visible;
  const reach = useMemo(() => (b && me && myTurn ? reachable(b, me, false, visible) : null), [b, me, myTurn, me?.x, me?.y, me?.moved, me?.acted, visible]);
  const dashReach = useMemo(() => (b && me && myTurn && dash ? reachable(b, me, true, visible) : null), [b, me, myTurn, dash, me?.x, me?.y, me?.moved, me?.acted, visible]);
  const targets = useMemo(() => {
    if (!b || !me || !myTurn || me.acted) return [] as { unit: Unit; info: FireInfo }[];
    const out: { unit: Unit; info: FireInfo }[] = [];
    for (const u of b.units) {
      if (!visible.has(u.id)) continue;
      const info = bestFire(b, me, u, me, false, visible);
      if (info) out.push({ unit: u, info });
    }
    return out.sort((p, q) => q.info.chance - p.info.chance);
  }, [b, me, myTurn, me?.x, me?.y, me?.acted, visible]);
  const indirect = me ? typeOf(me.type).weapons.find((w) => w.indirect) : undefined;
  // What a good commander would do with this unit, from your side's picture only.
  const advice = useMemo(() => (b && me && myTurn && !me.acted ? advise(b, me.id) : []), [b, me?.id, me?.x, me?.y, me?.moved, me?.acted, myTurn, b?.events.length]);
  const adviceMove = advice.find((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');

  // Keep the 3D overlay in step with the selection.
  useEffect(() => {
    const s = stageRef.current;
    if (!s || !b) return;
    const ghosts = Object.values(b.intel.blue).filter((g) => !g.now).map((g) => ({ x: g.x, y: g.y, type: g.type, age: b.turnIndex - g.turn }));
    const o: Overlay = { selected: myTurn ? selected : null, reach: [], dash: [], path: null, dest: null, targets: [], area: null, ghosts, danger, reachOf };
    if (myTurn && me) {
      const start = me.y * b.map.w + me.x;
      if (reach) o.reach = [...reach.cost.keys()].filter((i) => i !== start);
      if (dashReach) o.dash = [...dashReach.cost.keys()].filter((i) => i !== start && !reach?.cost.has(i));
      o.targets = targets.map((t) => t.unit.id);
      const r = dash ? dashReach : reach;
      // The route to the move being looked at, else the cell under the pointer, else the advised move.
      const looked = card?.kind === 'move' ? card : null;
      const to = looked ? looked.at : hover && r?.cost.has(hover.y * b.map.w + hover.x) && (hover.x !== me.x || hover.y !== me.y) ? hover : !card && mode.kind === 'none' && adviceMove ? adviceMove.to : null;
      const route = looked ? (looked.dash ? (dashReach ?? reachable(b, me, true, visible)) : reach) : to && hover === to ? r : adviceMove?.dash ? (dashReach ?? reachable(b, me, true, visible)) : reach;
      if (looked) o.dest = looked.at;
      if (to && route?.cost.has(to.y * b.map.w + to.x)) {
        const path: Point[] = [];
        for (let i: number | undefined = to.y * b.map.w + to.x; i !== undefined; i = route.prev.get(i)) path.unshift({ x: i % b.map.w, y: Math.floor(i / b.map.w) });
        o.path = path;
      }
      const aim = card?.kind === 'strike' ? card.at : mode.kind === 'strike' && hover ? hover : null;
      if (aim && indirect) o.area = { at: aim, r: Math.max(1, indirect.blast) };
    }
    if (myTurn && (mode.kind === 'support' || (mode.kind === 'ability' && mode.id === 'airstrike')) && hover) o.area = { at: hover, r: mode.kind === 'support' && mode.asset === 'tornado' ? 2 : 1 };
    if (card?.kind === 'support') o.area = { at: card.at, r: card.asset === 'tornado' ? 2 : 1 };
    s.setOverlay(o);
    drawn.current = { myTurn, selected: !!o.selected || !b.units.some((u) => u.side === 'blue' && u.alive && !u.acted && !u.carrier) };
  });

  // The camera brings the selected unit into view; a new turn starts with a ready unit selected.
  useEffect(() => {
    setMore(false);
    if (!me) return;
    // While a shot or a move is still playing, let it finish on screen, then go to the unit.
    if (stageRef.current?.busy) pendingFocus.current = me.id;
    else stageRef.current?.recenter(me);
    setOverview(false);
  }, [selected]);
  useEffect(() => {
    if (!myTurn || !b) return;
    const cur = b.units.find((u) => u.id === selected);
    if (!cur || !cur.alive || cur.acted || cur.carrier) setSelected(b.units.find((u) => u.side === 'blue' && u.alive && !u.acted && !u.carrier)?.id ?? null);
  }, [myTurn]);

  const nextReady = (after?: string) => {
    if (!b) return;
    const blue = b.units.filter((u) => u.side === 'blue' && u.alive && !u.acted && !u.carrier);
    const i = blue.findIndex((u) => u.id === after);
    setSelected((blue[i + 1] ?? blue[0])?.id ?? null);
  };

  /**
   * Play actions in order as one step, stopping at the first the battle refuses. The step can be
   * taken back when it drew no dice and showed nothing new (a plain move, a turn, overwatch...).
   */
  const perform = (actions: Action[], keepSelection: boolean) => {
    if (!b || !actions.length) return false;
    const snap = copyBattle(b);
    let done = 0;
    for (const a of actions) {
      if (!act(b, a)) break;
      done++;
    }
    if (!done) return false;
    const first = actions[0]!;
    const unit = 'unit' in first && first.unit ? first.unit : null;
    undoRef.current = unit && undoable(snap, b) ? { snap, unit } : null;
    setCard(null);
    setMode({ kind: 'none' });
    setDash(false);
    flush();
    if (!keepSelection && unit) nextReady(unit);
    return true;
  };
  const doAct = (action: Action, keepSelection = true) => perform([action], keepSelection);

  /** Take back the last step: the battle as it was, every unit back where it stood. */
  const undo = () => {
    const u = undoRef.current;
    const s = stageRef.current;
    if (!u || !b || !s || !myTurn) return;
    s.skip();
    const rec = b as unknown as Record<string, unknown>;
    for (const k of Object.keys(rec)) delete rec[k];
    Object.assign(rec, copyBattle(u.snap));
    cursor.current = b.events.length;
    s.resync();
    undoRef.current = null;
    setSelected(u.unit);
    setCard(null);
    setMode({ kind: 'none' });
    setDash(false);
    refresh();
  };

  /** Act on a tapped cell; false when the tap did nothing (so a second one zooms). */
  const tapCell = (p: Point): boolean => {
    if (!b || !myTurn) return false;
    if (mode.kind === 'ability') {
      doAct({ type: 'ability', id: mode.id, at: p });
      return true;
    }
    if (mode.kind === 'support') {
      setCard({ kind: 'support', asset: mode.asset, at: p });
      return true;
    }
    const there = unitAt(b, p.x, p.y) ?? unitAt(b, p.x, p.y, true);
    if (mode.kind === 'face' && me) {
      doAct({ type: 'face', unit: me.id, facing: Math.atan2(p.y - me.y, p.x - me.x) });
      return true;
    }
    if ((mode.kind === 'breach' || mode.kind === 'mine') && me) {
      doAct({ type: mode.kind, unit: me.id, at: p }, false);
      return true;
    }
    if (there?.side === 'blue' && !(mode.kind === 'strike')) {
      // Tapping your own carrier with infantry selected boards it.
      if (me && there.passengers !== undefined && typeOf(there.type).seats > 0 && typeOf(me.type).mobility === 'foot' && whyNot(b, { type: 'embark', unit: me.id, carrier: there.id }) === null) {
        doAct({ type: 'embark', unit: me.id, carrier: there.id }, false);
        return true;
      }
      setSelected(there.id);
      setCard(null);
      setDash(false);
      return true;
    }
    if (!me) return false;
    if (there?.side === 'red' && visible.has(there.id) && mode.kind !== 'strike') {
      const t = targets.find((x) => x.unit.id === there.id);
      if (!t) return false;
      if (card?.kind === 'fire' && card.target === there.id) doAct({ type: 'fire', unit: me.id, target: there.id, weapon: card.weapon }, false);
      else setCard({ kind: 'fire', target: there.id, weapon: t.info.weapon.id });
      return true;
    }
    if (mode.kind === 'strike' && indirect) {
      if (card?.kind === 'strike' && card.at.x === p.x && card.at.y === p.y) doAct({ type: 'strike', unit: me.id, at: p, weapon: indirect.id, smoke: card.smoke }, false);
      else if (strikeInfo(b, me, p, indirect, mode.smoke)) setCard({ kind: 'strike', at: p, smoke: mode.smoke });
      return true;
    }
    const r = dash ? dashReach : reach;
    if (r?.cost.has(p.y * b.map.w + p.x) && (p.x !== me.x || p.y !== me.y)) {
      // The first tap shows the route and what the place means; the second (or Move) goes.
      if (card?.kind === 'move' && card.at.x === p.x && card.at.y === p.y) doAct({ type: 'move', unit: me.id, to: p, ...(card.dash ? { dash: true } : {}) });
      else setCard({ kind: 'move', at: p, dash });
      return true;
    }
    setCard(null);
    return false;
  };

  /**
   * A tap on the field. Badges and larger-than-life models stand above their cells, so a tap near
   * one counts for that unit: an enemy you can shoot, else a move into the lit area, else a unit of
   * yours. A second tap that does nothing, close to the first, zooms in there.
   */
  const tapAt = (x: number, y: number) => {
    const stage = stageRef.current;
    if (!stage || !b) return;
    // A tap ends a long-press look at one enemy's reach.
    if (reachOf) setReachOf(null);
    const c = stage.pick(x, y);
    const near = stage.unitNear(x, y, 30);
    const nearUnit = near ? b.units.find((u) => u.id === near) : undefined;
    let done = false;
    if (nearUnit && nearUnit.side === 'red' && targets.some((t) => t.unit.id === nearUnit.id) && mode.kind === 'none') done = tapCell(nearUnit);
    else if (c && me && myTurn && mode.kind === 'none' && (dash ? dashReach : reach)?.cost.has(c.y * b.map.w + c.x) && !unitAt(b, c.x, c.y) && (c.x !== me.x || c.y !== me.y)) done = tapCell(c);
    else if (nearUnit && nearUnit.side === 'blue' && mode.kind === 'none') done = tapCell(nearUnit);
    else if (c) done = tapCell(c);
    const now = performance.now();
    const last = lastNoop.current;
    if (!done && last && now - last.t < 380 && Math.hypot(x - last.x, y - last.y) < 40) {
      stage.zoomBy(0.55, { x, y });
      lastNoop.current = null;
      return;
    }
    lastNoop.current = done ? null : { t: now, x, y };
  };



  // One finger (or the mouse) drags the board, two pinch to zoom, twist to turn and slide to tilt;
  // right-drag orbits with a mouse. A press that does not move is a tap.
  const pointers = useRef(new Map<number, { x: number; y: number; x0: number; y0: number; moved: boolean; button: number }>());
  const pinch = useRef<{ d: number; a: number; my: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, button: e.button });
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(p!.x - q!.x, p!.y - q!.y), a: Math.atan2(q!.y - p!.y, q!.x - p!.x), my: (p!.y + q!.y) / 2 };
      for (const v of pointers.current.values()) v.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    const p = pointers.current.get(e.pointerId);
    if (stage && p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 9) p.moved = true;
      if (pointers.current.size === 2 && pinch.current) {
        const [m, n] = [...pointers.current.values()];
        const d = Math.hypot(m!.x - n!.x, m!.y - n!.y);
        const a = Math.atan2(n!.y - m!.y, n!.x - m!.x);
        const my = (m!.y + n!.y) / 2;
        if (pinch.current.d > 0 && d > 0) stage.zoomBy(pinch.current.d / d, { x: (m!.x + n!.x) / 2, y: my });
        // The map turns with the fingers (it used to turn against them).
        stage.twistBy(Math.atan2(Math.sin(a - pinch.current.a), Math.cos(a - pinch.current.a)));
        stage.orbitBy(0, (my - pinch.current.my) * 0.004);
        pinch.current = { d, a, my };
      } else if (p.moved && (p.button === 2 || e.shiftKey)) stage.orbitBy(-dx * 0.006, dy * 0.004);
      else if (p.moved) stage.panBy(dx, dy);
    }
    if (e.pointerType === 'mouse' && !p) {
      const c = stage?.pick(e.clientX, e.clientY) ?? null;
      if (c?.x !== hover?.x || c?.y !== hover?.y) setHover(c);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!p || p.moved || p.button === 2) return;
    tapAt(e.clientX, e.clientY);
  };
  const onWheel = (e: React.WheelEvent) => stageRef.current?.zoomBy(Math.exp(e.deltaY * 0.0012), { x: e.clientX, y: e.clientY });

  const finishTurn = (auto = false) => {
    if (!b || !myTurn) return;
    setConfirmEnd(false);
    waitingRef.current = true;
    setWaiting(true);
    undoRef.current = null;
    setSelected(null);
    setCard(null);
    setMode({ kind: 'none' });
    setDash(false);
    setBanner('Enemy Turn');
    if (auto) autoTurn(b);
    else endTurn(b);
    flush();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCard(null);
        setMode({ kind: 'none' });
        setDash(false);
      } else if (e.key === 'Enter' && e.shiftKey) finishTurn();
      else if (e.key === 'Tab' && b) {
        e.preventDefault();
        nextReady(selected ?? undefined);
      } else if (e.key === 'q' || e.key === 'Q') stageRef.current?.orbitBy(0.3);
      else if (e.key === 'e' || e.key === 'E') stageRef.current?.orbitBy(-0.3);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const changeSettings = (next: ArenaSettings) => {
    setSettings(next);
    writeSettings(next);
    const bb = battleRef.current;
    if (next.quality !== settings.quality && bb) {
      // Rebuild the scene at the new quality from the battle as it stands.
      stageRef.current?.skip();
      const s = buildStage(bb, libRef.current, next.quality);
      s.resync();
      if (thermal) s.setThermal(true);
    }
    // Motion, shake, action cams and fast enemy turns apply at once.
    stageRef.current?.setFeel(feelOf(next));
  };

  /** Skip the film to its end (not the click that ends a hold on Skip). */
  const skipFilm = () => {
    if (wasHold.current) {
      wasHold.current = false;
      return;
    }
    if (waitingRef.current) skipped.current = true;
    stageRef.current?.skip();
  };
  const holdStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressAt.current = e.timeStamp;
    wasHold.current = false;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdRef.current = true;
      setHolding(true);
    }, HOLD_MS);
  };
  // A tap or a hold by the press's own timing, so a busy page that runs the timer late still skips on a tap.
  const holdEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    window.clearTimeout(holdTimer.current);
    wasHold.current = e.timeStamp - pressAt.current >= HOLD_MS;
    if (!holdRef.current) return;
    holdRef.current = false;
    setHolding(false);
  };

  const blue = b?.units.filter((u) => u.side === 'blue') ?? [];
  const readyCount = blue.filter((u) => u.alive && !u.acted && !u.carrier).length;
  const seenCount = visible.size;
  const battleMode = b?.map.mode ?? 'destroy';
  const labels = myTurn ? targets.map((t) => ({ id: t.unit.id, chance: t.info.chance, x: t.unit.x, y: t.unit.y })) : [];
  const formations = req.setup.attackers;

  // What the selected unit can do now, as buttons.
  /** What the selected unit can do now, most useful first (the card shows three; More shows the rest). */
  const actions: { id: string; label: string; on: () => void; ok: boolean; pressed?: boolean; pri: number }[] = [];
  if (me && b && myTurn) {
    const t = typeOf(me.type);
    const ok = (a: Action) => whyNot(b, a) === null;
    // The best shot it has, one tap from the card (targets can be off screen).
    const best = targets[0];
    if (best && !me.acted)
      actions.push({
        id: 'best', pri: 0,
        label: `Best Shot ${best.info.chance}%`,
        on: () => {
          setCard({ kind: 'fire', target: best.unit.id, weapon: best.info.weapon.id });
          stageRef.current?.follow(best.unit.x + 0.5, best.unit.y + 0.5);
        },
        ok: true,
      });
    if (!me.moved && !me.mobilityKill && t.move > 0) actions.push({ id: 'dash', pri: 4, label: 'Dash', on: () => setDash(!dash), ok: !me.acted, pressed: dash });
    if (indirect) {
      actions.push({ id: 'strike', pri: 1, label: 'Call Fire', on: () => setMode(mode.kind === 'strike' && !mode.smoke ? { kind: 'none' } : { kind: 'strike', smoke: false }), ok: !me.acted && (me.ammo[indirect.id] ?? 0) > 0, pressed: mode.kind === 'strike' && !mode.smoke });
      if (indirect.smoke) actions.push({ id: 'strike-smoke', pri: 3, label: `Smoke Rounds ${me.smoke[indirect.id] ?? 0}`, on: () => setMode(mode.kind === 'strike' && mode.smoke ? { kind: 'none' } : { kind: 'strike', smoke: true }), ok: !me.acted && (me.smoke[indirect.id] ?? 0) > 0, pressed: mode.kind === 'strike' && mode.smoke });
    }
    actions.push({ id: 'overwatch', pri: 2, label: 'Overwatch', on: () => doAct({ type: 'overwatch', unit: me.id }, false), ok: ok({ type: 'overwatch', unit: me.id }) });
    if (t.mobility === 'foot') actions.push({ id: 'hunker', pri: 3, label: 'Hunker', on: () => doAct({ type: 'hunker', unit: me.id }, false), ok: ok({ type: 'hunker', unit: me.id }) });
    if ((me.smoke.grenades ?? 0) > 0 || (me.smoke.pots ?? 0) > 0) actions.push({ id: 'smoke', pri: 3, label: `Smoke ${me.smoke.grenades ?? me.smoke.pots ?? 0}`, on: () => doAct({ type: 'smoke', unit: me.id }), ok: ok({ type: 'smoke', unit: me.id }) });
    if (me.passengers.length) actions.push({ id: 'dismount', pri: 1, label: 'Dismount', on: () => doAct({ type: 'dismount', unit: me.id }), ok: ok({ type: 'dismount', unit: me.id }) });
    if (t.mobility !== 'foot' && t.mobility !== 'heli' && t.mobility !== 'drone') actions.push({ id: 'face', pri: 5, label: 'Turn', on: () => setMode(mode.kind === 'face' ? { kind: 'none' } : { kind: 'face' }), ok: ok({ type: 'face', unit: me.id, facing: me.facing }), pressed: mode.kind === 'face' });
    if (me.type === 'squad_w' || me.type === 'squad_e') actions.push({ id: 'split', pri: 5, label: 'Split', on: () => doAct({ type: 'split', unit: me.id }), ok: ok({ type: 'split', unit: me.id }) });
    const half = b.units.find((o) => o !== me && o.alive && !o.carrier && o.side === 'blue' && (o.parent === me.id || me.parent === o.id || (!!me.parent && o.parent === me.parent)));
    if (half) actions.push({ id: 'merge', pri: 5, label: 'Join', on: () => doAct({ type: 'merge', unit: me.id, with: half.id }, false), ok: ok({ type: 'merge', unit: me.id, with: half.id }) });
    const carrier = b.units.find((o) => o.side === 'blue' && o.alive && !o.carrier && typeOf(o.type).seats > 0 && ok({ type: 'embark', unit: me.id, carrier: o.id }));
    if (t.mobility === 'foot' && carrier) actions.push({ id: 'embark', pri: 1, label: `Board ${typeOf(carrier.type).short}`, on: () => doAct({ type: 'embark', unit: me.id, carrier: carrier.id }, false), ok: true });
    if (t.treat) {
      const hurt = b.units.find((o) => o.side === 'blue' && ok({ type: 'treat', unit: me.id, target: o.id }));
      actions.push({ id: 'treat', pri: 1, label: 'Treat', on: () => hurt && doAct({ type: 'treat', unit: me.id, target: hurt.id }, false), ok: !!hurt });
    }
    if (t.repair) {
      const broke = b.units.find((o) => o.side === 'blue' && ok({ type: 'repair', unit: me.id, target: o.id }));
      actions.push({ id: 'repair', pri: 1, label: 'Repair', on: () => broke && doAct({ type: 'repair', unit: me.id, target: broke.id }, false), ok: !!broke });
    }
    if (t.engineer) {
      actions.push({ id: 'breach', pri: 2, label: 'Breach', on: () => setMode(mode.kind === 'breach' ? { kind: 'none' } : { kind: 'breach' }), ok: !me.acted, pressed: mode.kind === 'breach' });
      actions.push({ id: 'mine', pri: 3, label: `Mine ${me.ammo.mines ?? 0}`, on: () => setMode(mode.kind === 'mine' ? { kind: 'none' } : { kind: 'mine' }), ok: !me.acted && (me.ammo.mines ?? 0) > 0, pressed: mode.kind === 'mine' });
    }
  }

  const ranked = [...actions].sort((p, q) => p.pri - q.pri);
  const shownActions = more ? ranked : ranked.filter((a, i) => i < 3 || a.pressed);
  const hiddenActions = ranked.length - shownActions.length;

  return (
    <div
      className="absolute inset-0 bg-ink-950"
      data-testid="arena"
      onPointerDownCapture={(e) => {
        // A tap anywhere skips an action cam; on the field it does nothing else.
        if (stageRef.current?.endActionCam() && host.current?.contains(e.target as Node)) e.stopPropagation();
        // A tap outside the round report puts it away.
        if (report && !(e.target as Element).closest?.('[data-testid="arena-report"]')) setReport(null);
      }}
    >
      <div ref={host} className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerMove={onPointerMove} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-[15px] font-semibold text-muted">Deploying…</span>
        </div>
      )}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10">
        {labels.map((l) => (
          <div key={l.id} data-at={`${l.x},${l.y}`} className={`absolute top-0 left-0 rounded-md px-1.5 py-0.5 text-[13px] font-bold tabular-nums shadow ${card?.kind === 'fire' && card.target === l.id ? 'bg-white text-black' : 'bg-black/85 text-white'}`} data-testid={`odds-${l.id}`}>
            {l.chance}%
          </div>
        ))}
      </div>

      <header ref={headerRef} className="vercel safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-10" data-testid="arena-header">
        <div className="pointer-events-auto mx-2 mt-1.5 flex items-center gap-2 rounded-2xl bg-black/80 px-3 py-1.5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-muted">
              {MODE_TEXT[battleMode][0]}
              {b ? ` · ${TIME_TEXT[b.conditions.time]}, ${WEATHER_TEXT[b.conditions.weather]}` : ''}
            </div>
            <div className="truncate text-[16px] leading-tight font-bold">{req.title}</div>
          </div>
          <div className="text-right leading-tight">
            <div className="text-[17px] font-bold tabular-nums" data-testid="arena-round">
              {b?.round ?? 1}/{ROUND_LIMIT}
            </div>
            <div className="text-[12px] text-muted tabular-nums">{seenCount} seen</div>
          </div>
          {b && (b.conditions.time === 'night' || b.conditions.weather === 'fog') && (
            <button
              type="button"
              onClick={() => {
                const on = !thermal;
                setThermal(on);
                stageRef.current?.setThermal(on);
              }}
              className={`h-11 rounded-full px-3 text-[13px] font-bold ${thermal ? 'bg-white text-black' : 'bg-ink-800 text-text'}`}
              aria-pressed={thermal}
              data-testid="arena-thermal"
            >
              Thermal
            </button>
          )}
          <button type="button" onClick={() => setMenu(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-800" aria-label="Battle menu" data-testid="arena-pause">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        </div>
        {b && (
          <div className="pointer-events-auto mx-2 mt-1 grid grid-cols-2 gap-2 rounded-xl bg-black/80 px-3 py-1.5 backdrop-blur" data-testid="arena-strength">
            <Strength label="You" value={bars.blue} mark={BREAK_AT} side="blue" />
            <Strength label="Them, as seen" value={bars.red} mark={WITHDRAW_AT} side="red" />
          </div>
        )}
        {battleMode === 'capture' && b && (
          <div className="mx-4 mt-1.5 flex gap-1" aria-label={`Holding the ground: ${b.capture} of ${CAPTURE_ROUNDS} rounds`}>
            {Array.from({ length: CAPTURE_ROUNDS }, (_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i < b.capture ? 'bg-signal' : 'bg-white/20'}`} />
            ))}
          </div>
        )}
      </header>

      {(banner || report) && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] z-10 flex flex-col items-center gap-1.5 text-center">
          {banner && (
            <span className="rounded-full bg-white px-5 py-2 text-[17px] font-bold text-black shadow-lg" data-testid="arena-banner">
              {banner}
            </span>
          )}
          {report && <RoundReport news={report.news} onClose={() => setReport(null)} />}
        </div>
      )}
      {busy && ready && b && !myTurn && !b.ended && (
        <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center">
          {/* A tap skips their turn; holding it plays the turn four times as fast until let go. */}
          <button
            type="button"
            onClick={skipFilm}
            onPointerDown={holdStart}
            onPointerUp={holdEnd}
            onPointerCancel={holdEnd}
            onLostPointerCapture={holdEnd}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Skip, or hold to fast-forward"
            aria-pressed={holding}
            style={{ WebkitTouchCallout: 'none' }}
            className="v-btn v-btn-secondary pointer-events-auto mb-[118px] h-11 touch-none rounded-full px-5 text-[15px] font-semibold select-none"
            data-testid="arena-skip"
          >
            {holding ? 'Fast-Forward' : 'Skip'}
          </button>
        </div>
      )}
      {feed.length > 0 && (
        <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-10" data-testid="arena-feed">
          <div className="mt-[124px] flex flex-col items-center gap-1 px-4">
            {feed.map((f) => (
              <div key={f.id} className={`feed-in max-w-full truncate rounded-full bg-black/85 px-3.5 py-1.5 text-[14px] font-semibold ${f.tone === 'bad' ? 'text-[#ffb4a8]' : 'text-white'}`}>
                {f.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {ready && (
        <div className="safe-top safe-x pointer-events-none absolute top-0 right-0 z-10" data-testid="arena-camera">
          <div className="pointer-events-auto mt-[132px] mr-2 flex flex-col gap-2">
            <CamButton label="Zoom In" testid="cam-in" onClick={() => stageRef.current?.zoomBy(0.65)}>
              <path d="M12 5v14M5 12h14" />
            </CamButton>
            <CamButton label="Zoom Out" testid="cam-out" onClick={() => stageRef.current?.zoomBy(1 / 0.65)}>
              <path d="M5 12h14" />
            </CamButton>
            <CamButton
              label="Back to Selected Unit"
              testid="cam-unit"
              onClick={() => {
                if (me) stageRef.current?.recenter(me);
                setOverview(false);
              }}
            >
              <circle cx="12" cy="12" r="6.5" />
              <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
            </CamButton>
            <CamButton label={overview ? 'Back to Your View' : 'Whole Field'} testid="cam-overview" pressed={overview} onClick={() => setOverview(stageRef.current?.toggleOverview() ?? false)}>
              <path d="M4 7.5 9 5l6 2.5L20 5v11.5L15 19l-6-2.5L4 19Z M9 5v11.5M15 7.5V19" />
            </CamButton>
            <CamButton label={danger ? 'Hide Danger Area' : 'Danger Area'} testid="cam-danger" pressed={danger} onClick={() => setDanger(!danger)}>
              <path d="M12 3.5 21 19H3Z M12 9.5v4.5M12 16.6v.1" />
            </CamButton>
          </div>
        </div>
      )}

      {mode.kind !== 'none' && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] z-10 text-center">
          <span className="rounded-full bg-black/85 px-4 py-2 text-[15px] font-semibold text-white">
            {mode.kind === 'strike' ? `Tap a cell to call ${mode.smoke ? 'smoke' : 'fire'}` : mode.kind === 'face' ? 'Tap where to face' : mode.kind === 'breach' ? 'Tap a cell next to it to breach' : mode.kind === 'mine' ? 'Tap a cell next to it to mine' : mode.kind === 'support' ? 'Tap a cell for the rockets' : `Tap a cell: ${ABILITIES[mode.id].name}`}
          </span>
        </div>
      )}

      <footer ref={footerRef} className="vercel safe-bottom safe-x absolute inset-x-0 bottom-0 z-10" data-testid="arena-footer">
        <div className="mx-2 mb-1.5 rounded-2xl bg-black/85 p-2 backdrop-blur">
          {card?.kind === 'move' && b && me && (
            <MoveCard
              b={b}
              me={me}
              at={card.at}
              dash={card.dash}
              known={visible}
              onCancel={() => setCard(null)}
              onMove={() => doAct({ type: 'move', unit: me.id, to: card.at, ...(card.dash ? { dash: true } : {}) })}
            />
          )}
          {card && card.kind !== 'move' && b && (
            <div className="mb-2 rounded-xl bg-ink-900 p-3" data-testid="shot-card">
              {card.kind === 'fire' && me ? (
                <ShotCard b={b} shooter={me} target={b.units.find((u) => u.id === card.target)!} weapon={card.weapon} visible={visible} onWeapon={(w) => setCard({ ...card, weapon: w })} />
              ) : card.kind === 'strike' && me && indirect ? (
                <StrikeCard info={strikeInfo(b, me, card.at, indirect, card.smoke)} smoke={card.smoke} />
              ) : card.kind === 'support' ? (
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[15px] font-semibold">{card.asset === 'himars' ? 'HIMARS · GMLRS' : 'Tornado-G · 122 mm salvo'}</span>
                    <span className="text-[32px] font-bold tabular-nums">{supportChance(b, 'blue', card.asset, card.at)}%</span>
                  </div>
                  <p className="text-[13px] text-muted">{card.asset === 'himars' ? 'One guided rocket: on the cell when it is watched. Everything around it is hit too.' : 'Forty rockets over five by five cells.'}</p>
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button type="button" className="v-btn v-btn-secondary h-11 flex-1 text-[15px]" onClick={() => setCard(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="v-btn v-btn-primary h-11 flex-[1.6] text-[15px] font-semibold"
                  data-testid="arena-fire"
                  onClick={() => {
                    if (card.kind === 'fire' && me) doAct({ type: 'fire', unit: me.id, target: card.target, weapon: card.weapon }, false);
                    else if (card.kind === 'strike' && me && indirect) doAct({ type: 'strike', unit: me.id, at: card.at, weapon: indirect.id, smoke: card.smoke }, false);
                    else if (card.kind === 'support') doAct({ type: 'support', asset: card.asset, at: card.at });
                  }}
                >
                  Fire
                </button>
              </div>
            </div>
          )}

          {!card && me && myTurn && (
            <div className="mb-2" data-testid="arena-unit">
              <div className="flex items-baseline gap-2 px-1">
                <div className="min-w-0 flex-1 truncate text-[15px] font-bold">
                  {typeOf(me.type).name}
                  {me.rank > 0 && <span className="ml-1.5 text-[12px] font-semibold text-muted">{RANKS[me.rank]!.name}</span>}
                </div>
              </div>
              <div className="truncate px-1 text-[13px] text-muted">
                {me.name} · {statusLine(me)}
                {!me.acted && !indirect ? (targets.length ? ` · ${targets.length} in sight` : ' · nothing in sight') : ''}
              </div>
              {advice.length > 0 && (
                <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-ink-900 py-1 pr-1 pl-3" data-testid="arena-advice">
                  <div className="min-w-0 flex-1 text-[13px] leading-snug">
                    <span className="font-semibold">Advice </span>
                    <span className="text-muted">{adviceText(b, me, advice, visible)}</span>
                  </div>
                  <button type="button" onClick={() => perform(advice, !advice.some((a) => a.type !== 'move' && a.type !== 'face'))} className="v-btn v-btn-primary h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold" data-testid="arena-do-it">
                    Do It
                  </button>
                </div>
              )}
              <div className={`mt-1.5 flex gap-1.5 pb-0.5 ${more ? 'flex-wrap' : 'overflow-x-auto'}`}>
                {shownActions.map((a) => (
                  <button key={a.id} type="button" disabled={!a.ok} onClick={a.on} aria-pressed={a.pressed} className={`h-11 shrink-0 rounded-full px-3.5 text-[14px] font-semibold disabled:opacity-35 ${a.pressed ? 'bg-white text-black' : 'bg-ink-800 text-text'}`} data-testid={`arena-${a.id}`}>
                    {a.label}
                  </button>
                ))}
                {(hiddenActions > 0 || more) && (
                  <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="h-11 shrink-0 rounded-full bg-ink-800 px-3.5 text-[14px] font-semibold text-muted" data-testid="arena-more">
                    {more ? 'Less' : `More ${hiddenActions}`}
                  </button>
                )}
              </div>
            </div>
          )}

          {b && myTurn && !card && (Object.keys(b.abilities).some((id) => !ABILITIES[id as AbilityId].passive) || b.support.some((s) => s.side === 'blue')) && (
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {b.support
                .filter((s) => s.side === 'blue')
                .map((s) => (
                  <button key={s.id} type="button" disabled={s.missions <= 0} onClick={() => setMode(mode.kind === 'support' ? { kind: 'none' } : { kind: 'support', asset: s.id })} aria-pressed={mode.kind === 'support'} className={`h-11 shrink-0 rounded-full px-3.5 text-[14px] font-semibold disabled:opacity-35 ${mode.kind === 'support' && mode.asset === s.id ? 'bg-white text-black' : 'bg-ink-800'}`} data-testid={`support-${s.id}`}>
                    {s.id === 'himars' ? 'HIMARS' : 'Tornado-G'} {s.missions}
                  </button>
                ))}
              {(Object.keys(b.abilities) as AbilityId[])
                .filter((id) => !ABILITIES[id].passive)
                .map((id) => {
                  const def = ABILITIES[id];
                  const usable = b.abilities[id] === 'ready' && (!def.needsUnit || (!!me && whyNot(b, { type: 'ability', id, unit: me.id }) === null));
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!usable}
                      onClick={() => (def.targeted ? setMode(mode.kind === 'ability' && mode.id === id ? { kind: 'none' } : { kind: 'ability', id }) : doAct({ type: 'ability', id, ...(me ? { unit: me.id } : {}) }))}
                      className={`h-11 shrink-0 rounded-full px-3.5 text-[14px] font-semibold disabled:opacity-35 ${mode.kind === 'ability' && mode.id === id ? 'bg-white text-black' : 'bg-ink-800'}`}
                      data-testid={`ability-${id}`}
                      title={def.text}
                    >
                      {def.name}
                    </button>
                  );
                })}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 items-end gap-3 overflow-x-auto" data-testid="arena-units">
              {formations.map((f) => {
                const units = blue.filter((u) => u.formation === f.id);
                if (!units.length) return null;
                return (
                  <div key={f.id} className="shrink-0">
                    <div className="mb-0.5 max-w-[240px] truncate px-0.5 text-[11px] font-semibold text-muted">{f.name}</div>
                    <div className="flex gap-1">
                      {units.map((u) => (
                        <Tile
                          key={u.id}
                          u={u}
                          active={u.id === selected}
                          onClick={() => {
                            setSelected(u.id);
                            setCard(null);
                            setDash(false);
                            setMode({ kind: 'none' });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {myTurn && undoRef.current && (
              <button type="button" onClick={undo} className="v-btn v-btn-secondary h-[58px] shrink-0 px-3 text-[15px] font-semibold" data-testid="arena-undo" aria-label={`Undo the last move of ${b?.units.find((u) => u.id === undoRef.current?.unit)?.name ?? 'your unit'}`}>
                Undo
              </button>
            )}
            <button type="button" disabled={!myTurn} onClick={() => (readyCount > 0 ? setConfirmEnd(true) : finishTurn())} className={`v-btn h-[58px] shrink-0 px-3 text-[15px] leading-tight font-semibold disabled:opacity-40 ${readyCount === 0 ? 'v-btn-primary' : 'v-btn-secondary'}`} data-testid="arena-end-turn">
              {waiting && ready ? 'Enemy Turn' : readyCount ? (
                <>
                  End Turn
                  <br />
                  <span className="text-[12px] font-normal">{readyCount} ready</span>
                </>
              ) : (
                'End Turn'
              )}
            </button>
          </div>
        </div>
      </footer>

      {confirmEnd && myTurn && (
        <div className="vercel absolute inset-0 z-20 flex items-end bg-black/60" data-testid="arena-end-confirm" onClick={() => setConfirmEnd(false)}>
          <div className="safe-bottom safe-x w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mx-2 mb-2 rounded-2xl bg-ink-900 p-4">
              <div className="text-[17px] font-bold">
                {readyCount} {readyCount === 1 ? 'unit has' : 'units have'} not acted
              </div>
              <p className="mt-0.5 text-[14px] text-muted">Your crews can take their turns for them, the way the advice would.</p>
              <div className="mt-3 flex flex-col gap-2">
                <button type="button" onClick={() => finishTurn(true)} className="v-btn v-btn-primary h-12 text-[16px] font-semibold" data-testid="arena-end-auto">
                  Crews Act, Then End Turn
                </button>
                <button type="button" onClick={() => finishTurn()} className="v-btn v-btn-secondary h-12 text-[15px]" data-testid="arena-end-now">
                  End Turn Now
                </button>
                <button type="button" onClick={() => setConfirmEnd(false)} className="v-btn v-btn-secondary h-12 text-[15px]" data-testid="arena-end-cancel">
                  Keep Playing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {menu && (
        <div className="vercel absolute inset-0 z-20 overflow-y-auto bg-black/90" data-testid="arena-paused">
          <div className="safe-top safe-bottom mx-auto flex min-h-full max-w-sm flex-col justify-center gap-3 px-6 py-6">
            <div className="text-[28px] font-bold tracking-tight">Battle Orders</div>
            <button type="button" onClick={() => setMenu(false)} className="v-btn v-btn-primary h-12 text-[16px] font-semibold">
              Resume
            </button>
            <button
              type="button"
              disabled={!myTurn}
              onClick={() => {
                setMenu(false);
                finishTurn(true);
              }}
              className="v-btn v-btn-secondary h-12 text-[15px] disabled:opacity-40"
              data-testid="arena-auto"
            >
              Let My Crews Play This Turn
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                skipFilm();
              }}
              className="v-btn v-btn-secondary h-12 text-[15px]"
            >
              Skip the Animation
            </button>
            <div className="mt-2 text-[13px] font-semibold text-muted">Quality</div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-900 p-1" role="radiogroup" aria-label="Quality">
              {(['low', 'balanced', 'high'] as const).map((q) => (
                <button key={q} type="button" role="radio" aria-checked={settings.quality === q} onClick={() => changeSettings({ ...settings, quality: q })} className={`h-11 rounded-lg text-[14px] font-semibold ${settings.quality === q ? 'bg-white text-black' : 'text-text'}`} data-testid={`quality-${q}`}>
                  {q === 'low' ? 'Low' : q === 'balanced' ? 'Balanced' : 'High'}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[13px] font-semibold text-muted">Motion</div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-900 p-1" role="radiogroup" aria-label="Motion">
              {(['full', 'reduced', 'off'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={settings.motion === m} onClick={() => changeSettings({ ...settings, motion: m })} className={`h-11 rounded-lg text-[14px] font-semibold ${settings.motion === m ? 'bg-white text-black' : 'text-text'}`} data-testid={`motion-${m}`}>
                  {m === 'full' ? 'Full' : m === 'reduced' ? 'Reduced' : 'Off'}
                </button>
              ))}
            </div>
            <label className="flex min-h-12 items-center gap-3 rounded-xl bg-ink-900 px-4 py-2">
              <span className="w-24 shrink-0 text-[15px] font-semibold">Shake</span>
              <input type="range" min={0} max={100} step={10} value={settings.shake} disabled={settings.motion === 'off'} onChange={(e) => changeSettings({ ...settings, shake: Number(e.target.value) })} className="h-11 min-w-0 flex-1 accent-white disabled:opacity-40" aria-label="Screen shake" data-testid="setting-shake" />
              <span className="w-12 shrink-0 text-right text-[14px] text-muted tabular-nums">{settings.motion === 'off' ? 'Off' : `${settings.shake}%`}</span>
            </label>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-ink-900">
              {(
                [
                  ['actionCams', 'Action Cams', 'Short close-ups on big hits'],
                  ['radio', 'Radio Calls', 'Your crews call contacts and kills'],
                  ['fastEnemy', 'Fast Enemy Turns', 'Double speed, without the waits'],
                  ['endSheet', 'Ask Before Ending Turn', 'When units have not acted'],
                  ['tips', 'Tips', 'A word when the board shows a mistake'],
                  ['haptics', 'Haptics', 'A tick on Fire and End Turn'],
                  ['perfOverlay', 'Show Frame Time', 'For measuring on your phone'],
                ] as const
              ).map(([k, label, sub]) => (
                <li key={k}>
                  <button type="button" role="switch" aria-checked={settings[k]} onClick={() => changeSettings({ ...settings, [k]: !settings[k] })} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left" data-testid={`setting-${k}`}>
                    <span>
                      <span className="block text-[15px] font-semibold">{label}</span>
                      <span className="block text-[13px] text-muted">{sub}</span>
                    </span>
                    <span className={`relative h-7 w-12 shrink-0 rounded-full ${settings[k] ? 'bg-white' : 'bg-ink-700'}`} aria-hidden>
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full ${settings[k] ? 'left-[22px] bg-black' : 'left-0.5 bg-white'}`} />
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" role="switch" aria-checked={settings.palette === 'colourblind'} onClick={() => changeSettings({ ...settings, palette: settings.palette === 'colourblind' ? 'standard' : 'colourblind' })} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left" data-testid="setting-palette">
                  <span>
                    <span className="block text-[15px] font-semibold">Colour-Blind Palette</span>
                    <span className="block text-[13px] text-muted">Blue and orange for friend and foe</span>
                  </span>
                  <span className={`relative h-7 w-12 shrink-0 rounded-full ${settings.palette === 'colourblind' ? 'bg-white' : 'bg-ink-700'}`} aria-hidden>
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full ${settings.palette === 'colourblind' ? 'left-[22px] bg-black' : 'left-0.5 bg-white'}`} />
                  </span>
                </button>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                if (b) retreat(b);
                flush();
              }}
              className="v-btn v-btn-secondary mt-2 h-12 text-[15px] font-semibold"
              data-testid="arena-retreat"
            >
              Retreat (Losses Stand)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShotCard({ b, shooter, target, weapon, visible, onWeapon }: { b: Battle; shooter: Unit; target: Unit; weapon: string; visible: Set<string>; onWeapon: (w: string) => void }) {
  const options = usableWeapons(shooter)
    .map((w) => ({ w, info: fireInfo(b, shooter, target, w, shooter, false, visible) }))
    .filter((o): o is { w: Weapon; info: FireInfo } => !!o.info);
  const pick = options.find((o) => o.w.id === weapon) ?? options[0];
  if (!pick) return <div className="text-[15px] text-muted">No shot from here.</div>;
  const { info } = pick;
  const tt = typeOf(target.type);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">
            {typeOf(shooter.type).short} → {tt.short}
          </div>
          <div className="truncate text-[13px] text-muted">{pick.w.name}</div>
        </div>
        <div className="text-[36px] leading-none font-bold tabular-nums" data-testid="shot-chance">
          {info.chance}%
        </div>
      </div>
      <div className="mt-1.5 text-[14px]">
        {info.pen !== undefined ? (
          <>
            Penetrate <b className="tabular-nums">{info.pen}%</b> ({info.facing}) · Kill <b className="tabular-nums">{info.kill}%</b>
            {info.aps ? <> · {tt.aps?.name} stops {info.aps}%</> : null}
          </>
        ) : (
          <>
            About <b className="tabular-nums">{info.casualties}</b> {info.casualties === 1 ? 'casualty' : 'casualties'} · +{info.supp} suppression
          </>
        )}
        {info.intercept ? <> · shot down {info.intercept}%</> : null}
      </div>
      <div className="mt-1 text-[13px] text-muted">{info.parts.map(([k, v]) => (k === 'Base' ? `Base ${v}` : `${k} ${v > 0 ? '+' : '−'}${Math.abs(v)}`)).join(' · ')}</div>
      {options.length > 1 && (
        <div className="mt-2 flex gap-1 overflow-x-auto" role="radiogroup" aria-label="Weapon">
          {options.map((o) => (
            <button key={o.w.id} type="button" role="radio" aria-checked={o.w.id === pick.w.id} onClick={() => onWeapon(o.w.id)} className={`h-11 shrink-0 rounded-lg px-3 text-[13px] font-semibold ${o.w.id === pick.w.id ? 'bg-white text-black' : 'bg-ink-800 text-text'}`}>
              {o.w.name.split(' · ')[0]} {o.info.chance}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StrikeCard({ info, smoke }: { info: StrikeInfo | null; smoke: boolean }) {
  if (!info) return <div className="text-[15px] text-muted">Out of range or nothing to fire.</div>;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">{smoke ? 'Smoke on this cell' : 'Fire on this cell'}</span>
        <span className="text-[32px] font-bold tabular-nums">{info.chance}%</span>
      </div>
      <p className="text-[13px] text-muted">
        {info.observed === 'blind' ? 'Nobody sees it: a guess.' : info.observed === 'laser' ? 'A drone lasers it.' : info.observed === 'spotter' ? 'A spotter watches it.' : 'Your troops can see it.'}{' '}
        {smoke ? 'Blocks sight through three by three cells until your next turn.' : 'A miss lands a cell off. Everyone around it is hit, yours too.'}
      </p>
    </div>
  );
}

export function ArenaScreen({ req: given, onDone }: { req: BattleRequest; onDone: (o: BattleOutcome) => void }) {
  const [phase, setPhase] = useState<'brief' | 'fight' | 'done'>('brief');
  const [result, setResult] = useState<{ r: ArenaResult; b: Battle } | null>(null);
  // Skirmishes take the difficulty chosen here (remembered); war-map battles follow the campaign.
  const [chosen, setChosen] = useState<Difficulty>(() => readSettings().difficulty);
  const difficulty: Difficulty = given.skirmish ? chosen : (given.setup.difficulty ?? 'normal');
  const req = useMemo(() => ({ ...given, setup: { ...given.setup, difficulty } }), [given, difficulty]);
  const choose = (d: Difficulty) => {
    setChosen(d);
    writeSettings({ ...readSettings(), difficulty: d });
  };
  return (
    <div className="no-select fixed inset-0 z-50 bg-ink-950" role="dialog" aria-label={req.title}>
      {phase === 'brief' && <Brief req={req} onDifficulty={given.skirmish ? choose : undefined} onFight={() => setPhase('fight')} onQuick={() => onDone({ kind: 'quick' })} onBack={() => onDone({ kind: 'back' })} />}
      {phase !== 'brief' && (
        <Field
          req={req}
          onEnd={(r, b) => {
            setResult({ r, b });
            setPhase('done');
          }}
        />
      )}
      {phase === 'done' && result && <Verdict result={result.r} req={req} battle={result.b} onDone={() => onDone({ kind: 'fought', result: result.r })} />}
    </div>
  );
}
