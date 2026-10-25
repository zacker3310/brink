import { useMemo } from 'react';
import type { HexKey } from '@brink/contracts';
import { TERRAIN, UNITS } from '@brink/game-data';
import { hexCorners, hexToPixel, parseKey } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { hexLabel } from './insight';
import { hostilesAt, orderForClick, reachFor, type Mode } from './planning';
import { useGame } from './store';
import { Swatch } from './ui';

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
  const f = fid ? view.formations[fid] : undefined;
  if (resolving) {
    return (
      <div className="resolving-banner pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 overflow-hidden border border-signal/70 bg-ink-950/90 px-4 py-2 text-center" role="status">
        <div className="text-[10px] font-bold tracking-[0.3em] text-signal uppercase">Orders locked</div>
        <div className="text-sm font-semibold">Resolving turn {view.turn}…</div>
      </div>
    );
  }
  if (!f) return null;
  const tone = mode === 'attack' ? 'border-hostile/70 text-hostile' : 'border-signal/60 text-signal';
  return (
    <div className={`pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 border bg-ink-950/85 px-3 py-1.5 text-xs whitespace-nowrap backdrop-blur ${tone}`}>
      <span className="font-bold tracking-[0.2em] uppercase">{UNITS[f.unitClass].ground ? mode : UNITS[f.unitClass].range ? 'strike' : 'rebase'}</span>
      <span className="ml-2 text-muted">{UNITS[f.unitClass].ground ? MODE_HINT[mode] : 'Click a target or one of your cities'} · right-click to deselect</span>
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
  const flip = x > cam.width - 240;
  return (
    <div
      className="pointer-events-none absolute z-10 w-52 border border-line bg-ink-950/92 px-2.5 py-2 text-[11px] shadow-xl backdrop-blur"
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
          {action.ok ? `▸ ${action.text}` : action.text}
        </div>
      )}
    </div>
  );
}

export function ZoomControls() {
  const control = useCamera((s) => s.control);
  const btn = 'flex h-7 w-7 items-center justify-center border border-line bg-ink-900/90 text-sm text-muted hover:border-faint hover:text-text';
  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col gap-1" aria-label="Map zoom">
      <button type="button" className={btn} onClick={() => control?.zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in">
        +
      </button>
      <button type="button" className={btn} onClick={() => control?.zoomBy(0.8)} title="Zoom out (−)" aria-label="Zoom out">
        −
      </button>
      <button type="button" className={`${btn} text-[10px] font-bold`} onClick={() => control?.fit()} title="Fit map (F)" aria-label="Fit map" data-testid="map-fit">
        FIT
      </button>
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
    <div className="absolute right-3 bottom-3 z-10 w-52 border border-line bg-ink-950/90 p-1 shadow-xl" data-testid="minimap">
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

export function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[60%] flex-wrap gap-x-3 gap-y-0.5 border border-line/70 bg-ink-950/85 px-2 py-1 text-[10px] text-muted">
      <span>
        <span className="text-signal">━</span> planned
      </span>
      <span>
        <span className="text-text">━</span> locked
      </span>
      <span>
        <span className="text-signal">●</span> no orders
      </span>
      <span>
        <span className="text-hostile">✕</span> last turn's fighting
      </span>
      <span>faded = last known</span>
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
