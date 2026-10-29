import type * as THREE from 'three';
import { drum, hatch, log, mg, tiles } from './fittings';
import { S, T, box, convex, cyl, shade, type Lod, type Parts, type Style, type V3 } from './kit';

// Fittings of the Soviet and Russian tank family: cast dome turrets, Kontakt-5 and Relikt wedges,
// fender stowage boxes, rubber skirts with ERA, rear fuel drums and the unditching log.

const D = Math.PI / 180;

/** Rings of an egg-shaped plan (front `f`, rear `r`, half width `w`) at height `y`. */
function egg(y: number, w: number, f: number, r: number, n: number, sq = 2.3): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const z = Math.sign(c) * Math.pow(Math.abs(c), 2 / sq) * (c > 0 ? f : r);
    const x = Math.sign(s) * Math.pow(Math.abs(s), 2 / sq) * w;
    out.push([x, y, z]);
  }
  return out;
}

/** A cast dome turret from (height, half width, front, rear) stations, smooth shaded. */
export function castTurret(p: Parts, L: Lod, stations: [number, number, number, number][], style: Style = S.paint): void {
  const n = L.seg(18, 9);
  const pts: V3[] = [];
  for (const [y, w, f, r] of stations) pts.push(...egg(y, w, f, r, n));
  p.add(convex(pts), { ...style, crease: 42 });
}

/** One Kontakt-5 or Relikt "clamshell" wedge on a turret cheek, mirrored. */
export function cheekWedges(p: Parts, L: Lod, o: { x: number; y: number; z: number; len: number; h: number; t: number; yaw: number; slope: number }, style: Style = S.paint): void {
  // A box thicker at the base, its top bevelled back; long axis across the turret, swept back.
  const { len, h, t } = o;
  const g = convex([
    [-len / 2, 0, t / 2],
    [len / 2, 0, t / 2],
    [-len / 2, 0, -t / 2],
    [len / 2, 0, -t / 2],
    [-len / 2, h, -t / 2],
    [len / 2, h, -t / 2],
    [-len / 2, h * 0.82, t * 0.15],
    [len / 2, h * 0.82, t * 0.15],
  ]);
  // Swept about the vertical, then leaned back about its own long axis.
  const m = T(o.x, o.y, o.z, 0, o.yaw, 0).multiply(T(0, 0, 0, -o.slope, 0, 0));
  p.pair(g, style, m);
  void L;
}

/** Fender with stowage boxes and fuel tanks along it, both sides. */
export function fenders(p: Parts, L: Lod, o: { x0: number; x1: number; y: number; z0: number; z1: number; boxes: [number, number][]; bh: number }): void {
  const w = o.x1 - o.x0;
  p.pair(box(w, 0.035, o.z1 - o.z0), S.paint, T(o.x0 + w / 2, o.y, (o.z0 + o.z1) / 2));
  // Front mudguard sloping down.
  p.pair(box(w, 0.035, 0.45), S.paint, T(o.x0 + w / 2, o.y - 0.12, o.z1 + 0.2, 0.55, 0, 0));
  for (const [z0, z1] of o.boxes) {
    const g = box(w * 0.85, o.bh, z1 - z0 - (L.hi ? 0.04 : 0));
    p.pair(g, S.shade, T(o.x0 + w / 2, o.y + o.bh / 2, (z0 + z1) / 2));
  }
}

/** Rubber side skirt hanging from the fender; `era` panels on the front part. */
export function rubberSkirt(p: Parts, L: Lod, o: { x: number; top: number; bottom: number; z0: number; z1: number; era: number; eraRows?: number }): void {
  const h = o.top - o.bottom;
  p.pair(box(0.03, h, o.z1 - o.z0), shade(0.55, { rough: 0.95 }), T(o.x, o.bottom + h / 2, (o.z0 + o.z1) / 2));
  if (o.era > 0) {
    const rows = o.eraRows ?? 2;
    const cols = Math.max(1, Math.round(o.era / 0.42));
    for (const s of [1, -1]) {
      const m = T(s * (o.x + 0.02), o.bottom + 0.03, o.z1 - o.era, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      // The tiles' frame: x along the hull (toward the front for the left side), z outward.
      const mm = s > 0 ? m.multiply(T(-o.era, 0, 0)) : m;
      tiles(p, L, mm, cols, rows, o.era, h - 0.05, 0.11, 0.025);
    }
  }
}

/** Two 200 litre drums on the rear plate and the unditching log above them. */
export function rearDrumsAndLog(p: Parts, L: Lod, z: number, y: number, span: number): void {
  for (const s of [1, -1]) {
    drum(p, L, T(s * span * 0.27, y, z - 0.3), 0.85, 0.29);
    if (L.hi) p.add(box(0.06, 0.62, 0.05), S.deep, T(s * span * 0.27, y, z - 0.03));
  }
  log(p, L, T(0, y + 0.42, z - 0.17), span, 0.13);
}

/** Commander's cupola with its hatch and a pintle heavy machine gun (Kord or NSVT). */
export function cupola(p: Parts, L: Lod, m: THREE.Matrix4, r = 0.4): void {
  p.add(cyl(r, r * 1.05, 0.14, L.seg(14, 7)), S.paint, m.clone().multiply(T(0, 0.07, 0)));
  hatch(p, L, m.clone().multiply(T(0, 0.14, -0.05)), r * 0.78);
  if (L.hi) {
    for (const a of [-40, 0, 40]) p.add(box(0.12, 0.07, 0.04), S.glass, m.clone().multiply(T(Math.sin(a * D) * r, 0.1, Math.cos(a * D) * r, 0, a * D, 0)));
    p.add(box(0.08, 0.3, 0.08), S.shade, m.clone().multiply(T(r * 0.55, 0.28, 0.1)));
  }
  mg(p, L, m.clone().multiply(T(r * 0.55, 0.45, 0.2)), true);
}

/** A roof or glacis covered in ERA tiles: `cols` x `rows` over w x d, on a plane tilted by `tilt`. */
export function eraPlate(p: Parts, L: Lod, m: THREE.Matrix4, w: number, d: number, cols: number, rows: number, t = 0.09): void {
  // Tiles in the frame's xz plane, standing up along y.
  tiles(p, L, m.clone().multiply(T(-w / 2, 0, d / 2, -Math.PI / 2, 0, 0)), cols, rows, w, d, t, 0.02);
}

