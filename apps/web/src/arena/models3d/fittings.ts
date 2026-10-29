import * as THREE from 'three';
import { S, T, bar, box, chamfer, convex, cyl, lathe, rod, shade, type Lod, type Parts, type Style, type V2, type V3 } from './kit';

// Fittings shared across vehicles: gun barrels, mantlets, sights, remote weapon stations, machine
// guns, smoke dischargers, hatches, ERA tile arrays, slat cages, stowage, drums, logs and lights.
// Each takes a transform `m` that places its own frame (x left, y up, z forward) on the vehicle.

export interface BarrelSpec {
  /** Barrel end, metres from the trunnion. */
  len: number;
  /** Where the visible barrel starts (at the mantlet face). */
  start: number;
  /** Radius at the start and at the muzzle. */
  r0: number;
  r1: number;
  /** Thermal sleeve: band radius over the tube, and how many bands. */
  sleeve?: { r: number; bands: number; end: number };
  /** Bore evacuator (fume extractor) centre, length and radius. */
  evac?: { at: number; len: number; r: number };
  brake?: 'double' | 'slotted' | 'flash' | 'pepper' | 'none';
  /** Muzzle reference sensor on top of the muzzle. */
  mrs?: boolean;
  bore: number;
}

/** A gun tube along +z in the gun's frame: tube, sleeve bands, evacuator, muzzle device and bore. */
export function barrel(p: Parts, L: Lod, b: BarrelSpec, m: THREE.Matrix4 = T(), style: Style = S.paint): void {
  const segs = L.seg(14, 6);
  const device = { double: 0.62, slotted: 0.75, pepper: 0.4, flash: 0.3, none: 0 }[b.brake ?? 'none'];
  const tubeEnd = b.len - device;
  const span = b.len - b.start;
  const tubeR = (z: number) => b.r0 + ((b.r1 - b.r0) * (z - b.start)) / span;
  const sl = b.sleeve;
  const sleeveR = (z: number) => (sl && z <= sl.end + 1e-6 ? Math.max(tubeR(z) * 1.04, sl.r + (tubeR(z) * 1.1 - sl.r) * ((z - b.start) / (sl.end - b.start))) : tubeR(z));
  const ev = b.evac;
  const R = (z: number) => {
    if (ev) {
      const d = Math.abs(z - ev.at);
      if (d <= ev.len / 2 - 0.07) return ev.r;
      if (d < ev.len / 2) return sleeveR(z) + (ev.r - sleeveR(z)) * ((ev.len / 2 - d) / 0.07);
    }
    return sleeveR(z);
  };
  const zs: { z: number; k: number }[] = [
    { z: b.start, k: 1 },
    { z: tubeEnd, k: 1 },
  ];
  if (sl) {
    zs.push({ z: sl.end, k: 1 }, { z: sl.end + 0.012, k: 1 });
    if (L.hi)
      for (let i = 1; i < sl.bands; i++) {
        const z = b.start + ((sl.end - b.start) * i) / sl.bands;
        zs.push({ z: z - 0.018, k: 1 }, { z, k: 0.94 }, { z: z + 0.018, k: 1 });
      }
  }
  if (ev) for (const z of [ev.at - ev.len / 2, ev.at - ev.len / 2 + 0.07, ev.at + ev.len / 2 - 0.07, ev.at + ev.len / 2]) zs.push({ z, k: 1 });
  const prof: V2[] = [[0.001, b.start - 0.02], [R(b.start), b.start - 0.02]];
  for (const { z, k } of zs.filter((e) => e.z >= b.start && e.z <= tubeEnd).sort((a, c) => a.z - c.z)) prof.push([R(z) * k, z]);
  const br = b.r1;
  const me = tubeEnd;
  if (b.brake === 'double') {
    const W = br * 2.1;
    prof.push([W, me], [W, me + 0.18], [br * 1.1, me + 0.18], [br * 1.1, me + 0.36], [W, me + 0.36], [W * 0.95, b.len]);
  } else if (b.brake === 'slotted') prof.push([br * 1.45, me], [br * 1.45, b.len - 0.04], [br * 1.3, b.len]);
  else if (b.brake === 'pepper') prof.push([br * 1.5, me], [br * 1.5, b.len]);
  else if (b.brake === 'flash') prof.push([br * 1.1, me + 0.02], [br * 1.45, b.len]);
  else prof.push([br * 1.06, b.len - 0.12], [br * 1.06, b.len]);
  prof.push([b.bore, b.len]);
  p.add(lathe(prof, segs, 'z'), style, m);
  // The bore, dark inside.
  p.add(
    lathe(
      [
        [b.bore, b.len],
        [b.bore, b.len - 0.35],
        [0.001, b.len - 0.35],
      ],
      segs,
      'z',
    ),
    S.black,
    m,
  );
  if (L.hi && b.brake === 'double') for (const s of [1, -1]) p.add(box(0.04, br * 2.6, 0.13), S.black, m.clone().multiply(T(s * br * 2.1, 0, me + 0.09)));
  if (L.hi && b.brake === 'slotted') for (const s of [1, -1]) for (let i = 0; i < 4; i++) p.add(box(0.04, br * 1.6, 0.09), S.black, m.clone().multiply(T(s * br * 1.42, 0, me + 0.12 + i * 0.15)));
  if (L.hi && b.mrs) p.add(box(0.07, 0.06, 0.12), S.shade, m.clone().multiply(T(0, br + 0.04, b.len - 0.18)));
}

/** A plain tube (autocannon, MG barrel) along +z from z0 to z1. */
export function tube(p: Parts, L: Lod, r: number, z0: number, z1: number, m: THREE.Matrix4, style: Style = S.gunsteel): void {
  p.add(cyl(r, r, z1 - z0, L.seg(8, 5), 'z'), style, m.clone().multiply(T(0, 0, (z0 + z1) / 2)));
}

/** A generic machine gun on a pintle, pointing +z: receiver, barrel, ammo can. */
export function mg(p: Parts, L: Lod, m: THREE.Matrix4, heavy = false): void {
  const k = heavy ? 1 : 0.7;
  p.add(box(0.12 * k, 0.15 * k, 0.6 * k), S.gunsteel, m.clone().multiply(T(0, 0, 0)));
  if (!L.hi) {
    p.add(box(0.05, 0.05, heavy ? 1.3 : 0.7), S.gunsteel, m.clone().multiply(T(0, 0, heavy ? 0.9 : 0.6)));
    return;
  }
  tube(p, L, heavy ? 0.03 : 0.018, 0.25 * k, heavy ? 1.55 : 0.95, m);
  if (L.hi) {
    if (heavy) p.add(cyl(0.045, 0.045, 0.22, 6, 'z'), S.gunsteel, m.clone().multiply(T(0, 0, 0.42)));
    p.add(box(0.12 * k, 0.16 * k, 0.22 * k), S.shade, m.clone().multiply(T(0.14 * k, -0.02, 0.02)));
    p.add(box(0.04, 0.05, 0.25 * k), S.gunsteel, m.clone().multiply(T(0, 0.02, -0.38 * k)));
  }
}

/** Smoke grenade dischargers: `n` tubes in a row (or rows), aimed along the frame's +z and up. */
export function smoke(p: Parts, L: Lod, m: THREE.Matrix4, n: number, rows = 1, r = 0.045): void {
  if (!L.hi) {
    p.add(box(n * r * 2.2, rows * r * 2.2, 0.25), S.shade, m);
    return;
  }
  for (let row = 0; row < rows; row++)
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * r * 2.3;
      const y = row * r * 2.3;
      const tm = m.clone().multiply(T(x, y, 0, -0.35, 0, 0));
      p.add(cyl(r, r, 0.28, 6, 'z', true), S.shade, tm);
    }
  p.add(box(n * r * 2.3, 0.04, 0.2), S.deep, m.clone().multiply(T(0, -r - 0.02, -0.04)));
}

/** A round hatch, closed, with a rim and a handle. */
export function hatch(p: Parts, L: Lod, m: THREE.Matrix4, r: number): void {
  if (!L.hi) return;
  p.add(cyl(r, r * 1.04, 0.07, L.seg(12, 6)), S.shade, m.clone().multiply(T(0, 0.035, 0)));
  if (L.hi) {
    p.add(cyl(r * 0.8, r * 0.85, 0.03, 10), S.paint, m.clone().multiply(T(0, 0.085, 0)));
    p.add(bar([-r * 0.4, 0.11, r * 0.3], [r * 0.4, 0.11, r * 0.3], 0.025), S.deep, m);
  }
}

/** A periscope head: a little armoured box with a glass face toward +z. */
export function periscope(p: Parts, L: Lod, m: THREE.Matrix4, w = 0.18): void {
  if (!L.hi) return;
  p.add(box(w, 0.09, 0.12), S.shade, m.clone().multiply(T(0, 0.045, 0)));
  p.add(box(w * 0.85, 0.05, 0.01), S.glass, m.clone().multiply(T(0, 0.05, 0.062)));
}

/** A sight housing: an armoured box with a dark window, the window toward +z. */
export function sightBox(p: Parts, L: Lod, m: THREE.Matrix4, w: number, h: number, d: number, windows = 1): void {
  if (!L.hi) {
    p.add(box(w, h, d), S.paint, m.clone().multiply(T(0, h / 2, 0)));
    return;
  }
  p.add(chamfer(w, h, d, Math.min(w, h, d) * 0.12), S.paint, m.clone().multiply(T(0, h / 2, 0)));
  for (let i = 0; i < windows; i++) {
    const x = windows === 1 ? 0 : (i - (windows - 1) / 2) * (w / windows);
    p.add(box((w / windows) * 0.7, h * 0.45, 0.02), S.glass, m.clone().multiply(T(x, h * 0.55, d / 2 + 0.005)));
  }
}

/** A panoramic sight head on a pedestal: a turning drum with a hooded window. */
export function panoramic(p: Parts, L: Lod, m: THREE.Matrix4, r: number, h: number): void {
  if (!L.hi) {
    p.add(box(r * 2, h, r * 2), S.paint, m.clone().multiply(T(0, h / 2, 0)));
    return;
  }
  p.add(cyl(r * 0.55, r * 0.6, h * 0.5, L.seg(10, 6)), S.shade, m.clone().multiply(T(0, h * 0.25, 0)));
  p.add(chamfer(r * 2, h * 0.5, r * 2.1, r * 0.25), S.paint, m.clone().multiply(T(0, h * 0.75, 0)));
  p.add(box(r * 1.3, h * 0.24, 0.02), S.glass, m.clone().multiply(T(0, h * 0.75, r * 1.05 + 0.01)));
}

/** A remote weapon station: ring base, cradle, heavy MG and a sensor box. */
export function rws(p: Parts, L: Lod, m: THREE.Matrix4, kind: 'crows' | 'flw' | 'protector' | 'udp'): void {
  const big = kind === 'protector' || kind === 'udp';
  if (!L.hi) {
    p.add(box(0.7, 0.45, 0.6), S.paint, m.clone().multiply(T(0, 0.3, 0)));
    p.add(box(0.06, 0.06, 1.2), S.gunsteel, m.clone().multiply(T(0, 0.5, 0.8)));
    return;
  }
  p.add(cyl(0.32, 0.36, 0.12, L.seg(12, 6)), S.shade, m.clone().multiply(T(0, 0.06, 0)));
  p.add(chamfer(0.5, 0.32, 0.55, 0.05), S.paint, m.clone().multiply(T(0, 0.28, -0.05)));
  // The cradle arms either side of the gun.
  p.add(box(0.06, 0.32, 0.36), S.paint, m.clone().multiply(T(0.2, 0.52, 0)));
  p.add(box(0.06, 0.32, 0.36), S.paint, m.clone().multiply(T(-0.2, 0.52, 0)));
  mg(p, L, m.clone().multiply(T(0, 0.56, 0.05)), true);
  // Sensor box on the side, window forward.
  const sx = kind === 'flw' ? -0.34 : 0.36;
  p.add(chamfer(big ? 0.26 : 0.2, big ? 0.26 : 0.2, big ? 0.38 : 0.3, 0.03), S.paint, m.clone().multiply(T(sx, 0.62, 0.06)));
  p.add(box(big ? 0.18 : 0.14, big ? 0.14 : 0.1, 0.02), S.lens, m.clone().multiply(T(sx, 0.64, (big ? 0.19 : 0.15) + 0.07)));
  if (L.hi) {
    // Ammo box.
    p.add(box(0.22, 0.24, 0.3), S.shade, m.clone().multiply(T(-sx * 0.95, 0.5, -0.05)));
    if (kind === 'crows') p.add(box(0.08, 0.06, 0.2), S.shade, m.clone().multiply(T(sx, 0.78, 0.04)));
  }
}

/** A field of armour tiles in the frame's xy plane, standing out toward +z. */
export function tiles(p: Parts, L: Lod, m: THREE.Matrix4, cols: number, rows: number, w: number, h: number, depth: number, gap: number, style: Style = S.paint): void {
  const tw = (w - gap * (cols - 1)) / cols;
  const th = (h - gap * (rows - 1)) / rows;
  if (!L.hi) {
    p.add(box(w, h, depth), style, m.clone().multiply(T(w / 2, h / 2, depth / 2)));
    return;
  }
  const g = box(tw, th, depth);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) p.add(g, style, m.clone().multiply(T(c * (tw + gap) + tw / 2, r * (th + gap) + th / 2, depth / 2)));
}

/** A slat (bar armour) panel in the frame's xy plane: vertical slats and horizontal rails. */
export function slats(p: Parts, L: Lod, m: THREE.Matrix4, w: number, h: number, spacing: number, style: Style = S.shade): void {
  if (!L.hi) {
    // Far away the cage reads as its top and bottom rails.
    p.add(box(w, 0.07, 0.05), style, m.clone().multiply(T(w / 2, h, 0)));
    p.add(box(w, 0.07, 0.05), style, m.clone().multiply(T(w / 2, 0.03, 0)));
    return;
  }
  const n = Math.max(2, Math.round(w / spacing) + 1);
  // A slat is a thin open prism: its two broad faces and the outer edge.
  const slat = convexSlat(h);
  for (let i = 0; i < n; i++) p.add(slat, style, m.clone().multiply(T((i / (n - 1)) * w, 0, 0)));
  for (const y of [0.02, h * 0.5, h - 0.02]) p.add(box(w, 0.035, 0.04), style, m.clone().multiply(T(w / 2, y, -0.04)));
}

function convexSlat(h: number): THREE.BufferGeometry {
  const t = 0.008;
  const d = 0.07;
  const pos = [
    // Outer edge face (+z), and the two sides.
    -t, 0, d / 2, t, 0, d / 2, t, h, d / 2,
    -t, 0, d / 2, t, h, d / 2, -t, h, d / 2,
    t, 0, d / 2, t, 0, -d / 2, t, h, -d / 2,
    t, 0, d / 2, t, h, -d / 2, t, h, d / 2,
    -t, 0, -d / 2, -t, 0, d / 2, -t, h, d / 2,
    -t, 0, -d / 2, -t, h, d / 2, -t, h, -d / 2,
    // Inner edge face (-z).
    t, 0, -d / 2, -t, 0, -d / 2, -t, h, -d / 2,
    t, 0, -d / 2, -t, h, -d / 2, t, h, -d / 2,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** A rolled tarp or kit bag. */
export function bag(p: Parts, L: Lod, m: THREE.Matrix4, w: number, h: number, d: number, style: Style = S.canvas): void {
  if (L.hi) p.add(lathe(bagProfile(h, d), 7, 'x'), { ...style, crease: 70 }, m.clone().multiply(T(-w / 2, 0, 0, 0, 0, 0, w, 1, 1)));
  else p.add(box(w, h, d), style, m);
}

function bagProfile(h: number, d: number): V2[] {
  const r = Math.min(h, d) / 2;
  return [
    [0.001, 0],
    [r * 0.8, 0.02],
    [r, 0.08],
    [r, 0.92],
    [r * 0.8, 0.98],
    [0.001, 1],
  ];
}

/** A soft stowage bundle: a lumpy rounded box. */
export function bundle(p: Parts, m: THREE.Matrix4, w: number, h: number, d: number, style: Style = S.canvas, seed = 1): void {
  const pts: V3[] = [];
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    const u = rnd() * Math.PI * 2;
    const v = Math.acos(2 * rnd() - 1);
    const k = 0.85 + rnd() * 0.15;
    pts.push([Math.cos(u) * Math.sin(v) * (w / 2) * k, Math.cos(v) * (h / 2) * k, Math.sin(u) * Math.sin(v) * (d / 2) * k]);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * w * 0.42, -h / 2, sz * d * 0.42]);
  p.add(convex(pts), { ...style, crease: 60 }, m);
}

/** A 200 litre fuel drum lying along x. */
export function drum(p: Parts, L: Lod, m: THREE.Matrix4, len = 0.88, r = 0.29, style: Style = S.shade): void {
  const prof: V2[] = L.hi
    ? [
        [0.001, -len / 2],
        [r, -len / 2],
        [r, -len * 0.17],
        [r * 1.04, -len * 0.15],
        [r, len * 0.15],
        [r * 1.04, len * 0.17],
        [r, len / 2],
        [0.001, len / 2],
      ]
    : [
        [0.001, -len / 2],
        [r, -len / 2],
        [r, len / 2],
        [0.001, len / 2],
      ];
  p.add(lathe(prof, L.seg(10, 5), 'x'), { ...style, crease: 50 }, m);
}

/** The unditching log: a beam of wood along x. */
export function log(p: Parts, L: Lod, m: THREE.Matrix4, len: number, r = 0.13): void {
  p.add(cyl(r, r * 0.95, len, L.seg(9, 5), 'x'), { ...S.wood, crease: 50 }, m);
}

/** A grille in the frame's xz plane (engine deck louvres), dark slots between slats. */
export function grille(p: Parts, L: Lod, m: THREE.Matrix4, w: number, d: number, slots: number, style: Style = S.shade): void {
  p.add(box(w, 0.02, d), S.black, m);
  if (!L.hi) return;
  for (let i = 0; i < slots; i++) {
    const z = -d / 2 + ((i + 0.5) / slots) * d;
    p.add(box(w * 0.96, 0.03, (d / slots) * 0.45), style, m.clone().multiply(T(0, 0.02, z, 0.5, 0, 0)));
  }
}

/** A headlight cluster with its guard, facing +z. */
export function headlight(p: Parts, L: Lod, m: THREE.Matrix4): void {
  if (!L.hi) return;
  p.add(cyl(0.07, 0.08, 0.1, 8, 'z'), S.shade, m);
  p.add(cyl(0.055, 0.055, 0.01, 8, 'z'), S.light, m.clone().multiply(T(0, 0, 0.055)));
  p.add(bar([-0.1, 0.1, 0.08], [0.1, 0.1, 0.08], 0.02), S.deep, m);
}

/** A whip antenna. */
export function antenna(p: Parts, L: Lod, m: THREE.Matrix4, len: number): void {
  if (!L.hi) return;
  p.add(cyl(0.035, 0.045, 0.1, 6), S.black, m.clone().multiply(T(0, 0.05, 0)));
  p.add(rod([0, 0.1, 0], [0, len, -len * 0.06], 0.006, 3), S.black, m);
}

/** A steel tow cable along a polyline. */
export function cable(p: Parts, L: Lod, pts: V3[], r = 0.025): void {
  if (!L.hi) return;
  for (let i = 0; i + 1 < pts.length; i++) p.add(rod(pts[i]!, pts[i + 1]!, r, 4), S.steel, T());
}

/** A tow hook or shackle. */
export function hook(p: Parts, L: Lod, m: THREE.Matrix4): void {
  if (!L.hi) return;
  p.add(box(0.12, 0.16, 0.14), S.deep, m);
}

/** A box rack: open frame of rails, the frame's origin at the rack's base centre. */
export function rack(p: Parts, L: Lod, m: THREE.Matrix4, w: number, h: number, d: number, style: Style = S.shade): void {
  const x = w / 2, z = d / 2;
  const corners: V3[] = [
    [x, 0, z],
    [-x, 0, z],
    [-x, 0, -z],
    [x, 0, -z],
  ];
  const t = L.hi ? 0.035 : 0.06;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    p.add(bar([a[0], h, a[2]], [b[0], h, b[2]], t), style, m);
    if (L.hi) p.add(bar([a[0], h * 0.5, a[2]], [b[0], h * 0.5, b[2]], t * 0.8), style, m);
    p.add(bar(a, [a[0], h, a[2]], t), style, m);
  }
  if (L.hi) {
    // Uprights along the long sides.
    const n = Math.round(d / 0.5);
    for (let i = 1; i < n; i++) {
      const zz = -z + (i / n) * d;
      for (const xx of [x, -x]) p.add(bar([xx, 0, zz], [xx, h, zz], t * 0.8), style, m);
    }
    for (let i = 1; i < Math.round(w / 0.5); i++) {
      const xx = -x + (i / Math.round(w / 0.5)) * w;
      p.add(bar([xx, 0, -z], [xx, h, -z], t * 0.8), style, m);
    }
  }
}

/** Jerrycans in a row along x. */
export function jerrycans(p: Parts, L: Lod, m: THREE.Matrix4, n: number): void {
  if (!L.hi) return;
  for (let i = 0; i < n; i++) p.add(chamfer(0.17, 0.46, 0.34, 0.03), shade(0.85), m.clone().multiply(T((i - (n - 1) / 2) * 0.19, 0.23, 0)));
}

