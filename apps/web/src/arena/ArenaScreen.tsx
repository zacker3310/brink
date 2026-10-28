import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ABILITIES,
  act,
  arenaResult,
  autoTurn,
  CAPTURE_ROUNDS,
  CLASSES,
  createArena,
  endTurn,
  idx,
  RANKS,
  reachable,
  retreat,
  ROUND_LIMIT,
  strikeChance,
  targetsOf,
  unitAt,
  type AbilityId,
  type Action,
  type Arena,
  type ArenaResult,
  type FireInfo,
  type Point,
  type Unit,
  type UnitSpec,
} from '@brink/arena';
import { UnitGlyph } from '../glyphs';
import { arenaSfx, sfx, startMusic, stopMusic } from '../sfx';
import { loadLibrary, type Library } from './assets';
import type { BattleRequest } from './battle';
import { BattleView, type Overlay } from './scene';

// One battle, fought in turns: a brief, the fight, the verdict. On your turn tap a unit, tap a lit
// cell to move it, tap a marked enemy to see the odds, Fire to shoot. End turn and the enemy moves.
// The safe-* classes set padding outside Tailwind's layers and win over px-*/pt-*, so padding goes
// on an inner element.

export type BattleOutcome = { kind: 'fought'; result: ArenaResult } | { kind: 'quick' } | { kind: 'back' };

declare global {
  interface Window {
    __arena?: {
      arena: () => Arena | null;
      /** A cell's centre on screen. */
      toScreen: (x: number, y: number) => Point;
      /** True when nothing is animating and it is your turn. */
      ready: () => boolean;
      win: () => void;
      lose: () => void;
    };
  }
}

const MODE_TEXT = {
  destroy: ['Destroy them', 'Knock out every enemy unit.'],
  capture: ['Take the ground', `End ${CAPTURE_ROUNDS} rounds in the amber circle with no enemy in it, or destroy them all.`],
} as const;

function Tile({ spec, hp, max, active, dead, done }: { spec: Pick<UnitSpec, 'cls' | 'color'>; hp?: number; max?: number; active?: boolean; dead?: boolean; done?: boolean }) {
  const r = hp !== undefined && max ? Math.max(0, hp / max) : 1;
  return (
    <span className={`relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border-2 ${active ? 'border-white' : 'border-white/40'} ${dead ? 'opacity-30 grayscale' : done ? 'opacity-55' : ''}`} style={{ background: spec.color }}>
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
    <div className="vercel safe-top safe-bottom safe-x absolute inset-0 overflow-y-auto bg-black" data-testid="arena-brief">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-5">
        <div className="mt-6 font-mono text-[12px] tracking-[0.12em] text-muted uppercase">
          Battle · {s.terrain}
          {s.river ? ' · river' : ''}
        </div>
        <h1 className="text-3xl leading-tight font-semibold tracking-tight">{req.title}</h1>
        <div className="mt-3 rounded-xl border border-line bg-ink-900 p-3">
          <div className="text-lg font-semibold">{title}</div>
          <p className="text-[14px] text-muted">{text}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">Your force</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {s.attackers.map((u) => (
                <Tile key={u.id} spec={u} hp={u.strength} max={1000} />
              ))}
            </div>
          </div>
          <div>
            <div className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">Enemy seen</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {s.defenders.map((u) => (
                <Tile key={u.id} spec={u} hp={u.strength} max={1000} />
              ))}
            </div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-[14px] text-muted">
          <li>
            <b className="text-text">Your turn:</b> each unit moves, then acts. Tap a unit, tap a lit cell to move, tap a marked enemy to see the odds.
          </li>
          <li>A wall next to a unit takes 40 off the aim against it; sandbags and trees 22. Hit it from the side and cover counts for nothing.</li>
          <li>
            <b className="text-text">Overwatch</b> shoots the first enemy that moves into sight. <b className="text-text">Dig in</b> makes a unit harder to hit.
          </li>
          {s.abilities.length > 0 && <li>Your research gave you: {s.abilities.map((a) => ABILITIES[a].name).join(', ')}.</li>}
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-6 pb-4">
          <button type="button" onClick={onFight} className="v-btn v-btn-primary h-14 text-lg font-semibold" data-testid="arena-fight">
            Fight it
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onBack} className="v-btn v-btn-secondary h-11 flex-1 text-[14px]" data-testid="arena-back">
              {req.skirmish ? 'Back' : 'Back to map'}
            </button>
            {!req.skirmish && (
              <button type="button" onClick={onQuick} className="v-btn v-btn-secondary h-11 flex-1 text-[14px]" data-testid="arena-quick">
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
  const acc = result.stats.shots ? Math.round((result.stats.hits / result.stats.shots) * 100) : 0;
  return (
    <div className="vercel screen-in safe-top safe-bottom absolute inset-0 z-20 bg-black/80 backdrop-blur-sm" data-testid="arena-verdict">
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className={`text-5xl font-semibold tracking-tight ${result.won ? 'text-good' : 'text-hostile'}`}>{result.won ? 'Victory' : 'Repulsed'}</div>
        <div className="mt-3 flex gap-2" aria-label={`${result.stars} of 3 stars`} data-testid="arena-stars">
          {[1, 2, 3].map((i) => (
            <svg key={i} viewBox="0 0 24 24" className={`star-in h-12 w-12 ${i <= result.stars ? 'text-signal' : 'text-ink-700'}`} style={{ animationDelay: `${i * 160}ms` }} aria-hidden>
              <path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="currentColor" />
            </svg>
          ))}
        </div>
        <div className="mt-2 font-mono text-[12px] text-faint">★ win · ★ no losses · ★ in 6 rounds or near-untouched</div>
        <dl className="mt-5 grid w-full max-w-xs grid-cols-4 gap-2 text-center">
          {(
            [
              ['Destroyed', killed],
              ['Lost', lost],
              ['Rounds', result.rounds],
              ['Accuracy', `${acc}%`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-ink-900 py-2">
              <dd className="text-xl font-semibold tabular-nums">{v}</dd>
              <dt className="font-mono text-[10px] text-faint uppercase">{k}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-xs text-[13px] text-muted">
          {req.skirmish ? 'Practice battle: nothing on the war map changes.' : result.won ? 'The hex is yours when the turn ends, unless they reinforce it first.' : 'Your losses stand. The hex stays theirs.'}
        </p>
        <button type="button" onClick={onDone} className="v-btn v-btn-primary mt-6 h-12 w-full max-w-xs text-[15px] font-semibold" data-testid="arena-continue">
          {req.skirmish ? 'Done' : 'Back to the war'}
        </button>
      </div>
    </div>
  );
}

type Card = { kind: 'fire'; target: string; info: FireInfo } | { kind: 'strike'; at: Point; chance: number } | null;

function Field({ req, onEnd }: { req: BattleRequest; onEnd: (r: ArenaResult) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const viewRef = useRef<BattleView | null>(null);
  const cursor = useRef(0);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<Card>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [targeting, setTargeting] = useState<AbilityId | null>(null);
  const [menu, setMenu] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const colors = { blue: req.setup.attackers[0]?.color ?? '#4fb3ff', red: req.setup.defenders[0]?.color ?? '#ff5a4e' };
  const refresh = () => setTick((t) => t + 1);

  /** Hand everything the engine has logged since last time to the film. */
  const flush = () => {
    const a = arenaRef.current;
    const v = viewRef.current;
    if (!a || !v) return;
    v.play(a.events.slice(cursor.current));
    cursor.current = a.events.length;
    setBusy(true);
    refresh();
  };

  useEffect(() => {
    let dead = false;
    let raf = 0;
    let ended = 0;
    let wasBusy = true;
    const el = host.current!;
    const arena = createArena(req.setup);
    arenaRef.current = arena;
    startMusic();
    // Real models when they load in time; the primitive ones otherwise.
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 20000));
    void Promise.race([loadLibrary().catch(() => null), timeout]).then((lib: Library | null) => {
      if (dead) return;
      const view = new BattleView(el, arena, colors, lib, req.setup.seed);
      viewRef.current = view;
      view.setHud(0.1, 0.27);
      setReady(true);
      setBanner('Your turn');
      flush();
      let last = performance.now();
      const frame = (now: number) => {
        // Frame timestamps can run behind the clock on some browsers: never step backwards.
        const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
        last = now;
        if (!document.hidden) view.frame(dt);
        // Odds labels ride over their targets as the camera moves.
        const box = el.getBoundingClientRect();
        for (const n of labelsRef.current?.children ?? []) {
          const [x, y] = (n as HTMLElement).dataset.at!.split(',').map(Number);
          const at = view.toScreen(x!, y!, 0.9);
          (n as HTMLElement).style.transform = `translate(${at.x - box.left}px, ${at.y - box.top}px) translate(-50%, -100%)`;
        }
        const b = view.busy;
        if (b !== wasBusy) {
          wasBusy = b;
          setBusy(b);
          if (!b && !arena.ended && arena.turn === 'blue') setBanner(`Round ${arena.round} · your turn`);
        }
        if (arena.ended && !b && !ended) {
          ended = now;
          if (arena.ended === 'won') sfx.win();
          else sfx.lose();
        }
        if (ended && now - ended > 700) {
          onEnd(arenaResult(arena));
          return;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      window.__arena = {
        arena: () => arenaRef.current,
        toScreen: (x, y) => view.toScreen(x, y),
        ready: () => !view.busy && arena.turn === 'blue' && !arena.ended,
        win: () => {
          for (const u of arena.units) if (u.side === 'red') u.alive = false;
          arena.ended = 'won';
          arena.events.push({ type: 'end', won: true });
          flush();
          view.skip();
        },
        lose: () => {
          retreat(arena);
          flush();
          view.skip();
        },
      };
    });
    const onResize = () => viewRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      stopMusic();
      viewRef.current?.dispose();
      delete window.__arena;
    };
    // The battle is built once.
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1400);
    return () => clearTimeout(t);
  }, [banner]);

  const a = arenaRef.current;
  const myTurn = !!a && ready && !busy && a.turn === 'blue' && !a.ended;
  const me = a && selected ? a.units.find((u) => u.id === selected && u.alive) : undefined;
  const reach = useMemo(() => (a && me && myTurn && !me.moved && !me.acted ? reachable(a, me) : null), [a, me, myTurn, me?.x, me?.y, me?.moved, me?.acted]);
  const targets = useMemo(() => (a && me && myTurn ? targetsOf(a, me) : []), [a, me, myTurn, me?.x, me?.y, me?.acted, busy]);
  const isArtillery = me && CLASSES[me.cls].weapon.kind === 'area';

  // Keep the 3D overlay in step with the selection.
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !a) return;
    const o: Overlay = { selected: myTurn ? selected : null, reach: [], path: null, targets: [], area: null };
    if (myTurn && me) {
      if (reach) o.reach = [...reach.cost.keys()].filter((i) => i !== idx(me.x, me.y));
      o.targets = targets.map((t) => t.unit.id);
      if (hover && reach?.cost.has(idx(hover.x, hover.y)) && (hover.x !== me.x || hover.y !== me.y)) {
        const path: Point[] = [];
        for (let i: number | undefined = idx(hover.x, hover.y); i !== undefined; i = reach.prev.get(i)) path.unshift({ x: i % a.level.w, y: Math.floor(i / a.level.w) });
        o.path = path;
      }
      const at = card?.kind === 'strike' ? card.at : isArtillery && hover && !me.acted && strikeChance(a, me, hover) !== null ? hover : null;
      if (at) o.area = { at, r: CLASSES[me.cls].weapon.splash };
    }
    if (myTurn && targeting === 'airstrike' && hover) o.area = { at: hover, r: 1 };
    v.setOverlay(o);
  });

  // The camera brings the selected unit into view; a new turn starts with a ready unit selected.
  useEffect(() => {
    if (me) viewRef.current?.focusOn(me);
  }, [selected]);
  useEffect(() => {
    if (!myTurn || !a) return;
    const cur = a.units.find((u) => u.id === selected);
    if (!cur || !cur.alive || cur.acted) setSelected(a.units.find((u) => u.side === 'blue' && u.alive && !u.acted)?.id ?? null);
  }, [myTurn]);

  const nextReady = (after?: string) => {
    if (!a) return;
    const blue = a.units.filter((u) => u.side === 'blue' && u.alive && !u.acted);
    const i = blue.findIndex((u) => u.id === after);
    setSelected((blue[i + 1] ?? blue[0])?.id ?? null);
  };

  const doAct = (action: Action, keepSelection = true) => {
    if (!a || !act(a, action)) return false;
    setCard(null);
    flush();
    if (!keepSelection && 'unit' in action) nextReady(action.unit);
    return true;
  };

  const tapCell = (p: Point) => {
    if (!a || !myTurn) return;
    arenaSfx.tick();
    if (targeting) {
      if (targeting === 'airstrike') doAct({ type: 'ability', id: 'airstrike', at: p });
      setTargeting(null);
      return;
    }
    const there = unitAt(a, p.x, p.y);
    if (there?.side === 'blue') {
      setSelected(there.id);
      setCard(null);
      return;
    }
    if (!me) {
      if (there) setSelected(null);
      return;
    }
    if (there?.side === 'red') {
      const t = targets.find((x) => x.unit.id === there.id);
      if (!t) return;
      if (card?.kind === 'fire' && card.target === there.id) doAct({ type: 'fire', unit: me.id, target: there.id }, false);
      else setCard({ kind: 'fire', target: there.id, info: t.info });
      return;
    }
    if (reach?.cost.has(idx(p.x, p.y)) && (p.x !== me.x || p.y !== me.y)) {
      doAct({ type: 'move', unit: me.id, to: p });
      return;
    }
    if (isArtillery && !me.acted) {
      const chance = strikeChance(a, me, p);
      if (chance !== null) {
        if (card?.kind === 'strike' && card.at.x === p.x && card.at.y === p.y) doAct({ type: 'strike', unit: me.id, at: p }, false);
        else setCard({ kind: 'strike', at: p, chance });
        return;
      }
    }
    setCard(null);
  };

  // One finger (or the mouse) drags the board, two pinch to zoom; a press that does not move is a tap.
  const pointers = useRef(new Map<number, { x: number; y: number; x0: number; y0: number; moved: boolean }>());
  const pinch = useRef(0);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      pinch.current = Math.hypot(p!.x - q!.x, p!.y - q!.y);
      for (const v of pointers.current.values()) v.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const view = viewRef.current;
    const p = pointers.current.get(e.pointerId);
    if (view && p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 9) p.moved = true;
      if (pointers.current.size === 2) {
        const [m, n] = [...pointers.current.values()];
        const d = Math.hypot(m!.x - n!.x, m!.y - n!.y);
        if (pinch.current > 0 && d > 0) view.zoomBy(pinch.current / d);
        pinch.current = d;
      } else if (p.moved) view.panBy(dx, dy);
    }
    if (e.pointerType === 'mouse' && !p) {
      const c = view?.pick(e.clientX, e.clientY) ?? null;
      if (c?.x !== hover?.x || c?.y !== hover?.y) setHover(c);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = 0;
    if (!p || p.moved) return;
    const c = viewRef.current?.pick(e.clientX, e.clientY);
    if (c) tapCell(c);
  };
  const onWheel = (e: React.WheelEvent) => viewRef.current?.zoomBy(Math.exp(e.deltaY * 0.0012));

  const finishTurn = (auto = false) => {
    if (!a || !myTurn) return;
    setSelected(null);
    setCard(null);
    setTargeting(null);
    setBanner('Enemy turn');
    if (auto) autoTurn(a);
    else endTurn(a);
    flush();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCard(null);
        setTargeting(null);
        setSelected(null);
      } else if (e.key === 'Enter' && e.shiftKey) finishTurn();
      else if (e.key === 'Tab' && a) {
        e.preventDefault();
        nextReady(selected ?? undefined);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const blue = a?.units.filter((u) => u.side === 'blue') ?? [];
  const readyCount = blue.filter((u) => u.alive && !u.acted).length;
  const reds = a?.units.filter((u) => u.side === 'red' && u.alive).length ?? 0;
  const mode = a?.level.mode ?? 'destroy';
  // Hit chances over the enemies the selected unit can shoot.
  const labels = myTurn ? targets.map((t) => ({ id: t.unit.id, chance: t.info.chance, x: t.unit.x, y: t.unit.y })) : [];
  const status = (u: Unit) => (!u.alive ? 'Destroyed' : u.acted ? 'Done' : u.moved ? 'Moved: can still act' : 'Ready');

  return (
    <div className="absolute inset-0 bg-ink-950" data-testid="arena">
      <div ref={host} className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerMove={onPointerMove} onWheel={onWheel} />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[13px] tracking-[0.14em] text-muted uppercase">Deploying…</span>
        </div>
      )}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10">
        {labels.map((l) => (
          <div
            key={l.id}
            data-at={`${l.x},${l.y}`}
            className={`absolute top-0 left-0 rounded-md px-1.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums shadow ${card?.kind === 'fire' && card.target === l.id ? 'bg-white text-black' : 'bg-hostile text-white'}`}
            data-testid={`odds-${l.id}`}
          >
            {l.chance}%
          </div>
        ))}
      </div>

      <header className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 to-transparent">
        <div className="px-3 pb-6">
          <div className="pointer-events-auto flex items-center gap-2 pt-1.5">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] tracking-[0.1em] text-signal uppercase">{MODE_TEXT[mode][0]}</div>
              <div className="truncate text-lg leading-tight font-semibold tracking-tight">{req.title}</div>
            </div>
            <div className="text-right leading-tight">
              <div className="font-mono text-lg font-semibold tabular-nums" data-testid="arena-round">
                {a?.round ?? 1}/{ROUND_LIMIT}
              </div>
              <div className="font-mono text-[11px] text-faint">{reds} enemy left</div>
            </div>
            <button type="button" onClick={() => setMenu(true)} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60" aria-label="Menu" data-testid="arena-pause">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          </div>
          {mode === 'capture' && a && (
            <div className="mt-1.5 flex gap-1" aria-label="Capture">
              {Array.from({ length: CAPTURE_ROUNDS }, (_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i < a.capture ? 'bg-signal' : 'bg-white/15'}`} />
              ))}
            </div>
          )}
        </div>
      </header>

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] z-10 text-center" data-testid="arena-banner">
          <span className={`rounded-full px-5 py-2 text-lg font-semibold tracking-tight shadow-lg ${banner === 'Enemy turn' ? 'bg-hostile text-white' : 'bg-white text-black'}`}>{banner}</span>
        </div>
      )}
      {targeting && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] z-10 text-center">
          <span className="rounded-full bg-hostile px-4 py-2 text-[15px] font-semibold text-white">Tap a cell: {ABILITIES[targeting].name}</span>
        </div>
      )}

      <footer className="vercel safe-bottom safe-x absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent">
        <div className="px-3 pt-8">
          {card && me && (
            <div className="mb-2 rounded-xl border border-line bg-ink-900/95 p-3" data-testid="shot-card">
              {card.kind === 'fire' ? (
                <ShotCard shooter={me} target={a!.units.find((u) => u.id === card.target)!} info={card.info} />
              ) : (
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[14px] font-semibold">Shell this cell</span>
                    <span className="font-mono text-3xl font-semibold tabular-nums">{card.chance}%</span>
                  </div>
                  <p className="text-[12px] text-muted">On target, or it lands next to it. Everything around the cell takes half, yours included.</p>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button type="button" className="v-btn v-btn-secondary h-11 flex-1" onClick={() => setCard(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="v-btn v-btn-primary h-11 flex-[1.6] font-semibold"
                  data-testid="arena-fire"
                  onClick={() => (card.kind === 'fire' ? doAct({ type: 'fire', unit: me.id, target: card.target }, false) : doAct({ type: 'strike', unit: me.id, at: card.at }, false))}
                >
                  Fire
                </button>
              </div>
            </div>
          )}

          {!card && me && myTurn && (
            <div className="mb-2 flex items-center gap-2" data-testid="arena-unit">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">
                  {CLASSES[me.cls].name}
                  {me.rank > 0 && <span className="ml-1.5 font-mono text-[11px] text-signal uppercase">{RANKS[me.rank]!.name}</span>}
                </div>
                <div className="truncate font-mono text-[11px] text-muted">
                  {me.hp}/{me.maxHp} · {status(me)}
                  {!me.acted && targets.length === 0 && !isArtillery ? ' · no target in sight' : ''}
                  {!me.acted && targets.length > 0 ? ` · ${targets.length} in sight: tap one` : ''}
                </div>
              </div>
              {!me.acted && (
                <>
                  <button type="button" className="v-btn v-btn-secondary h-10 px-3 text-[13px]" onClick={() => doAct({ type: 'overwatch', unit: me.id }, false)} data-testid="arena-overwatch">
                    Overwatch
                  </button>
                  {!CLASSES[me.cls].flying && (
                    <button type="button" className="v-btn v-btn-secondary h-10 px-3 text-[13px]" onClick={() => doAct({ type: 'dig', unit: me.id }, false)} data-testid="arena-dig">
                      Dig in
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {a && Object.keys(a.abilities).length > 0 && myTurn && !card && (
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {(Object.keys(a.abilities) as AbilityId[]).map((id) => {
                const needsUnit = id === 'repair' || id === 'mines';
                const usable = a.abilities[id] === 'ready' && (!needsUnit || !!me) && (id !== 'repair' || (me ? me.hp < me.maxHp : false));
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!usable}
                    onClick={() => (ABILITIES[id].targeted ? setTargeting(targeting === id ? null : id) : doAct({ type: 'ability', id, unit: me?.id }))}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium disabled:opacity-30 ${targeting === id ? 'border-hostile bg-hostile text-white' : 'border-white/25 bg-black/60 text-text'}`}
                    data-testid={`ability-${id}`}
                    title={ABILITIES[id].text}
                  >
                    {ABILITIES[id].name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-2 pb-1">
            <div className="flex min-w-0 flex-1 items-end gap-1.5 overflow-x-auto" data-testid="arena-units">
              {blue.map((u) => (
                <button key={u.id} type="button" onClick={() => u.alive && (setSelected(u.id), setCard(null))} disabled={!u.alive} className="flex flex-col items-center gap-0.5" aria-pressed={u.id === selected} aria-label={`Select ${u.name}`} data-testid={`arena-unit-${u.id}`}>
                  <Tile spec={{ cls: u.cls, color: u.color }} hp={u.hp} max={u.maxHp} active={u.id === selected} dead={!u.alive} done={u.acted} />
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!myTurn}
              onClick={() => finishTurn()}
              className={`v-btn h-12 shrink-0 px-4 text-[15px] font-semibold disabled:opacity-40 ${readyCount === 0 ? 'v-btn-primary' : 'v-btn-secondary'}`}
              data-testid="arena-end-turn"
            >
              {busy && ready ? 'Wait…' : readyCount ? `End turn · ${readyCount} ready` : 'End turn'}
            </button>
          </div>
        </div>
      </footer>

      {menu && (
        <div className="vercel absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 px-8" data-testid="arena-paused">
          <div className="text-3xl font-semibold tracking-tight">Battle orders</div>
          <button type="button" onClick={() => setMenu(false)} className="v-btn v-btn-primary h-12 w-full max-w-xs text-[15px] font-semibold">
            Resume
          </button>
          <button
            type="button"
            disabled={!myTurn}
            onClick={() => {
              setMenu(false);
              finishTurn(true);
            }}
            className="v-btn v-btn-secondary h-11 w-full max-w-xs text-[14px] disabled:opacity-40"
            data-testid="arena-auto"
          >
            Let my crews play this turn
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              viewRef.current?.skip();
            }}
            className="v-btn v-btn-secondary h-11 w-full max-w-xs text-[14px]"
          >
            Skip the animation
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              if (a) retreat(a);
              flush();
            }}
            className="h-11 w-full max-w-xs rounded-lg border border-hostile/60 text-[14px] text-hostile"
            data-testid="arena-retreat"
          >
            Retreat (losses stand)
          </button>
        </div>
      )}
    </div>
  );
}

function ShotCard({ shooter, target, info }: { shooter: Unit; target: Unit; info: FireInfo }) {
  const lo = Math.floor(info.damage * 0.85);
  const hi = Math.ceil(info.damage * 1.15);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">
            {CLASSES[shooter.cls].name} → {CLASSES[target.cls].name}
          </div>
          <div className="font-mono text-[11px] text-muted">
            {lo}–{hi} damage · target has {target.hp}
            {hi >= target.hp ? ' · can kill' : ''}
          </div>
        </div>
        <div className="font-mono text-4xl font-semibold tabular-nums" data-testid="shot-chance">
          {info.chance}%
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {info.parts.map(([k, v]) => (
          <span key={k} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${k === 'Base' ? 'border-line text-muted' : v > 0 ? 'border-good/50 text-good' : 'border-hostile/50 text-hostile'}`}>
            {k} {k === 'Base' ? v : `${v > 0 ? '+' : ''}${v}`}
          </span>
        ))}
      </div>
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
