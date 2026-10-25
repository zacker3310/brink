import { memo, useMemo } from 'react';
import type { HexKey, NationId, Terrain, WorldState } from '@brink/contracts';
import { hexCorners, hexToPixel, neighborKeys, parseKey, type Point } from '@brink/map';
import { sortedKeys } from '@brink/simulation';

// A static SVG render of a world for the menus. The in-game map is Pixi; this one is cheap,
// crisp at any size, and animatable with CSS.

const SIZE = 10;

const TERRAIN_FILL: Record<Terrain, string> = {
  plains: '#3f4c38',
  forest: '#2a3f2f',
  hills: '#5a5040',
  mountains: '#6d6a66',
  urban: '#4a4e57',
  water: '#122233',
};

const center = (key: HexKey) => hexToPixel(parseKey(key), SIZE);
const pts = (c: Point, size: number) =>
  hexCorners(c, size)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');

/** The edge of `key` that faces `other`: the two corners nearest the neighbour's centre. */
function sharedEdge(key: HexKey, other: HexKey): [Point, Point] {
  const o = center(other);
  const [a, b] = hexCorners(center(key), SIZE)
    .map((p) => ({ p, d: (p.x - o.x) ** 2 + (p.y - o.y) ** 2 }))
    .sort((x, y) => x.d - y.d);
  return [a!.p, b!.p];
}

interface Props {
  world: WorldState;
  /** Highlight one nation; dim the rest. */
  focus?: NationId | null;
  labels?: boolean;
  forces?: boolean;
  className?: string;
}

export const MapPreview = memo(function MapPreview({ world, focus = null, labels = false, forces = false, className }: Props) {
  const geo = useMemo(() => {
    const keys = sortedKeys(world.tiles);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const k of keys) {
      const c = center(k);
      minX = Math.min(minX, c.x - SIZE);
      maxX = Math.max(maxX, c.x + SIZE);
      minY = Math.min(minY, c.y - SIZE);
      maxY = Math.max(maxY, c.y + SIZE);
    }
    const borders: { d: string; owner: NationId }[] = [];
    const rivers: string[] = [];
    for (const k of keys) {
      const t = world.tiles[k]!;
      for (const n of neighborKeys(k)) {
        const u = world.tiles[n];
        if (t.owner && (!u || u.owner !== t.owner)) {
          const [a, b] = u ? sharedEdge(k, n) : [null, null];
          if (a && b) borders.push({ d: `M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`, owner: t.owner });
        }
        if (t.river && u?.river && n > k) {
          const a = center(k);
          const b = center(n);
          rivers.push(`M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`);
        }
      }
    }
    const pad = SIZE;
    return { keys, borders, rivers, box: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}` };
  }, [world]);

  const colors = world.nations;
  const dim = (owner: NationId | null) => focus !== null && owner !== focus;

  return (
    <svg viewBox={geo.box} className={className} role="img" aria-label="Map of the theatre" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="mp-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g>
        {geo.keys.map((k) => {
          const t = world.tiles[k]!;
          const c = center(k);
          return <polygon key={k} points={pts(c, SIZE - 0.35)} fill={TERRAIN_FILL[t.terrain]} />;
        })}
      </g>
      <g>
        {geo.keys.map((k) => {
          const t = world.tiles[k]!;
          if (!t.owner) return null;
          return (
            <polygon
              key={k}
              points={pts(center(k), SIZE - 0.35)}
              fill={colors[t.owner]?.color}
              className="mp-tint"
              opacity={dim(t.owner) ? 0.1 : focus ? 0.42 : 0.26}
            />
          );
        })}
      </g>
      <path d={geo.rivers.join('')} stroke="#4f7fa8" strokeWidth={1.6} strokeLinecap="round" fill="none" opacity={0.8} />
      <g fill="none" strokeLinecap="round">
        {geo.borders.map((b, i) => (
          <path
            key={i}
            d={b.d}
            stroke={colors[b.owner]?.color}
            strokeWidth={b.owner === focus ? 1.8 : 1.1}
            opacity={dim(b.owner) ? 0.35 : 1}
            filter={b.owner === focus ? 'url(#mp-glow)' : undefined}
          />
        ))}
      </g>
      {forces && (
        <g>
          {sortedKeys(world.formations).map((id, i) => {
            const f = world.formations[id]!;
            const c = center(f.key);
            const off = (i % 3) - 1;
            return (
              <circle
                key={id}
                cx={c.x + off * 2.4}
                cy={c.y + 3.6}
                r={1.1}
                fill={colors[f.owner]?.color}
                className="mp-blip"
                style={{ animationDelay: `${(i * 0.37) % 4}s` }}
                opacity={dim(f.owner) ? 0.3 : 1}
              />
            );
          })}
        </g>
      )}
      <g>
        {sortedKeys(world.sites).map((id) => {
          const s = world.sites[id]!;
          const c = center(s.key);
          const color = s.owner ? colors[s.owner]?.color : '#e0a84a';
          const faded = dim(s.owner) && s.kind !== 'objective';
          return (
            <g key={id} opacity={faded ? 0.45 : 1}>
              {s.kind === 'capital' && (
                <>
                  <circle cx={c.x} cy={c.y} r={4.2} fill="none" stroke={color} strokeWidth={0.8} className="mp-pulse" />
                  <polygon points={star(c, 3.4)} fill={color} stroke="#070b12" strokeWidth={0.5} />
                </>
              )}
              {s.kind === 'city' && <rect x={c.x - 2.1} y={c.y - 2.1} width={4.2} height={4.2} fill={color} stroke="#070b12" strokeWidth={0.5} />}
              {s.kind === 'depot' && (
                <polygon points={`${c.x},${c.y - 2.2} ${c.x + 2.2},${c.y} ${c.x},${c.y + 2.2} ${c.x - 2.2},${c.y}`} fill="none" stroke={color} strokeWidth={0.8} />
              )}
              {s.kind === 'objective' && (
                <>
                  <circle cx={c.x} cy={c.y} r={5.5} fill="none" stroke="#e0a84a" strokeWidth={0.6} strokeDasharray="1.4 1.2" className="mp-spin" />
                  <circle cx={c.x} cy={c.y} r={2} fill="#e0a84a" />
                </>
              )}
              {labels && s.kind !== 'depot' && (
                <text
                  x={c.x}
                  y={c.y - 6.2}
                  textAnchor="middle"
                  fontSize={s.kind === 'city' ? 3.6 : 4.3}
                  fontWeight={600}
                  fill={s.kind === 'objective' ? '#e0a84a' : '#e6e1d3'}
                  stroke="#070b12"
                  strokeWidth={1.1}
                  paintOrder="stroke"
                  letterSpacing={0.3}
                >
                  {s.name.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
});

function star(c: Point, r: number): string {
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    out.push(`${(c.x + rr * Math.cos(a)).toFixed(2)},${(c.y + rr * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(' ');
}
