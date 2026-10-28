import { useEffect, useRef, useState } from 'react';
import { ABILITIES, arenaResult, CAPTURE_TIME, CLASSES, createArena, RANKS, stepArena, TIME_LIMIT, type AbilityId, type Arena, type ArenaInput, type ArenaResult, type Point, type UnitSpec } from '@brink/arena';
import { UnitGlyph } from '../glyphs';
import { arenaSfx, sfx, startMusic, stopMusic } from '../sfx';
import type { BattleRequest } from './battle';
import { ArenaView } from './scene';

// One battle, played by hand: a brief, the fight, the verdict. Drag anywhere to drive, tap to fire;
// on a computer WASD or the arrows drive and the mouse aims and fires.
// The safe-* classes set padding outside Tailwind's layers and win over px-*/pt-*, so padding goes
// on an inner element.

export type BattleOutcome = { kind: 'fought'; result: ArenaResult } | { kind: 'quick' } | { kind: 'back' };

declare global {
  interface Window {
    __arena?: { arena: () => Arena | null; toScreen: (x: number, y: number) => Point; win: () => void; lose: () => void };
  }
}

const MODE_TEXT = {
  destroy: ['Destroy them', 'Knock out every enemy unit.'],
  capture: ['Take the ground', `Hold the amber circle for ${CAPTURE_TIME} seconds with no enemy in it, or destroy them all.`],
} as const;

function Tile({ spec, hp, max, active, dead }: { spec: Pick<UnitSpec, 'cls' | 'color'>; hp?: number; max?: number; active?: boolean; dead?: boolean }) {
  const r = hp !== undefined && max ? Math.max(0, hp / max) : 1;
  return (
    <span className={`relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border-2 ${active ? 'border-friend' : 'border-white/70'} ${dead ? 'opacity-30 grayscale' : ''}`} style={{ background: spec.color }}>
      <UnitGlyph unitClass={spec.cls} color="#0d1114" className="h-6 w-8" />
      <span className="absolute inset-x-1 bottom-1 h-1 rounded-full bg-ink-950/60">
        <span className={`block h-full rounded-full ${r > 0.6 ? 'bg-good' : r > 0.3 ? 'bg-signal' : 'bg-hostile'}`} style={{ width: `${r * 100}%` }} />
      </span>
    </span>
  );
}

function Brief({ req, onFight, onQuick, onBack }: { req: BattleRequest; onFight: () => void; onQuick: () => void; onBack: () => void }) {
  const s = req.setup;
  const mode = s.site === 'capital' || s.site === 'city' || s.site === 'objective' ? 'capture' : 'destroy';
  const [title, text] = MODE_TEXT[mode];
  return (
    <div className="safe-top safe-bottom safe-x absolute inset-0 overflow-y-auto bg-ink-950/96" data-testid="arena-brief">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-5">
        <div className="mt-6 font-display text-[12px] font-bold tracking-[0.12em] text-signal uppercase">Battle · {s.terrain}{s.river ? ' · river' : ''}</div>
        <h1 className="font-display text-3xl leading-tight font-extrabold uppercase">{req.title}</h1>
        <div className="mt-3 rounded-xl border border-signal/50 bg-ink-900 p-3">
          <div className="font-display text-lg font-bold uppercase">{title}</div>
          <p className="text-[14px] text-muted">{text}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Your force</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {s.attackers.map((u) => (
                <Tile key={u.id} spec={u} hp={u.strength} max={1000} />
              ))}
            </div>
          </div>
          <div>
            <div className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Enemy seen</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {s.defenders.map((u) => (
                <Tile key={u.id} spec={u} hp={u.strength} max={1000} />
              ))}
            </div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-[14px] text-muted">
          <li>
            <b className="text-text">Drag</b> anywhere to drive. <b className="text-text">Tap</b> to fire there.
          </li>
          <li>Tank shells bounce once off walls: bank them round cover. The dotted line shows where.</li>
          <li>Tap a unit in the bottom bar to take control of it. The rest fight on their own.</li>
          {s.abilities.length > 0 && <li>Your research gave you: {s.abilities.map((a) => ABILITIES[a].name).join(', ')}.</li>}
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-6 pb-4">
          <button type="button" onClick={onFight} className="font-display h-14 rounded-xl bg-hostile text-xl font-extrabold tracking-wide text-white uppercase active:brightness-90" data-testid="arena-fight">
            Fight it
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onBack} className="h-11 flex-1 rounded-xl border border-line bg-ink-900 text-[14px]" data-testid="arena-back">
              {req.skirmish ? 'Back' : 'Back to map'}
            </button>
            {!req.skirmish && (
              <button type="button" onClick={onQuick} className="h-11 flex-1 rounded-xl border border-line bg-ink-900 text-[14px]" data-testid="arena-quick">
                Quick resolve (odds)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Verdict({ result, req, onDone }: { result: ArenaResult; req: BattleRequest; onDone: () => void }) {
  const lost = req.setup.attackers.filter((u) => (result.kept[u.id] ?? 0) === 0).length;
  const killed = req.setup.defenders.filter((u) => (result.kept[u.id] ?? 0) === 0).length;
  return (
    <div className="screen-in safe-top safe-bottom absolute inset-0 z-20 bg-ink-950/80 backdrop-blur-sm" data-testid="arena-verdict">
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className={`font-display text-5xl font-extrabold uppercase ${result.won ? 'text-good' : 'text-hostile'}`}>{result.won ? 'Victory' : 'Repulsed'}</div>
        <div className="mt-3 flex gap-2" aria-label={`${result.stars} of 3 stars`} data-testid="arena-stars">
          {[1, 2, 3].map((i) => (
            <svg key={i} viewBox="0 0 24 24" className={`star-in h-12 w-12 ${i <= result.stars ? 'text-signal' : 'text-ink-700'}`} style={{ animationDelay: `${i * 160}ms` }} aria-hidden>
              <path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor" />
            </svg>
          ))}
        </div>
        <div className="mt-2 text-[13px] text-faint">★ win · ★ no losses · ★ fast or near-untouched</div>
        <dl className="mt-5 grid w-full max-w-xs grid-cols-3 gap-2 text-center">
          {(
            [
              ['Destroyed', killed],
              ['Lost', lost],
              ['Time', `${result.time}s`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-ink-900 py-2">
              <dd className="font-display text-2xl font-extrabold">{v}</dd>
              <dt className="text-[11px] text-faint uppercase">{k}</dt>
            </div>
          ))}
        </dl>
        {result.stats.bounceKills > 0 && <div className="mt-3 text-[13px] text-signal">Trick shot: {result.stats.bounceKills} kill{result.stats.bounceKills === 1 ? '' : 's'} off the wall</div>}
        <p className="mt-4 max-w-xs text-[13px] text-muted">
          {req.skirmish ? 'Practice battle: nothing on the war map changes.' : result.won ? 'The hex is yours when the turn ends, unless they reinforce it first.' : 'Your losses stand. The hex stays theirs.'}
        </p>
        <button type="button" onClick={onDone} className="font-display mt-6 h-13 w-full max-w-xs rounded-xl bg-signal py-3 text-lg font-extrabold text-ink-950 uppercase" data-testid="arena-continue">
          {req.skirmish ? 'Done' : 'Back to the war'}
        </button>
      </div>
    </div>
  );
}

function Field({ req, onEnd }: { req: BattleRequest; onEnd: (r: ArenaResult) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const viewRef = useRef<ArenaView | null>(null);
  const input = useRef<{ move: Point | null; fire: Point | null; control: string | null; ability: ArenaInput['ability']; retreat: boolean; aim: Point | null; auto: boolean }>({ move: null, fire: null, control: null, ability: null, retreat: false, aim: null, auto: false });
  const [, setTick] = useState(0);
  const [targeting, setTargeting] = useState<AbilityId | null>(null);
  const targetingRef = useRef<AbilityId | null>(null);
  const [stick, setStick] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [hint, setHint] = useState(true);
  const colors = { blue: req.setup.attackers[0]?.color ?? '#4fb3ff', red: req.setup.defenders[0]?.color ?? '#ff5a4e' };
  targetingRef.current = targeting;
  pausedRef.current = paused;

  useEffect(() => {
    const el = host.current!;
    const arena = createArena(req.setup);
    arenaRef.current = arena;
    const view = new ArenaView(el, arena, colors);
    viewRef.current = view;
    view.setHud(0.11, 0.17);
    startMusic();
    let raf = 0;
    let last = performance.now();
    let ended = 0;
    let hud = 0;
    const keys = new Set<string>();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current && !document.hidden) {
        const i = input.current;
        let move = i.move;
        if (keys.size) {
          const kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
          const ky = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
          if (kx || ky) move = { x: kx / Math.hypot(kx, ky), y: ky / Math.hypot(kx, ky) };
        }
        stepArena(arena, dt, { move, fire: i.fire, control: i.control, ability: i.ability, retreat: i.retreat, auto: i.auto });
        i.fire = null;
        i.control = null;
        i.ability = null;
        for (const e of arena.events) {
          if (e.type === 'fire') {
            const k = e.kind;
            if (k === 'shell') arenaSfx.shell();
            else if (k === 'cannon') arenaSfx.cannon();
            else if (k === 'bullet') arenaSfx.bullet();
            else if (k === 'rocket') arenaSfx.rocket();
            else if (k === 'lob') arenaSfx.lob();
            else arenaSfx.dive();
          } else if (e.type === 'boom') arenaSfx.boom(e.size);
          else if (e.type === 'bounce') arenaSfx.bounce();
          else if (e.type === 'hit' && e.unit === arena.controlled) arenaSfx.hurt();
          else if (e.type === 'ability') arenaSfx.ability();
        }
        if (arena.capture > 0 && arena.level.zone) arenaSfx.capture();
        view.render(arena, dt, i.aim);
        if (arena.ended && !ended) {
          ended = now;
          if (arena.ended === 'won') sfx.win();
          else sfx.lose();
        }
        if (ended && now - ended > 1300) {
          onEnd(arenaResult(arena));
          return;
        }
      }
      if (now - hud > 100) {
        hud = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => view.resize();
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.add(k);
        e.preventDefault();
      }
      if (k === 'escape') setPaused((p) => !p);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.__arena = {
      arena: () => arenaRef.current,
      toScreen: (x, y) => view.toScreen(x, y),
      win: () => {
        for (const u of arena.units) if (u.side === 'red') u.alive = false;
      },
      lose: () => {
        input.current.retreat = true;
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      stopMusic();
      view.dispose();
      delete window.__arena;
    };
    // The arena is built once per battle.
  }, []);

  // Touch and mouse: a drag drives, a tap fires (or places a targeted ability).
  const pointers = useRef(new Map<number, { x0: number; y0: number; t0: number; stick: boolean }>());
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x0: e.clientX, y0: e.clientY, t0: performance.now(), stick: false });
  };
  const onMove = (e: React.PointerEvent) => {
    const view = viewRef.current;
    if (e.pointerType === 'mouse' && view) input.current.aim = view.pick(e.clientX, e.clientY);
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (!p.stick && Math.hypot(dx, dy) > 14 && ![...pointers.current.values()].some((q) => q.stick)) p.stick = true;
    if (p.stick) {
      const len = Math.hypot(dx, dy);
      const k = Math.min(1, len / 60);
      input.current.move = len > 0 ? { x: (dx / len) * k, y: (dy / len) * k } : null;
      setStick({ x0: p.x0, y0: p.y0, x: e.clientX, y: e.clientY });
      setHint(false);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!p) return;
    if (p.stick) {
      input.current.move = null;
      setStick(null);
      return;
    }
    if (performance.now() - p.t0 > 450) return;
    const at = viewRef.current?.pick(e.clientX, e.clientY);
    if (!at) return;
    const t = targetingRef.current;
    if (t) {
      input.current.ability = { id: t, x: at.x, y: at.y };
      setTargeting(null);
    } else {
      input.current.fire = at;
      if (e.pointerType !== 'mouse') input.current.aim = at;
    }
    setHint(false);
  };

  const a = arenaRef.current;
  const blue = a?.units.filter((u) => u.side === 'blue') ?? [];
  const reds = a?.units.filter((u) => u.side === 'red' && u.alive).length ?? 0;
  const left = Math.max(0, Math.ceil(TIME_LIMIT - (a?.time ?? 0)));
  const mode = a?.level.mode ?? 'destroy';
  const me = a?.units.find((u) => u.id === a.controlled);
  return (
    <div className="absolute inset-0 bg-ink-950" data-testid="arena">
      <div ref={host} className="absolute inset-0" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      {stick && (
        <div className="pointer-events-none absolute z-10" style={{ left: stick.x0 - 44, top: stick.y0 - 44 }} aria-hidden>
          <div className="h-[88px] w-[88px] rounded-full border-2 border-white/40 bg-white/5" />
          <div className="absolute h-10 w-10 rounded-full bg-white/60" style={{ left: 24 + Math.max(-36, Math.min(36, stick.x - stick.x0)), top: 24 + Math.max(-36, Math.min(36, stick.y - stick.y0)) }} />
        </div>
      )}
      <header className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-ink-950/95 to-transparent">
        <div className="px-3 pb-5">
          <div className="pointer-events-auto flex items-center gap-2 pt-1.5">
            <div className="min-w-0 flex-1">
              <div className="font-display text-[11px] font-bold tracking-[0.1em] text-signal uppercase">{mode === 'capture' ? 'Take the ground' : 'Destroy them'}</div>
              <div className="font-display truncate text-lg leading-tight font-extrabold uppercase">{req.title}</div>
            </div>
            <div className="text-right leading-tight">
              <div className="font-display text-xl font-extrabold tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
              <div className="text-[11px] text-faint">{reds} enemy left</div>
            </div>
            <button type="button" onClick={() => setPaused(true)} className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink-900/80" aria-label="Pause" data-testid="arena-pause">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            </button>
          </div>
          {mode === 'capture' && a && (
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-700" aria-label="Capture">
              <div className="h-full bg-signal transition-[width]" style={{ width: `${Math.min(100, (a.capture / CAPTURE_TIME) * 100)}%` }} />
            </div>
          )}
        </div>
      </header>
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 text-center">
          <span className="rounded-full bg-ink-950/80 px-4 py-2 font-display text-lg font-bold tracking-wide uppercase">Drag to drive · Tap to fire</span>
        </div>
      )}
      {targeting && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 text-center">
          <span className="rounded-full bg-hostile px-4 py-2 font-display text-lg font-bold text-white uppercase">Tap where: {ABILITIES[targeting].name}</span>
        </div>
      )}
      <footer className="safe-bottom safe-x absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-950/95 to-transparent">
        <div className="px-3 pt-6">
          {a && Object.keys(a.abilities).length > 0 && (
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {(Object.keys(a.abilities) as AbilityId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={a.abilities[id] !== 'ready'}
                  onClick={() => (ABILITIES[id].targeted ? setTargeting(targeting === id ? null : id) : (input.current.ability = { id }))}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-30 ${targeting === id ? 'border-hostile bg-hostile text-white' : 'border-signal/60 bg-ink-900/90 text-signal'}`}
                  data-testid={`ability-${id}`}
                >
                  {ABILITIES[id].name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 overflow-x-auto pb-1" data-testid="arena-units">
            {blue.map((u) => (
              <button key={u.id} type="button" onClick={() => u.alive && (input.current.control = u.id)} disabled={!u.alive} className="flex flex-col items-center gap-0.5" aria-pressed={u.id === a?.controlled} aria-label={`Drive ${u.name}`}>
                <Tile spec={{ cls: u.cls, color: u.color }} hp={u.hp} max={u.maxHp} active={u.id === a?.controlled} dead={!u.alive} />
                <span className="max-w-14 truncate text-[10px] text-faint">{u.rank > 0 ? RANKS[u.rank]!.name : CLASSES[u.cls].name}</span>
              </button>
            ))}
            {me && <div className="ml-auto max-w-[45%] pb-4 text-right text-[12px] leading-snug text-muted">{CLASSES[me.cls].tip}</div>}
          </div>
        </div>
      </footer>
      {paused && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-ink-950/80 px-8" data-testid="arena-paused">
          <div className="font-display text-3xl font-extrabold uppercase">Paused</div>
          <button type="button" onClick={() => setPaused(false)} className="font-display h-12 w-full max-w-xs rounded-xl bg-signal text-lg font-extrabold text-ink-950 uppercase">
            Resume
          </button>
          <button
            type="button"
            onClick={() => {
              input.current.auto = !input.current.auto;
              setPaused(false);
            }}
            className="h-11 w-full max-w-xs rounded-xl border border-line bg-ink-900 text-[14px]"
          >
            {input.current.auto ? 'Take the controls back' : 'Autopilot: let my crews fight it'}
          </button>
          <button
            type="button"
            onClick={() => {
              input.current.retreat = true;
              setPaused(false);
            }}
            className="h-11 w-full max-w-xs rounded-xl border border-hostile/60 text-[14px] text-hostile"
            data-testid="arena-retreat"
          >
            Retreat (losses stand)
          </button>
        </div>
      )}
    </div>
  );
}

export function ArenaScreen({ req, onDone }: { req: BattleRequest; onDone: (o: BattleOutcome) => void }) {
  const [phase, setPhase] = useState<'brief' | 'fight' | 'done'>('brief');
  const [result, setResult] = useState<ArenaResult | null>(null);
  return (
    <div className="no-select fixed inset-0 z-50 bg-ink-950" role="dialog" aria-label={req.title}>
      {phase === 'brief' && <Brief req={req} onFight={() => setPhase('fight')} onQuick={() => onDone({ kind: 'quick' })} onBack={() => onDone({ kind: 'back' })} />}
      {phase !== 'brief' && (
        <Field
          req={req}
          onEnd={(r) => {
            setResult(r);
            setPhase('done');
          }}
        />
      )}
      {phase === 'done' && result && <Verdict result={result} req={req} onDone={() => onDone({ kind: 'fought', result })} />}
    </div>
  );
}
