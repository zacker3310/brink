import * as THREE from 'three';
import { H, W, typeOf, type AirRing, type Point, type TypeId, type WatchArea } from '@brink/arena';
import type { UnitClass } from '@brink/contracts';
import { pictogramCanvas } from '../design/pictograms';
import { drawGlyph, type FacingGlyph } from './facing';
import { classOf } from './units';

// The part of the field that says what the player knows of the enemy, all of it worked out by the
// engine's insight.ts from the player's own observation: the Danger Area (or one enemy's reach),
// overwatch footprints, air-defence rings, likely target lines, the facing glyph at a move being
// looked at, last known positions fading with age, and the expected-enemy area clearing as it is
// scouted. Each kind has its own line style so overlapping threats stay apart: shading for reach,
// a solid edge for overwatch, rings (dashed when only suspected) for air defence, dashed arrows for
// likely targets. Merged ribbons and instanced tiles, rebuilt only when what they show changes.

export interface InsightOverlay {
  /** Danger Area: per cell, how many seen enemies could fire on it next turn; null hides it. */
  threat: readonly number[] | null;
  /** One enemy's reach (a long-press on it), as cells; drawn instead of the Danger Area. */
  threatOf: readonly number[] | null;
  /** Units on overwatch: theirs that you see and yours. */
  watch: readonly WatchArea[];
  /** Air-defence rings, or drone-interception squares. */
  air: readonly AirRing[];
  /** From a seen enemy to the unit of yours it would most likely shoot (a prediction). */
  likely: readonly { from: Point; to: Point }[];
  /** The facing glyph at the move being looked at. */
  glyph: { at: Point; g: FacingGlyph } | null;
  /** Last known enemy positions. */
  ghosts: readonly { x: number; y: number; type: TypeId; age: number }[];
  /** Cells of the expected-enemy area seen empty now (the layer remembers them). */
  scouted: readonly number[];
}

export interface PlaceLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  /** Pixels down the screen from the point, to clear the unit's badge and odds above it. */
  dy: number;
}

/** Danger Area shading by how many enemies reach a cell: one, two, three or more. */
const THREAT_ALPHA = [0.2, 0.34, 0.5] as const;
/** The dark edge under every stroke, so lines read on sand and snow as well as grass. */
const HALO = 0.07;
/** Ribbons sit just over the ground (the move area's tiles are at 0.04, its edge at 0.06). */
const LIFT = 0.075;
const GHOST_CLASSES: UnitClass[] = ['armor', 'mechanized', 'recon', 'artillery', 'air', 'drone', 'infantry'];
/** Last known positions fade with age (turns since seen), never quite away. */
const ghostAlpha = (age: number) => Math.max(0.28, 0.8 - 0.13 * Math.max(0, age - 1));

const inField = (x: number, z: number) => x >= 0 && z >= 0 && x <= W && z <= H;

/** Flat strips laid on the ground, each with its own colour and alpha, merged into one mesh. */
class Strokes {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  constructor(private readonly ground: (x: number, z: number) => number) {}

  private quad(ax: number, az: number, bx: number, bz: number, w: number, c: THREE.Color, a: number): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) return;
    const ya = this.ground(ax, az) + LIFT;
    const yb = this.ground(bx, bz) + LIFT;
    // A dark halo first, then the colour on it (one mesh draws in order).
    for (const [width, r, g, b, alpha] of [
      [w + HALO, 0, 0, 0, a * 0.4],
      [w, c.r, c.g, c.b, a],
    ] as const) {
      const nx = (-(bz - az) / len) * (width / 2);
      const nz = ((bx - ax) / len) * (width / 2);
      this.pos.push(ax + nx, ya, az + nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz, ax + nx, ya, az + nz, bx - nx, yb, bz - nz, ax - nx, ya, az - nz);
      for (let i = 0; i < 6; i++) this.col.push(r, g, b, alpha);
    }
  }

  /** A strip from a to b following the ground; `dash` > 0 draws dashes that long with gaps as long. */
  line(ax: number, az: number, bx: number, bz: number, w: number, c: THREE.Color, a: number, dash = 0): void {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      if (dash > 0 && Math.floor((t0 * len) / dash) % 2 === 1) continue;
      this.quad(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, w, c, a);
    }
  }

  /** A circle round a cell centre, cut to the field; dashed for what is only suspected. */
  ring(cx: number, cz: number, r: number, w: number, c: THREE.Color, a: number, dashed: boolean): void {
    const n = Math.max(48, Math.ceil((2 * Math.PI * r) / 0.3));
    for (let i = 0; i < n; i++) {
      if (dashed && i % 2 === 1) continue;
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const mx = cx + Math.cos((a0 + a1) / 2) * r;
      const mz = cz + Math.sin((a0 + a1) / 2) * r;
      if (!inField(mx, mz)) continue;
      this.quad(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, w, c, a);
    }
  }

  /** The edge of the cells within `r` (Chebyshev) of a cell. */
  square(x: number, y: number, r: number, w: number, c: THREE.Color, a: number, dashed: boolean): void {
    const x0 = Math.max(0, x - r);
    const x1 = Math.min(W, x + r + 1);
    const z0 = Math.max(0, y - r);
    const z1 = Math.min(H, y + r + 1);
    const d = dashed ? 0.3 : 0;
    this.line(x0, z0, x1, z0, w, c, a, d);
    this.line(x1, z0, x1, z1, w, c, a, d);
    this.line(x1, z1, x0, z1, w, c, a, d);
    this.line(x0, z1, x0, z0, w, c, a, d);
  }

  /** Strips just inside the outer edges of a set of cells. */
  edges(cells: ReadonlySet<number>, w: number, c: THREE.Color, a: number): void {
    const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cells.has(y * W + x);
    const k = w / 2;
    for (const i of cells) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (!has(x, y - 1)) this.line(x, y + k, x + 1, y + k, w, c, a);
      if (!has(x, y + 1)) this.line(x, y + 1 - k, x + 1, y + 1 - k, w, c, a);
      if (!has(x - 1, y)) this.line(x + k, y, x + k, y + 1, w, c, a);
      if (!has(x + 1, y)) this.line(x + 1 - k, y, x + 1 - k, y + 1, w, c, a);
    }
  }

  /** An arrowhead at b, pointing from a. */
  arrow(ax: number, az: number, bx: number, bz: number, size: number, w: number, c: THREE.Color, a: number): void {
    const ang = Math.atan2(bz - az, bx - ax);
    for (const s of [-1, 1]) this.line(bx, bz, bx - Math.cos(ang + s * 0.5) * size, bz - Math.sin(ang + s * 0.5) * size, w, c, a);
  }

  mesh(material: THREE.Material, order: number): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    const m = new THREE.Mesh(g, material);
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  }
}

/** Billboards of a fixed size on screen: the faded pictograms of last known positions. */
function ghostGlyphMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas }, cells: { value: GHOST_CLASSES.length }, px: { value: new THREE.Vector2(33, 22) }, perPx: { value: 0.002 } },
    vertexShader: `
      attribute float aAlpha;
      attribute float aCell;
      uniform float cells;
      uniform vec2 px;
      uniform float perPx;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        c.xy += position.xy * px * perPx * -c.z;
        gl_Position = projectionMatrix * c;
        vUv = vec2((uv.x + aCell) / cells, uv.y);
        vAlpha = aAlpha;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a * vAlpha < 0.02) discard;
        gl_FragColor = vec4(t.rgb, t.a * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

/** One cell per class: a hollow, dashed frame round the pictogram, so a last known position never reads as a unit seen now. */
function ghostAtlas(red: string): THREE.CanvasTexture {
  const cw = 96;
  const ch = 64;
  const c = document.createElement('canvas');
  c.width = cw * GHOST_CLASSES.length;
  c.height = ch;
  const ctx = c.getContext('2d')!;
  GHOST_CLASSES.forEach((cls, k) => {
    const x = k * cw;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(x + 4, 4, cw - 8, ch - 8, 12);
    ctx.fill();
    ctx.setLineDash([9, 6]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = red;
    ctx.stroke();
    ctx.setLineDash([]);
    const p = pictogramCanvas(cls, red, 1.6);
    ctx.drawImage(p, x + (cw - p.width) / 2, (ch - p.height) / 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 1;
  return t;
}

/** Seconds a scouted cell's dot takes to shrink away. */
const FADE = 0.6;

type StrokeKind = 'threat' | 'watch' | 'air' | 'likely' | 'ghost';

export class InsightLayer {
  readonly group = new THREE.Group();
  private readonly blue: THREE.Color;
  private readonly red: THREE.Color;
  private readonly redCss: string;
  /** Untoned: friend and foe colours stay what they are under the scene's tone mapping. */
  private readonly strokeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private readonly tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly threatTiles: THREE.InstancedMesh[];
  private readonly watchTiles: Record<'blue' | 'red', THREE.InstancedMesh>;
  private readonly dots: THREE.InstancedMesh | null;
  private readonly ghostGlyphs: THREE.InstancedMesh;
  private readonly glyph: THREE.Mesh;
  private readonly glyphCanvas = document.createElement('canvas');
  private readonly glyphTexture: THREE.CanvasTexture;
  private strokes: Record<StrokeKind, THREE.Mesh | null> = { threat: null, watch: null, air: null, likely: null, ghost: null };
  private keys: Record<string, unknown> = {};
  private placeLabels: PlaceLabel[] = [];
  /** The expected area: its cells, the ones seen empty so far, and the dots still fading out. */
  private readonly expected: readonly number[];
  private readonly cleared = new Set<number>();
  private readonly fading = new Map<number, number>();
  private glyphKind: FacingGlyph['kind'] | null = null;

  constructor(
    private readonly ground: (x: number, z: number) => number,
    colours: { blue: number; red: number },
    expected: readonly number[],
  ) {
    this.blue = new THREE.Color(colours.blue);
    this.red = new THREE.Color(colours.red);
    this.redCss = `#${this.red.getHexString(THREE.SRGBColorSpace)}`;
    this.group.name = 'insight';
    const tiles = (color: THREE.Color, opacity: number, order: number) => {
      const m = new THREE.InstancedMesh(this.tileGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }), W * H);
      m.count = 0;
      m.renderOrder = order;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    // Under the move area's tiles (order 2), so your own move reads on top.
    this.threatTiles = THREAT_ALPHA.map((a) => tiles(this.red, a, 1));
    this.watchTiles = { blue: tiles(this.blue, 0.08, 1), red: tiles(this.red, 0.08, 1) };
    this.expected = expected;
    if (expected.length) {
      const dot = new THREE.CircleGeometry(0.14, 12).rotateX(-Math.PI / 2);
      this.dots = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial({ color: this.red, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }), expected.length);
      this.dots.renderOrder = 1;
      this.dots.frustumCulled = false;
      this.group.add(this.dots);
      this.placeDots();
    } else this.dots = null;
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(64), 1));
    plane.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(64), 1));
    this.ghostGlyphs = new THREE.InstancedMesh(plane, ghostGlyphMaterial(ghostAtlas(this.redCss)), 64);
    this.ghostGlyphs.count = 0;
    this.ghostGlyphs.renderOrder = 6;
    this.ghostGlyphs.frustumCulled = false;
    this.group.add(this.ghostGlyphs);
    this.glyphCanvas.width = this.glyphCanvas.height = 160;
    this.glyphTexture = new THREE.CanvasTexture(this.glyphCanvas);
    this.glyphTexture.colorSpace = THREE.SRGBColorSpace;
    this.glyph = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.glyphTexture, transparent: true, depthWrite: false, toneMapped: false }));
    this.glyph.renderOrder = 6;
    this.glyph.visible = false;
    this.group.add(this.glyph);
  }

  /** Labels pinned to the ground for the HUD layer: air-defence chances and likely targets. */
  get labels(): readonly PlaceLabel[] {
    return this.placeLabels;
  }

  /** Something is moving (scouted dots shrinking away): a frame on demand should keep coming. */
  get animating(): boolean {
    return this.fading.size > 0;
  }

  /** What it shows, for tests. */
  counts(): { threat: number; threatOf: number; watch: number; air: number; suspected: number; likely: number; glyph: string | null; ghosts: number; expected: number } {
    const k = this.keys as { air?: readonly AirRing[]; watch?: readonly WatchArea[]; likely?: string };
    return {
      threat: this.threatTiles.reduce((s, m) => s + m.count, 0),
      threatOf: (this.keys.threatOf as readonly number[] | null | undefined)?.length ?? 0,
      watch: k.watch?.length ?? 0,
      air: k.air?.filter((r) => !r.suspected).length ?? 0,
      suspected: k.air?.filter((r) => r.suspected).length ?? 0,
      likely: this.placeLabels.filter((l) => l.id.startsWith('likely')).length,
      glyph: this.glyph.visible ? `${this.glyphKind}${this.keys.glyphFlank ? ':flanked' : ''}` : null,
      ghosts: this.ghostGlyphs.count,
      expected: this.expected.length - this.cleared.size,
    };
  }

  set(o: InsightOverlay): void {
    const changed = (name: string, value: unknown, same: (a: unknown, b: unknown) => boolean = (a, b) => a === b) => {
      if (name in this.keys && same(this.keys[name], value)) return false;
      this.keys[name] = value;
      return true;
    };
    const json = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const threat = changed('threat', o.threat);
    if (changed('threatOf', o.threatOf) || threat) this.setThreat(o.threat, o.threatOf);
    if (changed('watch', o.watch)) this.setWatch(o.watch);
    const airChanged = changed('air', o.air, json);
    const likelyChanged = changed('likely', o.likely, json);
    if (airChanged) this.setAir(o.air);
    if (likelyChanged) this.setLikely(o.likely);
    if (airChanged || likelyChanged) this.setLabels(o.air, o.likely);
    if (changed('glyph', o.glyph, json)) this.setGlyph(o.glyph);
    if (changed('ghosts', o.ghosts, json)) this.setGhosts(o.ghosts);
    if (o.scouted.length) {
      const was = this.cleared.size;
      for (const i of o.scouted) if (!this.cleared.has(i) && this.expected.includes(i)) {
        this.cleared.add(i);
        this.fading.set(i, FADE);
      }
      if (this.cleared.size !== was) this.placeDots();
    }
  }

  /** Each frame: dots fading out, the shield turned to face the camera, ghosts at their screen size. */
  tick(dt: number, view: { yaw: number; perPx: number; cinematic: boolean }): void {
    // An action cam is a shot, not a map.
    this.group.visible = !view.cinematic;
    if (this.fading.size) {
      for (const [i, t] of this.fading) {
        const left = t - dt;
        if (left <= 0) this.fading.delete(i);
        else this.fading.set(i, left);
      }
      this.placeDots();
    }
    if (this.glyphKind === 'shield') this.glyph.rotation.y = view.yaw;
    (this.ghostGlyphs.material as THREE.ShaderMaterial).uniforms.perPx!.value = view.perPx;
  }

  private swap(kind: StrokeKind, s: Strokes, order: number): void {
    const old = this.strokes[kind];
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
    }
    const m = s.mesh(this.strokeMat, order);
    if (m) this.group.add(m);
    this.strokes[kind] = m;
  }

  private putTiles(mesh: THREE.InstancedMesh, cells: Iterable<number>): void {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const i of cells) {
      if (n >= mesh.instanceMatrix.count) break;
      const x = (i % W) + 0.5;
      const z = Math.floor(i / W) + 0.5;
      m.makeTranslation(x, this.ground(x, z) + 0.035, z);
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private setThreat(level: readonly number[] | null, one: readonly number[] | null): void {
    const by: number[][] = [[], [], []];
    const any = new Set<number>();
    if (one) {
      for (const i of one) {
        by[1]!.push(i);
        any.add(i);
      }
    } else if (level)
      level.forEach((n, i) => {
        if (n <= 0) return;
        by[Math.min(by.length, n) - 1]!.push(i);
        any.add(i);
      });
    this.threatTiles.forEach((mesh, k) => this.putTiles(mesh, by[k]!));
    const s = new Strokes(this.ground);
    s.edges(any, 0.07, this.red, 0.85);
    this.swap('threat', s, 2);
  }

  private setWatch(areas: readonly WatchArea[]): void {
    const s = new Strokes(this.ground);
    const fill = { blue: new Set<number>(), red: new Set<number>() };
    for (const a of areas) {
      const c = a.side === 'blue' ? this.blue : this.red;
      if (a.sky > 0) {
        // Watching the sky: a dome, drawn as a double ring.
        s.ring(a.x + 0.5, a.y + 0.5, a.sky, 0.06, c, 0.75, false);
        s.ring(a.x + 0.5, a.y + 0.5, a.sky - 0.3, 0.04, c, 0.55, false);
        continue;
      }
      const cells = new Set(a.cells);
      for (const i of cells) fill[a.side].add(i);
      s.edges(cells, 0.045, c, a.side === 'blue' ? 0.55 : 0.8);
    }
    this.putTiles(this.watchTiles.blue, fill.blue);
    this.putTiles(this.watchTiles.red, fill.red);
    this.swap('watch', s, 3);
  }

  private setAir(rings: readonly AirRing[]): void {
    const s = new Strokes(this.ground);
    for (const r of rings) {
      const a = r.suspected ? 0.85 * ghostAlpha(r.age) : r.dedicated ? 0.95 : 0.7;
      const w = r.dedicated ? 0.12 : 0.07;
      if (r.square) s.square(r.x, r.y, r.r, w, this.red, a, r.suspected);
      else {
        s.ring(r.x + 0.5, r.y + 0.5, r.r, w, this.red, a, r.suspected);
        // On watch with radar: the sky over it is covered, a second ring inside.
        if (r.watch) s.ring(r.x + 0.5, r.y + 0.5, r.r - 0.3, 0.04, this.red, a * 0.7, r.suspected);
      }
    }
    this.swap('air', s, 3);
  }

  private setLikely(lines: readonly { from: Point; to: Point }[]): void {
    const s = new Strokes(this.ground);
    for (const l of lines) {
      const ax = l.from.x + 0.5;
      const az = l.from.y + 0.5;
      const bx = l.to.x + 0.5;
      const bz = l.to.y + 0.5;
      const d = Math.hypot(bx - ax, bz - az) || 1;
      // Stop short of the units so the arrow points at the target, not into it.
      const k0 = Math.min(0.45, 0.6 / d);
      const k1 = Math.max(0.55, 1 - 0.7 / d);
      const p = { x: ax + (bx - ax) * k0, z: az + (bz - az) * k0 };
      const q = { x: ax + (bx - ax) * k1, z: az + (bz - az) * k1 };
      s.line(p.x, p.z, q.x, q.z, 0.1, this.red, 0.95, 0.4);
      s.arrow(p.x, p.z, q.x, q.z, 0.5, 0.1, this.red, 1);
    }
    this.swap('likely', s, 4);
  }

  private setLabels(rings: readonly AirRing[], lines: readonly { from: Point; to: Point }[]): void {
    const out: PlaceLabel[] = [];
    for (const r of rings) {
      const x = r.x + 0.5;
      const z = r.y + 0.5;
      const what = r.square ? 'Intercept' : 'AA';
      // Seen: the rules' chance. Only suspected: a question, not a number.
      out.push({ id: `air-${r.unit}`, text: r.suspected || r.chance === null ? `${what} ?` : `${what} ${r.chance}%`, x, y: this.ground(x, z) + 0.05, z, dy: 26 });
    }
    const taken: { x: number; z: number }[] = [];
    lines.forEach((l, k) => {
      const x = (l.from.x + l.to.x) / 2 + 0.5;
      const z = (l.from.y + l.to.y) / 2 + 0.5;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < 1.6)) return;
      taken.push({ x, z });
      out.push({ id: `likely-${k}`, text: 'Likely', x, y: this.ground(x, z) + 0.3, z, dy: 0 });
    });
    this.placeLabels = out;
  }

  private setGlyph(at: InsightOverlay['glyph']): void {
    this.glyph.visible = !!at;
    this.glyphKind = at?.g.kind ?? null;
    this.keys.glyphFlank = !!at?.g.flanked;
    if (!at) return;
    const ctx = this.glyphCanvas.getContext('2d');
    if (!ctx) return;
    drawGlyph(ctx, at.g, this.glyphCanvas.width, this.redCss);
    this.glyphTexture.needsUpdate = true;
    const x = at.at.x + 0.5;
    const z = at.at.y + 0.5;
    this.glyph.position.set(x, this.ground(x, z) + 0.09, z);
    // The hull points where the unit will face; the shield stands up to the camera (tick).
    const f = at.g.facing;
    if (at.g.kind === 'hull') this.glyph.rotation.set(0, Math.atan2(-Math.cos(f), -Math.sin(f)), 0);
  }

  private setGhosts(ghosts: InsightOverlay['ghosts']): void {
    const s = new Strokes(this.ground);
    const m = new THREE.Matrix4();
    const alpha = this.ghostGlyphs.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    const cell = this.ghostGlyphs.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    let n = 0;
    for (const g of ghosts) {
      if (n >= 64) break;
      const x = g.x + 0.5;
      const z = g.y + 0.5;
      const a = ghostAlpha(g.age);
      // A dashed diamond on the ground where it was last seen.
      const r = 0.36;
      const pts = [
        [x, z - r],
        [x + r, z],
        [x, z + r],
        [x - r, z],
        [x, z - r],
      ] as const;
      for (let k = 0; k < 4; k++) s.line(pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1], 0.06, this.red, a, 0.12);
      m.makeTranslation(x, this.ground(x, z) + 0.55, z);
      this.ghostGlyphs.setMatrixAt(n, m);
      alpha.setX(n, a);
      cell.setX(n, Math.max(0, GHOST_CLASSES.indexOf(classOf(typeOf(g.type).role))));
      n++;
    }
    this.ghostGlyphs.count = n;
    this.ghostGlyphs.instanceMatrix.needsUpdate = true;
    alpha.needsUpdate = true;
    cell.needsUpdate = true;
    this.swap('ghost', s, 3);
  }

  /** Dots over the expected area's cells not yet seen empty; ones just seen shrink away. */
  private placeDots(): void {
    if (!this.dots) return;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const i of this.expected) {
      const fade = this.fading.get(i);
      if (this.cleared.has(i) && fade === undefined) continue;
      const x = (i % W) + 0.5;
      const z = Math.floor(i / W) + 0.5;
      const k = fade === undefined ? 1 : fade / FADE;
      m.makeScale(k, 1, k).setPosition(x, this.ground(x, z) + 0.04, z);
      this.dots.setMatrixAt(n++, m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const o of this.group.children) {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry !== this.tileGeo) mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && mat !== this.strokeMat) mat.dispose();
    }
    this.tileGeo.dispose();
    this.strokeMat.dispose();
    this.glyphTexture.dispose();
    ((this.ghostGlyphs.material as THREE.ShaderMaterial).uniforms.map!.value as THREE.Texture).dispose();
  }
}
