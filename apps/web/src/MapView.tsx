import { useEffect, useRef } from 'react';
import { Application, BlurFilter, Container, Graphics, Matrix, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { Formation, FormationOrder, HexKey, NationView, Terrain, UnitClass } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { hexCorners, hexToPixel, keyOf, neighborKeys, parseKey, pixelToHex, type Point, type Reach } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { addUnit, affiliationOf, keepScreenSize, setModelZoom, tickModels, type CounterLook } from './counters';
import { AFFILIATION, FONT_DISPLAY, FONT_UI, SIGNAL, SURFACE, TEXT } from './design/tokens';
import { buildTimeline, playReplay } from './replay';
import { terrainTexture } from './design/terrain';
import { getArt, loadArt, siteArt, URBAN_SPOTS, type Art } from './art';
import { sfx } from './sfx';
import { isPhone } from './phone';
import { threatZones } from '@brink/simulation';
import { contextualOrder, hostilesAt, orderForClick, reachFor } from './planning';
import { nextObjective } from './objective';
import { groupOrders, oddsFor, ODDS_TAG, type Odds } from './odds';
import { useGame } from './store';
import { paintTheatre } from './paint/ground';
import { MapLife } from './paint/life';

/** Region names on the painted map: an engraved serif, like a printed atlas of a fantasy world. */
const FONT_REGION = "'Cinzel', Georgia, serif";

const SIZE = HEX_SIZE;


const MOVE = AFFILIATION.friend;
const ATTACK = AFFILIATION.hostile;

const hex = (n: string) => Number.parseInt(n.replace('#', ''), 16);

/** A nation colour lifted toward white: the bright core of a glowing border. */
function lighten(c: number): number {
  const ch = (sh: number) => Math.min(255, (((c >> sh) & 0xff) * 0.55 + 255 * 0.45) | 0);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function center(key: HexKey) {
  return hexToPixel(parseKey(key), SIZE);
}

/**
 * Each terrain's imagery seen through a blurred mask of its own hexes, layered water first, so
 * fields fade into forest and forest into rock the way real ground does, instead of changing at a
 * hex edge. The hard per-hex fill beneath keeps every hex covered.
 */
function softGround(app: Application, art: Art, sat: Matrix, keys: HexKey[], terrainOf: (k: HexKey) => Terrain, minX: number, minY: number, span: number, made: Texture[]): Container {
  const out = new Container();
  const pad = 40;
  const frame = new Rectangle(minX - pad, minY - pad, span + pad * 2, span + pad * 2);
  for (const t of ['water', 'plains', 'hills', 'forest', 'mountains'] as const) {
    const mine = keys.filter((k) => terrainOf(k) === t);
    if (mine.length === 0) continue;
    const g = new Graphics();
    for (const k of mine) g.poly(hexCorners(center(k), SIZE + 6).flatMap((p) => [p.x, p.y])).fill({ color: 0xffffff });
    g.filters = [new BlurFilter({ strength: 10, quality: 4 })];
    const tex = app.renderer.generateTexture({ target: g, frame, resolution: 0.5 });
    made.push(tex);
    g.destroy();
    const mask = new Sprite(tex);
    mask.position.set(frame.x, frame.y);
    const fill = new Graphics().rect(frame.x, frame.y, frame.width, frame.height).fill({ texture: art.ground[t], textureSpace: 'global', matrix: sat });
    fill.mask = mask;
    out.addChild(fill, mask);
  }
  return out;
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

/** Board-game ground: flat, calm terrain colours, each with a small mark saying what it is. */
const ATLAS: Record<Terrain, { fill: number; ink: number }> = {
  plains: { fill: 0x8e9a64, ink: 0x6d7a48 },
  forest: { fill: 0x4f6e47, ink: 0x2f4a2b },
  hills: { fill: 0xa48e60, ink: 0x7a6640 },
  mountains: { fill: 0x8d8b86, ink: 0xe9e7e1 },
  urban: { fill: 0x7a8490, ink: 0x4c5560 },
  water: { fill: 0x3e6c8c, ink: 0x6f9bb8 },
};

function atlasGround(v: NationView, keys: HexKey[]): Container {
  const g = new Graphics();
  const marks = new Graphics();
  for (const key of keys) {
    const t = v.tiles[key]!;
    if (t.visibility === 'unknown' || !t.terrain) {
      g.poly(poly(key)).fill({ color: 0x1a2126 });
      g.poly(poly(key)).stroke({ width: 0.8, color: 0x2b353c, alpha: 0.8 });
      continue;
    }
    const look = ATLAS[t.terrain];
    // A touch of variation hex to hex, so the land does not look like a spreadsheet.
    const shade = jitter(key, 3) * 0.08;
    g.poly(poly(key)).fill({ color: look.fill });
    g.poly(poly(key)).fill({ color: shade > 0 ? 0xffffff : 0x000000, alpha: Math.abs(shade) });
    g.poly(poly(key)).stroke({ width: 1, color: 0x000000, alpha: 0.18 });
    const c = center(key);
    const x = c.x + jitter(key, 5) * 6;
    const y = c.y - 9 + jitter(key, 6) * 3;
    if (t.siteId) continue;
    if (t.terrain === 'forest') {
      for (const [dx, dy] of [[-7, 2], [0, -2], [7, 2]] as const) marks.poly([x + dx, y + dy - 6, x + dx + 4, y + dy + 2, x + dx - 4, y + dy + 2]).fill({ color: look.ink, alpha: 0.9 });
    } else if (t.terrain === 'hills') {
      marks.moveTo(x - 10, y + 3).quadraticCurveTo(x - 5, y - 4, x, y + 3).moveTo(x - 1, y + 3).quadraticCurveTo(x + 5, y - 5, x + 11, y + 3).stroke({ width: 1.8, color: look.ink, alpha: 0.9, cap: 'round' });
    } else if (t.terrain === 'mountains') {
      marks.poly([x - 10, y + 4, x - 2, y - 7, x + 3, y, x + 6, y - 4, x + 11, y + 4]).fill({ color: 0x5f5d59 });
      marks.poly([x - 4.5, y - 3.5, x - 2, y - 7, x + 0.5, y - 3.5]).fill({ color: look.ink });
    } else if (t.terrain === 'urban') {
      for (const [dx, h] of [[-7, 6], [-1, 9], [5, 5]] as const) marks.rect(x + dx, y + 4 - h, 5, h).fill({ color: look.ink, alpha: 0.9 });
    } else if (t.terrain === 'water') {
      for (const dy of [-2, 3]) marks.moveTo(x - 9, y + dy).quadraticCurveTo(x - 4.5, y + dy - 3, x, y + dy).quadraticCurveTo(x + 4.5, y + dy + 3, x + 9, y + dy).stroke({ width: 1.5, color: look.ink, alpha: 0.9, cap: 'round' });
    }
  }
  const water = new Graphics();
  for (const key of keys) {
    const t = v.tiles[key]!;
    if (!t.river || !t.terrain) continue;
    const c = center(key);
    for (const n of neighborKeys(key)) {
      const u = v.tiles[n];
      if (!u?.river || !u.terrain || n < key) continue;
      const d = center(n);
      const mx = (c.x + d.x) / 2 + jitter(key + n, 1) * 8;
      const my = (c.y + d.y) / 2 + jitter(key + n, 2) * 8;
      water.moveTo(c.x, c.y).quadraticCurveTo(mx, my, d.x, d.y).stroke({ width: 5, color: 0x3e6c8c, cap: 'round' });
    }
  }
  const out = new Container();
  out.addChild(g, marks, water);
  return out;
}

const ODDS_COLOR: Record<Odds, number> = { good: 0x4fd18b, even: 0xffc23d, bad: 0xff5a4e };

/** A pill under an enemy hex: how an attack there would likely go. Holds its size on screen. */
function oddsBadge(c: Point, odds: Odds): Container {
  return tagBadge(c, ODDS_TAG[odds], ODDS_COLOR[odds]);
}

function tagBadge(c: Point, text: string, color: number): Container {
  const box = new Container();
  const t = new Text({ text, resolution: 4, style: { fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: '800', fill: 0x0d1114, letterSpacing: 0.4 } });
  t.anchor.set(0.5);
  const w = t.width + 10;
  box.addChild(new Graphics().roundRect(-w / 2, -7.5, w, 15, 7.5).fill({ color }).stroke({ width: 1.5, color: 0x0d1114 }), t);
  box.position.set(c.x, c.y + SIZE * 0.72);
  keepScreenSize(box);
  return box;
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

declare global {
  interface Window {
    __brink?: {
      hexToClient(key: HexKey): { x: number; y: number };
      reachable(): HexKey[];
      enemies(): HexKey[];
      formations(): { id: string; cls: UnitClass; key: HexKey }[];
      /** Enemy hexes the selected stack can attack. */
      targets(): HexKey[];
    };
  }
}

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<{ app: Application; world: Container; layers: Record<string, Container>; life: MapLife } | null>(null);
  const hover = useRef<HexKey | null>(null);
  /** Set once the player pans or zooms; until then the map refits to its container. */
  const userMoved = useRef(false);
  const groundSig = useRef('');
  const groundTextures = useRef<Texture[]>([]);
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
    void app.init({ resizeTo: el, background: SURFACE.ink950, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) }).then(() => {
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
      for (const name of ['terrain', 'overlay', 'threat', 'sites', 'highlight', 'paths', 'units', 'life', 'labels', 'anim', 'hover']) {
        layers[name] = new Container();
        world.addChild(layers[name]);
      }
      // The map, alive: fog, cloud shadows, water, and fighting along every front.
      const life = new MapLife(app, layers.life!, { center, size: SIZE });
      appRef.current = { app, world, layers, life };
      // Rotors turn and drone teams circle whether or not anything else changes.
      app.ticker.add(() => tickModels(performance.now()));
      wireInput(app, world);
      // Imported art arrives after the first frame; redraw with it as soon as it lands.
      void loadArt().then((loaded) => {
        if (loaded && !destroyed) redraw();
      });
      // Pixi draws text at once: redraw the region names when their typeface has arrived.
      void document.fonts?.load(`700 30px ${FONT_REGION}`).then(() => {
        if (!destroyed) redraw();
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
            userMoved.current = true;
            const cur = useGame.getState().view;
            if (cur) fitTo(cur, true);
          },
          home: () => {
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
        appRef.current.life.destroy();
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
    // Zoomed out, the map becomes a political map: nation names across their land.
    a.layers.labels!.visible = a.world.scale.x < 0.95;
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

  /** The band of the canvas the player can actually see: on a phone the status strip and the dock cover the ends. */
  function band(h: number): { top: number; bottom: number } {
    if (!isPhone()) return { top: 0, bottom: h };
    // The guided match's card sits under the status strip; keep the action below it.
    const coach = document.querySelector('[data-testid="coach"]')?.getBoundingClientRect().bottom ?? 0;
    // The unit card stands about 400 px tall over the bottom of the map while a stack is selected.
    const g = useGame.getState();
    return { top: Math.max(150, coach), bottom: h - (g.armed ? 470 : g.selectedFormation ? 410 : 300) };
  }

  function fitTo(v: NationView, whole = false) {
    const a = appRef.current;
    if (!a) return;
    if (!whole && isPhone()) {
      // A phone opens on your own country at a size a thumb can hit, not the whole theatre in miniature.
      const home = Object.values(v.sites).find((x) => x.owner === v.self.id && x.kind === 'capital')?.key ?? Object.values(v.formations)[0]?.key;
      if (home) {
        const p = center(home);
        const s = 1.35;
        const { top, bottom } = band(a.app.screen.height);
        a.world.scale.set(s);
        a.world.position.set(a.app.screen.width / 2 - p.x * s, (top + bottom) / 2 - p.y * s);
        publish();
        return;
      }
    }
    const pts = Object.keys(v.tiles).map(center);
    const minX = Math.min(...pts.map((p) => p.x)) - SIZE;
    const maxX = Math.max(...pts.map((p) => p.x)) + SIZE;
    const minY = Math.min(...pts.map((p) => p.y)) - SIZE;
    const maxY = Math.max(...pts.map((p) => p.y)) + SIZE;
    const w = a.app.screen.width;
    // On a phone the whole theatre fits between the status strip and the world card below it.
    const top = isPhone() ? 130 : 0;
    const h = a.app.screen.height - top - (isPhone() ? 330 : 0);
    const s = Math.min((w - 8) / (maxX - minX), h / (maxY - minY), 1.6);
    a.world.scale.set(s);
    a.world.position.set((w - (maxX - minX) * s) / 2 - minX * s, top + (h - (maxY - minY) * s) / 2 - minY * s);
    publish();
  }

  function wireInput(app: Application, world: Container) {
    const canvas = app.canvas;
    // Every finger or mouse on the map. One pans (or taps); two pinch-zoom around their midpoint.
    const pts = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; wx: number; wy: number; button: number; touch: boolean } | null = null;
    let pinch: { dist: number; scale: number; mx: number; my: number; wx: number; wy: number } | null = null;
    let dragged = false;
    const rectOf = () => canvas.getBoundingClientRect();
    const startPan = (x: number, y: number, button: number, touch: boolean) => {
      down = { x, y, wx: world.x, wy: world.y, button, touch };
    };
    const startPinch = () => {
      const [a, b] = [...pts.values()];
      const r = rectOf();
      pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, scale: world.scale.x, mx: (a!.x + b!.x) / 2 - r.left, my: (a!.y + b!.y) / 2 - r.top, wx: world.x, wy: world.y };
      dragged = true;
    };
    canvas.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pts.size === 1) {
        startPan(e.clientX, e.clientY, e.button, e.pointerType !== 'mouse');
        dragged = false;
      } else if (pts.size === 2) startPinch();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const r = rectOf();
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
        const s = Math.min(4.5, Math.max(0.4, (pinch.scale * dist) / pinch.dist));
        const mx = (a!.x + b!.x) / 2 - r.left;
        const my = (a!.y + b!.y) / 2 - r.top;
        // Keep the world point that was under the fingers' first midpoint under their midpoint now.
        const bx = (pinch.mx - pinch.wx) / pinch.scale;
        const by = (pinch.my - pinch.wy) / pinch.scale;
        world.scale.set(s);
        world.position.set(mx - bx * s, my - by * s);
        userMoved.current = true;
        publish();
        return;
      }
      if (down && pts.has(e.pointerId)) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > (down.touch ? 10 : 5)) dragged = true;
        if (dragged) {
          userMoved.current = true;
          world.position.set(down.wx + dx, down.wy + dy);
          publish();
        }
      }
      if (e.pointerType !== 'mouse') return;
      const k = hexAt(e.clientX, e.clientY);
      if (k !== hover.current) {
        hover.current = k;
        redrawHover();
        useGame.getState().setHover(k);
      }
    });
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      hover.current = null;
      redrawHover();
      useGame.getState().setHover(null);
    });
    const lift = (e: PointerEvent, cancelled: boolean) => {
      const was = pts.size;
      pts.delete(e.pointerId);
      if (was >= 2) {
        // A pinch ended: carry on panning with the finger still down, without a jump.
        pinch = null;
        const rest = [...pts.values()][0];
        if (rest) startPan(rest.x, rest.y, 0, true);
        return;
      }
      const wasDrag = dragged;
      const start = down;
      down = null;
      if (wasDrag || cancelled || !start) return;
      const k = hexAt(e.clientX, e.clientY);
      if (!k) return;
      if (start.touch) onHexClick(k, 'touch');
      else if (start.button === 0) onHexClick(k, 'left');
      else if (start.button === 2) onHexClick(k, 'right');
    };
    canvas.addEventListener('pointerup', (e) => lift(e, false));
    canvas.addEventListener('pointercancel', (e) => lift(e, true));
    // iOS Safari sends its own pinch gestures to the page; the map handles pinches itself.
    canvas.addEventListener('gesturestart', (e) => e.preventDefault());
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
      targets() {
        const s = useGame.getState();
        const v = s.view;
        if (!v || s.group.length === 0) return [];
        const keys = [...new Set(Object.values(v.contacts).filter((c) => v.relations[c.owner] === 'war').map((c) => c.key))].sort();
        return keys.filter((k) => Object.values(groupOrders(v, s.group, k).orders).some((o) => o.type === 'attack'));
      },
      enemies() {
        const v = useGame.getState().view;
        return v ? [...new Set(Object.values(v.contacts).filter((c) => c.confirmed && v.relations[c.owner] === 'war').map((c) => c.key))].sort() : [];
      },
    };
  }

  /**
   * Left-click selects, or orders in the current mode; right-click always orders by context. A tap
   * selects your own units and otherwise orders by context; an attack takes a second tap, so the
   * first can show the odds.
   */
  function onHexClick(key: HexKey, input: 'left' | 'right' | 'touch') {
    const s = useGame.getState();
    const v = s.view;
    if (!v || s.playback) return;
    const right = input === 'right';
    const touch = input === 'touch';
    const r = currentReach();
    const own = Object.values(v.formations)
      .filter((o) => o.key === key)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (touch) {
      onTap(key, own.length > 0);
      return;
    }
    if (r && !s.resolving) {
      const { f, reach } = r;
      const hostile = hostilesAt(v, key).length > 0;
      // Clicking or tapping a hex holding our own units (that is not a move target) cycles selection.
      const selectHere = !right && own.length > 0 && !hostile && (key === f.key || touch || (s.mode === 'move' && !reach[key]));
      if (!selectHere && !(right && key === f.key)) {
        const result = contextualOrder(v, f, key, touch ? 'move' : s.mode, reach, right || touch);
        if ('error' in result) {
          // A command that cannot be carried out says why; an idle click elsewhere just inspects.
          if (right || (touch && hostile)) {
            s.notify(result.error, 'warn');
            return;
          }
        } else if (touch && result.order.type === 'attack') {
          const armed = s.armed;
          if (armed && armed.formation === f.id && armed.target === key) s.issueOrder(f.id, result.order);
          else s.armAttack({ formation: f.id, target: key, order: result.order });
          s.focusOn(key);
          return;
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

  /**
   * A tap. Your own stack: select all of it. With a stack selected: a blue hex moves everyone who can
   * reach it; an enemy locks on (the odds are already on the map) and a second tap attacks.
   * Anywhere else: look at it, and open your city if it is one.
   */
  function onTap(key: HexKey, ownHere: boolean) {
    const s = useGame.getState();
    const v = s.view!;
    const hostile = hostilesAt(v, key).length > 0;
    if (ownHere && !hostile) {
      s.selectStack(key);
      // Bring it up out from under the unit card, so its reach and targets are on screen.
      s.focusOn(key);
      return;
    }
    const group = s.group.filter((id) => v.formations[id]);
    if (group.length > 0 && !s.resolving) {
      const { orders, error } = groupOrders(v, group, key);
      const ids = Object.keys(orders);
      if (ids.length > 0) {
        if (ids.some((id) => orders[id]!.type === 'attack')) {
          const armed = s.armed;
          if (armed && armed.target === key) s.attack(key, armed.orders ?? { [armed.formation]: armed.order });
          else {
            const lead = s.selectedFormation && orders[s.selectedFormation] ? s.selectedFormation : ids[0]!;
            s.armAttack({ formation: lead, target: key, order: orders[lead]!, orders });
          }
          s.focusOn(key);
          return;
        }
        s.selectHex(key);
        s.issueGroup(orders);
        if (ids.length < group.length) s.notify(`${ids.length} of ${group.length} units can reach there this turn`, 'warn');
        return;
      }
      if (hostile) {
        s.notify(error ?? 'Out of reach this turn', 'warn');
        return;
      }
    }
    s.selectFormation(null);
    s.selectHex(key);
    const site = v.tiles[key]?.siteId;
    if (site && v.sites[site]?.owner === v.self.id && v.sites[site]?.kind !== 'objective') s.openCity(site);
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

  /** The ground: rebuilt only when what the viewer knows of the land changes, not on every click. */
  function drawGround(a: NonNullable<typeof appRef.current>, v: NationView, keys: string[]) {
    const style = useGame.getState().mapStyle;
    const atlas = style === 'atlas';
    const painted = style === 'painted';
    const art = atlas || painted ? null : getArt();
    // The painted canvas only changes when land is explored; seen-versus-visible shading is drawn
    // over it, so a new turn does not repaint the theatre.
    const vis = (k: HexKey) => (painted ? (v.tiles[k]!.visibility === 'unknown' ? 'u' : 'k') : v.tiles[k]!.visibility[0]);
    const sig = `${style}${art ? 1 : 0}|${keys.map((k) => `${k}${vis(k)}${v.tiles[k]!.terrain ?? ''}${v.tiles[k]!.river ? 'r' : ''}${v.tiles[k]!.siteId ?? ''}`).join(',')}`;
    if (groundSig.current === sig) return;
    groundSig.current = sig;
    const layer = a.layers.terrain!;
    layer.removeChildren().forEach((c) => c.destroy());
    for (const t of groundTextures.current) t.destroy(true);
    const made: Texture[] = [];
    groundTextures.current = made;
    if (atlas) {
      layer.addChild(atlasGround(v, keys));
      return;
    }
    // Beyond the painted canvas the open sea runs on.
    a.app.renderer.background.color = painted ? 0x0a2433 : SURFACE.ink950;
    if (painted) {
      // One hand-painted canvas for the whole theatre, baked into a single texture.
      // Instrumented: `brink:paint` in the browser's performance timeline.
      performance.mark('brink:paint-start');
      const p = paintTheatre(v, keys, SIZE);
      performance.measure('brink:paint', 'brink:paint-start');
      const tex = Texture.from(p.canvas);
      made.push(tex);
      const ground = new Sprite(tex);
      ground.position.set(p.x, p.y);
      ground.scale.set(p.unit);
      layer.addChild(ground);
      return;
    }
    // Terrain: satellite-style ground mapped in world space, so the landscape runs on across hexes.
    const terrain = new Graphics();
    const crisp = new Graphics();
    const grid = new Graphics();
    const groundMatrix = new Matrix().scale(0.5, 0.5);
    // Satellite imagery: one real 10 km scene per terrain, stretched once across the whole theatre so
    // no stretch of ground ever repeats.
    const pts = keys.map(center);
    const minX = Math.min(...pts.map((p) => p.x)) - SIZE;
    const minY = Math.min(...pts.map((p) => p.y)) - SIZE;
    const span = Math.max(Math.max(...pts.map((p) => p.x)) + SIZE - minX, Math.max(...pts.map((p) => p.y)) + SIZE - minY);
    const satMatrix = art ? new Matrix().scale(span / art.ground.plains.width, span / art.ground.plains.width).translate(minX, minY) : null;
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown' || !t.terrain) {
        crisp.poly(poly(key)).fill({ color: 0x0e1110 });
        grid.poly(poly(key)).stroke({ width: 0.8, color: 0x2a302d, alpha: 0.7 });
        continue;
      }
      const site = t.siteId ? v.sites[t.siteId] : undefined;
      if (art && site) {
        // Sites stand on 50 cm imagery of a real place, one hex across.
        const c = center(key);
        const tex = art.sites[siteArt(site, Math.floor((jitter(key, 5) + 0.5) * 4))];
        const k = (SIZE * 2.1) / tex.width;
        const m = new Matrix().scale(k, k).translate(c.x - (tex.width * k) / 2, c.y - (tex.height * k) / 2);
        crisp.poly(poly(key)).fill({ texture: tex, textureSpace: 'global', matrix: m });
      } else if (satMatrix && t.terrain === 'urban') {
        // Cities always sit on dense blocks of the real city, never on its river or fields.
        const k = satMatrix.a;
        const [px, py] = URBAN_SPOTS[Math.floor((jitter(key, 9) + 0.5) * URBAN_SPOTS.length) % URBAN_SPOTS.length]!;
        const c = center(key);
        const m = new Matrix().scale(k, k).translate(c.x - px * k, c.y - py * k);
        crisp.poly(poly(key)).fill({ texture: art!.ground.urban, textureSpace: 'global', matrix: m });
      } else if (satMatrix) terrain.poly(poly(key)).fill({ texture: art!.ground[t.terrain], textureSpace: 'global', matrix: satMatrix });
      else terrain.poly(poly(key)).fill({ texture: terrainTexture(t.terrain), textureSpace: 'global', matrix: groundMatrix });
      // Without imagery, vary the light hex to hex as tiles taken at different hours.
      if (!art) {
        const shade = jitter(key, 3);
        terrain.poly(poly(key)).fill({ color: shade > 0 ? 0xffffff : 0x000000, alpha: Math.abs(shade) * 0.07 });
      }
      if (t.terrain === 'water') {
        for (const n of neighborKeys(key)) {
          const u = v.tiles[n];
          if (u?.terrain && u.terrain !== 'water') {
            const [p, q] = edge(key, n, 1);
            terrain.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 3, color: 0x8a8a6a, alpha: 0.45 });
          }
        }
      }
      grid.poly(poly(key)).stroke({ width: 0.7, color: 0x000000, alpha: art ? 0.16 : 0.22 });
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
    if (art && satMatrix) {
      // Bake the feathered landscape once into one texture: live masks would re-render the whole map
      // at screen scale every frame and exhaust GPU memory when zoomed in.
      const comp = new Container();
      comp.addChild(terrain, softGround(a.app, art, satMatrix, keys.filter((k) => v.tiles[k]!.terrain && v.tiles[k]!.visibility !== 'unknown' && !v.tiles[k]!.siteId), (k) => v.tiles[k]!.terrain!, minX, minY, span, made));
      const frame = new Rectangle(minX - 40, minY - 40, span + 80, span + 80);
      const baked = a.app.renderer.generateTexture({ target: comp, frame, resolution: 1.5 });
      for (const t of made) t.destroy(true);
      made.length = 0;
      made.push(baked);
      comp.destroy({ children: true });
      const ground = new Sprite(baked);
      ground.position.set(frame.x, frame.y);
      layer.addChild(ground);
    } else layer.addChild(terrain);
    layer.addChild(crisp, water, grid);
  }

  function redraw() {
    const a = appRef.current;
    const s = useGame.getState();
    // While a turn replays, the board shows the world it was planned against.
    const v = s.playback?.before ?? s.view;
    const replaying = s.playback !== null;
    if (!a || !v) return;
    for (const name of ['overlay', 'threat', 'sites', 'highlight', 'paths', 'units', 'labels']) {
      a.layers[name]!.removeChildren().forEach((c) => c.destroy());
    }
    const keys = Object.keys(v.tiles).sort();
    const art = getArt();
    const paintedMap = s.mapStyle === 'painted';
    drawGround(a, v, keys);
    a.life.update(v, s.report, !replaying);


    // Ownership: tint and Civ-style thick borders, fog on stale ground.
    const overlay = new Graphics();
    const washes = new Map<string, HexKey[]>();
    const stale: HexKey[] = [];
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown') continue;
      // The imagery is graded down so units, borders and highlights carry the picture.
      if (art && s.mapStyle === 'satellite' && !t.siteId) overlay.poly(poly(key)).fill({ color: 0x0d1418, alpha: 0.32 });
      if (t.owner) {
        const color = hex(v.nations[t.owner]?.color ?? '#888888');
        if (paintedMap) {
          // A light wash of the nation's colour (one path per nation, below, so no seams), and a
          // border that glows like a realm's edge.
          washes.set(t.owner, [...(washes.get(t.owner) ?? []), key]);
          for (const n of neighborKeys(key)) {
            if (v.tiles[n]?.owner === t.owner) continue;
            const [p, q] = edge(key, n, 3);
            overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 11, color, alpha: 0.18, cap: 'round' });
            overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 5.5, color, alpha: 0.45, cap: 'round' });
            overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 2.2, color: lighten(color), alpha: 1, cap: 'round' });
          }
        } else {
          overlay.poly(poly(key, 1)).fill({ color, alpha: t.visibility === 'visible' ? 0.2 : 0.12 });
          for (const n of neighborKeys(key)) {
            if (v.tiles[n]?.owner === t.owner) continue;
            const [p, q] = edge(key, n, 2.5);
            overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 6, color: 0x000000, alpha: 0.4, cap: 'round' });
            overlay.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 3.5, color, alpha: 1, cap: 'round' });
          }
        }
      }
      if (t.visibility === 'observed') {
        if (paintedMap) stale.push(key);
        else overlay.poly(poly(key)).fill({ color: 0x0a0c0b, alpha: 0.5 });
      }
    }
    if (paintedMap) {
      const wash = new Graphics();
      for (const [owner, list] of [...washes].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        for (const k of list) wash.poly(poly(k, -0.6));
        wash.fill({ color: hex(v.nations[owner]?.color ?? '#888888'), alpha: 0.1 });
      }
      for (const k of stale) wash.poly(poly(k, -0.6));
      if (stale.length) wash.fill({ color: 0x0a0c0b, alpha: 0.36 });
      a.layers.overlay!.addChild(wash);
    }
    a.layers.overlay!.addChild(overlay);

    // Nation names across their territory, for the zoomed-out political map.
    const lands = new Map<string, Point[]>();
    for (const key of keys) {
      const t = v.tiles[key]!;
      if (t.owner && t.visibility !== 'unknown') lands.set(t.owner, [...(lands.get(t.owner) ?? []), center(key)]);
    }
    for (const [owner, pts] of [...lands].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const n = v.nations[owner];
      if (!n || pts.length < 3) continue;
      const cx = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
      const cy = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
      const label = paintedMap
        ? new Text({
            text: n.name.toUpperCase(),
            resolution: 2,
            style: {
              fontFamily: FONT_REGION,
              fontSize: 30,
              fontWeight: '700',
              fill: 0xf6ecd0,
              letterSpacing: 6,
              stroke: { color: 0x1a1208, width: 6, join: 'round' },
              dropShadow: { color: hex(n.color), blur: 12, distance: 0, alpha: 0.9 },
              align: 'center',
              wordWrap: true,
              wordWrapWidth: 300,
            },
          })
        : new Text({
            text: n.name.toUpperCase(),
            resolution: 2,
            style: { fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: '800', fill: 0xffffff, letterSpacing: 2, stroke: { color: hex(n.color), width: 7, join: 'round' }, align: 'center', wordWrap: true, wordWrapWidth: 260 },
          });
      label.anchor.set(0.5);
      label.position.set(cx, cy);
      label.alpha = 0.92;
      a.layers.labels!.addChild(label);
    }
    a.layers.labels!.visible = a.world.scale.x < 0.95;

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
    const badges: Container[] = [];
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
      // Every enemy the selected stack can hit, ringed, with how the fight would likely go.
      const group = s.group.map((id) => v.formations[id]).filter((f): f is Formation => !!f);
      const attackers = group.length ? group : [r.f];
      const seen = new Set<HexKey>();
      for (const c of Object.values(v.contacts)) {
        if (v.relations[c.owner] !== 'war' || seen.has(c.key)) continue;
        seen.add(c.key);
        const able = attackers.filter((f) => !('error' in orderForClick(v, f, c.key, 'attack', f.id === r.f.id ? r.reach : reachFor(v, f))));
        if (able.length === 0) continue;
        hl.poly(poly(c.key, 2)).fill({ color: ATTACK, alpha: 0.18 }).stroke({ width: 3, color: ATTACK, alpha: 0.95 });
        const odds = oddsFor(v, able, c.key);
        if (odds) badges.push(oddsBadge(center(c.key), odds));
      }
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
    // Battles you have fought this turn: how they went.
    for (const b of s.draft?.battles ?? []) {
      if (replaying) break;
      hl.poly(poly(b.target, 3)).stroke({ width: 3, color: b.won ? 0x4fd18b : ATTACK, alpha: 0.95 });
      badges.push(tagBadge(center(b.target), b.won ? 'WON' : 'REPULSED', b.won ? 0x4fd18b : 0xff5a4e));
    }
    // The suggested next objective: a ring in command amber.
    const goal = replaying ? null : nextObjective(v);
    if (goal) {
      const c = center(goal.site.key);
      hl.circle(c.x, c.y, SIZE * 0.95).stroke({ width: 3, color: SIGNAL, alpha: 0.95 });
      hl.circle(c.x, c.y, SIZE * 1.12).stroke({ width: 1.5, color: SIGNAL, alpha: 0.5 });
    }
    // A touch attack waiting for its second tap: the target in crosshairs.
    if (s.armed && !replaying) {
      const c = center(s.armed.target);
      hl.poly(poly(s.armed.target, 1)).fill({ color: ATTACK, alpha: 0.18 }).stroke({ width: 3.5, color: ATTACK, alpha: 1 });
      hl.circle(c.x, c.y, SIZE * 0.55).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) hl.moveTo(c.x + dx * SIZE * 0.35, c.y + dy * SIZE * 0.35).lineTo(c.x + dx * SIZE * 0.8, c.y + dy * SIZE * 0.8).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    }
    a.layers.highlight!.addChild(hl, ...badges);

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

    // Formations: one counter per hex for each side, standing for the whole stack.
    const planned = (s.submitted ?? s.draft)?.formations ?? {};
    const sprites = a.layers.units!;
    if (replaying) return;
    for (const gh of ghosts) {
      const c = center(gh.key);
      addUnit(sprites, c.x, c.y, { cls: gh.cls, aff: 'friend', fill: v.self.color, confirmed: true, strength: gh.strength, planned: true, facing: gh.facing });
    }
    const counters: { key: HexKey; look: CounterLook; side: number }[] = [];
    const ownByHex = new Map<HexKey, Formation[]>();
    for (const f of Object.values(v.formations).sort((x, y) => (x.id < y.id ? -1 : 1))) ownByHex.set(f.key, [...(ownByHex.get(f.key) ?? []), f]);
    for (const [key, list] of ownByHex) {
      // The counter on top: the selected unit, else one still waiting for orders, else the strongest.
      const lead = list.find((f) => f.id === s.selectedFormation) ?? list.find((f) => !planned[f.id]) ?? [...list].sort((x, y) => y.strength - x.strength)[0]!;
      counters.push({
        key,
        side: 0,
        look: {
          cls: lead.unitClass,
          aff: 'friend',
          fill: v.self.color,
          confirmed: true,
          strength: lead.strength,
          selected: list.some((f) => f.id === s.selectedFormation),
          idle: !s.submitted && list.some((f) => !planned[f.id]),
          count: list.length,
        },
      });
    }
    const theirsByHex = new Map<HexKey, (typeof v.contacts)[string][]>();
    for (const c of Object.values(v.contacts).sort((x, y) => (x.formation < y.formation ? -1 : 1))) theirsByHex.set(c.key, [...(theirsByHex.get(c.key) ?? []), c]);
    for (const [key, list] of theirsByHex) {
      const lead = [...list].sort((x, y) => Number(y.confirmed) - Number(x.confirmed) || y.estimatedStrength - x.estimatedStrength)[0]!;
      counters.push({
        key,
        side: ownByHex.has(key) ? 1 : 0,
        look: {
          cls: lead.unitClass,
          aff: affiliationOf(false, v.relations[lead.owner]),
          fill: v.nations[lead.owner]?.color ?? '#888888',
          confirmed: list.some((c) => c.confirmed),
          strength: lead.estimatedStrength,
          count: list.length,
        },
      });
    }
    // Back to front, so lower counters overlap the ones behind them.
    for (const m of counters.sort((x, y) => center(x.key).y - center(y.key).y)) {
      const c = center(m.key);
      addUnit(sprites, c.x + m.side * 14, c.y + m.side * 6, m.look, m.side ? 0.85 : 1);
    }

  }

  useEffect(() => {
    redraw();
    redrawHover();
  }, [view, draft, submitted, report, selectedHex, selectedFormation, mode]);

  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      if (s.showReport !== prev.showReport || s.playback !== prev.playback || s.showThreat !== prev.showThreat || s.armed !== prev.armed || s.mapStyle !== prev.mapStyle || s.group !== prev.group) redraw();
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
      onImpact: (kind) => (kind === 'battle' ? sfx.battle() : sfx.boom()),
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
    const m = 70;
    const { top, bottom } = band(a.app.screen.height);
    if (sx < m || sy < top + m || sx > a.app.screen.width - m || sy > bottom - m) {
      a.world.position.set(a.app.screen.width / 2 - p.x * s, (top + bottom) / 2 - p.y * s);
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
