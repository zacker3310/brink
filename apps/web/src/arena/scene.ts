import * as THREE from 'three';
import { ARENA_H, ARENA_W, CLASSES, type Arena, type ArenaEvent, type Point, type Side, type WeaponKind } from '@brink/arena';
import type { UnitClass } from '@brink/contracts';
import { arenaSfx } from '../sfx';
import { fallbackUnit, realUnit, type Library, type RealUnit } from './assets';
import { buildField, type Field } from './terrain';

// The battle drawn in three.js: a tilted camera over a battlefield built from the level, lit by a
// real sky (image-based light) and a low sun with soft shadows. The tactics engine decides
// everything at once; this plays its event log back as a film: tanks drive cell to cell and turn
// their turrets, guns flash, tracers and shells fly, hits burst, wrecks burn and smoke.

const HAZE = 0x8d9aa0;
const BLUE_RING = 0x4fb3ff;
const RED_RING = 0xff5a4e;

interface Step {
  dur: number;
  t: number;
  started: boolean;
  start?: () => void;
  tick?: (k: number, dt: number) => void;
  end?: () => void;
}

interface Fx {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (fx: Fx, dt: number) => void;
}

interface UnitView {
  id: string;
  side: Side;
  cls: UnitClass;
  model: RealUnit;
  holder: THREE.Group;
  ring: THREE.Mesh;
  bar: THREE.Group;
  fill: THREE.Mesh;
  marker: THREE.Sprite;
  dug: THREE.Object3D | null;
  x: number;
  z: number;
  facing: number;
  aim: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  wreck: boolean;
  smokeT: number;
  flash: number;
  /** Aircraft falling out of the sky. */
  fall: number;
}

export interface Overlay {
  selected: string | null;
  /** Cells the selected unit can move to. */
  reach: number[];
  /** The route to the cell under the pointer. */
  path: Point[] | null;
  /** Enemies the selected unit can fire at. */
  targets: string[];
  /** An area strike being aimed: its centre cell and radius. */
  area: { at: Point; r: number } | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, k: number) => a + wrap(b - a) * k;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
/** Grid heading to a three.js yaw for a model that faces +z. */
const yawOf = (facing: number) => Math.PI / 2 - facing;

function textSprite(text: string, color: string, size = 0.5): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '900 64px "Geist", "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 50);
  g.fillStyle = color;
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(size * 2.67, size, 1);
  s.renderOrder = 20;
  return s;
}

function tileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(4, 4, 56, 56);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.strokeRect(5, 5, 54, 54);
  return new THREE.CanvasTexture(c);
}

export class BattleView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.3, 160);
  private readonly units = new Map<string, UnitView>();
  private readonly field: Field;
  private readonly steps: Step[] = [];
  private readonly fx: Fx[] = [];
  private readonly explosion: THREE.Texture[] = [];
  private readonly smoke: THREE.Texture[] = [];
  private readonly flashLight = new THREE.PointLight(0xffa860, 0, 6, 2);
  private readonly tiles: THREE.InstancedMesh;
  private readonly areaTiles: THREE.InstancedMesh;
  private readonly targetRings: THREE.InstancedMesh;
  private readonly selRing: THREE.Mesh;
  private pathLine: THREE.Mesh | null = null;
  private readonly zone: THREE.Group | null = null;
  private zoneGlow = 0;
  private readonly mineMarks = new THREE.Group();
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hud: [number, number] = [0.12, 0.24];
  private readonly tilt = (54 * Math.PI) / 180;
  /** Zoomed all the way out: the whole board in view. */
  private far = 60;
  private readonly farFocus = new THREE.Vector3(ARENA_W / 2, 0, ARENA_H / 2);
  private dist = 30;
  private wantDist = 30;
  private readonly focus = new THREE.Vector3(ARENA_W / 2, 0, ARENA_H / 2);
  private readonly wantFocus = new THREE.Vector3(ARENA_W / 2, 0, ARENA_H / 2);
  private framed = false;
  private shake = 0;
  private clock = 0;
  private overlay: Overlay = { selected: null, reach: [], path: null, targets: [], area: null };

  constructor(
    private readonly host: HTMLElement,
    private readonly arena: Arena,
    private readonly colors: { blue: string; red: string },
    private readonly lib: Library | null,
    seed: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('data-testid', 'arena-canvas');
    this.renderer.domElement.style.touchAction = 'none';
    // setSize(..., false) leaves CSS alone: pin it to the host or a 2x screen shows a quarter of the field.
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.renderer.domElement);

    // Light: the sky itself (a Poly Haven HDRI) for ambient and reflections, a low sun for shadows.
    this.scene.background = new THREE.Color(HAZE);
    this.scene.fog = new THREE.Fog(HAZE, 34, 75);
    if (lib) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromEquirectangular(lib.env).texture;
      this.scene.environmentIntensity = 0.6;
      pmrem.dispose();
    } else this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3326, 1.1));
    const sun = new THREE.DirectionalLight(0xffe9d2, 3.1);
    sun.position.set(ARENA_W / 2 - 14, 22, ARENA_H / 2 + 9);
    sun.target.position.set(ARENA_W / 2, 0, ARENA_H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 19, bottom: -19, near: 1, far: 70 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target, this.flashLight);

    const loader = new THREE.TextureLoader();
    const fxBase = `${import.meta.env.BASE_URL}art/fx/`;
    for (let i = 0; i < 9; i++) this.explosion.push(loader.load(`${fxBase}explosion${i}.png`, (t) => (t.colorSpace = THREE.SRGBColorSpace)));
    for (let i = 0; i < 8; i++) this.smoke.push(loader.load(`${fxBase}smoke${i}.png`, (t) => (t.colorSpace = THREE.SRGBColorSpace)));

    this.field = buildField(arena.level, seed, lib);
    this.scene.add(this.field.group);
    if (arena.level.zone) this.zone = this.buildZone(arena.level.zone);
    this.scene.add(this.mineMarks);

    // Selection overlays.
    const tileTex = tileTexture();
    const tileGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    this.tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ map: tileTex, color: BLUE_RING, transparent: true, opacity: 0.4, depthWrite: false }), ARENA_W * ARENA_H);
    this.areaTiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ map: tileTex, color: RED_RING, transparent: true, opacity: 0.8, depthWrite: false }), 25);
    const ringGeo = new THREE.RingGeometry(0.4, 0.48, 40).rotateX(-Math.PI / 2);
    this.targetRings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.95, depthWrite: false }), 16);
    for (const m of [this.tiles, this.areaTiles, this.targetRings]) {
      m.count = 0;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.scene.add(m);
    }
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.54, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
    this.selRing.visible = false;
    this.selRing.renderOrder = 3;
    this.scene.add(this.selRing);

    for (const u of arena.units) this.addUnit(u.id, u.side, u.cls, u.x, u.y, u.facing, u.hp, u.maxHp, u.dug);
    this.resize();
  }

  // --- Camera ------------------------------------------------------------------------------------

  /** The HUD covers the top and bottom of the screen; keep the battlefield framed between them. */
  setHud(top: number, bottom: number): void {
    this.hud = [top, bottom];
    this.resize();
  }

  resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Zoomed all the way out: the closest camera that keeps the whole field between the HUD bars.
    const corners = [new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(ARENA_W + 0.2, 0, -0.2), new THREE.Vector3(-0.2, 0, ARENA_H + 0.2), new THREE.Vector3(ARENA_W + 0.2, 0, ARENA_H + 0.2)];
    const fits = (d: number, z: number) => {
      this.place(new THREE.Vector3(ARENA_W / 2, 0, z), d);
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return p.x >= -0.98 && p.x <= 0.98 && p.y <= 1 - this.hud[0] * 2 && p.y >= -1 + this.hud[1] * 2;
      });
    };
    let best = 90;
    let bestZ = ARENA_H / 2;
    for (const z of [ARENA_H / 2, ARENA_H / 2 - 1, ARENA_H / 2 + 1, ARENA_H / 2 - 2, ARENA_H / 2 + 2, ARENA_H / 2 - 3]) {
      let lo = 4;
      let hi = 120;
      if (!fits(hi, z)) continue;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid, z)) hi = mid;
        else lo = mid;
      }
      if (hi < best) {
        best = hi;
        bestZ = z;
      }
    }
    this.far = best;
    this.farFocus.set(ARENA_W / 2, 0, bestZ);
    if (!this.framed) {
      // Open close enough to see the models: a phone shows about nine cells across.
      this.framed = true;
      this.wantDist = this.dist = best * (w < h ? 0.55 : 0.62);
      const blue = [...this.units.values()].filter((u) => u.side === 'blue');
      const cx = blue.reduce((s, u) => s + u.x, 0) / Math.max(1, blue.length);
      const cz = blue.reduce((s, u) => s + u.z, 0) / Math.max(1, blue.length);
      this.wantFocus.set(blue.length ? cx : ARENA_W / 2, 0, blue.length ? cz - 3 : ARENA_H / 2);
      this.clampFocus(this.wantFocus);
      this.focus.copy(this.wantFocus);
    }
    this.wantDist = Math.max(this.far * 0.28, Math.min(this.far, this.wantDist));
    this.applyCamera(0);
  }

  /** Camera over a focus point at a distance, with the focus centred between the HUD bars. */
  private place(focus: THREE.Vector3, d: number): void {
    const band = (1 - this.hud[0] * 2 + (-1 + this.hud[1] * 2)) / 2;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const look = new THREE.Vector3(focus.x, 0, focus.z + (d * band * half) / Math.sin(this.tilt));
    this.camera.position.set(look.x, Math.sin(this.tilt) * d, look.z + Math.cos(this.tilt) * d);
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld(true);
  }

  private clampFocus(f: THREE.Vector3): void {
    // Zoomed out, the board is centred; zoomed in, the focus may roam the whole board.
    const k = Math.max(0, Math.min(1, (this.far - this.wantDist) / (this.far * 0.6)));
    f.x = THREE.MathUtils.lerp(this.farFocus.x, Math.max(0.5, Math.min(ARENA_W - 0.5, f.x)), k);
    f.z = THREE.MathUtils.lerp(this.farFocus.z, Math.max(0.5, Math.min(ARENA_H - 0.5, f.z)), k);
  }

  private applyCamera(dt: number): void {
    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * 5);
    this.clampFocus(this.wantFocus);
    this.focus.lerp(this.wantFocus, k);
    this.dist += (this.wantDist - this.dist) * k;
    this.place(this.focus, this.dist);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.dist * 1.4;
    fog.far = this.dist * 3.6;
  }

  /** Drag the board by a screen distance (pixels). */
  panBy(dx: number, dy: number): void {
    const h = this.host.clientHeight || 1;
    const perPx = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    this.wantFocus.x -= dx * perPx;
    this.wantFocus.z -= (dy * perPx) / Math.sin(this.tilt);
    this.clampFocus(this.wantFocus);
    this.focus.copy(this.wantFocus);
  }

  /** Zoom in (factor below 1) or out. */
  zoomBy(factor: number): void {
    this.wantDist = Math.max(this.far * 0.28, Math.min(this.far, this.wantDist * factor));
  }

  /** Bring a cell into view if it is near the edge or off screen; `centre` always centres it. */
  follow(x: number, z: number, centre = false): void {
    const p = new THREE.Vector3(x, 0, z).project(this.camera);
    const top = 1 - this.hud[0] * 2;
    const bottom = -1 + this.hud[1] * 2;
    const margin = 0.28;
    if (centre || Math.abs(p.x) > 1 - margin || p.y > top - margin || p.y < bottom + margin) this.wantFocus.set(x, 0, z);
  }

  /** Centre the camera on a cell. */
  focusOn(cell: Point): void {
    this.follow(cell.x + 0.5, cell.y + 0.5);
  }

  /** The cell under a screen point, or null off the field. */
  pick(clientX: number, clientY: number): Point | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    return x >= 0 && y >= 0 && x < ARENA_W && y < ARENA_H ? { x, y } : null;
  }

  /** A cell's centre (at a height) in client pixels: tests and the HUD's labels. */
  toScreen(x: number, y: number, h = 0): Point {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector3(x + 0.5, h, y + 0.5).project(this.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Where a unit is drawn right now, in client pixels (above its model). */
  unitScreen(id: string): Point | null {
    const v = this.units.get(id);
    if (!v || !v.alive) return null;
    return this.toScreen(v.x - 0.5, v.z - 0.5, (v.model.lift || 0) + 0.7);
  }

  // --- Building ----------------------------------------------------------------------------------

  private buildZone(z: { x: number; y: number; r: number }): THREE.Group {
    const g = new THREE.Group();
    g.position.set(z.x, 0.02, z.y);
    const edge = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.07, z.r, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.9, depthWrite: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(z.r - 0.07, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.08, depthWrite: false }));
    fill.name = 'fill';
    // A flagpole at the heart of it.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 6), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.7, roughness: 0.3 }));
    pole.position.y = 0.65;
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26, 8, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(this.colors.red), side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(0.22, 1.15, 0);
    flag.name = 'flag';
    flag.castShadow = true;
    g.add(edge, fill, pole, flag);
    this.scene.add(g);
    return g;
  }

  private addUnit(id: string, side: Side, cls: UnitClass, x: number, y: number, facing: number, hp: number, maxHp: number, dug: boolean): void {
    const color = side === 'blue' ? this.colors.blue : this.colors.red;
    const model = this.lib ? realUnit(this.lib, cls) : fallbackUnit(cls, color);
    const holder = new THREE.Group();
    holder.add(model.root);
    this.scene.add(holder);
    // The side's colour on the ground, like a unit's base on a tabletop.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: side === 'blue' ? BLUE_RING : RED_RING, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.renderOrder = 1;
    this.scene.add(ring);
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.085), new THREE.MeshBasicMaterial({ color: 0x0d1114, transparent: true, opacity: 0.85, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.05), new THREE.MeshBasicMaterial({ color: 0x4fd18b, depthTest: false }));
    fill.position.z = 0.001;
    bg.renderOrder = 10;
    fill.renderOrder = 11;
    bar.add(bg, fill);
    this.scene.add(bar);
    const marker = textSprite('◉ OVERWATCH', '#ffc23d', 0.22);
    marker.visible = false;
    this.scene.add(marker);
    const v: UnitView = { id, side, cls, model, holder, ring, bar, fill, marker, dug: null, x: x + 0.5, z: y + 0.5, facing, aim: facing, hp, maxHp, alive: true, wreck: false, smokeT: 0, flash: 0, fall: 0 };
    this.units.set(id, v);
    if (dug) this.setDug(v, true);
  }

  private setDug(v: UnitView, on: boolean): void {
    if (v.dug) {
      this.scene.remove(v.dug);
      v.dug = null;
    }
    if (!on || CLASSES[v.cls].flying) return;
    // A half ring of sandbags on the side facing the enemy.
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a8a62, roughness: 1 });
    const geo = new THREE.CapsuleGeometry(0.045, 0.1, 3, 6).rotateZ(Math.PI / 2);
    const toward = v.side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
    for (let i = 0; i < 9; i++) {
      const a = toward - 1.3 + (i / 8) * 2.6;
      for (const row of [0, 1]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Math.cos(a) * 0.5, 0.045 + row * 0.08, Math.sin(a) * 0.5);
        m.rotation.y = -a + Math.PI / 2 + row * 0.2;
        m.castShadow = true;
        g.add(m);
      }
    }
    g.position.set(v.x, 0, v.z);
    this.scene.add(g);
    v.dug = g;
  }

  // --- Overlay -----------------------------------------------------------------------------------

  setOverlay(o: Overlay): void {
    this.overlay = o;
    const m = new THREE.Matrix4();
    this.tiles.count = 0;
    for (const i of o.reach) {
      m.makeTranslation((i % ARENA_W) + 0.5, 0.025, Math.floor(i / ARENA_W) + 0.5);
      this.tiles.setMatrixAt(this.tiles.count++, m);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.areaTiles.count = 0;
    if (o.area) {
      for (let dy = -o.area.r; dy <= o.area.r; dy++)
        for (let dx = -o.area.r; dx <= o.area.r; dx++) {
          const x = o.area.at.x + dx;
          const y = o.area.at.y + dy;
          if (x < 0 || y < 0 || x >= ARENA_W || y >= ARENA_H) continue;
          m.makeTranslation(x + 0.5, 0.03, y + 0.5);
          this.areaTiles.setMatrixAt(this.areaTiles.count++, m);
        }
    }
    this.areaTiles.instanceMatrix.needsUpdate = true;
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }
    if (o.path && o.path.length > 1) {
      const curve = new THREE.CatmullRomCurve3(o.path.map((p) => new THREE.Vector3(p.x + 0.5, 0.06, p.y + 0.5)), false, 'centripetal', 0.2);
      this.pathLine = new THREE.Mesh(new THREE.TubeGeometry(curve, o.path.length * 6, 0.045, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      this.pathLine.renderOrder = 4;
      this.scene.add(this.pathLine);
    }
  }

  // --- Playback ----------------------------------------------------------------------------------

  /** True while the event log is still being played. */
  get busy(): boolean {
    return this.steps.length > 0;
  }

  /** Queue events to be played in order. */
  play(events: readonly ArenaEvent[]): void {
    for (const e of events) this.queue(e);
  }

  /** Skip to the end of what is queued (the HUD's fast-forward). */
  skip(): void {
    for (let n = 0; n < 2000 && this.steps.length; n++) {
      const s = this.steps[0]!;
      if (!s.started) {
        s.started = true;
        s.start?.();
      }
      s.tick?.(1, 0);
      s.end?.();
      this.steps.shift();
    }
  }

  private step(dur: number, s: Omit<Step, 'dur' | 't' | 'started'>): void {
    this.steps.push({ dur, t: 0, started: false, ...s });
  }

  private queue(e: ArenaEvent): void {
    const u = 'unit' in e ? this.units.get(e.unit) : undefined;
    switch (e.type) {
      case 'turn':
        this.step(0.25, {
          start: () => {
            for (const v of this.units.values()) {
              if (v.side !== e.side) continue;
              v.marker.visible = false;
              this.setDug(v, false);
            }
          },
        });
        break;
      case 'move': {
        if (!u) break;
        const pts = e.path.map((p) => new THREE.Vector2(p.x + 0.5, p.y + 0.5));
        const per = u.cls === 'infantry' ? 0.26 : u.cls === 'recon' || CLASSES[u.cls].flying ? 0.13 : 0.19;
        let dust = 0;
        this.step(per * (pts.length - 1) + 0.12, {
          start: () => {
            this.setDug(u, false);
            this.follow(pts.at(-1)!.x, pts.at(-1)!.y);
            if (u.cls !== 'infantry') arenaSfx.engine();
          },
          tick: (k, dt) => {
            const f = ease(k) * (pts.length - 1);
            const i = Math.min(pts.length - 2, Math.floor(f));
            const a = pts[i]!;
            const b = pts[i + 1]!;
            const t = f - i;
            u.x = a.x + (b.x - a.x) * t;
            u.z = a.y + (b.y - a.y) * t;
            const dir = Math.atan2(b.y - a.y, b.x - a.x);
            u.facing = lerpAngle(u.facing, dir, Math.min(1, dt * 14));
            u.aim = lerpAngle(u.aim, dir, Math.min(1, dt * 10));
            dust -= dt;
            if (dust <= 0 && !CLASSES[u.cls].flying && u.cls !== 'infantry') {
              dust = 0.08;
              this.puff(u.x - Math.cos(u.facing) * 0.4, 0.08, u.z - Math.sin(u.facing) * 0.4, 0.45, 0.25, 0.9, 0.35);
            }
          },
          end: () => {
            const last = pts.at(-1)!;
            u.x = last.x;
            u.z = last.y;
          },
        });
        break;
      }
      case 'fire': {
        if (!u) break;
        const to = new THREE.Vector3(e.to.x + 0.5, 0, e.to.y + 0.5);
        const target = e.target ? this.units.get(e.target) : undefined;
        if (target) to.y = (target.model.lift || 0) + 0.15;
        const kind = e.kind;
        const want = Math.atan2(e.to.y + 0.5 - u.z, e.to.x + 0.5 - u.x);
        // Turn the turret (a drone turns itself) first, with both ends of the shot in view.
        this.step(0.22, {
          start: () => this.follow((u.x + to.x) / 2, (u.z + to.z) / 2),
          tick: (_k, dt) => {
            u.aim = lerpAngle(u.aim, want, Math.min(1, dt * 16));
            if (CLASSES[u.cls].flying || u.cls === 'infantry') u.facing = lerpAngle(u.facing, want, Math.min(1, dt * 12));
          },
          end: () => {
            u.aim = want;
            if (CLASSES[u.cls].flying || u.cls === 'infantry') u.facing = want;
          },
        });
        if (kind === 'dive') {
          const from = new THREE.Vector3();
          this.step(0.55, {
            start: () => {
              from.set(u.x, u.model.lift, u.z);
              arenaSfx.dive();
            },
            tick: (k) => {
              u.x = from.x + (to.x - from.x) * k * k;
              u.z = from.z + (to.z - from.z) * k * k;
              u.model.lift = from.y * (1 - k * k) + 0.1;
            },
            end: () => {
              u.alive = false;
              u.holder.visible = false;
              u.ring.visible = false;
              u.bar.visible = false;
              if (!e.hit) this.boomAt(to.x + 0.3, to.z - 0.2, 0.7);
            },
          });
          break;
        }
        const dur = kind === 'area' ? 1.0 : kind === 'rocket' ? 0.45 : kind === 'mg' ? 0.5 : kind === 'autocannon' ? 0.42 : 0.3;
        // A miss lands short or wide of the target.
        const land = e.hit || kind === 'area' ? to.clone() : to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.1, 0, (Math.random() - 0.5) * 1.1));
        if (!e.hit && kind !== 'area') land.y = 0.02;
        let shots = 0;
        this.step(dur, {
          start: () => {
            const m = this.muzzleWorld(u);
            this.muzzle(m, kind);
            this.fireSound(kind);
            if (kind === 'area') this.lob(m, land, dur);
            else if (kind === 'rocket') this.rocket(m, land, dur);
            else this.tracer(m, land, kind === 'gun' ? 0.16 : 0.12, kind === 'gun' ? 0.09 : 0.035);
            shots = 1;
            if (kind === 'gun') this.shake = Math.max(this.shake, u.side === 'blue' ? 0.12 : 0.08);
          },
          tick: (k) => {
            // Bursts: more tracers through the step.
            const burst = kind === 'mg' ? 6 : kind === 'autocannon' ? 3 : 1;
            while (shots < burst && k >= shots / burst) {
              const m = this.muzzleWorld(u);
              this.muzzle(m, kind);
              this.fireSound(kind);
              const spread = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
              this.tracer(m, land.clone().add(spread), 0.12, 0.03);
              shots++;
            }
          },
          end: () => {
            if (kind === 'area') return;
            if (e.hit) this.impact(land, kind === 'gun' || kind === 'rocket' ? 0.9 : 0.5);
            else {
              this.puff(land.x, 0.1, land.z, 0.7, 0.6, 1.1, 0.6, 0x8a7a5a);
              arenaSfx.miss();
            }
          },
        });
        break;
      }
      case 'hit': {
        if (!u) break;
        this.step(0.32, {
          start: () => {
            u.hp = Math.max(0, u.hp - e.damage);
            u.flash = 1;
            this.floater(`-${e.damage}`, '#ff6a5e', u);
            arenaSfx.hurt();
            if (e.damage > 30) this.shake = Math.max(this.shake, 0.18);
          },
        });
        break;
      }
      case 'miss':
        if (!u) break;
        this.step(0.22, { start: () => this.floater('MISS', '#e9eef2', u) });
        break;
      case 'boom':
        this.step(0.22, { start: () => this.boomAt(e.x + 0.5, e.y + 0.5, e.size) });
        break;
      case 'destroyed': {
        if (!u) break;
        this.step(u.cls === 'drone' && !u.holder.visible ? 0.05 : 0.75, {
          start: () => {
            if (!u.holder.visible) return;
            if (CLASSES[u.cls].flying) u.fall = 0.001;
            else this.wreck(u);
            this.boomAt(u.x, u.z, u.cls === 'infantry' ? 0.8 : 1.4);
            this.shake = Math.max(this.shake, 0.35);
          },
          tick: (k) => {
            if (u.fall > 0) {
              u.fall = k;
              u.model.lift = Math.max(0, (CLASSES[u.cls].flying ? 2 : 0) * (1 - k * k));
              u.facing += 0.25;
            }
          },
          end: () => {
            if (u.fall > 0 && !u.wreck) {
              this.wreck(u);
              this.boomAt(u.x, u.z, 1.2);
            }
            u.alive = false;
            u.ring.visible = false;
            u.bar.visible = false;
            u.marker.visible = false;
          },
        });
        break;
      }
      case 'break':
        this.step(0.05, {
          start: () => {
            this.field.clear(e.x, e.y);
            this.puff(e.x + 0.5, 0.3, e.y + 0.5, 1, 0.8, 1.4, 0.7, 0x6b5a40);
          },
        });
        break;
      case 'mine':
        this.step(0.1, { start: () => this.refreshMines() });
        break;
      case 'dig':
        if (!u) break;
        this.step(0.3, { start: () => this.setDug(u, true) });
        break;
      case 'overwatch':
        if (!u) break;
        this.step(0.3, { start: () => (u.marker.visible = true) });
        break;
      case 'ability':
        this.step(e.id === 'airstrike' ? 0.7 : 0.5, {
          start: () => {
            arenaSfx.ability();
            if (e.id === 'mines') this.refreshMines();
            else if (e.id === 'repair') {
              const v = [...this.units.values()].find((x) => Math.round(x.x - 0.5) === e.x && Math.round(x.z - 0.5) === e.y && x.alive);
              const real = v ? this.arena.units.find((x) => x.id === v.id) : undefined;
              if (v && real) {
                const gain = real.hp - v.hp;
                v.hp = real.hp;
                if (gain > 0) this.floater(`+${gain}`, '#4fd18b', v);
              }
            } else if (e.id === 'sweep') this.pulse(new THREE.Vector3(ARENA_W / 2, 0.05, ARENA_H / 2), 0x4fb3ff, 18);
            else if (e.id === 'airstrike') this.bombs(new THREE.Vector3(e.x + 0.5, 0, e.y + 0.5));
          },
        });
        break;
      case 'capture':
        this.step(0.4, {
          start: () => {
            this.zoneGlow = 1;
            arenaSfx.capture();
          },
        });
        break;
      case 'end':
        this.step(0.6, {});
        break;
    }
  }

  private refreshMines(): void {
    this.mineMarks.clear();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.7, metalness: 0.4 });
    const led = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
    for (const m of this.arena.mines) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 14), mat);
      disc.position.y = 0.025;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), led);
      dot.position.y = 0.06;
      g.add(disc, dot);
      g.position.set(m.x + 0.5, 0, m.y + 0.5);
      this.mineMarks.add(g);
    }
  }

  // --- Effects -----------------------------------------------------------------------------------

  private muzzleWorld(u: UnitView): THREE.Vector3 {
    u.holder.updateMatrixWorld(true);
    return u.model.turret.localToWorld(u.model.muzzle.clone());
  }

  private fireSound(kind: WeaponKind): void {
    if (kind === 'gun') arenaSfx.shell();
    else if (kind === 'autocannon') arenaSfx.cannon();
    else if (kind === 'mg') arenaSfx.bullet();
    else if (kind === 'rocket') arenaSfx.rocket();
    else if (kind === 'area') arenaSfx.lob();
  }

  private sprite(tex: THREE.Texture, additive: boolean, opacity = 1): THREE.Sprite {
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  }

  private addFx(obj: THREE.Object3D, life: number, update: Fx['update']): void {
    this.scene.add(obj);
    this.fx.push({ obj, t: 0, life, update });
  }

  private muzzle(at: THREE.Vector3, kind: WeaponKind): void {
    const size = kind === 'gun' || kind === 'area' ? 0.9 : kind === 'rocket' ? 0.6 : 0.35;
    const s = this.sprite(this.explosion[1]!, true);
    s.position.copy(at);
    this.addFx(s, 0.1, (f) => s.scale.setScalar(size * (0.6 + f.t * 8)));
    this.flashLight.position.copy(at);
    this.flashLight.intensity = kind === 'gun' || kind === 'area' ? 30 : 10;
    if (kind === 'gun' || kind === 'area') this.puff(at.x, at.y, at.z, 0.8, 0.4, 1.2, 0.55, 0xb8b0a0);
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3, life: number, width: number): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(width, width, Math.min(1.2, len * 0.35), 5).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(from);
    const look = new THREE.Object3D();
    look.position.copy(from);
    look.lookAt(to);
    m.quaternion.copy(look.quaternion);
    this.addFx(m, life, (f) => {
      m.position.lerpVectors(from, to, Math.min(1, f.t / f.life));
    });
  }

  private rocket(from: THREE.Vector3, to: THREE.Vector3, life: number): void {
    const s = this.sprite(this.explosion[2]!, true);
    s.scale.setScalar(0.3);
    let trail = 0;
    this.addFx(s, life, (f, dt) => {
      const k = Math.min(1, f.t / f.life);
      s.position.lerpVectors(from, to, k);
      s.position.y += Math.sin(k * Math.PI) * 0.25;
      trail -= dt;
      if (trail <= 0) {
        trail = 0.025;
        this.puff(s.position.x, s.position.y, s.position.z, 0.25, 0.1, 0.7, 0.5, 0xd8d4cc);
      }
    });
  }

  private lob(from: THREE.Vector3, to: THREE.Vector3, life: number): void {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
    const apex = Math.max(3, from.distanceTo(to) * 0.4);
    this.addFx(shell, life, (f) => {
      const k = Math.min(1, f.t / f.life);
      shell.position.lerpVectors(from, to, k);
      shell.position.y = from.y * (1 - k) + Math.sin(k * Math.PI) * apex;
    });
  }

  private bombs(at: THREE.Vector3): void {
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.25, 3, 8), new THREE.MeshStandardMaterial({ color: 0x2b2e2a, metalness: 0.5, roughness: 0.4 }));
      const x = at.x + (i - 1) * 0.6;
      this.addFx(b, 0.6, (f) => {
        const k = Math.min(1, f.t / f.life);
        b.position.set(x - 2 * (1 - k), 8 * (1 - k * k), at.z - 1 * (1 - k));
        b.rotation.z = 0.6 * (1 - k);
      });
    }
  }

  private impact(at: THREE.Vector3, size: number): void {
    const s = this.sprite(this.explosion[0]!, true);
    s.position.copy(at);
    const frames = this.explosion;
    this.addFx(s, 0.35, (f) => {
      const i = Math.min(frames.length - 1, Math.floor((f.t / f.life) * frames.length));
      s.material.map = frames[i]!;
      s.scale.setScalar(size * (0.6 + f.t * 2.5));
    });
    // Sparks off armour.
    for (let i = 0; i < 8; i++) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      spark.position.copy(at);
      this.addFx(spark, 0.45, (_f, dt) => {
        spark.position.addScaledVector(v, dt);
        v.y -= 9 * dt;
      });
    }
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 22;
    arenaSfx.boom(size * 0.6);
  }

  private boomAt(x: number, z: number, size: number): void {
    const s = this.sprite(this.explosion[0]!, true);
    s.position.set(x, 0.35 * size, z);
    const frames = this.explosion;
    this.addFx(s, 0.6, (f) => {
      const i = Math.min(frames.length - 1, Math.floor((f.t / f.life) * frames.length));
      s.material.map = frames[i]!;
      s.scale.setScalar(size * 1.8 * (0.5 + f.t * 1.6));
      s.material.opacity = 1 - (f.t / f.life) * 0.5;
    });
    this.flashLight.position.set(x, 1.2, z);
    this.flashLight.intensity = 45 * Math.min(2, size);
    // A scorch mark that stays, and debris thrown out.
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(size * 0.42, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b0a08, transparent: true, opacity: 0.5, depthWrite: false }));
    scorch.position.set(x, 0.014 + Math.random() * 0.004, z);
    scorch.renderOrder = 1;
    this.scene.add(scorch);
    for (let i = 0; i < 10; i++) {
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 1 }));
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4).multiplyScalar(0.6 + size * 0.3);
      chunk.position.set(x, 0.2, z);
      this.addFx(chunk, 0.9, (_f, dt) => {
        chunk.position.addScaledVector(v, dt);
        v.y -= 10 * dt;
        if (chunk.position.y < 0.02) {
          chunk.position.y = 0.02;
          v.set(0, 0, 0);
        }
        chunk.rotation.x += dt * 8;
      });
    }
    for (let i = 0; i < 4; i++) this.puff(x + (Math.random() - 0.5) * size * 0.6, 0.3, z + (Math.random() - 0.5) * size * 0.6, 1.4 * size, 0.9, 2.4, 0.7);
    arenaSfx.boom(size);
    this.shake = Math.max(this.shake, 0.12 * size);
  }

  private puff(x: number, h: number, z: number, size: number, rise: number, life: number, opacity = 0.6, tint = 0x9a948a): void {
    const s = this.sprite(this.smoke[Math.floor(Math.random() * this.smoke.length)]!, false, opacity);
    s.material.color.setHex(tint);
    s.position.set(x, h, z);
    s.material.rotation = Math.random() * Math.PI * 2;
    const drift = (Math.random() - 0.3) * 0.25;
    this.addFx(s, life, (f, dt) => {
      s.position.y += rise * dt;
      s.position.x += drift * dt;
      s.scale.setScalar(size * (0.35 + (f.t / f.life) * 0.9));
      s.material.opacity = opacity * (1 - f.t / f.life);
    });
  }

  private pulse(at: THREE.Vector3, color: number, r: number): void {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    ring.position.copy(at);
    this.addFx(ring, 0.9, (f) => {
      const k = f.t / f.life;
      ring.scale.setScalar(0.2 + k * r);
      (ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
  }

  private floater(text: string, color: string, v: UnitView): void {
    const s = textSprite(text, color, 0.36);
    const y0 = (v.model.lift || 0) + 0.8;
    s.position.set(v.x, y0, v.z);
    this.addFx(s, 1.1, (f) => {
      const k = f.t / f.life;
      s.position.y = y0 + k * 0.7;
      s.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    });
  }

  private wreck(v: UnitView): void {
    v.wreck = true;
    v.alive = false;
    v.bar.visible = false;
    v.ring.visible = false;
    v.marker.visible = false;
    this.setDug(v, false);
    for (const p of v.model.paint) {
      p.color.multiplyScalar(0.22);
      p.emissive?.setRGB(0, 0, 0);
      p.roughness = 1;
    }
    if (v.cls === 'infantry') {
      // The fireteam is down.
      v.model.turret.children.forEach((c, i) => {
        c.rotation.x = -Math.PI / 2;
        c.position.y = 0.03;
        c.rotation.z = i * 0.7;
      });
      v.model.mixer?.stopAllAction();
    } else {
      // The turret blown askew.
      v.model.turret.rotation.z = 0.22;
      v.model.turret.rotation.y += 0.5;
      v.model.turret.position.y += 0.03;
    }
  }

  // --- Frame -------------------------------------------------------------------------------------

  /** Advance the film and draw. */
  frame(dt: number): void {
    this.clock += dt;
    // Play queued steps; several short ones can pass in one frame.
    let budget = dt;
    while (this.steps.length && budget > 0) {
      const s = this.steps[0]!;
      if (!s.started) {
        s.started = true;
        s.start?.();
      }
      const use = Math.min(budget, s.dur - s.t);
      s.t += use;
      budget -= use;
      s.tick?.(s.dur > 0 ? Math.min(1, s.t / s.dur) : 1, use);
      if (s.t >= s.dur - 1e-6) {
        s.end?.();
        this.steps.shift();
      } else break;
    }

    for (const v of this.units.values()) {
      const m = v.model;
      const flying = CLASSES[v.cls].flying && v.alive && v.fall === 0;
      const bob = flying ? Math.sin(this.clock * 2 + v.x) * 0.05 : 0;
      v.holder.position.set(v.x, (v.wreck ? 0 : m.lift) + bob, v.z);
      v.holder.rotation.y = yawOf(v.facing);
      if (v.cls === 'air' && flying) v.holder.rotation.z = Math.sin(this.clock * 1.3 + v.z) * 0.04;
      m.turret.rotation.y = v.wreck ? m.turret.rotation.y : wrap(v.facing - v.aim);
      if (v.alive) for (const r of m.rotors) r.rotation.y += dt * 38;
      m.mixer?.update(dt);
      v.flash = Math.max(0, v.flash - dt * 5);
      for (const p of m.paint) p.emissive?.setRGB(v.flash * 0.8, v.flash * 0.12, v.flash * 0.05);
      v.ring.position.set(v.x, 0.016, v.z);
      v.bar.visible = v.alive && v.hp < v.maxHp;
      v.bar.position.set(v.x, (m.lift || 0) + 0.62, v.z - 0.05);
      v.bar.quaternion.copy(this.camera.quaternion);
      v.marker.position.set(v.x, (m.lift || 0) + 0.85, v.z);
      const r = Math.max(0, v.hp / v.maxHp);
      v.fill.scale.x = Math.max(0.001, r);
      v.fill.position.x = -0.31 * (1 - r);
      (v.fill.material as THREE.MeshBasicMaterial).color.setHex(r > 0.6 ? 0x4fd18b : r > 0.3 ? 0xffc23d : 0xff5a4e);
      if (v.wreck) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = 0.22;
          this.puff(v.x + (Math.random() - 0.5) * 0.2, 0.25, v.z + (Math.random() - 0.5) * 0.2, 0.9, 1.1, 2.6, 0.55, 0x2a2724);
          if (Math.random() < 0.5) {
            const fire = this.sprite(this.explosion[3]!, true, 0.8);
            fire.position.set(v.x + (Math.random() - 0.5) * 0.25, 0.2, v.z + (Math.random() - 0.5) * 0.25);
            this.addFx(fire, 0.3, (f) => {
              fire.scale.setScalar(0.35 + f.t);
              fire.material.opacity = 0.8 * (1 - f.t / f.life);
            });
          }
        }
      }
    }

    // Selection.
    const sel = this.overlay.selected ? this.units.get(this.overlay.selected) : undefined;
    this.selRing.visible = !!sel && sel.alive;
    if (sel) {
      this.selRing.position.set(sel.x, 0.02, sel.z);
      this.selRing.scale.setScalar(1 + Math.sin(this.clock * 5) * 0.05);
    }
    const m4 = new THREE.Matrix4();
    this.targetRings.count = 0;
    for (const id of this.overlay.targets) {
      const t = this.units.get(id);
      if (!t || !t.alive || this.targetRings.count >= 16) continue;
      m4.makeScale(1 + Math.sin(this.clock * 6) * 0.08, 1, 1 + Math.sin(this.clock * 6) * 0.08).setPosition(t.x, 0.022, t.z);
      this.targetRings.setMatrixAt(this.targetRings.count++, m4);
    }
    this.targetRings.instanceMatrix.needsUpdate = true;

    if (this.zone) {
      this.zoneGlow = Math.max(0, this.zoneGlow - dt * 0.8);
      const fill = this.zone.getObjectByName('fill') as THREE.Mesh;
      (fill.material as THREE.MeshBasicMaterial).opacity = 0.08 + this.arena.capture * 0.12 + this.zoneGlow * 0.3;
      const flag = this.zone.getObjectByName('flag') as THREE.Mesh;
      const pos = flag.geometry.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + 0.21;
        pos.setZ(i, Math.sin(this.clock * 5 + x * 9) * 0.03 * x * 4);
      }
      pos.needsUpdate = true;
      (flag.material as THREE.MeshStandardMaterial).color.set(this.arena.capture > 0 ? this.colors.blue : this.colors.red);
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      f.t += dt;
      f.update(f, dt);
      if (f.t >= f.life) {
        this.scene.remove(f.obj);
        const mesh = f.obj as THREE.Mesh;
        if (mesh.geometry && !(f.obj as THREE.Sprite).isSprite) mesh.geometry.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
        this.fx.splice(i, 1);
      }
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160);
    this.field.update(this.clock);

    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake;
    this.applyCamera(dt);
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
    this.camera.position.z += (Math.random() - 0.5) * s;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.field.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose?.();
    });
  }
}
