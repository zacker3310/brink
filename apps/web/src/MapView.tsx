import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Matrix, Sprite, Text } from 'pixi.js';
import type { Formation, FormationOrder, HexKey, NationView, UnitClass } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { hexCorners, hexToPixel, keyOf, neighborKeys, parseKey, pixelToHex, type Point, type Reach } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { addUnit, affiliationOf, keepScreenSize, setModelZoom, slotOffsets, tickModels, type CounterLook } from './counters';
import { AFFILIATION, FONT_UI, SURFACE, TEXT } from './design/tokens';
import { buildTimeline, playReplay } from './replay';
import { terrainTexture } from './design/terrain';
import { getArt, loadArt, URBAN_SPOTS } from './art';
import { threatZones } from '@brink/simulation';
import { hostilesAt, orderForClick, reachFor, type Mode } from './planning';
import { useGame } from './store';

const SIZE = HEX_SIZE;


const MOVE = AFFILIATION.friend;
const ATTACK = AFFILIATION.hostile;

const hex = (n: string) => Number.parseInt(n.replace('#', ''), 16);

function center(key: HexKey) {
  return hexToPixel(parseKey(key), SIZE);
}

/** Middle of the known map, where units face when they have nowhere to go. */
function mapMiddle(v: NationView): Point {
  const pts = Object.keys(v.tiles).map(center);
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
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
    __brink?: {
      hexToClient(key: HexKey): { x: number; y: number };
      reachable(): HexKey[];
      enemies(): HexKey[];
      formations(): { id: string; cls: UnitClass; key: HexKey }[];
    };
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
    void app.init({ resizeTo: el, background: SURFACE.ink950, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 }).then(() => {
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
      for (const name of ['terrain', 'overlay', 'threat', 'sites', 'highlight', 'paths', 'units', 'anim', 'hover']) {
        layers[name] = new Container();
        world.addChild(layers[name]);
      }
      appRef.current = { app, world, layers };
      // Rotors turn and drone teams circle whether or not anything else changes.
      app.ticker.add(() => tickModels(performance.now()));
      wireInput(app, world);
      // Imported art arrives after the first frame; redraw with it as soon as it lands.
      void loadArt().then((loaded) => {
        if (loaded && !destroyed) redraw();
      });
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
    setModelZoom(a.world.scale.x);
  }

  function zoomAt(px: number, py: number, factor: number) {
    const a = appRef.current;
    if (!a) return;
    const w = a.world;
    const bx = (px - w.x) / w.scale.x;
    const by = (py - w.y) / w.scale.y;
    const s = Math.min(4.5, Math.max(0.4, w.scale.x * factor));
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
      formations() {
        const v = useGame.getState().view;
        return v ? Object.values(v.formations).map((f) => ({ id: f.id, cls: f.unitClass, key: f.key })) : [];
      },
      enemies() {
        const v = useGame.getState().view;
        return v ? [...new Set(Object.values(v.contacts).filter((c) => c.confirmed && v.relations[c.owner] === 'war').map((c) => c.key))].sort() : [];
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
    // Hovering an enemy shows its intent: everywhere it could hit next turn.
    if (v && !s.playback) {
      const here = new Set(Object.values(v.contacts).filter((c) => c.key === k && v.relations[c.owner] === 'war').map((c) => c.formation));
      if (here.size > 0) {
        const zone = threatZones(v, here);
        for (const z of zone.keys()) {
          g.poly(poly(z, 1)).fill({ color: ATTACK, alpha: 0.13 });
          for (const nb of neighborKeys(z)) {
            if (zone.has(nb) || !v.tiles[nb]) continue;
            const [p, q] = edge(z, nb, 1.5);
            g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 2.5, color: ATTACK, alpha: 0.95, cap: 'round' });
          }
        }
      }
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
    for (const name of ['terrain', 'overlay', 'threat', 'sites', 'highlight', 'paths', 'units']) {
      a.layers[name]!.removeChildren().forEach((c) => c.destroy());
    }
    const keys = Object.keys(v.tiles).sort();

    // Terrain: satellite-style ground mapped in world space, so the landscape runs on across hexes.
    const terrain = new Graphics();
    const grid = new Graphics();
    const groundMatrix = new Matrix().scale(0.5, 0.5);
    // Satellite imagery: one real 10 km scene per terrain, stretched once across the whole theatre so
    // no stretch of ground ever repeats.
    const art = getArt();
    const pts = keys.map(center);
    const minX = Math.min(...pts.map((p) => p.x)) - SIZE;
    const minY = Math.min(...pts.map((p) => p.y)) - SIZE;
    const span = Math.max(Math.max(...pts.map((p) => p.x)) + SIZE - minX, Math.max(...pts.map((p) => p.y)) + SIZE - minY);
    const satMatrix = art ? new Matrix().scale(span / art.ground.plains.width, span / art.ground.plains.width).translate(minX, minY) : null;
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown' || !t.terrain) {
        terrain.poly(poly(key)).fill({ color: 0x0e1110 });
        grid.poly(poly(key)).stroke({ width: 0.8, color: 0x2a302d, alpha: 0.7 });
        continue;
      }
      if (satMatrix && t.terrain === 'urban') {
        // Cities always sit on dense blocks of the real city, never on its river or fields.
        const k = satMatrix.a;
        const [px, py] = URBAN_SPOTS[Math.floor((jitter(key, 9) + 0.5) * URBAN_SPOTS.length) % URBAN_SPOTS.length]!;
        const c = center(key);
        const m = new Matrix().scale(k, k).translate(c.x - px * k, c.y - py * k);
        terrain.poly(poly(key)).fill({ texture: art!.ground.urban, textureSpace: 'global', matrix: m });
      } else if (satMatrix) terrain.poly(poly(key)).fill({ texture: art!.ground[t.terrain], textureSpace: 'global', matrix: satMatrix });
      else terrain.poly(poly(key)).fill({ texture: terrainTexture(t.terrain), textureSpace: 'global', matrix: groundMatrix });
      // Hex-to-hex variation in light, as imagery tiles taken at different hours.
      const shade = jitter(key, 3);
      terrain.poly(poly(key)).fill({ color: shade > 0 ? 0xffffff : 0x000000, alpha: Math.abs(shade) * 0.07 });
      if (t.terrain === 'water') {
        for (const n of neighborKeys(key)) {
          const u = v.tiles[n];
          if (u?.terrain && u.terrain !== 'water') {
            const [p, q] = edge(key, n, 1);
            terrain.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 3, color: 0x8a8a6a, alpha: 0.45 });
          }
        }
      }
      grid.poly(poly(key)).stroke({ width: 0.7, color: 0x000000, alpha: 0.22 });
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
          water.moveTo(c.x, c.y).quadraticCurveTo(mx, my, d.x, d.y).stroke({ width: 7, color: 0x3f4a2c, alpha: 0.8, cap: 'round' });
          water.moveTo(c.x, c.y).quadraticCurveTo(mx, my, d.x, d.y).stroke({ width: 4, color: 0x29495a, cap: 'round' });
          water.moveTo(c.x, c.y).quadraticCurveTo(mx, my, d.x, d.y).stroke({ width: 1.2, color: 0x6f95a6, alpha: 0.5, cap: 'round' });
        }
      }
    }
    a.layers.terrain!.addChild(terrain, water, grid);

    // Ownership: tint and Civ-style thick borders, fog on stale ground.
    const overlay = new Graphics();
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown') continue;
      if (t.owner) {
        const color = hex(v.nations[t.owner]?.color ?? '#888888');
        overlay.poly(poly(key, 1)).fill({ color, alpha: t.visibility === 'visible' ? 0.1 : 0.06 });
        for (const n of neighborKeys(key)) {
          if (v.tiles[n]?.owner === t.owner) continue;
          const [p, q] = edge(key, n, 2.5);
          overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 5, color: 0x000000, alpha: 0.35, cap: 'round' });
          overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 2.5, color, alpha: 0.95, cap: 'round' });
        }
      }
      if (t.visibility === 'observed') overlay.poly(poly(key)).fill({ color: 0x0a0c0b, alpha: 0.5 });
    }
    a.layers.overlay!.addChild(overlay);

    // Threat: where seen enemies could hit next turn, darker where more of them could.
    if (s.showThreat && !replaying) {
      const zones = threatZones(v);
      const threat = new Graphics();
      for (const [k, n] of zones) {
        threat.poly(poly(k, 1)).fill({ color: ATTACK, alpha: Math.min(0.5, 0.04 + 0.11 * (n - 1) + (n > 1 ? 0.06 : 0)) });
        for (const nb of neighborKeys(k)) {
          if (zones.has(nb) || !v.tiles[nb]) continue;
          const [p, q] = edge(k, nb, 1.5);
          threat.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 2.5, color: ATTACK, alpha: 0.85, cap: 'round' });
        }
      }
      a.layers.threat!.addChild(threat);
    }

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
        // A supply dump at the edge of the hex: a fenced compound out from under the units.
        const dx = c.x - SIZE * 0.5;
        const dy = c.y + SIZE * 0.42;
        if (art) {
          const depot = new Sprite(art.units.depot);
          depot.anchor.set(0.5);
          depot.scale.set((art.size.depot * 0.55) / depot.width);
          depot.position.set(c.x - SIZE * 0.38, c.y + SIZE * 0.3);
          a.layers.sites!.addChild(depot);
          sites.rect(dx - 3, dy + 4, 6, 1.5).fill({ color, alpha: 0.95 });
        } else {
          sites.rect(dx - 5, dy - 4, 10, 8).fill({ color: 0x2c2f2a, alpha: 0.9 }).stroke({ width: 1.2, color });
          sites.rect(dx - 3.2, dy - 2.4, 2.6, 1.8).fill({ color: 0x77705a });
          sites.rect(dx + 0.6, dy - 2.4, 2.6, 1.8).fill({ color: 0x77705a });
          sites.rect(dx - 3.2, dy + 0.6, 2.6, 1.8).fill({ color: 0x5c6650 });
        }
        const label = new Text({
          text: site.name,
          resolution: 3,
          style: { fontFamily: FONT_UI, fontSize: 8, fill: TEXT, fontWeight: '600', stroke: { color: 0x070b12, width: 3, join: 'round' } },
        });
        label.anchor.set(0.5, 0);
        label.position.set(c.x, c.y + SIZE * 0.62);
        label.alpha = 0.8;
        keepScreenSize(label);
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
    const ghosts: { key: HexKey; cls: UnitClass; strength: number; facing: number }[] = [];
    const orders = s.submitted ?? s.draft;
    if (orders && !replaying) {
      for (const id of Object.keys(orders.formations).sort()) {
        const f = v.formations[id];
        const o = orders.formations[id]!;
        if (!f) continue;
        const selected = id === s.selectedFormation;
        drawPath(paths, f.key, o, s.submitted ? 0xf4f1e8 : o.type === 'attack' ? ATTACK : MOVE, selected ? 1 : 0.7);
        if ('path' in o && o.path.length > 0) {
          const end = o.path.at(-1)!;
          const prev = o.path.length > 1 ? o.path.at(-2)! : f.key;
          const p = center(prev);
          const q = center(end);
          ghosts.push({ key: end, cls: f.unitClass, strength: f.strength, facing: Math.atan2(q.y - p.y, q.x - p.x) });
        }
        if (o.type === 'defend') {
          const c = center(f.key);
          paths.roundRect(c.x - 15, c.y + 12, 30, 6, 2).fill({ color: 0x0a0f18, alpha: 0.8 }).stroke({ width: 1.5, color: 0xe0b44a });
        }
      }
    }
    a.layers.paths!.addChild(paths);

    // Formations: top-down models deployed in formation within each hex, own first then contacts.
    type Marker = CounterLook & { key: HexKey };
    const byHex = new Map<HexKey, Marker[]>();
    const planned = (s.submitted ?? s.draft)?.formations ?? {};
    const mid = mapMiddle(v);
    const toward = (from: HexKey, to: Point) => {
      const p = center(from);
      return Math.atan2(to.y - p.y, to.x - p.x);
    };
    for (const f of Object.values(v.formations).sort((x, y) => (x.id < y.id ? -1 : 1))) {
      const o = planned[f.id];
      const next = o && 'path' in o && o.path.length ? o.path[0]! : o?.type === 'attack' ? o.target : null;
      byHex.set(f.key, [
        ...(byHex.get(f.key) ?? []),
        {
          key: f.key,
          cls: f.unitClass,
          aff: 'friend',
          fill: v.self.color,
          confirmed: true,
          strength: f.strength,
          selected: f.id === s.selectedFormation,
          idle: !o && !s.submitted,
          facing: toward(f.key, next ? center(next) : mid),
        },
      ]);
    }
    for (const c of Object.values(v.contacts).sort((x, y) => (x.formation < y.formation ? -1 : 1))) {
      byHex.set(c.key, [
        ...(byHex.get(c.key) ?? []),
        {
          key: c.key,
          cls: c.unitClass,
          aff: affiliationOf(false, v.relations[c.owner]),
          fill: v.nations[c.owner]?.color ?? '#888888',
          confirmed: c.confirmed,
          strength: c.estimatedStrength,
          facing: toward(c.key, mid),
        },
      ]);
    }
    const sprites = a.layers.units!;
    if (!replaying) {
      for (const gh of ghosts) {
        const c = center(gh.key);
        addUnit(sprites, c.x, c.y, { cls: gh.cls, aff: 'friend', fill: v.self.color, confirmed: true, strength: gh.strength, planned: true, facing: gh.facing });
      }
    } else byHex.clear();
    // Draw back to front so lower models overlap the ones behind them.
    for (const [key, list] of [...byHex].sort((x, y) => center(x[0]).y - center(y[0]).y)) {
      const c = center(key);
      const slots = slotOffsets(list.length);
      // Aircraft fly over the ground units sharing their hex.
      const air = (m: Marker) => (UNITS[m.cls].ground ? 0 : 1);
      const order = [...list].sort((m, n) => air(m) - air(n) || Number(m.selected) - Number(n.selected));
      order.forEach((m, i) => {
        const at = slots[Math.min(i, slots.length - 1)]!;
        addUnit(sprites, c.x + at.x, c.y + at.y, m, at.scale);
      });
    }

  }

  useEffect(() => {
    redraw();
    redrawHover();
  }, [view, draft, submitted, report, selectedHex, selectedFormation, mode]);

  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      if (s.showReport !== prev.showReport || s.playback !== prev.playback || s.showThreat !== prev.showThreat) redraw();
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
