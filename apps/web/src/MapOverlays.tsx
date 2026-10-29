import { useEffect, useMemo } from 'react';
import type { HexKey } from '@brink/contracts';
import { GOVERNMENTS, RIVER_ASSAULT_PENALTY, TERRAIN, UNITS } from '@brink/game-data';
import { nationModifiers, previewAssault, previewStrike, threatZones } from '@brink/simulation';
import { hexCorners, hexToPixel, parseKey } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { hexLabel } from './insight';
import { UnitGlyph } from './glyphs';
import { hostilesAt, orderForClick, reachFor, type Mode } from './planning';
import { useReplay } from './replay';
import { useGame } from './store';
import { Swatch } from './ui';
import { Icon } from './icons';

// HTML overlays drawn over the Pixi map: mode banner, hover card, zoom, minimap, legend, toasts.

const MODE_HINT: Record<Mode, string> = {
  move: 'Click a highlighted hex to move',
  attack: 'Click an enemy hex to assault or strike',
  recon: 'Click a hex to scout towards it',
  withdraw: 'Click a hex to fall back to',
};

const center = (k: HexKey) => hexToPixel(parseKey(k), HEX_SIZE);

export function ModeBanner() {
  const view = useGame((s) => s.view)!;
  const fid = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const resolving = useGame((s) => s.resolving);
  const playback = useGame((s) => s.playback);
  const f = fid ? view.formations[fid] : undefined;
  if (playback) return <ReplayBar />;
  if (resolving) {
    return (
      <div className="resolving-banner pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 overflow-hidden border border-signal/70 bg-ink-950/90 px-4 py-2 text-center" role="status">
        <div className="font-display text-[10px] font-bold tracking-[0.1em] text-signal uppercase">Orders locked</div>
        <div className="text-sm font-semibold">Resolving turn {view.turn}…</div>
      </div>
    );
  }
  if (!f) return null;
  const tone = mode === 'attack' ? 'border-hostile/70 text-hostile' : 'border-signal/60 text-signal';
  return (
    <div className={`pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 border bg-ink-950/85 px-3 py-1.5 text-xs whitespace-nowrap backdrop-blur ${tone}`}>
      <span className="font-display font-bold tracking-[0.06em] uppercase">{UNITS[f.unitClass].ground ? mode : UNITS[f.unitClass].range ? 'strike' : 'rebase'}</span>
      <span className="ml-2 text-muted">{UNITS[f.unitClass].ground ? MODE_HINT[mode] : 'Click a target or one of your cities'} · right-click to deselect</span>
    </div>
  );
}

const OUTCOME_TEXT: Record<string, [string, string]> = {
  attacker_victory: ['Decisive victory', 'text-good'],
  inconclusive: ['Indecisive', 'text-signal'],
  defender_held: ['Repulsed', 'text-hostile'],
};

/** Civ-style combat preview: both sides, expected damage, and the modifiers in play. */
function CombatCard({ fid, target }: { fid: string; target: HexKey }) {
  const view = useGame((s) => s.view)!;
  const f = view.formations[fid]!;
  const def = UNITS[f.unitClass];
  const enemies = hostilesAt(view, target);
  const tile = view.tiles[target]!;
  const enemy = enemies[0]!;
  const enemyNation = view.nations[enemy.owner];
  const theirStrength = enemies.reduce((a, c) => a + c.estimatedStrength, 0) / enemies.length;
  const ranged = def.range > 0;
  const assault = ranged ? null : previewAssault(view, [fid], target);
  const strike = ranged ? previewStrike(view, fid, target) : null;
  const terrain = tile.terrain ? TERRAIN[tile.terrain] : null;
  const mods: [string, number][] = [];
  const mine = nationModifiers(view.self);
  if (mine.attack) mods.push([`${GOVERNMENTS[view.self.government].name}`, mine.attack]);
  if (!ranged && terrain && (f.unitClass === 'armor' || f.unitClass === 'mechanized') && terrain.armorPenalty) mods.push([`Armor in ${terrain.name.toLowerCase()}`, -terrain.armorPenalty]);
  if (!ranged && tile.river) mods.push(['Attacking across a river', -RIVER_ASSAULT_PENALTY]);
  if (!ranged && !enemies.every((c) => c.confirmed)) mods.push(['Target not in sight', -20]);
  const theirMods: [string, number][] = [];
  if (terrain?.defense) {
    const cover = enemy.unitClass === 'infantry' ? Math.floor((terrain.defense * 3) / 2) : enemy.unitClass === 'armor' ? Math.floor(terrain.defense / 2) : terrain.defense;
    theirMods.push([`${terrain.name} cover`, cover]);
  }
  const theirGov = enemyNation ? nationModifiers({ government: enemyNation.government, research: { current: null, progress: 0, unlocked: [] } }) : null;
  if (theirGov?.homeDefense && tile.owner === enemy.owner) theirMods.push(['Defending home ground', theirGov.homeDefense]);
  const ourLoss = assault?.attackerLoss ?? [0, 0];
  const theirLoss = assault?.defenderLoss ?? strike?.loss ?? [0, 0];
  const bar = (now: number, loss: readonly [number, number], color: string, label: string, sub: string) => {
    const after = [Math.max(0, now - loss[1]), Math.max(0, now - loss[0])];
    return (
      <div>
        <div className="flex justify-between text-[10px]">
          <span className="font-semibold text-text">{label}</span>
          <span className="font-mono text-muted">{sub}</span>
        </div>
        <div className="relative mt-0.5 h-2.5 bg-ink-700">
          <div className="absolute inset-y-0 left-0 bg-hostile/70" style={{ width: `${now / 10}%` }} />
          <div className="absolute inset-y-0 left-0 opacity-50" style={{ width: `${after[1]! / 10}%`, background: color }} />
          <div className="absolute inset-y-0 left-0" style={{ width: `${after[0]! / 10}%`, background: color }} />
        </div>
      </div>
    );
  };
  const outcomes = assault?.outcomes ?? [];
  const confidence = assault?.confidence ?? strike?.confidence ?? 'blind';
  return (
    <div className="w-72 border-2 border-hostile/70 bg-ink-950/95 text-[11px] shadow-2xl backdrop-blur" data-testid="combat-preview">
      <div className="flex items-center justify-between bg-hostile/20 px-3 py-1.5">
        <span className="font-display text-[10px] font-black tracking-[0.06em] text-hostile uppercase">{ranged ? 'Strike' : 'Assault'}</span>
        <span className="text-[10px] text-muted">{confidence} intel</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-2.5">
        <div className="flex flex-col items-center text-center">
          <UnitGlyph unitClass={f.unitClass} color={view.self.color} className="h-5 w-8" />
          <div className="mt-1 leading-tight font-bold">{f.name}</div>
        </div>
        <div className="font-display text-lg font-black text-faint">VS</div>
        <div className="flex flex-col items-center text-center">
          <UnitGlyph unitClass={enemy.unitClass} color={enemyNation?.color ?? '#888'} className="h-5 w-8" />
          <div className="mt-1 leading-tight font-bold" style={{ color: enemyNation?.color }}>
            {enemies.length > 1 ? `${enemies.length} formations` : UNITS[enemy.unitClass].name}
          </div>
        </div>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {!ranged && bar(f.strength, ourLoss, 'var(--color-good)', 'Your strength', `−${ourLoss[0]}–${ourLoss[1]}`)}
        {bar(Math.min(1000, theirStrength), theirLoss, enemyNation?.color ?? '#888', 'Their strength (est.)', `−${theirLoss[0]}–${theirLoss[1]}`)}
      </div>
      {outcomes.length > 0 && (
        <div className="border-t border-line px-3 py-1.5 text-center">
          <span className="font-display text-[10px] tracking-[0.06em] text-faint uppercase">Likely result </span>
          {outcomes.map((o, i) => (
            <span key={o} className={`font-display font-black ${OUTCOME_TEXT[o]?.[1]}`}>
              {i > 0 && <span className="font-normal text-faint"> or </span>}
              {OUTCOME_TEXT[o]?.[0]}
            </span>
          ))}
        </div>
      )}
      {(mods.length > 0 || theirMods.length > 0) && (
        <div className="grid grid-cols-2 gap-x-3 border-t border-line px-3 py-1.5 text-[10px]">
          <ul>
            {mods.map(([l, n]) => (
              <li key={l} className={n >= 0 ? 'text-good' : 'text-hostile'}>
                {n > 0 ? '+' : ''}
                {n}% {l}
              </li>
            ))}
          </ul>
          <ul className="text-right">
            {theirMods.map(([l, n]) => (
              <li key={l} className="text-hostile">
                +{n}% {l}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-line bg-ink-900 px-3 py-1 text-center text-[10px] text-muted">Right-click to {ranged ? 'strike' : 'attack'}</div>
    </div>
  );
}

/** Replay transport: phases you can jump to, pause, speed, progress, skip. */
function ReplayBar() {
  const playback = useGame((s) => s.playback)!;
  const finishPlayback = useGame((s) => s.finishPlayback);
  const { paused, speed, marks, progress } = useReplay();
  // A replay closed while paused leaves the next one playing.
  useEffect(() => () => useReplay.setState({ paused: false }), []);
  const steps = ['movement', 'combat', 'aftermath'] as const;
  const btn = 'border border-line px-2 py-1 text-[11px] text-muted hover:border-faint hover:text-text';
  return (
    <div className="resolving-banner absolute top-3 left-1/2 z-10 -translate-x-1/2 overflow-hidden border border-signal/70 bg-ink-950/92 px-4 pt-2 pb-2.5" role="status" data-testid="replay">
      <div className="flex items-center gap-4">
        <div>
          <div className="font-display text-[10px] font-bold tracking-[0.1em] text-signal uppercase">
            Turn {playback.before.turn} · {playback.rewatch ? 'rewatch' : 'replay'}
          </div>
          <div className="flex gap-3 text-xs font-semibold">
            {steps.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => useReplay.setState({ seek: marks[p] })}
                className={`capitalize transition-colors hover:text-signal ${p === playback.phase ? 'text-text' : steps.indexOf(p) < steps.indexOf(playback.phase) ? 'text-faint line-through' : 'text-faint'}`}
                title={`Jump to ${p}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => useReplay.setState({ seek: 0, paused: false })} className={btn} title="Restart" aria-label="Restart replay">
            ⟲
          </button>
          <button type="button" onClick={() => useReplay.setState({ paused: !paused })} className={`${btn} w-8 ${paused ? 'border-signal text-signal' : ''}`} title="Pause / play (Space)" aria-pressed={paused} data-testid="replay-pause">
            <Icon name={paused ? 'play' : 'pause'} className="h-3 w-3" />
          </button>
          {[0.5, 1, 2].map((x) => (
            <button key={x} type="button" onClick={() => useReplay.setState({ speed: x })} className={`${btn} font-mono ${speed === x ? 'border-signal text-signal' : ''}`} aria-pressed={speed === x}>
              {x}×
            </button>
          ))}
        </div>
        <button type="button" onClick={finishPlayback} className={btn} data-testid="skip-replay">
          {playback.rewatch ? 'Done' : 'Skip'} <span className="font-mono text-[9px] text-faint">Esc</span>
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-700">
        <div className="h-full bg-signal" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

export function HoverCard() {
  const view = useGame((s) => s.view)!;
  const key = useGame((s) => s.hoverHex);
  const fid = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const resolving = useGame((s) => s.resolving);
  const cam = useCamera((s) => s.camera);
  const f = fid ? view.formations[fid] : undefined;
  const reach = useMemo(() => (f ? reachFor(view, f) : null), [view, f]);
  if (!key) return null;
  const t = view.tiles[key];
  if (!t) return null;
  const p = center(key);
  const x = cam.x + p.x * cam.scale;
  const y = cam.y + p.y * cam.scale;
  const own = Object.values(view.formations).filter((o) => o.key === key);
  const hostiles = hostilesAt(view, key);
  const others = Object.values(view.contacts).filter((c) => c.key === key);
  let action: { ok: boolean; text: string } | null = null;
  if (f && reach && !resolving && key !== f.key) {
    const r = orderForClick(view, f, key, mode, reach);
    action = 'error' in r ? { ok: false, text: r.error } : { ok: true, text: r.label.replace(/\d+,-?\d+|-?\d+,\d+/, hexLabel(view, key)) };
  }
  const threatCount = threatZones(view).get(key) ?? 0;
  const flip = x > cam.width - 320;
  const combat = f && reach && !resolving && hostiles.length > 0 && action?.ok;
  if (combat) {
    return (
      <div className="pointer-events-none absolute z-10" style={{ left: flip ? x - 288 - HEX_SIZE * cam.scale : x + HEX_SIZE * cam.scale, top: Math.max(8, Math.min(y - 60, cam.height - 300)) }}>
        <CombatCard fid={f.id} target={key} />
      </div>
    );
  }
  return (
    <div
      className="pointer-events-none absolute z-10 w-52 ds-panel px-2.5 py-2 text-[11px] shadow-xl backdrop-blur"
      style={{ left: flip ? x - 208 - HEX_SIZE * cam.scale : x + HEX_SIZE * cam.scale, top: Math.max(8, Math.min(y - 20, cam.height - 140)) }}
      data-testid="hover-card"
    >
      <div className="font-semibold text-text">{hexLabel(view, key)}</div>
      <div className="text-muted">
        {t.terrain ? `${TERRAIN[t.terrain].name}${TERRAIN[t.terrain].defense ? `, +${TERRAIN[t.terrain].defense}% def` : ''}${t.river ? ', river' : ''}` : 'Unknown ground'}
        {t.visibility === 'observed' && <span className="text-faint"> · seen turn {t.lastObserved}</span>}
      </div>
      {t.owner && (
        <div className="mt-0.5 flex items-center gap-1.5 text-muted">
          <Swatch color={view.nations[t.owner]?.color ?? '#888'} />
          {view.nations[t.owner]?.name}
        </div>
      )}
      {threatCount > 0 && (
        <div className="mt-0.5 font-semibold text-hostile" data-testid="hover-threat">
          <Icon name="alert" className="mr-1 h-3 w-3 align-[-2px]" />{threatCount} enemy {threatCount === 1 ? 'unit' : 'units'} could strike here next turn
        </div>
      )}
      {(own.length > 0 || others.length > 0) && (
        <div className="mt-1 border-t border-line/60 pt-1">
          {own.map((o) => (
            <div key={o.id} className="flex justify-between">
              <span>{o.name}</span>
              <span className="font-mono text-faint">{Math.round(o.strength / 10)}%</span>
            </div>
          ))}
          {others.map((c) => (
            <div key={c.formation} className="flex justify-between" style={{ color: view.nations[c.owner]?.color }}>
              <span>
                {UNITS[c.unitClass].name}
                {c.confirmed ? '' : ' (last seen)'}
              </span>
              <span className="font-mono">~{Math.round(c.estimatedStrength / 10)}%</span>
            </div>
          ))}
        </div>
      )}
      {action && (
        <div className={`mt-1 border-t border-line/60 pt-1 font-semibold ${action.ok ? (hostiles.length || mode === 'attack' ? 'text-hostile' : 'text-signal') : 'text-faint'}`}>
          {action.text}
        </div>
      )}
    </div>
  );
}

export function ZoomControls({ onHelp }: { onHelp?: () => void }) {
  const control = useCamera((s) => s.control);
  const showThreat = useGame((s) => s.showThreat);
  const toggleThreat = useGame((s) => s.toggleThreat);
  const btn = 'flex h-7 w-7 items-center justify-center border border-line bg-ink-900/90 text-sm text-muted hover:border-faint hover:text-text';
  return (
    <div className="absolute top-3 right-3 z-10 flex gap-1" aria-label="Map zoom">
      <button type="button" className={btn} onClick={() => control?.zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in">
        +
      </button>
      <button type="button" className={btn} onClick={() => control?.zoomBy(0.8)} title="Zoom out (−)" aria-label="Zoom out">
        −
      </button>
      <button type="button" className={`${btn} text-[10px] font-bold`} onClick={() => control?.fit()} title="Fit map (F)" aria-label="Fit map" data-testid="map-fit">
        FIT
      </button>
      <button
        type="button"
        className={`${btn} text-[10px] font-bold ${showThreat ? 'border-hostile bg-hostile/20 text-hostile' : ''}`}
        onClick={toggleThreat}
        title="Threat: where seen enemies could strike next turn (V)"
        aria-pressed={showThreat}
        data-testid="toggle-threat"
      >
        <Icon name="alert" />
      </button>
      {onHelp && (
        <button type="button" className={btn} onClick={onHelp} title="Controls (?)" aria-label="Controls" data-testid="help">
          ?
        </button>
      )}
    </div>
  );
}

export function Minimap() {
  const view = useGame((s) => s.view)!;
  const cam = useCamera((s) => s.camera);
  const control = useCamera((s) => s.control);
  const geo = useMemo(() => {
    const keys = Object.keys(view.tiles).sort();
    const pts = keys.map(center);
    const minX = Math.min(...pts.map((p) => p.x)) - HEX_SIZE;
    const maxX = Math.max(...pts.map((p) => p.x)) + HEX_SIZE;
    const minY = Math.min(...pts.map((p) => p.y)) - HEX_SIZE;
    const maxY = Math.max(...pts.map((p) => p.y)) + HEX_SIZE;
    return { keys, minX, minY, w: maxX - minX, h: maxY - minY };
  }, [view.tiles]);
  const vx = -cam.x / cam.scale;
  const vy = -cam.y / cam.scale;
  const vw = cam.width / cam.scale;
  const vh = cam.height / cam.scale;
  return (
    <div className="w-full ds-panel p-1" data-testid="minimap">
      <svg
        viewBox={`${geo.minX} ${geo.minY} ${geo.w} ${geo.h}`}
        style={{ aspectRatio: `${geo.w} / ${geo.h}` }}
        className="block w-full cursor-crosshair"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          control?.centerOn(geo.minX + ((e.clientX - r.left) / r.width) * geo.w, geo.minY + ((e.clientY - r.top) / r.height) * geo.h);
        }}
        role="img"
        aria-label="Minimap: click to move the camera"
      >
        {geo.keys.map((k) => {
          const t = view.tiles[k]!;
          const fill =
            t.visibility === 'unknown' ? '#1a2333' : t.owner ? (view.nations[t.owner]?.color ?? '#555') : t.terrain === 'water' ? '#1d3147' : '#3a4536';
          return (
            <polygon
              key={k}
              points={hexCorners(center(k), HEX_SIZE - 2)
                .map((p) => `${p.x},${p.y}`)
                .join(' ')}
              fill={fill}
              opacity={t.visibility === 'visible' ? (t.owner ? 0.8 : 0.9) : t.visibility === 'unknown' ? 1 : 0.5}
            />
          );
        })}
        {Object.values(view.sites).map((s) =>
          s.kind === 'capital' || s.kind === 'objective' ? (
            <circle key={s.id} cx={center(s.key).x} cy={center(s.key).y} r={9} fill={s.kind === 'objective' ? '#e0a84a' : '#e6e1d3'} stroke="#070b12" strokeWidth={4} />
          ) : null,
        )}
        {Object.values(view.contacts).map((c) => (
          <rect key={c.formation} x={center(c.key).x - 6} y={center(c.key).y - 6} width={12} height={12} fill="#d9534f" opacity={c.confirmed ? 1 : 0.45} />
        ))}
        <rect x={vx} y={vy} width={vw} height={vh} fill="none" stroke="#e0a84a" strokeWidth={6} opacity={0.9} />
      </svg>
    </div>
  );
}

export function Toasts() {
  const notices = useGame((s) => s.notices);
  const dismiss = useGame((s) => s.dismiss);
  return (
    <ul className="absolute top-14 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5" aria-live="polite">
      {notices.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className={`toast-in border bg-ink-950/95 px-3 py-1.5 text-xs shadow-xl ${n.tone === 'error' ? 'border-hostile/60 text-hostile' : n.tone === 'warn' ? 'border-signal/60 text-signal' : 'border-line text-text'}`}
          >
            {n.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
