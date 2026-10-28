import * as THREE from 'three';
import { ARENA_H, ARENA_W, BRIDGE, CLASSES, CRATE, idx, isSolid, TREE, WALL, WATER, type Arena, type ArenaEvent, type Level, type Point } from '@brink/arena';
import type { Terrain } from '@brink/contracts';
import { buildUnit, type UnitMesh } from './models';

// The arena drawn in three.js: a tilted top-down camera over a battlefield built from the level,
// lit like late afternoon, with shells, tracers, explosions and wrecks. The simulation owns every
// number; this only draws it.

/** Units draw larger than their hitboxes so they read on a phone screen. */
const UNIT_SCALE = 1.4;

const GROUND: Record<Terrain, [string, string, string]> = {
  plains: ['#6c7444', '#7b8450', '#5d653a'],
  forest: ['#4a5733', '#3f4b2b', '#56633c'],
  hills: ['#857652', '#94845d', '#766845'],
  mountains: ['#736d65', '#827b72', '#655f58'],
  urban: ['#55585b', '#5f6265', '#4b4e51'],
  water: ['#6c7444', '#7b8450', '#5d653a'],
};

interface UnitView {
  mesh: UnitMesh;
  bar: THREE.Group;
  fill: THREE.Mesh;
  wreck: boolean;
  smoke: number;
}

interface Fx {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (fx: Fx, dt: number) => void;
}

export class ArenaView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);
  private readonly units = new Map<string, UnitView>();
  private readonly shots = new Map<number, THREE.Object3D>();
  private readonly cells = new Map<number, THREE.Object3D>();
  private readonly fx: Fx[] = [];
  private readonly ring: THREE.Mesh;
  private reload: THREE.Mesh;
  private readonly aimLine: THREE.Line;
  private readonly zone: THREE.Group | null = null;
  private zoneFill: THREE.Mesh | null = null;
  private readonly flash = new THREE.PointLight(0xffb060, 0, 12, 2);
  private readonly explosion: THREE.Texture[] = [];
  private readonly smoke: THREE.Texture[] = [];
  private shake = 0;
  private readonly base = new THREE.Vector3();
  private readonly look = new THREE.Vector3(ARENA_W / 2, 0, ARENA_H / 2);
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private clock = 0;
  /** Screen space the HUD covers, as fractions of the height: [top, bottom]. */
  private hud: [number, number] = [0.12, 0.24];

  constructor(
    private readonly host: HTMLElement,
    arena: Arena,
    private readonly colors: { blue: string; red: string },
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
    this.scene.background = new THREE.Color(0x10151a);
    this.scene.fog = new THREE.Fog(0x10151a, 40, 80);

    // Light: a low sun from the south-west for long shadows, sky fill, warm bounce.
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3326, 0.85));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-8, 18, 22);
    sun.target.position.set(ARENA_W / 2, 0, ARENA_H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun, sun.target, this.flash);

    const loader = new THREE.TextureLoader();
    const base = `${import.meta.env.BASE_URL}art/fx/`;
    for (let i = 0; i < 9; i++) this.explosion.push(loader.load(`${base}explosion${i}.png`));
    for (let i = 0; i < 8; i++) this.smoke.push(loader.load(`${base}smoke${i}.png`));

    this.buildGround(arena.level);
    this.buildCells(arena.level);
    if (arena.level.zone) this.zone = this.buildZone(arena.level.zone);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.84, 40), new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.95 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.scene.add(this.ring);
    this.reload = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.98, 40, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.9 }));
    this.reload.rotation.x = -Math.PI / 2;
    this.reload.position.y = 0.035;
    this.scene.add(this.reload);
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.55 }));
    this.scene.add(this.aimLine);

    for (const u of arena.units) this.addUnit(u.id, u.cls, u.side === 'blue' ? colors.blue : colors.red);
    this.resize();
  }

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
    // Find the closest camera, at a fixed tilt, that keeps the whole field between the HUD bars.
    const tilt = (58 * Math.PI) / 180;
    const corners = [
      new THREE.Vector3(-0.3, 0, -0.3),
      new THREE.Vector3(ARENA_W + 0.3, 0, -0.3),
      new THREE.Vector3(-0.3, 0, ARENA_H + 0.3),
      new THREE.Vector3(ARENA_W + 0.3, 0, ARENA_H + 0.3),
      new THREE.Vector3(ARENA_W / 2, 2.2, -0.3),
    ];
    const top = 1 - this.hud[0] * 2;
    const bottom = -1 + this.hud[1] * 2;
    const fits = (d: number, shift: number) => {
      this.place(d, tilt, shift);
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return p.x >= -0.98 && p.x <= 0.98 && p.y <= top && p.y >= bottom;
      });
    };
    let best = 60;
    let bestShift = 0;
    for (const shift of [0, 1, 2, 3, -1, 4, 5]) {
      let lo = 8;
      let hi = 90;
      if (!fits(hi, shift)) continue;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid, shift)) hi = mid;
        else lo = mid;
      }
      if (hi < best) {
        best = hi;
        bestShift = shift;
      }
    }
    this.place(best, tilt, bestShift);
    this.base.copy(this.camera.position);
  }

  private place(d: number, tilt: number, shift: number): void {
    this.look.set(ARENA_W / 2, 0, ARENA_H / 2 + shift * 0.5);
    this.camera.position.set(this.look.x, Math.sin(tilt) * d, this.look.z + Math.cos(tilt) * d);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld(true);
  }

  /** Screen point to arena coordinates. */
  pick(clientX: number, clientY: number): Point | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    return { x: hit.x, y: hit.z };
  }

  /** Arena coordinates to client pixels (tests and the HUD). */
  toScreen(x: number, y: number): Point {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector3(x, 0, y).project(this.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  private buildGround(level: Level): void {
    const s = 32;
    const c = document.createElement('canvas');
    c.width = ARENA_W * s;
    c.height = ARENA_H * s;
    const g = c.getContext('2d')!;
    const [base, light, darkTone] = GROUND[level.terrain] ?? GROUND.plains;
    g.fillStyle = base;
    g.fillRect(0, 0, c.width, c.height);
    // Patchy ground: soft blotches of lighter and darker earth.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      g.globalAlpha = 0.18 + rnd() * 0.2;
      g.fillStyle = rnd() < 0.5 ? light : darkTone;
      g.beginPath();
      g.ellipse(rnd() * c.width, rnd() * c.height, 10 + rnd() * 40, 8 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (level.terrain === 'urban' || level.mode === 'capture') {
      // Streets: a grid of asphalt with kerbs.
      g.strokeStyle = 'rgba(220,220,210,0.22)';
      g.setLineDash([10, 10]);
      g.lineWidth = 2;
      for (let y = 1; y < ARENA_H; y += 4) {
        g.beginPath();
        g.moveTo(0, y * s);
        g.lineTo(c.width, y * s);
        g.stroke();
      }
      g.setLineDash([]);
    }
    for (let y = 0; y < ARENA_H; y++)
      for (let x = 0; x < ARENA_W; x++) {
        const cell = level.cells[idx(x, y)];
        if (cell === WATER) {
          g.fillStyle = '#2d5a73';
          g.fillRect(x * s, y * s, s, s);
          g.fillStyle = 'rgba(255,255,255,0.08)';
          g.fillRect(x * s + 4, y * s + 10, s - 8, 2);
        } else if (cell === BRIDGE) {
          g.fillStyle = '#6a6052';
          g.fillRect(x * s, y * s, s, s);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          for (let i = 0; i < 4; i++) g.fillRect(x * s, y * s + i * 8, s, 1);
        }
      }
    // Tyre tracks, for the feel of a fought-over field.
    g.strokeStyle = 'rgba(30,25,15,0.18)';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      const x0 = rnd() * c.width;
      g.moveTo(x0, c.height);
      g.bezierCurveTo(x0 + (rnd() - 0.5) * 200, c.height * 0.6, x0 + (rnd() - 0.5) * 200, c.height * 0.3, rnd() * c.width, 0);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(ARENA_W / 2, 0, ARENA_H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // A dark apron beyond the edge.
    // Unlit: a lit plane this size throws a sun glint off the far corner.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W + 40, ARENA_H + 40), new THREE.MeshBasicMaterial({ color: 0x151a1e }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(ARENA_W / 2, -0.02, ARENA_H / 2);
    this.scene.add(apron);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ARENA_W, 0.01, ARENA_H)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    edge.position.set(ARENA_W / 2, 0.01, ARENA_H / 2);
    this.scene.add(edge);
  }

  private buildCells(level: Level): void {
    const concrete = [0x8a8d90, 0x968e82, 0x7b7f84, 0xa09a8e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    const roof = new THREE.MeshStandardMaterial({ color: 0x3e4246, roughness: 0.9 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x22303a, roughness: 0.3, metalness: 0.5 });
    const rock = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 1, flatShading: true });
    const hesco = new THREE.MeshStandardMaterial({ color: 0xb29a69, roughness: 0.95 });
    const bags = new THREE.MeshStandardMaterial({ color: 0x9d8a5c, roughness: 1 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.9 });
    const leaf = [0x2f4a27, 0x38552c, 0x2a4023].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    const bark = new THREE.MeshStandardMaterial({ color: 0x4b3a28, roughness: 1 });
    let n = 0;
    for (let y = 0; y < ARENA_H; y++)
      for (let x = 0; x < ARENA_W; x++) {
        const i = idx(x, y);
        const cell = level.cells[i];
        const g = new THREE.Group();
        g.position.set(x + 0.5, 0, y + 0.5);
        n++;
        if (cell === WALL) {
          const style = level.style[i];
          if (style === 'building') {
            const h = level.height[i]! * 1.1;
            const m = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1), concrete[n % concrete.length]);
            m.position.y = h / 2;
            g.add(m);
            const r = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.9), roof);
            r.position.y = h + 0.02;
            g.add(r);
            for (let f = 0.45; f < h - 0.2; f += 0.55) {
              const w = new THREE.Mesh(new THREE.BoxGeometry(1.01, 0.14, 0.6), windowMat);
              w.position.y = f;
              g.add(w);
            }
          } else if (style === 'rock') {
            const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), rock);
            m.scale.set(1, 0.7 + (n % 3) * 0.15, 1);
            m.rotation.set(n, n * 2, 0);
            m.position.y = 0.32;
            g.add(m);
          } else if (style === 'hesco') {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.9, 0.96), hesco);
            m.position.y = 0.45;
            g.add(m);
          } else {
            const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.45, 0.8), bags);
            m.position.y = 0.22;
            g.add(m);
          }
        } else if (cell === CRATE) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), wood);
          m.position.y = 0.3;
          m.rotation.y = n * 0.7;
          g.add(m);
        } else if (cell === TREE) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), bark);
          trunk.position.y = 0.25;
          g.add(trunk);
          const s = 0.8 + ((n * 37) % 10) / 25;
          for (const [h, r] of [
            [0.75, 0.48],
            [1.15, 0.36],
          ] as const) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(r * s, 0.7 * s, 7), leaf[n % leaf.length]);
            c.position.y = h * s;
            g.add(c);
          }
          g.position.x += ((n * 13) % 7) / 30 - 0.1;
        } else continue;
        g.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.scene.add(g);
        this.cells.set(i, g);
      }
  }

  private buildZone(z: { x: number; y: number; r: number }): THREE.Group {
    const g = new THREE.Group();
    g.position.set(z.x, 0.025, z.y);
    const edge = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.08, z.r, 64), new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.9 }));
    edge.rotation.x = -Math.PI / 2;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(z.r - 0.08, 64), new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.1 }));
    fill.rotation.x = -Math.PI / 2;
    g.add(edge, fill);
    this.zoneFill = fill;
    this.scene.add(g);
    return g;
  }

  private addUnit(id: string, cls: Parameters<typeof buildUnit>[0], color: string): void {
    const mesh = buildUnit(cls, color);
    // Chunkier than the hitbox, as in the old tank games: readable on a phone.
    mesh.root.scale.setScalar(UNIT_SCALE);
    mesh.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.scene.add(mesh.root);
    // Health bar, facing the camera.
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.09), new THREE.MeshBasicMaterial({ color: 0x0d1114, transparent: true, opacity: 0.8, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.06), new THREE.MeshBasicMaterial({ color: 0x4fd18b, depthTest: false }));
    fill.position.z = 0.001;
    bg.renderOrder = 10;
    fill.renderOrder = 11;
    bar.add(bg, fill);
    this.scene.add(bar);
    // Aircraft cast a shadow blob on the ground.
    if (mesh.lift > 0) {
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
      blob.rotation.x = -Math.PI / 2;
      blob.name = 'blob';
      this.scene.add(blob);
      mesh.root.userData.blob = blob;
    }
    this.units.set(id, { mesh, bar, fill, wreck: false, smoke: 0 });
  }

  /** Draw the arena as it is now, plus the effects of this frame's events. */
  render(a: Arena, dt: number, aim: Point | null): void {
    this.clock += dt;
    for (const e of a.events) this.onEvent(a, e);

    for (const u of a.units) {
      const v = this.units.get(u.id);
      if (!v) continue;
      const m = v.mesh;
      if (!u.alive && !v.wreck) this.wreck(v, u.cls);
      const bob = m.lift > 0 && u.alive ? Math.sin(this.clock * 2 + u.x) * 0.06 : 0;
      m.root.position.set(u.x, (u.alive ? m.lift * UNIT_SCALE : 0) + bob, u.y);
      // Three.js turns counter-clockwise about +y; the arena's angles run clockwise seen from above.
      m.root.rotation.y = -u.angle;
      m.turret.rotation.y = -(u.aim - u.angle);
      if (u.alive) for (const r of m.rotors) r.rotation.y += dt * 40;
      const flash = u.hitT < 0.12 ? 1 - u.hitT / 0.12 : 0;
      for (const p of m.paint) {
        p.emissive.setRGB(flash * 0.9, flash * 0.15, flash * 0.05);
      }
      const blob = m.root.userData.blob as THREE.Mesh | undefined;
      if (blob) {
        blob.visible = u.alive;
        blob.position.set(u.x + 0.35, 0.02, u.y + 0.35);
      }
      v.bar.visible = u.alive && u.hp < u.maxHp;
      v.bar.position.set(u.x, m.lift * UNIT_SCALE + 1.2, u.y - 0.1);
      v.bar.quaternion.copy(this.camera.quaternion);
      const r = Math.max(0, u.hp / u.maxHp);
      v.fill.scale.x = Math.max(0.001, r);
      v.fill.position.x = -0.38 * (1 - r);
      (v.fill.material as THREE.MeshBasicMaterial).color.setHex(r > 0.6 ? 0x4fd18b : r > 0.3 ? 0xffc23d : 0xff5a4e);
      if (v.wreck) {
        v.smoke -= dt;
        if (v.smoke <= 0) {
          v.smoke = 0.35;
          this.puff(u.x, 0.4, u.y, 0.9, 2.2, 0.5);
        }
      }
    }

    // The unit you drive: a ring, a reload arc, and where its next shell would go.
    const me = a.units.find((u) => u.id === a.controlled && u.alive);
    this.ring.visible = this.reload.visible = !!me;
    this.aimLine.visible = false;
    if (me) {
      this.ring.position.set(me.x, 0.03, me.y);
      const frac = me.cooldown > 0 ? 1 - me.cooldown / me.reload : 1;
      this.reload.geometry.dispose();
      this.reload.geometry = new THREE.RingGeometry(0.9, 0.98, 40, 1, Math.PI / 2, Math.PI * 2 * frac);
      this.reload.position.set(me.x, 0.035, me.y);
      (this.reload.material as THREE.MeshBasicMaterial).color.setHex(frac >= 1 ? 0x4fd18b : 0xffc23d);
      const kind = CLASSES[me.cls].weapon.kind;
      if (kind === 'shell' || kind === 'cannon' || kind === 'rocket' || kind === 'bullet') {
        const dir = aim ? Math.atan2(aim.y - me.y, aim.x - me.x) : me.aim;
        const pts = tracePath(a.level, me.x, me.y, dir, CLASSES[me.cls].weapon.range, kind === 'shell' ? 1 : 0);
        this.aimLine.geometry.dispose();
        this.aimLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, 0.12, p.y)));
        this.aimLine.computeLineDistances();
        this.aimLine.visible = true;
      }
    }

    this.drawShots(a);
    if (this.zoneFill && a.level.zone) {
      const p = a.capture / 6;
      (this.zoneFill.material as THREE.MeshBasicMaterial).opacity = 0.08 + p * 0.4;
      this.zone!.scale.setScalar(1 + Math.sin(this.clock * 3) * 0.01);
    }

    for (const f of this.fx) {
      f.t += dt;
      f.update(f, dt);
    }
    for (const f of this.fx.filter((x) => x.t >= x.life)) {
      this.scene.remove(f.obj);
      f.obj.traverse((o) => {
        const mm = o as THREE.Mesh | THREE.Sprite;
        if ('geometry' in mm && mm.geometry && !(mm as THREE.Sprite).isSprite) mm.geometry.dispose();
        const mat = (mm as THREE.Mesh).material as THREE.Material | undefined;
        if (mat && !(o as THREE.Sprite).isSprite) mat.dispose();
      });
    }
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i]!.t >= this.fx[i]!.life) this.fx.splice(i, 1);

    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 160);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.5;
    this.camera.position.set(this.base.x + (Math.random() - 0.5) * s, this.base.y + (Math.random() - 0.5) * s, this.base.z + (Math.random() - 0.5) * s);
    this.renderer.render(this.scene, this.camera);
  }

  private drawShots(a: Arena): void {
    const live = new Set<number>();
    for (const s of a.shots) {
      live.add(s.id);
      let o = this.shots.get(s.id);
      if (!o) {
        o = this.makeShot(s.kind, s.side === 'blue');
        this.shots.set(s.id, o);
        this.scene.add(o);
      }
      if (s.arc) {
        const p = Math.min(1, s.arc.t / s.arc.dur);
        const h = s.kind === 'lob' ? 5 * Math.sin(Math.PI * p) : 2.2 * (1 - p) + 0.2;
        o.position.set(s.x, h + 0.3, s.y);
        const mark = o.userData.mark as THREE.Mesh | undefined;
        if (mark) {
          mark.position.set(s.arc.x1 - s.x, -h - 0.27, s.arc.y1 - s.y);
          mark.scale.setScalar(0.6 + p * 0.6);
        }
      } else {
        o.position.set(s.x, 0.35, s.y);
        o.rotation.y = -Math.atan2(s.vy, s.vx);
        if (Math.random() < 0.5 && (s.kind === 'rocket' || s.homing)) this.puff(s.x, 0.35, s.y, 0.25, 0.6, 0.2);
      }
    }
    for (const [id, o] of this.shots)
      if (!live.has(id)) {
        this.scene.remove(o);
        this.shots.delete(id);
      }
  }

  private makeShot(kind: string, blue: boolean): THREE.Object3D {
    const g = new THREE.Group();
    const hot = new THREE.MeshBasicMaterial({ color: kind === 'bullet' || kind === 'cannon' ? 0xffe28a : 0xffb347 });
    if (kind === 'shell') {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 2, 6), hot);
      m.rotation.z = Math.PI / 2;
      g.add(m);
      const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.07), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      trail.rotation.x = -Math.PI / 2;
      trail.position.x = -0.4;
      g.add(trail);
    } else if (kind === 'bullet' || kind === 'cannon') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(kind === 'cannon' ? 0.32 : 0.24, 0.03, 0.03), hot);
      g.add(m);
    } else if (kind === 'rocket') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 6), new THREE.MeshStandardMaterial({ color: 0xd8d8d0 }));
      m.rotation.z = Math.PI / 2;
      g.add(m);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), hot);
      glow.position.x = -0.15;
      g.add(glow);
    } else {
      const m = new THREE.Mesh(new THREE.SphereGeometry(kind === 'lob' ? 0.1 : 0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a28, emissive: 0x552200 }));
      g.add(m);
      // Where it will land: a reticle on the ground, red if it is coming for you.
      const mark = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), new THREE.MeshBasicMaterial({ color: blue ? 0xffc23d : 0xff5a4e, transparent: true, opacity: 0.85 }));
      mark.rotation.x = -Math.PI / 2;
      g.add(mark);
      g.userData.mark = mark;
    }
    return g;
  }

  private onEvent(a: Arena, e: ArenaEvent): void {
    if (e.type === 'fire') {
      const u = a.units.find((x) => x.id === e.unit);
      const off = u ? CLASSES[u.cls].radius * UNIT_SCALE + 0.35 : 0.5;
      if (e.kind !== 'lob' && e.kind !== 'dive') this.muzzle(e.x + Math.cos(e.angle) * off, e.y + Math.sin(e.angle) * off, e.kind === 'shell' ? 0.8 : 0.4);
      else this.puff(e.x, 0.6, e.y, 0.6, 1, 0.4);
      if (e.kind === 'shell' && u?.id === a.controlled) this.shake = Math.max(this.shake, 0.35);
    } else if (e.type === 'boom') {
      this.boom(e.x, e.y, e.size);
      this.shake = Math.max(this.shake, Math.min(1.4, 0.4 + e.size * 0.45));
    } else if (e.type === 'bounce' || e.type === 'spark') {
      this.muzzle(e.x, e.y, 0.35);
    } else if (e.type === 'break') {
      const i = idx(Math.floor(e.x), Math.floor(e.y));
      const g = this.cells.get(i);
      if (g) {
        this.scene.remove(g);
        this.cells.delete(i);
      }
      this.puff(e.x, 0.3, e.y, 0.9, 1.2, 0.8);
    } else if (e.type === 'hit') {
      if (e.unit === a.controlled) this.shake = Math.max(this.shake, 0.6);
    }
  }

  private wreck(v: UnitView, _cls: string): void {
    v.wreck = true;
    v.bar.visible = false;
    for (const p of v.mesh.paint) {
      p.color.multiplyScalar(0.28);
      p.emissive.setRGB(0, 0, 0);
    }
    v.mesh.turret.rotation.z = 0.25;
    v.mesh.turret.position.y -= 0.03;
  }

  private sprite(tex: THREE.Texture, additive: boolean): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    return s;
  }

  private muzzle(x: number, y: number, size: number): void {
    const s = this.sprite(this.explosion[1]!, true);
    s.position.set(x, 0.4, y);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.fx.push({ obj: s, t: 0, life: 0.09, update: (f) => s.scale.setScalar(size * (1 + f.t * 6)) });
  }

  private boom(x: number, y: number, size: number): void {
    const s = this.sprite(this.explosion[0]!, true);
    s.position.set(x, 0.6, y);
    this.scene.add(s);
    const frames = this.explosion;
    this.fx.push({
      obj: s,
      t: 0,
      life: 0.55,
      update: (f) => {
        const i = Math.min(frames.length - 1, Math.floor((f.t / f.life) * frames.length));
        s.material.map = frames[i]!;
        s.scale.setScalar(size * 2.4 * (0.6 + f.t * 1.4));
        s.material.opacity = 1 - (f.t / f.life) * 0.6;
      },
    });
    this.flash.position.set(x, 1.5, y);
    this.flash.intensity = 40 * Math.min(2, size);
    // A scorch mark that stays.
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(size * 0.55, 20), new THREE.MeshBasicMaterial({ color: 0x0b0a08, transparent: true, opacity: 0.42, depthWrite: false }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(x, 0.012 + Math.random() * 0.004, y);
    this.scene.add(scorch);
    for (let i = 0; i < 3; i++) this.puff(x + (Math.random() - 0.5) * size, 0.5, y + (Math.random() - 0.5) * size, 1.2 * size, 1.6, 1.4);
  }

  private puff(x: number, h: number, y: number, size: number, rise: number, life: number): void {
    const s = this.sprite(this.smoke[Math.floor(Math.random() * this.smoke.length)]!, false);
    s.position.set(x, h, y);
    s.material.opacity = 0.55;
    s.material.rotation = Math.random() * Math.PI * 2;
    this.scene.add(s);
    this.fx.push({
      obj: s,
      t: 0,
      life,
      update: (f, dt) => {
        s.position.y += rise * dt;
        s.scale.setScalar(size * (0.5 + f.t / f.life));
        s.material.opacity = 0.55 * (1 - f.t / f.life);
      },
    });
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }
}

/** Where a shot fired from (x, y) at `angle` would travel, bouncing off walls `bounces` times. */
export function tracePath(level: Level, x: number, y: number, angle: number, range: number, bounces: number): Point[] {
  const pts: Point[] = [{ x, y }];
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let px = x + dx * 0.6;
  let py = y + dy * 0.6;
  let left = range * 1.5;
  let b = bounces;
  while (left > 0) {
    const nx = px + dx * 0.1;
    const ny = py + dy * 0.1;
    left -= 0.1;
    const solid = isSolid(level, Math.floor(nx), Math.floor(ny)) || level.cells[idx(Math.floor(nx), Math.floor(ny))] === TREE;
    if (solid) {
      pts.push({ x: px, y: py });
      if (b <= 0 || level.cells[idx(Math.floor(nx), Math.floor(ny))] === TREE) return pts;
      const bx = isSolid(level, Math.floor(nx), Math.floor(py));
      const by = isSolid(level, Math.floor(px), Math.floor(ny));
      if (bx || !by) dx = -dx;
      if (by || !bx) dy = -dy;
      b -= 1;
      continue;
    }
    px = nx;
    py = ny;
  }
  pts.push({ x: px, y: py });
  return pts;
}
