import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { Formation, FormationOrder, HexKey, NationView, Terrain, UnitClass } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { hexCorners, hexToPixel, keyOf, neighborKeys, parseKey, pixelToHex, type Point, type Reach } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { COUNTER_H, COUNTER_W, drawCounter } from './counters';
import { buildTimeline, playReplay } from './replay';
import { hostilesAt, orderForClick, reachFor, type Mode } from './planning';
import { useGame } from './store';

const SIZE = HEX_SIZE;

const TERRAIN_COLOR: Record<Terrain, number> = {
  plains: 0x6b7a4f,
  forest: 0x3f5a3a,
  hills: 0x857356,
  mountains: 0x77736e,
  urban: 0x5d6068,
  water: 0x1b3a55,
};

const MOVE = 0x7fd3ff;
const ATTACK = 0xe0523e;

const hex = (n: string) => Number.parseInt(n.replace('#', ''), 16);

function center(key: HexKey) {
  return hexToPixel(parseKey(key), SIZE);
}

function poly(key: HexKey, shrink = 0): number[] {
  return hexCorners(center(key), SIZE - shrink).flatMap((p) => [p.x, p.y]);
}

/** The edge of `key` facing neighbour `other`: its two corners nearest the neighbour's centre. */
function edge(key: HexKey, other: HexKey, shrink = 0): [Point, Point] {
  const o = center(other);
  const [a, b] = hexCorners(center(key), SIZE - shrink)
    .map((p) => ({ p, d: (p.x - o.x) ** 2 + (p.y - o.y) ** 2 }))
    .sort((x, y) => x.d - y.d);
  return [a!.p, b!.p];
}

/** Small deterministic jitter per hex so terrain art does not tile visibly. */
function jitter(key: HexKey, i: number): number {
  let h = 2166136261;
  for (const ch of `${key}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

function drawTerrainArt(g: Graphics, key: HexKey, t: Terrain) {
  const c = center(key);
  if (t === 'forest') {
    for (let i = 0; i < 6; i++) {
      const x = c.x + jitter(key, i) * SIZE * 1.1;
      const y = c.y + jitter(key, i + 10) * SIZE * 0.9 + 4;
      g.poly([x - 5, y + 4, x, y - 8, x + 5, y + 4]).fill({ color: 0x24402a });
      g.poly([x - 4, y, x, y - 10, x + 4, y]).fill({ color: 0x2f5536 });
    }
  } else if (t === 'hills') {
    for (const [dx, dy, r] of [
      [-8, 5, 10],
      [7, 1, 12],
    ] as const) {
      g.ellipse(c.x + dx, c.y + dy, r, r * 0.55).fill({ color: 0x9a8665 });
      g.ellipse(c.x + dx + 2, c.y + dy + 2, r * 0.8, r * 0.35).fill({ color: 0x6f5f45, alpha: 0.6 });
    }
  } else if (t === 'mountains') {
    for (const [dx, h, w] of [
      [-9, 17, 11],
      [6, 22, 13],
    ] as const) {
      const bx = c.x + dx;
      const by = c.y + 9;
      g.poly([bx - w, by, bx, by - h, bx + w, by]).fill({ color: 0x9c958c });
      g.poly([bx, by - h, bx + w, by, bx + 2, by]).fill({ color: 0x6f6a63 });
      g.poly([bx - w * 0.32, by - h * 0.68, bx, by - h, bx + w * 0.32, by - h * 0.68]).fill({ color: 0xf2f0ea });
    }
  } else if (t === 'urban') {
    for (let i = 0; i < 6; i++) {
      const x = c.x + ((i % 3) - 1) * 9 + jitter(key, i) * 3;
      const y = c.y + (Math.floor(i / 3) - 0.5) * 11 + 3;
      const h = 6 + (jitter(key, i + 5) + 0.5) * 7;
      g.rect(x - 3.5, y - h, 7, h).fill({ color: 0x8b8f99 }).stroke({ width: 0.8, color: 0x3d4048 });
    }
  } else if (t === 'plains') {
    for (let i = 0; i < 4; i++) {
      const x = c.x + jitter(key, i) * SIZE;
      const y = c.y + jitter(key, i + 7) * SIZE * 0.8;
      g.moveTo(x - 2, y).lineTo(x, y - 4).lineTo(x + 2, y).stroke({ width: 1, color: 0x8a9a63, alpha: 0.7 });
    }
  }
}

function drawPath(g: Graphics, from: HexKey, order: FormationOrder, color: number, alpha: number, dashed = false) {
  const path = 'path' in order ? order.path : [];
  const pts = [from, ...path].map(center);
  if (pts.length > 1) {
    if (dashed) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        for (let s = 0; s < 1; s += 0.34) {
          const p = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
          const q = { x: a.x + (b.x - a.x) * Math.min(1, s + 0.2), y: a.y + (b.y - a.y) * Math.min(1, s + 0.2) };
          g.moveTo(p.x, p.y).lineTo(q.x, q.y);
        }
      }
      g.stroke({ width: 4, color, alpha, cap: 'round' });
    } else {
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 7, color: 0x070b12, alpha: alpha * 0.5, cap: 'round', join: 'round' });
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 3.5, color, alpha, cap: 'round', join: 'round' });
    }
    const end = pts.at(-1)!;
    const prev = pts.at(-2)!;
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    const tip = (d: number, a: number) => ({ x: end.x + Math.cos(ang + a) * d, y: end.y + Math.sin(ang + a) * d });
    const p1 = tip(-11, 0.5);
    const p2 = tip(-11, -0.5);
    g.poly([end.x, end.y, p1.x, p1.y, p2.x, p2.y]).fill({ color, alpha });
  }
  if (order.type === 'attack') {
    const t = center(order.target);
    const last = pts.at(-1)!;
    if (last.x !== t.x || last.y !== t.y) g.moveTo(last.x, last.y).lineTo(t.x, t.y).stroke({ width: 3.5, color: ATTACK, alpha });
    drawCrosshair(g, t, ATTACK, alpha);
  }
}

function drawCrosshair(g: Graphics, c: Point, color: number, alpha: number) {
  g.circle(c.x, c.y, SIZE * 0.55).stroke({ width: 3, color, alpha });
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    g.moveTo(c.x + dx * SIZE * 0.35, c.y + dy * SIZE * 0.35)
      .lineTo(c.x + dx * SIZE * 0.75, c.y + dy * SIZE * 0.75)
      .stroke({ width: 2.5, color, alpha });
  }
}

/** The order a right-click (or a click in the current mode) on `key` means for `f`. */
export function contextualOrder(view: NationView, f: Formation, key: HexKey, mode: Mode, reach: Record<HexKey, Reach>, rightClick: boolean) {
  const m: Mode = hostilesAt(view, key).length > 0 ? 'attack' : rightClick && mode === 'attack' ? 'move' : mode;
  return orderForClick(view, f, key, m, reach);
}

declare global {
  interface Window {
    __brink?: { hexToClient(key: HexKey): { x: number; y: number }; reachable(): HexKey[] };
  }
}

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<{ app: Application; world: Container; layers: Record<string, Container> } | null>(null);
  const hover = useRef<HexKey | null>(null);
  /** Set once the player pans or zooms; until then the map refits to its container. */
  const userMoved = useRef(false);
  const reachCache = useRef<{ view: NationView; id: string; reach: Record<HexKey, Reach> } | null>(null);
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const submitted = useGame((s) => s.submitted);
  const report = useGame((s) => s.report);
  const selectedHex = useGame((s) => s.selectedHex);
  const selectedFormation = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const focus = useGame((s) => s.focus);

  /** Reach for the selected formation, cached per view. */
  function currentReach(): { f: Formation; reach: Record<HexKey, Reach> } | null {
    const s = useGame.getState();
    const v = s.view;
    const f = v && s.selectedFormation ? v.formations[s.selectedFormation] : undefined;
    if (!v || !f || s.playback) return null;
    const c = reachCache.current;
    if (c && c.view === v && c.id === f.id) return { f, reach: c.reach };
    const reach = reachFor(v, f);
    reachCache.current = { view: v, id: f.id, reach };
    return { f, reach };
  }

  // Create the Pixi application once.
  useEffect(() => {
    const el = host.current!;
    let destroyed = false;
    let resize: ResizeObserver | null = null;
    const app = new Application();
    void app.init({ resizeTo: el, background: 0x0a0f18, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 }).then(() => {
      if (destroyed) {
        app.destroy(true);
        return;
      }
      el.appendChild(app.canvas);
      app.canvas.setAttribute('data-testid', 'map-canvas');
      app.canvas.setAttribute('aria-label', 'Strategic map');
      const world = new Container();
      app.stage.addChild(world);
      const layers: Record<string, Container> = {};
      for (const name of ['terrain', 'overlay', 'sites', 'highlight', 'paths', 'units', 'anim', 'hover']) {
        layers[name] = new Container();
        world.addChild(layers[name]);
      }
      appRef.current = { app, world, layers };
      wireInput(app, world);
      redraw();
      redrawHover();
      const v = useGame.getState().view;
      if (v) fitTo(v);
      useCamera.setState({
        control: {
          zoomBy: (f) => {
            userMoved.current = true;
            zoomAt(app.screen.width / 2, app.screen.height / 2, f);
          },
          fit: () => {
            userMoved.current = false;
            const cur = useGame.getState().view;
            if (cur) fitTo(cur);
          },
          centerOn: (x, y) => {
            userMoved.current = true;
            world.position.set(app.screen.width / 2 - x * world.scale.x, app.screen.height / 2 - y * world.scale.y);
            publish();
          },
        },
      });
      resize = new ResizeObserver(() => {
        app.resize();
        const cur = useGame.getState().view;
        if (!userMoved.current && cur) fitTo(cur);
        else publish();
      });
      resize.observe(el);
    });
    return () => {
      destroyed = true;
      resize?.disconnect();
      useCamera.setState({ control: null });
      if (appRef.current) {
        appRef.current.app.destroy(true);
        appRef.current = null;
      }
      delete window.__brink;
    };
  }, []);

  function toWorld(clientX: number, clientY: number) {
    const a = appRef.current!;
    const rect = a.app.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - a.world.x) / a.world.scale.x, y: (clientY - rect.top - a.world.y) / a.world.scale.y };
  }

  function hexAt(clientX: number, clientY: number): HexKey | null {
    const key = keyOf(pixelToHex(toWorld(clientX, clientY), SIZE));
    return useGame.getState().view?.tiles[key] ? key : null;
  }

  function publish() {
    const a = appRef.current;
    if (!a) return;
    useCamera.setState({ camera: { x: a.world.x, y: a.world.y, scale: a.world.scale.x, width: a.app.screen.width, height: a.app.screen.height } });
  }

  function zoomAt(px: number, py: number, factor: number) {
    const a = appRef.current;
    if (!a) return;
    const w = a.world;
    const bx = (px - w.x) / w.scale.x;
    const by = (py - w.y) / w.scale.y;
    const s = Math.min(3, Math.max(0.4, w.scale.x * factor));
    w.scale.set(s);
    w.position.set(px - bx * s, py - by * s);
    publish();
  }

  function fitTo(v: NationView) {
    const a = appRef.current;
    if (!a) return;
    const pts = Object.keys(v.tiles).map(center);
    const minX = Math.min(...pts.map((p) => p.x)) - SIZE;
    const maxX = Math.max(...pts.map((p) => p.x)) + SIZE;
    const minY = Math.min(...pts.map((p) => p.y)) - SIZE;
    const maxY = Math.max(...pts.map((p) => p.y)) + SIZE;
    const w = a.app.screen.width;
    const h = a.app.screen.height;
    const s = Math.min(w / (maxX - minX), h / (maxY - minY), 1.6);
    a.world.scale.set(s);
    a.world.position.set((w - (maxX - minX) * s) / 2 - minX * s, (h - (maxY - minY) * s) / 2 - minY * s);
    publish();
  }

  function wireInput(app: Application, world: Container) {
    const canvas = app.canvas;
    let down: { x: number; y: number; wx: number; wy: number; button: number } | null = null;
    let dragged = false;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, wx: world.x, wy: world.y, button: e.button };
      dragged = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
        if (dragged) {
          userMoved.current = true;
          world.position.set(down.wx + dx, down.wy + dy);
          publish();
        }
      }
      const k = hexAt(e.clientX, e.clientY);
      if (k !== hover.current) {
        hover.current = k;
        redrawHover();
        useGame.getState().setHover(k);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      hover.current = null;
      redrawHover();
      useGame.getState().setHover(null);
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasDrag = dragged;
      const button = down?.button ?? e.button;
      down = null;
      if (wasDrag) return;
      const k = hexAt(e.clientX, e.clientY);
      if (!k) return;
      if (button === 0) onHexClick(k, false);
      else if (button === 2) onHexClick(k, true);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        userMoved.current = true;
        const rect = canvas.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false },
    );
    window.__brink = {
      hexToClient(key) {
        const p = center(key);
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + world.x + p.x * world.scale.x, y: rect.top + world.y + p.y * world.scale.y };
      },
      reachable() {
        const r = currentReach();
        return r ? Object.keys(r.reach).filter((k) => k !== r.f.key).sort() : [];
      },
    };
  }

  /** Left-click selects, or orders in the current mode; right-click always orders by context. */
  function onHexClick(key: HexKey, right: boolean) {
    const s = useGame.getState();
    const v = s.view;
    if (!v || s.playback) return;
    const r = currentReach();
    const own = Object.values(v.formations)
      .filter((o) => o.key === key)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (r && !s.resolving) {
      const { f, reach } = r;
      // Left-click on a hex holding our own units (that is not a move target) cycles selection.
      const selectHere = !right && own.length > 0 && hostilesAt(v, key).length === 0 && (key === f.key || (s.mode === 'move' && !reach[key]));
      if (!selectHere && !(right && key === f.key)) {
        const result = contextualOrder(v, f, key, s.mode, reach, right);
        if ('error' in result) {
          // A right-click is a command, so say why it failed; a left-click elsewhere just inspects.
          if (right) {
            s.notify(result.error, 'warn');
            return;
          }
        } else {
          s.selectHex(key);
          s.issueOrder(f.id, result.order);
          return;
        }
      }
      if (right) {
        s.selectFormation(null);
        return;
      }
      if (own.length) {
        const i = own.findIndex((o) => o.id === f.id);
        s.selectFormation(own[(i + 1) % own.length]!.id);
        s.selectHex(key);
        return;
      }
    }
    if (right) {
      s.selectFormation(null);
      return;
    }
    s.selectHex(key);
    if (own[0]) s.selectFormation(own[0].id);
    else {
      s.selectFormation(null);
      const site = v.tiles[key]?.siteId;
      if (site && v.sites[site]?.owner === v.self.id && v.sites[site]?.kind !== 'objective') s.openCity(site);
    }
  }

  /** Hover: outline, and with a unit selected the path or attack it would order (Civ-style). */
  function redrawHover() {
    const a = appRef.current;
    if (!a) return;
    const layer = a.layers.hover!;
    layer.removeChildren().forEach((c) => c.destroy());
    const k = hover.current;
    if (!k) return;
    const g = new Graphics();
    const s = useGame.getState();
    const v = s.view;
    const r = currentReach();
    if (v && r && !s.resolving && k !== r.f.key) {
      const result = contextualOrder(v, r.f, k, s.mode, r.reach, false);
      if (!('error' in result)) {
        const attack = result.order.type === 'attack';
        drawPath(g, r.f.key, result.order, attack ? ATTACK : MOVE, 0.95, true);
        if (!attack) g.poly(poly(k, 2)).stroke({ width: 3, color: MOVE, alpha: 0.95 });
      } else {
        g.poly(poly(k, 2)).stroke({ width: 2.5, color: 0x8a8f99, alpha: 0.6 });
      }
    } else {
      g.poly(poly(k, 1.5)).fill({ color: 0xffffff, alpha: 0.07 }).stroke({ width: 2, color: 0xe8e2d0, alpha: 0.6 });
    }
    layer.addChild(g);
  }

  function redraw() {
    const a = appRef.current;
    const s = useGame.getState();
    // While a turn replays, the board shows the world it was planned against.
    const v = s.playback?.before ?? s.view;
    const replaying = s.playback !== null;
    if (!a || !v) return;
    for (const name of ['terrain', 'overlay', 'sites', 'highlight', 'paths', 'units']) {
      a.layers[name]!.removeChildren().forEach((c) => c.destroy());
    }
    const keys = Object.keys(v.tiles).sort();

    // Terrain and rivers.
    const terrain = new Graphics();
    const art = new Graphics();
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown' || !t.terrain) {
        terrain.poly(poly(key, 1)).fill({ color: 0x111a27 }).stroke({ width: 1, color: 0x223047, alpha: 0.9 });
        continue;
      }
      terrain.poly(poly(key)).fill({ color: TERRAIN_COLOR[t.terrain] }).stroke({ width: 1, color: 0x0a0f18, alpha: 0.35 });
      // Light from the north-west: a soft highlight on the upper half of each hex.
      terrain.poly(poly(key, 6)).fill({ color: 0xffffff, alpha: 0.035 });
      if (t.terrain === 'water') {
        for (const n of neighborKeys(key)) {
          const u = v.tiles[n];
          if (u?.terrain && u.terrain !== 'water') {
            const [p, q] = edge(key, n, 2);
            terrain.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 4, color: 0x5c8fb3, alpha: 0.6 });
          }
        }
      } else drawTerrainArt(art, key, t.terrain);
    }
    const water = new Graphics();
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (!t.terrain) continue;
      const c = center(key);
      for (const n of neighborKeys(key)) {
        const u = v.tiles[n];
        if (!u?.terrain || n < key) continue;
        const d = center(n);
        if (t.river && u.river) {
          const mx = (c.x + d.x) / 2 + jitter(key + n, 1) * 8;
          const my = (c.y + d.y) / 2 + jitter(key + n, 2) * 8;
          water.moveTo(c.x, c.y).quadraticCurveTo(mx, my, d.x, d.y).stroke({ width: 7, color: 0x2c5c85, cap: 'round' });
          water.moveTo(c.x, c.y).quadraticCurveTo(mx, my, d.x, d.y).stroke({ width: 3.5, color: 0x6aa6d3, cap: 'round' });
        }
      }
    }
    a.layers.terrain!.addChild(terrain, water, art);

    // Ownership: tint and Civ-style thick borders, fog on stale ground.
    const overlay = new Graphics();
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown') continue;
      if (t.owner) {
        const color = hex(v.nations[t.owner]?.color ?? '#888888');
        overlay.poly(poly(key, 1)).fill({ color, alpha: t.visibility === 'visible' ? 0.2 : 0.12 });
        for (const n of neighborKeys(key)) {
          if (v.tiles[n]?.owner === t.owner) continue;
          const [p, q] = edge(key, n, 2.5);
          overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 4, color, alpha: 0.95, cap: 'round' });
        }
      }
      if (t.visibility === 'observed') overlay.poly(poly(key)).fill({ color: 0x05080e, alpha: 0.45 });
    }
    a.layers.overlay!.addChild(overlay);

    // Site markers. Names are HTML city banners; only depots get a small label here.
    const sites = new Graphics();
    for (const id of Object.keys(v.sites).sort()) {
      const site = v.sites[id]!;
      const c = center(site.key);
      const color = site.owner ? hex(v.nations[site.owner]?.color ?? '#999999') : 0xd8d2c0;
      if (site.kind === 'objective') {
        sites.circle(c.x, c.y, SIZE * 0.62).stroke({ width: 2.5, color: 0xe0b44a, alpha: 0.9 });
        sites.poly([c.x, c.y - 9, c.x + 9, c.y, c.x, c.y + 9, c.x - 9, c.y]).fill({ color: 0x0a0f18 }).stroke({ width: 2.5, color: 0xe0b44a });
      } else if (site.kind === 'depot') {
        sites.poly([c.x - 8, c.y + 7, c.x, c.y - 8, c.x + 8, c.y + 7]).fill({ color: 0x0a0f18, alpha: 0.85 }).stroke({ width: 2, color });
        const label = new Text({
          text: site.name,
          resolution: 3,
          style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 8, fill: 0xe6e1d3, fontWeight: '600', stroke: { color: 0x070b12, width: 3, join: 'round' } },
        });
        label.anchor.set(0.5, 0);
        label.position.set(c.x, c.y + SIZE * 0.55);
        label.alpha = 0.8;
        a.layers.sites!.addChild(label);
      } else {
        sites.poly(poly(site.key, 3)).stroke({ width: 2, color, alpha: 0.85 });
      }
    }
    a.layers.sites!.addChildAt(sites, 0);

    // Movement range (blue, Civ-style) with a bright outer border, attackable enemies in red.
    const hl = new Graphics();
    const r = replaying ? null : currentReach();
    if (r) {
      const tint = s.mode === 'withdraw' ? 0x9fb8d9 : MOVE;
      for (const k of Object.keys(r.reach)) {
        if (k === r.f.key) continue;
        hl.poly(poly(k, 1)).fill({ color: tint, alpha: 0.16 });
        for (const n of neighborKeys(k)) {
          if (r.reach[n]) continue;
          const [p, q] = edge(k, n, 1.5);
          hl.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 2.5, color: tint, alpha: 0.9, cap: 'round' });
        }
      }
      const targets = new Set<HexKey>();
      for (const c of Object.values(v.contacts)) {
        if (v.relations[c.owner] !== 'war' || targets.has(c.key)) continue;
        const res = orderForClick(v, r.f, c.key, 'attack', r.reach);
        if (!('error' in res)) targets.add(c.key);
      }
      for (const k of targets) hl.poly(poly(k, 2)).fill({ color: ATTACK, alpha: 0.18 }).stroke({ width: 3, color: ATTACK, alpha: 0.95 });
    }
    if (s.report && !s.showReport && !replaying) {
      for (const e of s.report.events) {
        if (e.kind === 'engagement') {
          const c = center(e.location);
          hl.moveTo(c.x - 8, c.y - 8).lineTo(c.x + 8, c.y + 8).moveTo(c.x + 8, c.y - 8).lineTo(c.x - 8, c.y + 8).stroke({ width: 3, color: ATTACK, alpha: 0.6 });
        }
        if (e.kind === 'site_captured') hl.poly(poly(e.key, 2)).stroke({ width: 3, color: 0xe0b44a, alpha: 0.8 });
      }
    }
    if (s.selectedHex && !replaying) hl.poly(poly(s.selectedHex, 1)).stroke({ width: 2.5, color: 0xffffff, alpha: 0.9 });
    a.layers.highlight!.addChild(hl);

    // Planned orders: path, arrowhead and a ghost of the unit where it will end up.
    const paths = new Graphics();
    const ghosts: { key: HexKey; cls: UnitClass; strength: number }[] = [];
    const orders = s.submitted ?? s.draft;
    if (orders && !replaying) {
      for (const id of Object.keys(orders.formations).sort()) {
        const f = v.formations[id];
        const o = orders.formations[id]!;
        if (!f) continue;
        const selected = id === s.selectedFormation;
        drawPath(paths, f.key, o, s.submitted ? 0xf4f1e8 : o.type === 'attack' ? ATTACK : MOVE, selected ? 1 : 0.7);
        if ('path' in o && o.path.length > 0) ghosts.push({ key: o.path.at(-1)!, cls: f.unitClass, strength: f.strength });
        if (o.type === 'defend') {
          const c = center(f.key);
          paths.roundRect(c.x - 15, c.y + 12, 30, 6, 2).fill({ color: 0x0a0f18, alpha: 0.8 }).stroke({ width: 1.5, color: 0xe0b44a });
        }
      }
    }
    a.layers.paths!.addChild(paths);

    // Formations: own counters, then contacts, stacked per hex.
    type Marker = { cls: UnitClass; color: number; own: boolean; confirmed: boolean; strength: number; selected: boolean; ordered: boolean };
    const byHex = new Map<HexKey, Marker[]>();
    const planned = (s.submitted ?? s.draft)?.formations ?? {};
    for (const f of Object.values(v.formations).sort((x, y) => (x.id < y.id ? -1 : 1))) {
      byHex.set(f.key, [
        ...(byHex.get(f.key) ?? []),
        { cls: f.unitClass, color: hex(v.self.color), own: true, confirmed: true, strength: f.strength, selected: f.id === s.selectedFormation, ordered: !!planned[f.id] },
      ]);
    }
    for (const c of Object.values(v.contacts).sort((x, y) => (x.formation < y.formation ? -1 : 1))) {
      byHex.set(c.key, [
        ...(byHex.get(c.key) ?? []),
        { cls: c.unitClass, color: hex(v.nations[c.owner]?.color ?? '#888888'), own: false, confirmed: c.confirmed, strength: c.estimatedStrength, selected: false, ordered: false },
      ]);
    }
    const units = new Graphics();
    if (!replaying) {
      for (const gh of ghosts) {
        const c = center(gh.key);
        drawCounter(units, c.x - COUNTER_W / 2, c.y - COUNTER_H / 2 - 2, { cls: gh.cls, color: hex(v.self.color), own: true, confirmed: true, strength: gh.strength }, 0.38);
      }
    } else byHex.clear();
    for (const [key, list] of byHex) {
      const c = center(key);
      const order = [...list].sort((m, n) => Number(m.selected) - Number(n.selected));
      order.forEach((m, i) => {
        const x = c.x - COUNTER_W / 2 - 3 + i * 4;
        const y = c.y - COUNTER_H / 2 - 2 - i * 4;
        drawCounter(units, x, y, m);
        if (m.own && !m.ordered && !s.submitted) units.circle(x + COUNTER_W, y, 3.4).fill({ color: 0xe0a84a }).stroke({ width: 1.2, color: 0x070b12 });
        if (!m.confirmed && i === order.length - 1) {
          const t = new Text({ text: '?', resolution: 3, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, fontWeight: '800', fill: m.color } });
          t.anchor.set(0.5, 0.5);
          t.position.set(x + COUNTER_W + 6, y + COUNTER_H / 2);
          a.layers.units!.addChild(t);
        }
      });
      if (list.length > 1) {
        const x = c.x - COUNTER_W / 2 - 6;
        const y = c.y - COUNTER_H / 2 - 4 - (list.length - 1) * 4;
        units.circle(x, y, 6).fill({ color: 0x070b12 }).stroke({ width: 1.2, color: 0xe6e1d3 });
        const t = new Text({ text: String(list.length), resolution: 3, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 8, fontWeight: '800', fill: 0xe6e1d3 } });
        t.anchor.set(0.5, 0.5);
        t.position.set(x, y);
        a.layers.units!.addChild(t);
      }
    }
    a.layers.units!.addChildAt(units, 0);
  }

  useEffect(() => {
    redraw();
    redrawHover();
  }, [view, draft, submitted, report, selectedHex, selectedFormation, mode]);

  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      if (s.showReport !== prev.showReport || s.playback !== prev.playback) redraw();
    });
    return unsub;
  }, []);

  // Replay a resolved turn, then hand the result back to the store.
  const playback = useGame((s) => s.playback);
  const result = playback?.result;
  useEffect(() => {
    const a = appRef.current;
    const pb = useGame.getState().playback;
    if (!a || !pb) {
      if (pb) useGame.getState().finishPlayback();
      return;
    }
    const stop = playReplay(a.app, a.layers.anim!, buildTimeline(pb), {
      center,
      size: SIZE,
      onPhase: (phase) => {
        const cur = useGame.getState().playback;
        if (cur && cur.phase !== phase) useGame.setState({ playback: { ...cur, phase } });
      },
      onDone: () => useGame.getState().finishPlayback(),
    });
    return stop;
  }, [result]);

  useEffect(() => {
    const a = appRef.current;
    if (!a || !focus) return;
    const p = center(focus.key);
    const s = a.world.scale.x;
    // Only pan when the target is off-screen or near the edge, so cycling units does not jitter.
    const sx = a.world.x + p.x * s;
    const sy = a.world.y + p.y * s;
    const m = 90;
    if (sx < m || sy < m || sx > a.app.screen.width - m || sy > a.app.screen.height - m) {
      a.world.position.set(a.app.screen.width / 2 - p.x * s, a.app.screen.height / 2 - p.y * s);
      publish();
    }
  }, [focus]);

  return <div ref={host} className="absolute inset-0" />;
}

/** Unit stats line for tooltips and the unit panel. */
export function unitLine(cls: UnitClass): string {
  const d = UNITS[cls];
  return `${d.movement ? `${d.movement} MP` : 'rebases'} · atk ${d.softAttack}/${d.hardAttack} · def ${d.defense}${d.range ? ` · range ${d.range}` : ''}`;
}
