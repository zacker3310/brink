import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { HexKey, NationView } from '@brink/contracts';
import { hexCorners, hexToPixel, neighborKeys, parseKey, type Point } from '@brink/map';
import { createScenario, PACIFIC_ID, shortName } from '@brink/scenarios';
import { mainland } from '../mainland';
import { buildView } from '@brink/simulation';
import { paintTheatre } from '../paint/ground';
import { MapLife } from '../paint/life';

// The home screen's backdrop: the theatre itself, painted, at war. Fronts burn along the realm
// borders, smoke rises, clouds pass, and the camera drifts slowly over it all. Decoration only.

const SIZE = 30;
const center = (k: HexKey): Point => hexToPixel(parseKey(k), SIZE);
const hex = (c: string) => Number.parseInt(c.replace('#', ''), 16);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * Where the war is burning: edges from a realm into a rival's land or into the no-man's land
 * between realms (in the Pacific many realms are kept apart by sea), sampled
 * evenly across the map.
 */
function frontier(v: NationView): [HexKey, HexKey][] {
  const out: [HexKey, HexKey][] = [];
  for (const k of Object.keys(v.tiles).sort()) {
    const a = v.tiles[k]!.owner;
    if (!a) continue;
    for (const n of neighborKeys(k)) {
      const t = v.tiles[n];
      if (!t || t.owner === a || t.terrain === 'water') continue;
      out.push([k, n]);
    }
  }
  return out.filter(([k, n]) => hash(k + n) < 0.22).slice(0, 16);
}

function borders(v: NationView): Graphics {
  const g = new Graphics();
  for (const k of Object.keys(v.tiles).sort()) {
    const owner = v.tiles[k]!.owner;
    if (!owner) continue;
    const color = hex(v.nations[owner]?.color ?? '#888888');
    for (const n of neighborKeys(k)) {
      if (v.tiles[n]?.owner === owner) continue;
      const o = center(n);
      const [p, q] = hexCorners(center(k), SIZE - 3)
        .map((pt) => ({ pt, d: (pt.x - o.x) ** 2 + (pt.y - o.y) ** 2 }))
        .sort((x, y) => x.d - y.d)
        .map((x) => x.pt);
      g.moveTo(p!.x, p!.y).lineTo(q!.x, q!.y).stroke({ width: 11, color, alpha: 0.2, cap: 'round' });
      g.moveTo(p!.x, p!.y).lineTo(q!.x, q!.y).stroke({ width: 5, color, alpha: 0.5, cap: 'round' });
      g.moveTo(p!.x, p!.y).lineTo(q!.x, q!.y).stroke({ width: 2, color: 0xfff4dc, alpha: 0.75, cap: 'round' });
    }
  }
  return g;
}

export function TitleScene({ className = '' }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    let dead = false;
    let life: MapLife | null = null;
    const textures: Texture[] = [];
    const app = new Application();
    void app.init({ resizeTo: el, background: 0x0a2433, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 1.5) }).then(() => {
      if (dead) {
        app.destroy(true);
        return;
      }
      // A backdrop under a shade: 30 frames a second is smooth enough and halves the GPU's work.
      app.ticker.maxFPS = 30;
      el.appendChild(app.canvas);
      app.canvas.setAttribute('aria-hidden', 'true');
      const world = new Container();
      app.stage.addChild(world);
      const v = buildView(createScenario(PACIFIC_ID, 1), 'usa');
      const keys = Object.keys(v.tiles).sort();
      const painted = paintTheatre(v, keys, SIZE);
      const tex = Texture.from(painted.canvas);
      textures.push(tex);
      const ground = new Sprite(tex);
      ground.position.set(painted.x, painted.y);
      ground.scale.set(painted.unit);
      world.addChild(ground, borders(v));
      const lifeLayer = new Container();
      world.addChild(lifeLayer);
      life = new MapLife(app, lifeLayer, { center, size: SIZE });
      life.update(v, null, false);
      for (const [k, n] of frontier(v)) life.addFront(center(k), center(n), hash(n + k));
      for (const [k] of frontier(v).filter((_, i) => i % 3 === 0)) life.addFire(center(k), hash(k));
      // Realm names, engraved: drawn once the typeface is in (Pixi will not redraw unchanged text).
      // On each realm's mainland, not the average of its islands (which can fall in the sea).
      const held = new Map<string, string[]>();
      for (const k of keys) {
        const o = v.tiles[k]!.owner;
        if (o) held.set(o, [...(held.get(o) ?? []), k]);
      }
      const lands = new Map<string, Point[]>([...held].map(([o, ks]) => [o, mainland(ks).map(center)]));
      const font = document.fonts?.load("700 34px 'Cinzel'") ?? Promise.resolve();
      void Promise.race([font, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (dead) return;
      for (const [owner, pts] of lands) {
        const n = v.nations[owner]!;
        const t = new Text({
          text: shortName(n.name).toUpperCase(),
          resolution: 2,
          style: { fontFamily: "'Cinzel', Georgia, serif", fontSize: 26, fontWeight: '700', fill: 0xf6ecd0, letterSpacing: 8, stroke: { color: 0x1a1208, width: 6, join: 'round' }, dropShadow: { color: hex(n.color), blur: 14, distance: 0, alpha: 0.9 } },
        });
        t.anchor.set(0.5);
        t.alpha = 0.5;
        t.position.set(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
        world.addChild(t);
      }
      });
      // A slow flight over the theatre: wide enough to fill the screen, drifting and breathing.
      const pts = keys.map(center);
      const minX = Math.min(...pts.map((p) => p.x));
      const maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';
      // Strikes: missiles arc between rival cities, a hot head over a trail in the launcher's
      // colour, and a flash and a ring where they land.
      const strikes = new Graphics();
      world.addChild(strikes);
      const targets = Object.values(v.sites)
        .filter((s) => s.owner && (s.kind === 'capital' || s.kind === 'city'))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const flights: { a: Point; b: Point; c: Point; color: number; born: number; dur: number }[] = [];
      let nextLaunch = 1.6;
      let shot = 0;
      const bez = (f: (typeof flights)[number], u: number): Point => ({
        x: (1 - u) * (1 - u) * f.a.x + 2 * (1 - u) * u * f.c.x + u * u * f.b.x,
        y: (1 - u) * (1 - u) * f.a.y + 2 * (1 - u) * u * f.c.y + u * u * f.b.y,
      });
      const launch = (now: number) => {
        for (let tries = 0; tries < 12; tries++) {
          shot += 1;
          const from = targets[Math.floor(hash(`from${shot}`) * targets.length)];
          const to = targets[Math.floor(hash(`to${shot}`) * targets.length)];
          if (!from || !to || from.owner === to.owner) continue;
          const a = center(from.key);
          const b = center(to.key);
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d < SIZE * 6 || d > SIZE * 40) continue;
          const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - d * 0.42 };
          flights.push({ a, b, c, color: hex(v.nations[from.owner!]?.color ?? '#ffffff'), born: now, dur: 1.8 + d / (SIZE * 22) });
          return;
        }
      };
      const drawStrikes = (now: number) => {
        strikes.clear();
        for (let i = flights.length - 1; i >= 0; i--) {
          const f = flights[i]!;
          const u = (now - f.born) / f.dur;
          if (u > 1.6) {
            flights.splice(i, 1);
            continue;
          }
          const head = Math.min(1, u);
          // The trail: the last stretch of the arc, fading toward its tail (and away after impact).
          const fade = u > 1 ? Math.max(0, 1 - (u - 1) / 0.6) : 1;
          const tail = Math.max(0, head - 0.28);
          const N = 14;
          for (let k = 0; k < N; k++) {
            const p = bez(f, tail + ((head - tail) * k) / N);
            const q = bez(f, tail + ((head - tail) * (k + 1)) / N);
            const w = (k + 1) / N;
            strikes.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 1 + 3 * w, color: f.color, alpha: 0.55 * w * fade, cap: 'round' });
          }
          if (u < 1) {
            const p = bez(f, head);
            strikes.circle(p.x, p.y, 7).fill({ color: f.color, alpha: 0.35 });
            strikes.circle(p.x, p.y, 2.6).fill({ color: 0xfff6e0, alpha: 1 });
          } else {
            // Impact: a white flash, then an orange ring that spreads and fades.
            const k = (u - 1) / 0.6;
            strikes.circle(f.b.x, f.b.y, 6 + 26 * k).stroke({ width: 3, color: 0xffb347, alpha: 0.9 * (1 - k) });
            if (k < 0.35) strikes.circle(f.b.x, f.b.y, 14 * (1 - k)).fill({ color: 0xfff1d0, alpha: 0.9 * (1 - k / 0.35) });
          }
        }
      };
      let t = 0;
      app.ticker.add(() => {
        t += still ? 0 : app.ticker.deltaMS / 1000;
        if (!still) {
          if (t > nextLaunch && flights.length < 3) {
            launch(t);
            nextLaunch = t + 1.4 + hash(`gap${shot}`) * 2.2;
          }
          drawStrikes(t);
        }
        const w = app.screen.width;
        const h = app.screen.height;
        const cover = Math.max(w / (maxX - minX), h / (maxY - minY));
        const s = cover * (1.04 + Math.sin(t * 0.05) * 0.06);
        const fx = cx + Math.sin(t * 0.031) * (maxX - minX) * 0.06;
        const fy = cy + Math.cos(t * 0.023) * (maxY - minY) * 0.05;
        world.scale.set(s);
        // In portrait the menu covers the lower half: keep the heart of the war in the open top third.
        world.position.set(w / 2 - fx * s, (h > w ? h * 0.36 : h / 2) - fy * s);
      });
    });
    return () => {
      dead = true;
      life?.destroy();
      if (app.renderer) app.destroy(true);
      for (const x of textures) x.destroy(true);
    };
  }, []);
  return <div ref={host} className={className} />;
}
