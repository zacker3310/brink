import { useEffect, useMemo, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { FormationOrder, HexKey, NationView, Terrain, UnitClass } from '@brink/contracts';
import { hexCorners, hexToPixel, keyOf, parseKey, pixelToHex } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { hostilesAt, orderForClick, reachFor } from './planning';
import { useGame } from './store';

const SIZE = HEX_SIZE;

const TERRAIN_COLOR: Record<Terrain, number> = {
  plains: 0x56664a,
  forest: 0x34503a,
  hills: 0x76694f,
  mountains: 0x8a8682,
  urban: 0x5f636d,
  water: 0x1d3147,
};

const hex = (n: string) => Number.parseInt(n.replace('#', ''), 16);

function center(key: HexKey) {
  return hexToPixel(parseKey(key), SIZE);
}

function poly(key: HexKey, shrink = 0): number[] {
  return hexCorners(center(key), SIZE - shrink).flatMap((p) => [p.x, p.y]);
}

function drawPath(g: Graphics, from: HexKey, order: FormationOrder, color: number, alpha: number) {
  const path = 'path' in order ? order.path : [];
  const pts = [from, ...path].map(center);
  if (pts.length > 1) {
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.stroke({ width: 3, color, alpha, cap: 'round', join: 'round' });
    const end = pts.at(-1)!;
    g.circle(end.x, end.y, 5).fill({ color, alpha });
  }
  if (order.type === 'attack') {
    const t = center(order.target);
    const last = pts.at(-1)!;
    g.moveTo(last.x, last.y).lineTo(t.x, t.y).stroke({ width: 3, color: 0xd9534f, alpha });
    g.circle(t.x, t.y, SIZE * 0.55).stroke({ width: 3, color: 0xd9534f, alpha });
  }
}

/** A NATO-style class symbol inside a w x h frame at (x, y). */
function drawSymbol(g: Graphics, cls: UnitClass, x: number, y: number, w: number, h: number, color: number, alpha: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const line = { width: 1.4, color, alpha };
  if (cls === 'infantry' || cls === 'mechanized') g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke(line);
  if (cls === 'mechanized' || cls === 'armor') g.ellipse(cx, cy, w * 0.32, h * 0.26).stroke({ ...line, width: cls === 'armor' ? 1.8 : 1.4 });
  if (cls === 'artillery') g.circle(cx, cy, h * 0.18).fill({ color, alpha });
  if (cls === 'recon') g.moveTo(x, y + h).lineTo(x + w, y).stroke(line);
  if (cls === 'air') g.moveTo(x + w * 0.15, cy + 2).quadraticCurveTo(x + w * 0.32, cy - 5, cx, cy + 2).quadraticCurveTo(x + w * 0.68, cy - 5, x + w * 0.85, cy + 2).stroke(line);
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
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const submitted = useGame((s) => s.submitted);
  const report = useGame((s) => s.report);
  const selectedHex = useGame((s) => s.selectedHex);
  const selectedFormation = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const focus = useGame((s) => s.focus);

  const reach = useMemo(() => {
    const f = selectedFormation && view ? view.formations[selectedFormation] : undefined;
    return f && view ? reachFor(view, f) : null;
  }, [view, selectedFormation]);

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
      for (const name of ['terrain', 'overlay', 'sites', 'highlight', 'paths', 'units', 'hover']) {
        layers[name] = new Container();
        world.addChild(layers[name]);
      }
      world.scale.set(1);
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
      // Refit when the container changes size, until the player takes the camera.
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
    let down: { x: number; y: number; wx: number; wy: number } | null = null;
    let dragged = false;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, wx: world.x, wy: world.y };
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
      down = null;
      if (wasDrag || e.button !== 0) return;
      const k = hexAt(e.clientX, e.clientY);
      if (k) onHexClick(k);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      useGame.getState().selectFormation(null);
    });
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
        const { view: v, selectedFormation: id } = useGame.getState();
        const f = v && id ? v.formations[id] : undefined;
        return f && v ? Object.keys(reachFor(v, f)).filter((k) => k !== f.key).sort() : [];
      },
    };
  }

  function onHexClick(key: HexKey) {
    const s = useGame.getState();
    const v = s.view;
    if (!v) return;
    const fid = s.selectedFormation;
    const f = fid ? v.formations[fid] : undefined;
    if (f && !s.resolving) {
      const ownHere = Object.values(v.formations).filter((o) => o.key === key);
      // Clicking another own formation's hex (not as a move target in attack mode) selects it.
      if (key === f.key || (ownHere.length > 0 && s.mode === 'move' && hostilesAt(v, key).length === 0 && !reachFor(v, f)[key])) {
        s.selectFormation(ownHere.find((o) => o.id !== fid)?.id ?? fid);
        s.selectHex(key);
        return;
      }
      const result = orderForClick(v, f, key, s.mode, reachFor(v, f));
      if ('error' in result) {
        s.notify(result.error, 'warn');
        s.selectHex(key);
        return;
      }
      s.setOrder(f.id, result.order);
      s.selectHex(key);
      return;
    }
    const own = Object.values(v.formations).filter((o) => o.key === key).sort((a, b) => (a.id < b.id ? -1 : 1));
    s.selectHex(key);
    if (own[0]) s.selectFormation(own[0].id);
  }

  function redrawHover() {
    const a = appRef.current;
    if (!a) return;
    const layer = a.layers.hover!;
    layer.removeChildren().forEach((c) => c.destroy());
    if (!hover.current) return;
    const g = new Graphics();
    g.poly(poly(hover.current, 1.5)).fill({ color: 0xffffff, alpha: 0.06 }).stroke({ width: 2, color: 0xe8e2d0, alpha: 0.6 });
    layer.addChild(g);
  }

  function redraw() {
    const a = appRef.current;
    const s = useGame.getState();
    const v = s.view;
    if (!a || !v) return;
    for (const name of ['terrain', 'overlay', 'sites', 'highlight', 'paths', 'units']) {
      a.layers[name]!.removeChildren().forEach((c) => c.destroy());
    }

    const terrain = new Graphics();
    const overlay = new Graphics();
    for (const key of Object.keys(v.tiles).sort()) {
      const t = v.tiles[key]!;
      if (t.visibility === 'unknown' || !t.terrain) {
        terrain.poly(poly(key, 1)).fill({ color: 0x111a27 }).stroke({ width: 1, color: 0x223047, alpha: 0.9 });
        continue;
      }
      terrain.poly(poly(key)).fill({ color: TERRAIN_COLOR[t.terrain] }).stroke({ width: 1, color: 0x0a0f18, alpha: 0.6 });
      if (t.river) {
        const c = center(key);
        terrain.moveTo(c.x - SIZE * 0.85, c.y + 4).bezierCurveTo(c.x - 8, c.y - 8, c.x + 8, c.y + 12, c.x + SIZE * 0.85, c.y - 2);
        terrain.stroke({ width: 3, color: 0x4f7ea8, alpha: 0.9 });
      }
      if (t.terrain === 'forest' || t.terrain === 'hills' || t.terrain === 'mountains') {
        const c = center(key);
        const mark = t.terrain === 'forest' ? 0x24382a : t.terrain === 'hills' ? 0x5d5340 : 0xb9b5ae;
        for (const [dx, dy] of [
          [-8, 4],
          [6, -4],
          [2, 9],
        ] as const) {
          if (t.terrain === 'forest') terrain.circle(c.x + dx, c.y + dy, 4).fill({ color: mark, alpha: 0.9 });
          else terrain.poly([c.x + dx - 6, c.y + dy + 4, c.x + dx, c.y + dy - 6, c.x + dx + 6, c.y + dy + 4]).fill({ color: mark, alpha: 0.85 });
        }
      }
      if (t.owner) {
        const color = hex(v.nations[t.owner]?.color ?? '#888888');
        overlay.poly(poly(key, 1)).fill({ color, alpha: t.visibility === 'visible' ? 0.26 : 0.16 });
        // Border edges against other owners.
        const corners = hexCorners(center(key), SIZE - 1.5);
        const neighbors = ['1,0', '1,-1', '0,-1', '-1,0', '-1,1', '0,1'];
        const { q, r } = parseKey(key);
        neighbors.forEach((d, i) => {
          const [dq, dr] = d.split(',').map(Number) as [number, number];
          const nk = `${q + dq},${r + dr}`;
          if (v.tiles[nk]?.owner === t.owner) return;
          // Corner order is clockwise from the top; edge i sits between these corners.
          const edge = [
            [1, 2],
            [0, 1],
            [5, 0],
            [4, 5],
            [3, 4],
            [2, 3],
          ][i]!;
          const p0 = corners[edge[0]!]!;
          const p1 = corners[edge[1]!]!;
          overlay.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ width: 2.5, color, alpha: 0.95 });
        });
      }
      if (t.visibility === 'observed') overlay.poly(poly(key)).fill({ color: 0x05080e, alpha: 0.42 });
    }
    a.layers.terrain!.addChild(terrain);
    a.layers.overlay!.addChild(overlay);

    // Sites.
    const sites = new Graphics();
    for (const id of Object.keys(v.sites).sort()) {
      const site = v.sites[id]!;
      const c = center(site.key);
      const color = site.owner ? hex(v.nations[site.owner]?.color ?? '#999999') : 0xd8d2c0;
      const y = c.y - 12;
      if (site.kind === 'capital') {
        sites.circle(c.x, y, 7).fill({ color: 0x0a0f18 }).stroke({ width: 2, color });
        sites.circle(c.x, y, 3.5).fill({ color });
      } else if (site.kind === 'city') {
        sites.rect(c.x - 5.5, y - 5.5, 11, 11).fill({ color: 0x0a0f18 }).stroke({ width: 2, color });
      } else if (site.kind === 'depot') {
        sites.poly([c.x - 6, y + 5, c.x, y - 6, c.x + 6, y + 5]).fill({ color: 0x0a0f18 }).stroke({ width: 2, color });
      } else {
        sites.poly([c.x, y - 7, c.x + 7, y, c.x, y + 7, c.x - 7, y]).fill({ color: 0x0a0f18 }).stroke({ width: 2, color: 0xe0b44a });
      }
      const label = new Text({
        text: site.kind === 'depot' ? site.name : site.name.toUpperCase(),
        resolution: 3,
        style: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: site.kind === 'capital' ? 10 : 8.5,
          fill: site.kind === 'objective' ? 0xe0b44a : 0xe6e1d3,
          fontWeight: site.kind === 'depot' ? '500' : '700',
          letterSpacing: site.kind === 'depot' ? 0 : 0.6,
          stroke: { color: 0x070b12, width: 3, join: 'round' },
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(c.x, c.y + 15);
      label.alpha = site.kind === 'depot' ? 0.75 : 0.95;
      a.layers.sites!.addChild(label);
    }
    a.layers.sites!.addChildAt(sites, 0);

    // Selection, reachable hexes and results of the last turn.
    const hl = new Graphics();
    if (reach && s.selectedFormation) {
      for (const k of Object.keys(reach)) {
        if (k !== v.formations[s.selectedFormation]?.key) {
          const tint = s.mode === 'attack' ? 0xd9534f : s.mode === 'withdraw' ? 0x8fb3d9 : 0xf2e6b8;
          hl.poly(poly(k, 3)).fill({ color: tint, alpha: 0.16 }).stroke({ width: 1, color: tint, alpha: 0.45 });
        }
      }
    }
    if (s.report && !s.showReport) {
      for (const e of s.report.events) {
        if (e.kind === 'engagement') {
          const c = center(e.location);
          hl.moveTo(c.x - 8, c.y - 8).lineTo(c.x + 8, c.y + 8).moveTo(c.x + 8, c.y - 8).lineTo(c.x - 8, c.y + 8).stroke({ width: 3, color: 0xd9534f, alpha: 0.7 });
        }
        if (e.kind === 'site_captured') hl.poly(poly(e.key, 2)).stroke({ width: 3, color: 0xe0b44a, alpha: 0.8 });
      }
    }
    if (s.selectedHex) hl.poly(poly(s.selectedHex, 1)).stroke({ width: 2.5, color: 0xffffff, alpha: 0.95 });
    a.layers.highlight!.addChild(hl);

    // Orders: planned (amber), submitted (white).
    const paths = new Graphics();
    const orders = s.submitted ?? s.draft;
    if (orders) {
      for (const id of Object.keys(orders.formations).sort()) {
        const f = v.formations[id];
        if (!f) continue;
        drawPath(paths, f.key, orders.formations[id]!, s.submitted ? 0xf4f1e8 : 0xe0a84a, id === s.selectedFormation ? 1 : 0.75);
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
    const W = 24;
    const H = 16;
    for (const [key, list] of byHex) {
      const c = center(key);
      // Selected counter draws last so it sits on top of its stack.
      const order = [...list].sort((m, n) => Number(m.selected) - Number(n.selected));
      order.forEach((m, i) => {
        const x = c.x - W / 2 - 3 + i * 3.5;
        const y = c.y - H / 2 - 1 - i * 3.5;
        const alpha = m.confirmed ? 1 : 0.45;
        if (m.selected) units.roundRect(x - 3, y - 3, W + 6, H + 9, 3).fill({ color: 0xffffff, alpha: 0.18 });
        units.rect(x, y, W, H).fill({ color: m.own ? m.color : 0x0d121c, alpha }).stroke({ width: m.selected ? 2 : 1.2, color: m.selected ? 0xffffff : m.own ? 0x070b12 : m.color, alpha });
        drawSymbol(units, m.cls, x, y, W, H, m.own ? 0x070b12 : m.color, alpha);
        // Strength strip under the counter.
        units.rect(x, y + H + 1, W, 2.5).fill({ color: 0x070b12, alpha: 0.8 * alpha });
        const sw = Math.max(1, Math.round((W * m.strength) / 1000));
        units.rect(x, y + H + 1, sw, 2.5).fill({ color: m.strength < 400 ? 0xd9534f : m.own ? 0x6fbf8e : m.color, alpha });
        if (m.own && !m.ordered && !s.submitted) units.circle(x + W, y, 2.6).fill({ color: 0xe0a84a }).stroke({ width: 1, color: 0x070b12 });
        if (!m.confirmed && i === order.length - 1) {
          const t = new Text({ text: '?', resolution: 3, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10, fontWeight: '800', fill: m.color } });
          t.anchor.set(0.5, 0.5);
          t.position.set(x + W + 5, y + H / 2);
          a.layers.units!.addChild(t);
        }
      });
    }
    a.layers.units!.addChildAt(units, 0);
  }

  useEffect(() => {
    redraw();
  }, [view, draft, submitted, report, selectedHex, selectedFormation, mode, reach]);

  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      if (s.showReport !== prev.showReport) redraw();
    });
    return unsub;
  }, []);

  useEffect(() => {
    const a = appRef.current;
    if (!a || !focus) return;
    const p = center(focus.key);
    const s = a.world.scale.x;
    a.world.position.set(a.app.screen.width / 2 - p.x * s, a.app.screen.height / 2 - p.y * s);
    publish();
  }, [focus]);

  return <div ref={host} className="absolute inset-0" />;
}
