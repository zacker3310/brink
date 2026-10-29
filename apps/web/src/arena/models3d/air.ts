import type * as THREE from 'three';
import { LEVEL } from '../quality';
import { gunOf, type Draft, type RotorDraft } from './draft';
import { antenna, mg, tube } from './fittings';
import { Parts, S, T, bar, box, convex, cyl, lathe, loft, planSlab, rod, shade, sideSlab, superellipse, sym, type Lod, type Style, type V2, type V3 } from './kit';

// Helicopters and recon drones. Fuselages are lofted through superellipse stations taken from side
// and top views; rotors spin in their real direction (US rotors anticlockwise seen from above,
// Russian clockwise; the Ka-52's coaxial pair against each other).

/** Flight height for helicopters (2.5 levels) and recon drones (6 levels), world units. */
const HELI_LIFT = 2.5 * LEVEL;
const DRONE_LIFT = 6 * LEVEL;

/** A fuselage station: z, half width, bottom and top heights, squareness (2 round, 4 boxy). */
type Station = [number, number, number, number, number];

/** Loft a body through stations from nose to tail; smooth shaded. */
export function fuselage(p: Parts, L: Lod, st: Station[], style: Style = S.smooth, segs = 20): void {
  const n = L.lod === 0 ? segs : Math.max(6, Math.round(segs / 3));
  const rings = st.map(([z, w, y0, y1, k]) => superellipse(Math.max(w, 0.005), Math.max((y1 - y0) / 2, 0.005), k, n, (y0 + y1) / 2).map(([x, y]) => [x, y, z] as V3));
  p.add(loft(rings), { ...style, crease: style.crease ?? 55 });
}

/** A rotor blade along +x from `r0` to `r1`: tapered, thin, slightly drooped. */
function blade(r0: number, r1: number, chord: number, tip = 0.7): THREE.BufferGeometry {
  const t = chord * 0.12;
  const c1 = chord * tip;
  return convex([
    [r0, 0, -chord / 2],
    [r0, 0, chord / 2],
    [r0, t, 0],
    [r1, -0.04, -c1 / 2],
    [r1, -0.04, c1 / 2],
    [r1, t * 0.6 - 0.04, 0],
  ]);
}

/** A rotor in its own frame: hub on the axis (local y), `n` blades of radius `r`. */
function rotor(L: Lod, base: number, n: number, r: number, chord: number, hubR: number, style: Style = S.black): Parts {
  const p = new Parts(base);
  p.add(cyl(hubR, hubR * 1.1, hubR * 0.9, L.seg(10, 6)), S.gunsteel);
  const g = blade(hubR * 0.6, r, chord);
  for (let i = 0; i < n; i++) p.add(g, style, T(0, 0, 0, 0, (i / n) * Math.PI * 2, 0));
  return p;
}

/** A tail rotor in the y-z plane (spins about local x). `pairs` gives the Apache's scissor layout. */
function tailRotor(L: Lod, base: number, n: number, r: number, chord: number, scissor = false): Parts {
  const p = new Parts(base);
  p.add(cyl(chord * 0.6, chord * 0.6, chord * 1.2, L.seg(8, 5), 'x'), S.gunsteel);
  const g = blade(chord * 0.4, r, chord, 0.9);
  for (let i = 0; i < n; i++) {
    const a = scissor ? (i % 2) * 55 * (Math.PI / 180) + Math.floor(i / 2) * Math.PI : (i / n) * Math.PI * 2;
    const x = scissor ? (i % 2 ? 0.08 : -0.08) : 0;
    // Blade along +x in its own frame: turn it into the y-z plane, then around the axis.
    p.add(g, S.black, T(x, 0, 0, a, 0, 0).multiply(T(0, 0, 0, 0, 0, Math.PI / 2)));
  }
  return p;
}

function addRotor(d: Draft, r: Omit<RotorDraft, 'parent'> & { parent?: 'body' | 'turret' }): void {
  d.rotors.push({ parent: 'body', ...r });
}

/** A rocket pod: tube with a rounded nose and the tube mouths dark in front. */
function rocketPod(p: Parts, L: Lod, m: THREE.Matrix4, r: number, len: number): void {
  if (!L.hi) {
    p.add(cyl(r, r, len, 6, 'z'), S.paint, m);
    return;
  }
  p.add(
    lathe(
      [
        [0.001, -len / 2],
        [r * 0.85, -len / 2],
        [r, -len / 2 + 0.08],
        [r, len / 2 - 0.15],
        [r * 0.9, len / 2],
        [r * 0.55, len / 2 + 0.02],
      ],
      L.seg(12, 6),
      'z',
    ),
    { ...S.paint, crease: 50 },
    m,
  );
  p.add(cyl(r * 0.55, r * 0.55, 0.02, L.seg(10, 5), 'z'), S.black, m.clone().multiply(T(0, 0, len / 2 + 0.02)));
}

/** A missile on its rail: body, nose and fins, pointing +z. */
function missile(p: Parts, L: Lod, m: THREE.Matrix4, r: number, len: number, style: Style = shade(0.85)): void {
  if (!L.hi) {
    p.add(box(r * 2, r * 2, len), style, m);
    return;
  }
  p.add(
    lathe(
      [
        [0.001, -len / 2],
        [r, -len / 2],
        [r, len / 2 - r * 2.5],
        [r * 0.55, len / 2 - r * 0.8],
        [0.001, len / 2],
      ],
      L.seg(8, 5),
      'z',
    ),
    style,
    m,
  );
  if (L.hi) for (const a of [0, Math.PI / 2]) p.add(box(r * 4, 0.006, r * 2.2), style, m.clone().multiply(T(0, 0, -len / 2 + r * 1.4, 0, 0, a)));
}

/** A wing or stabiliser: plan outline (x, z) at height y, `t` thick. */
function wing(p: Parts, outline: V2[], y: number, t: number, style: Style = S.paint, m = T()): void {
  p.add(planSlab(outline, y - t / 2, y + t / 2), style, m);
}

/** A fin: side outline (z, y), `t` thick, at x. */
function fin(p: Parts, outline: V2[], x: number, t: number, style: Style = S.paint): void {
  p.add(sideSlab(outline, x - t / 2, x + t / 2), style);
}

/** A landing wheel on a strut. */
function gearLeg(p: Parts, L: Lod, top: V3, x: number, z: number, r: number, w: number): void {
  if (!L.hi) {
    p.add(bar(top, [x, r, z], 0.08), S.steel);
    p.add(cyl(r, r, w, 6, 'x'), S.tyre, T(x, r, z));
    return;
  }
  p.add(rod(top, [x, r, z], 0.05, 5), S.steel);
  p.add(lathe([[r * 0.7, -w / 2], [r, -w / 3], [r, w / 3], [r * 0.7, w / 2]], L.seg(10, 6), 'x'), S.tyre, T(x, r, z));
}

/** AH-64E Apache: tandem stepped cockpit, engine pods, stub wings with Hellfires and rockets, Longbow. */
export function apache(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = HELI_LIFT;
  d.dust = 0.25;
  d.dustTop = 0.6;
  // Fuselage: nose sensor turret to the tail fin.
  fuselage(b, L, [
    [6.55, 0.18, 1.15, 1.55, 2.2],
    [6.2, 0.42, 0.95, 1.75, 2.6],
    [5.2, 0.55, 0.88, 1.85, 3],
    [4.0, 0.62, 0.85, 1.95, 3.2],
    [2.6, 0.68, 0.85, 2.15, 3.2],
    [1.2, 0.72, 0.9, 2.45, 3],
    [-0.4, 0.68, 0.95, 2.45, 3],
    [-1.6, 0.48, 1.2, 2.3, 2.8],
    [-3.2, 0.3, 1.38, 2.12, 2.4],
    [-6.2, 0.2, 1.38, 1.85, 2.2],
    [-7.3, 0.14, 1.42, 1.82, 2.2],
  ]);
  // Stepped tandem canopy: gunner low in front, pilot higher behind.
  fuselage(
    b,
    L,
    [
      [5.75, 0.05, 1.8, 1.82, 2],
      [5.3, 0.5, 1.75, 2.25, 2.6],
      [4.35, 0.56, 1.8, 2.42, 2.8],
      [4.05, 0.56, 1.9, 2.75, 2.8],
      [3.0, 0.58, 2.0, 2.9, 2.8],
      [2.5, 0.5, 2.05, 2.62, 2.6],
    ],
    S.glass,
  );
  // Avionics bays bulging along the forward fuselage sides.
  for (const s of [1, -1]) b.add(convex([[s * 0.55, 1.0, 4.6], [s * 0.55, 1.75, 4.4], [s * 0.55, 1.0, 0.6], [s * 0.55, 1.85, 0.8], [s * 0.86, 1.1, 4.0], [s * 0.86, 1.65, 3.8], [s * 0.86, 1.1, 1.0], [s * 0.86, 1.7, 1.1]]), shade(0.95));
  // Nose sensor turret (TADS/PNVS).
  b.add(cyl(0.32, 0.32, 0.55, L.seg(12, 6)), S.paint, T(0, 1.32, 6.55));
  b.add(box(0.5, 0.22, 0.04), S.lens, T(0, 1.25, 6.88));
  // Engine pods either side of the rotor mast, exhausts pointing out and back.
  for (const s of [1, -1]) {
    b.add(lathe([[0.001, 1.7], [0.38, 1.5], [0.5, 0.9], [0.5, -1.0], [0.4, -1.6], [0.001, -1.62]], L.seg(12, 6), 'z'), { ...S.paint, crease: 50 }, T(s * 1.02, 2.2, 0.2, 0, 0, 0, 1, 1.12, 1));
    b.add(box(0.4, 0.45, 0.55), S.black, T(s * 1.12, 2.28, -1.55, 0, s * 0.3, 0));
  }
  // Stub wings with two pylons a side: four Hellfires outboard, a 19-tube rocket pod inboard.
  for (const s of [1, -1]) {
    wing(b, [[0.6, 0.85], [2.6, 0.55], [2.6, -0.25], [0.6, -0.45]].map(([x, z]) => [s * x!, z!] as V2), 1.72, 0.12);
    b.add(box(0.12, 0.35, 0.6), S.shade, T(s * 1.4, 1.5, 0.2));
    rocketPod(b, L, T(s * 1.4, 1.1, 0.25), 0.22, 1.7);
    b.add(box(0.12, 0.3, 0.6), S.shade, T(s * 2.25, 1.52, 0.2));
    for (const [dx, dy] of [
      [-0.12, 0],
      [0.12, 0],
      [-0.12, -0.25],
      [0.12, -0.25],
    ] as const)
      missile(b, L, T(s * 2.25 + dx, 1.22 + dy, 0.35), 0.09, 1.63);
  }
  // Tail fin, stabilator, tailwheel.
  fin(b, [[-6.8, 1.6], [-7.3, 3.7], [-8.0, 3.8], [-8.0, 1.6], [-7.4, 1.45]], 0, 0.14);
  wing(b, [[0, -7.15], [1.7, -7.35], [1.7, -7.9], [0, -7.85], [-1.7, -7.9], [-1.7, -7.35]], 1.6, 0.08);
  gearLeg(b, L, [0, 1.4, -6.9], 0, -7.0, 0.2, 0.12);
  // Main gear under the forward fuselage.
  for (const s of [1, -1]) gearLeg(b, L, [s * 0.6, 1.0, 3.0], s * 1.0, 3.2, 0.33, 0.2);
  if (L.hi) {
    antenna(b, L, T(0, 2.45, -1.2), 1.0);
    b.add(box(0.2, 0.1, 0.4), S.black, T(0, 2.46, 0.4));
  }
  // Main rotor and the Longbow radome above it.
  const main = rotor(L, 3.8, 4, 7.3, 0.53, 0.32);
  main.add(cyl(0.12, 0.12, 0.6, 8), S.gunsteel, T(0, 0.35, 0));
  main.add(lathe([[0.001, 0], [0.5, 0.05], [0.55, 0.3], [0.4, 0.5], [0.001, 0.56]], L.seg(14, 7)), S.smooth, T(0, 0.62, 0));
  b.add(cyl(0.18, 0.28, 1.25, L.seg(10, 6)), S.paint, T(0, 3.05, 0.6));
  addRotor(d, { parts: main, at: [0, 3.8, 0.6], axis: 'y', rate: 30.3, blur: 7.3 });
  addRotor(d, { parts: tailRotor(L, 3.15, 4, 1.4, 0.25, true), at: [0.32, 3.15, -7.65], axis: 'x', rate: 147, blur: 1.4 });
  // M230 chain gun under the chin: the gun pivot.
  const g = gunOf(d, [0, 0.82, 4.6]);
  g.add(cyl(0.22, 0.25, 0.3, L.seg(10, 6)), S.shade, T(0, 0.1, 0));
  tube(g, L, 0.045, 0.1, 1.55, T(0, -0.05, 0), S.gunsteel);
  g.add(box(0.16, 0.18, 0.5), S.gunsteel, T(0, -0.05, 0.3));
  d.muzzle = [0, -0.05, 1.55];
  d.heat.push({ at: [0, 2.3, -1.5], size: [2.4, 0.5, 0.6], level: 1, parent: 'body' }, { at: [0, 2.25, 0.2], size: [2.2, 0.8, 2.8], level: 0.7, parent: 'body' });
}

/** Ka-52 Alligator: side-by-side cockpit, coaxial 3-blade rotors, twin tail fins, 30 mm on the right. */
export function ka52(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = HELI_LIFT;
  d.dust = 0.25;
  d.dustTop = 0.6;
  fuselage(b, L, [
    [6.45, 0.12, 1.3, 1.5, 2.2],
    [6.1, 0.5, 1.05, 1.85, 2.4],
    [5.0, 0.78, 0.85, 2.0, 2.8],
    [3.6, 0.88, 0.8, 2.15, 3.2],
    [1.8, 0.9, 0.85, 2.4, 3.4],
    [0.2, 0.85, 0.9, 2.55, 3.2],
    [-1.4, 0.6, 1.1, 2.4, 3],
    [-3.2, 0.4, 1.45, 2.25, 2.6],
    [-5.6, 0.28, 1.6, 2.2, 2.4],
    [-6.6, 0.2, 1.65, 2.25, 2.2],
  ]);
  // Wide side-by-side canopy.
  fuselage(
    b,
    L,
    [
      [5.3, 0.1, 1.95, 1.98, 2],
      [4.8, 0.8, 1.9, 2.35, 2.6],
      [3.8, 0.86, 1.95, 2.7, 3],
      [2.8, 0.84, 2.05, 2.78, 3],
      [2.2, 0.7, 2.15, 2.62, 2.6],
    ],
    S.glass,
  );
  // Sensor ball under the nose, engines on the shoulders.
  b.add(lathe([[0.001, -0.4], [0.32, -0.25], [0.38, 0], [0.32, 0.25], [0.001, 0.4]], L.seg(12, 6)), S.paint, T(0, 0.82, 4.8));
  if (L.hi) b.add(box(0.3, 0.2, 0.04), S.lens, T(0, 0.8, 5.17));
  for (const s of [1, -1]) {
    b.add(lathe([[0.001, 1.4], [0.3, 1.25], [0.38, 0.7], [0.38, -0.9], [0.3, -1.3], [0.001, -1.32]], L.seg(12, 6), 'z'), S.smooth, T(s * 0.95, 2.35, 0.0));
    b.add(box(0.3, 0.34, 0.4), S.black, T(s * 1.15, 2.45, -1.25, 0, s * 0.6, 0));
  }
  // Stub wings: Vikhr racks outboard, B-8 rocket pods inboard, defensive pods on the tips.
  for (const s of [1, -1]) {
    wing(b, [[0.8, 0.7], [3.6, 0.45], [3.6, -0.35], [0.8, -0.55]].map(([x, z]) => [s * x!, z!] as V2), 1.55, 0.14);
    b.add(box(0.12, 0.3, 0.6), S.shade, T(s * 1.6, 1.35, 0.1));
    rocketPod(b, L, T(s * 1.6, 0.98, 0.15), 0.26, 2.1);
    b.add(box(0.12, 0.3, 0.6), S.shade, T(s * 2.7, 1.38, 0.05));
    for (let i = 0; i < 6; i++) {
      const dx = ((i % 3) - 1) * 0.16;
      const dy = Math.floor(i / 3) * -0.17;
      b.add(cyl(0.07, 0.07, 2.8, L.seg(7, 4), 'z'), shade(0.82), T(s * 2.7 + dx, 1.12 + dy, 0.2));
    }
    b.add(lathe([[0.001, -0.9], [0.16, -0.7], [0.18, 0.5], [0.001, 0.9]], L.seg(8, 5), 'z'), S.smooth, T(s * 3.65, 1.55, 0.1));
  }
  // The 2A42 on the right side of the fuselage.
  b.add(box(0.3, 0.38, 1.6), S.shade, T(-0.92, 1.1, 1.3));
  tube(b, L, 0.045, 2.1, 4.3, T(-0.92, 1.1, 0), S.gunsteel);
  // Tail: horizontal stabiliser with twin end-plate fins and the ventral fin.
  wing(b, [[0, -5.6], [1.6, -5.9], [1.6, -6.4], [0, -6.3], [-1.6, -6.4], [-1.6, -5.9]], 2.05, 0.1);
  for (const s of [1, -1]) fin(b, [[-5.75, 1.7], [-6.0, 2.9], [-6.55, 2.95], [-6.5, 1.65]], s * 1.62, 0.08);
  fin(b, [[-6.0, 2.2], [-6.4, 3.0], [-6.9, 3.0], [-6.75, 2.0]], 0, 0.1);
  // Coaxial rotors: lower anticlockwise, upper clockwise seen from above.
  b.add(cyl(0.2, 0.32, 1.0, L.seg(10, 6)), S.paint, T(0, 2.95, 0.4));
  const lower = rotor(L, 3.6, 3, 7.25, 0.47, 0.3);
  const upper = rotor(L, 4.6, 3, 7.25, 0.47, 0.3);
  upper.add(cyl(0.12, 0.14, 1.0, 8), S.gunsteel, T(0, -0.5, 0));
  addRotor(d, { parts: lower, at: [0, 3.6, 0.4], axis: 'y', rate: 26, blur: 7.25 });
  addRotor(d, { parts: upper, at: [0, 4.6, 0.4], axis: 'y', rate: -26, blur: 7.25 });
  d.muzzle = [-0.92, 1.1, 4.3];
  d.heat.push({ at: [0, 2.45, -1.2], size: [2.5, 0.4, 0.5], level: 1, parent: 'body' }, { at: [0, 2.35, 0], size: [2.2, 0.8, 2.6], level: 0.7, parent: 'body' });
}

/** Mi-35M: tandem bubble cockpits, troop cabin, anhedral stub wings with tip rails, 5-blade rotor. */
export function mi35(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = HELI_LIFT;
  d.dust = 0.3;
  d.dustTop = 0.7;
  fuselage(b, L, [
    [7.6, 0.14, 1.25, 1.45, 2.2],
    [7.3, 0.42, 1.0, 1.75, 2.4],
    [6.4, 0.6, 0.9, 1.95, 2.8],
    [5.0, 0.75, 0.85, 2.3, 3],
    [3.2, 0.85, 0.8, 2.6, 3.4],
    [0.8, 0.88, 0.8, 2.75, 3.4],
    [-1.6, 0.8, 0.95, 2.7, 3.2],
    [-3.2, 0.5, 1.45, 2.55, 2.8],
    [-5.5, 0.28, 1.95, 2.55, 2.4],
    [-8.6, 0.2, 2.25, 2.65, 2.2],
    [-9.4, 0.16, 2.3, 2.7, 2.2],
  ]);
  // Two bubble canopies, the pilot's higher and behind.
  fuselage(b, L, [[7.0, 0.05, 1.7, 1.72, 2], [6.6, 0.52, 1.68, 2.15, 2.4], [5.8, 0.58, 1.75, 2.35, 2.4], [5.2, 0.5, 1.85, 2.3, 2.4], [5.0, 0.2, 1.95, 2.0, 2]], S.glass);
  fuselage(b, L, [[5.0, 0.05, 2.15, 2.17, 2], [4.6, 0.58, 2.1, 2.6, 2.4], [3.7, 0.64, 2.2, 2.85, 2.4], [3.0, 0.55, 2.35, 2.75, 2.4], [2.8, 0.2, 2.45, 2.5, 2]], S.glass);
  // Cabin windows.
  if (L.hi) for (const s of [1, -1]) for (let i = 0; i < 3; i++) b.add(box(0.03, 0.32, 0.38), S.glass, T(s * 0.9, 1.9, 1.6 - i * 0.65));
  // Engines and intakes on top, exhausts to the sides.
  for (const s of [1, -1]) {
    b.add(lathe([[0.001, 1.9], [0.32, 1.75], [0.4, 1.1], [0.4, -1.2], [0.3, -1.7], [0.001, -1.72]], L.seg(12, 6), 'z'), S.smooth, T(s * 0.62, 2.95, 0.6));
    b.add(box(0.35, 0.4, 0.5), S.black, T(s * 0.95, 2.9, -1.2, 0, s * 0.7, 0));
  }
  // Anhedral stub wings: two pylons a side with rocket pods, Ataka rails on the tips.
  for (const s of [1, -1]) {
    const m = T(s * 0.85, 1.65, 0.2, 0, 0, s * -12 * (Math.PI / 180));
    wing(b, [[0, 0.8], [2.5, 0.5], [2.5, -0.5], [0, -0.8]].map(([x, z]) => [s * x!, z!] as V2), 0, 0.14, S.paint, m);
    for (const x of [0.9, 1.75]) {
      const pm = m.clone().multiply(T(s * x, -0.35, 0.05));
      b.add(box(0.12, 0.3, 0.6), S.shade, m.clone().multiply(T(s * x, -0.12, 0)));
      rocketPod(b, L, pm, 0.26, 2.1);
    }
    for (const dy of [0.12, -0.12]) missile(b, L, m.clone().multiply(T(s * 2.55, dy, 0.3)), 0.07, 1.8);
  }
  // Nose turret with the twin 23 mm.
  const g = gunOf(d, [0, 0.82, 6.4]);
  g.add(lathe([[0.001, -0.3], [0.3, -0.2], [0.32, 0.1], [0.001, 0.25]], L.seg(10, 6)), S.paint, T(0, 0.05, 0));
  for (const x of [-0.06, 0.06]) tube(g, L, 0.03, 0.1, 1.1, T(x, 0, 0), S.gunsteel);
  d.muzzle = [0, 0, 1.1];
  // Tail fin with the tail rotor on the left, stabiliser.
  fin(b, [[-8.6, 2.5], [-9.2, 4.6], [-9.7, 4.6], [-9.5, 2.4]], 0, 0.14);
  wing(b, [[0, -7.8], [1.6, -8.0], [1.6, -8.5], [0, -8.4], [-1.6, -8.5], [-1.6, -8.0]], 2.4, 0.09);
  // Fixed tricycle landing gear.
  gearLeg(b, L, [0, 1.0, 6.2], 0, 6.3, 0.3, 0.2);
  for (const s of [1, -1]) gearLeg(b, L, [s * 0.7, 1.0, -1.4], s * 1.3, -1.3, 0.4, 0.25);
  b.add(cyl(0.22, 0.32, 1.0, L.seg(10, 6)), S.paint, T(0, 3.15, 0.2));
  addRotor(d, { parts: rotor(L, 3.9, 5, 8.6, 0.58, 0.38), at: [0, 3.9, 0.2], axis: 'y', rate: -25, blur: 8.6 });
  addRotor(d, { parts: tailRotor(L, 4.0, 4, 1.95, 0.3, true), at: [0.35, 4.0, -9.35], axis: 'x', rate: 118, blur: 1.95 });
  d.heat.push({ at: [0, 2.9, -1.2], size: [2.2, 0.5, 0.5], level: 1, parent: 'body' }, { at: [0, 2.95, 0.6], size: [1.8, 0.8, 3.0], level: 0.7, parent: 'body' });
}

/** AH-6M Little Bird: egg cabin, skids, 6-blade rotor, side pylons with miniguns and rocket pods. */
export function ah6(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = HELI_LIFT;
  d.dust = 0.25;
  d.dustTop = 0.5;
  // The egg: glazed nose, cabin, then the slim tail boom.
  fuselage(b, L, [
    [2.25, 0.08, 1.15, 1.35, 2],
    [2.0, 0.55, 0.75, 1.85, 2.2],
    [1.2, 0.72, 0.55, 2.15, 2.3],
    [0.0, 0.72, 0.55, 2.2, 2.4],
    [-1.0, 0.55, 0.75, 2.05, 2.3],
    [-1.6, 0.25, 1.35, 1.75, 2.1],
    [-4.6, 0.12, 1.45, 1.68, 2],
    [-4.9, 0.1, 1.48, 1.68, 2],
  ]);
  fuselage(b, L, [[2.3, 0.06, 1.2, 1.32, 2], [2.05, 0.6, 0.85, 1.85, 2.2], [1.3, 0.74, 0.95, 2.1, 2.3], [0.7, 0.7, 1.2, 2.05, 2.2], [0.5, 0.2, 1.7, 1.8, 2]], S.glass);
  // T-tail: dorsal and ventral fin, stabiliser with end plates.
  fin(b, [[-4.3, 1.6], [-4.6, 2.45], [-4.95, 2.45], [-4.85, 1.6]], 0, 0.06);
  fin(b, [[-4.4, 1.5], [-4.6, 1.05], [-4.85, 1.05], [-4.8, 1.5]], 0, 0.05);
  wing(b, [[0, -4.4], [0.8, -4.45], [0.8, -4.8], [-0.8, -4.8], [-0.8, -4.45]], 2.45, 0.05);
  for (const s of [1, -1]) fin(b, [[-4.4, 2.3], [-4.45, 2.65], [-4.8, 2.65], [-4.8, 2.3]], s * 0.8, 0.04);
  // Skids.
  for (const s of [1, -1]) {
    b.add(cyl(0.04, 0.04, 2.9, L.seg(6, 4), 'z'), S.black, T(s * 0.95, 0.05, 0.1));
    b.add(rod([s * 0.95, 0.06, 1.55], [s * 0.95, 0.18, 1.75], 0.04, 4), S.black);
    for (const z of [0.9, -0.7]) b.add(rod([s * 0.95, 0.05, z], [s * 0.5, 0.7, z], 0.04, 4), S.black);
  }
  // The plank across the cabin: an M134 inboard and a 7-tube rocket pod outboard each side.
  b.add(box(3.2, 0.1, 0.25), S.black, T(0, 0.95, 0.1));
  for (const s of [1, -1]) {
    rocketPod(b, L, T(s * 1.5, 0.75, 0.25), 0.15, 1.2);
    b.add(box(0.2, 0.2, 0.7), S.gunsteel, T(s * 1.05, 0.78, 0.2));
    tube(b, L, 0.05, 0.5, 1.4, T(s * 1.05, 0.78, 0), S.gunsteel);
  }
  b.add(cyl(0.18, 0.25, 0.5, L.seg(10, 6)), S.paint, T(0, 2.35, 0.1));
  addRotor(d, { parts: rotor(L, 2.65, 6, 4.15, 0.19, 0.2), at: [0, 2.65, 0.1], axis: 'y', rate: 51.5, blur: 4.15 });
  addRotor(d, { parts: tailRotor(L, 2.0, 2, 0.7, 0.12), at: [0.12, 2.0, -4.75], axis: 'x', rate: 307, blur: 0.7 });
  d.muzzle = [1.05, 0.78, 1.4];
  d.heat.push({ at: [0, 1.9, -1.2], size: [0.6, 0.4, 0.5], level: 1, parent: 'body' });
}

/** UH-60M Black Hawk: long fuselage, 4-blade rotor, canted tail rotor, fixed wheels, door guns. */
export function uh60(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = HELI_LIFT;
  d.dust = 0.25;
  d.dustTop = 0.6;
  fuselage(b, L, [
    [6.75, 0.15, 1.1, 1.4, 2.2],
    [6.4, 0.6, 0.85, 1.85, 2.4],
    [5.4, 0.95, 0.65, 2.15, 2.8],
    [3.6, 1.18, 0.6, 2.35, 3.6],
    [0.0, 1.18, 0.62, 2.45, 3.8],
    [-1.6, 1.05, 0.8, 2.45, 3.4],
    [-3.0, 0.55, 1.25, 2.38, 2.8],
    [-5.8, 0.3, 1.4, 2.2, 2.4],
    [-7.8, 0.22, 1.7, 2.35, 2.2],
  ]);
  fuselage(b, L, [[6.25, 0.1, 1.55, 1.6, 2], [6.0, 0.72, 1.4, 2.0, 2.4], [5.2, 0.95, 1.55, 2.35, 2.8], [4.6, 0.98, 1.75, 2.42, 3], [4.4, 0.4, 2.2, 2.3, 2]], S.glass);
  // Cabin door and window outlines, engines on top, the dorsal fairing.
  if (L.hi) for (const s of [1, -1]) {
    b.add(box(0.02, 1.25, 1.75), shade(0.82), T(s * 1.19, 1.45, 1.35));
    b.add(box(0.03, 0.4, 0.5), S.glass, T(s * 1.2, 1.9, 1.6));
    b.add(box(0.03, 0.42, 0.52), S.glass, T(s * 1.2, 1.9, 3.15));
  }
  b.add(lathe([[0.001, 2.6], [0.55, 2.1], [0.75, 0.8], [0.75, -1.4], [0.45, -2.6], [0.001, -2.8]], L.seg(14, 7), 'z'), S.smooth, T(0, 2.45, -0.1, 0, 0, 0, 1, 0.55, 1));
  for (const s of [1, -1]) b.add(lathe([[0.001, 1.2], [0.3, 1.0], [0.34, -0.8], [0.25, -1.2], [0.001, -1.22]], L.seg(10, 6), 'z'), S.smooth, T(s * 0.62, 2.6, -0.3));
  // Tail pylon and the large stabilator.
  fin(b, [[-7.3, 1.9], [-7.9, 3.9], [-8.6, 4.0], [-8.3, 1.9]], 0, 0.16);
  wing(b, [[0, -7.5], [2.2, -7.6], [2.2, -8.3], [0, -8.2], [-2.2, -8.3], [-2.2, -7.6]], 1.95, 0.1);
  // Main wheels on their struts, tail wheel.
  for (const s of [1, -1]) {
    gearLeg(b, L, [s * 0.9, 1.1, 2.6], s * 1.45, 2.7, 0.36, 0.22);
    b.add(rod([s * 0.95, 0.95, 3.4], [s * 1.45, 0.42, 2.75], 0.04, 4), S.steel);
  }
  gearLeg(b, L, [0, 1.42, -6.6], 0, -6.7, 0.18, 0.1);
  // Door guns in the forward cabin windows.
  for (const s of [1, -1]) mg(b, L, T(s * 1.3, 1.85, 2.0, 0, s * 0.6, 0));
  b.add(cyl(0.22, 0.3, 0.6, L.seg(10, 6)), S.paint, T(0, 3.15, 0.3));
  addRotor(d, { parts: rotor(L, 3.6, 4, 8.18, 0.53, 0.38), at: [0, 3.6, 0.3], axis: 'y', rate: 27, blur: 8.18 });
  addRotor(d, { parts: tailRotor(L, 3.4, 4, 1.68, 0.25), at: [-0.32, 3.4, -8.35], tilt: [0, 0, -20 * (Math.PI / 180)], axis: 'x', rate: 124.6, blur: 1.68 });
  d.muzzle = [1.3, 1.85, 2.0];
  d.heat.push({ at: [0, 2.6, -1.6], size: [1.6, 0.5, 0.8], level: 1, parent: 'body' }, { at: [0, 2.6, -0.3], size: [1.6, 0.6, 2.2], level: 0.7, parent: 'body' });
}

/** Mi-8AMTSh: big fuselage, clamshell rear doors, 5-blade rotor, outriggers with rocket pods. */
export function mi8(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = HELI_LIFT;
  d.dust = 0.3;
  d.dustTop = 0.7;
  fuselage(b, L, [
    [7.6, 0.2, 1.1, 1.5, 2.2],
    [7.25, 0.8, 0.85, 2.15, 2.4],
    [6.3, 1.15, 0.75, 2.6, 2.8],
    [4.8, 1.25, 0.72, 2.95, 3.8],
    [0.0, 1.25, 0.72, 3.0, 4],
    [-3.6, 1.2, 0.85, 2.95, 3.6],
    [-4.6, 0.9, 1.45, 2.85, 2.8],
    [-5.4, 0.42, 2.25, 2.85, 2.4],
    [-10.4, 0.22, 2.5, 2.95, 2.2],
    [-11.0, 0.18, 2.55, 3.0, 2.2],
  ]);
  // Glazed nose.
  fuselage(b, L, [[7.7, 0.1, 1.25, 1.4, 2], [7.4, 0.78, 1.1, 2.0, 2.4], [6.6, 1.05, 1.15, 2.55, 2.8], [5.9, 1.08, 1.6, 2.72, 3], [5.6, 0.5, 2.5, 2.6, 2]], S.glass);
  // Engine housing and the dust filters on top.
  b.add(convex(sym([[0.95, 3.0, 4.2], [0.95, 3.0, -3.3], [0.8, 3.75, 3.6], [0.8, 3.75, -2.6], [0.4, 3.9, 2.0], [0.4, 3.9, -2.0]])), S.paint);
  for (const s of [1, -1]) {
    b.add(cyl(0.38, 0.38, 1.4, L.seg(10, 6), 'z'), shade(0.85), T(s * 0.6, 3.55, 4.4));
    b.add(box(0.3, 0.32, 0.4), S.black, T(s * 1.0, 3.45, -1.6, 0, s * 0.7, 0));
  }
  // Round cabin windows, the sliding door.
  if (L.hi) {
    for (const s of [1, -1]) for (let i = 0; i < 5; i++) b.add(cyl(0.2, 0.2, 0.04, 8, 'x'), S.glass, T(s * 1.26, 2.1, 3.6 - i * 1.15));
    b.add(box(0.03, 1.4, 1.1), shade(0.85), T(1.26, 1.6, 4.5));
  }
  // Clamshell doors: the rear fuselage under the boom, split down the middle.
  b.add(convex(sym([[1.15, 0.9, -3.6], [1.15, 2.85, -3.6], [0.85, 1.0, -4.6], [0.85, 2.7, -4.7], [0.3, 1.5, -5.2], [0.3, 2.5, -5.25]])), shade(0.94));
  if (L.hi) b.add(box(0.03, 1.4, 0.05), S.black, T(0, 1.95, -5.15, 0.3, 0, 0));
  // Outriggers each side: a truss with two pylons and rocket pods.
  for (const s of [1, -1]) {
    wing(b, [[1.2, 1.2], [2.8, 1.0], [2.8, -0.6], [1.2, -0.8]].map(([x, z]) => [s * x!, z!] as V2), 1.95, 0.12);
    b.add(rod([s * 1.2, 1.0, 0.0], [s * 2.6, 1.9, 0.1], 0.06, 5), S.shade);
    for (const x of [1.75, 2.5]) {
      b.add(box(0.12, 0.28, 0.6), S.shade, T(s * x, 1.75, 0.2));
      rocketPod(b, L, T(s * x, 1.38, 0.3), 0.26, 2.1);
    }
  }
  // Tail: fin, stabiliser, fixed tricycle gear.
  fin(b, [[-10.2, 2.7], [-10.9, 4.5], [-11.5, 4.5], [-11.2, 2.6]], 0, 0.14);
  wing(b, [[0, -9.6], [1.5, -9.75], [1.5, -10.25], [0, -10.2], [-1.5, -10.25], [-1.5, -9.75]], 2.55, 0.09);
  gearLeg(b, L, [0, 0.9, 6.3], 0, 6.4, 0.3, 0.3);
  for (const s of [1, -1]) {
    gearLeg(b, L, [s * 1.3, 1.1, 0.2], s * 2.0, 0.3, 0.45, 0.3);
    b.add(rod([s * 1.0, 0.8, 0.4], [s * 2.0, 0.5, 0.3], 0.05, 4), S.steel);
  }
  b.add(cyl(0.24, 0.34, 0.8, L.seg(10, 6)), S.paint, T(0, 4.05, 0.6));
  addRotor(d, { parts: rotor(L, 4.5, 5, 10.6, 0.52, 0.42), at: [0, 4.5, 0.6], axis: 'y', rate: -20.1, blur: 10.6 });
  addRotor(d, { parts: tailRotor(L, 4.0, 3, 1.95, 0.3), at: [0.35, 4.0, -11.0], axis: 'x', rate: 117.7, blur: 1.95 });
  d.muzzle = [2.5, 1.38, 1.4];
  d.heat.push({ at: [0, 3.45, -1.6], size: [2.2, 0.4, 0.5], level: 1, parent: 'body' }, { at: [0, 3.5, 0.5], size: [1.8, 0.8, 5.0], level: 0.7, parent: 'body' });
}

/** RQ-11B Raven: small pod fuselage, high wing on a pylon, pusher prop, tail on a boom. */
export function raven(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = DRONE_LIFT;
  d.dust = 0;
  fuselage(b, L, [[0.45, 0.01, 0.04, 0.06, 2], [0.38, 0.05, 0.0, 0.11, 2.4], [0.0, 0.06, 0.0, 0.13, 2.4], [-0.2, 0.035, 0.05, 0.12, 2.2], [-0.45, 0.012, 0.09, 0.12, 2]], S.smooth, 10);
  b.add(box(0.03, 0.08, 0.14), S.paint, T(0, 0.15, 0.05));
  wing(b, [[0, 0.12], [0.68, 0.08], [0.68, -0.05], [0, -0.06], [-0.68, -0.05], [-0.68, 0.08]], 0.2, 0.012);
  wing(b, [[0, -0.36], [0.2, -0.38], [0.2, -0.46], [-0.2, -0.46], [-0.2, -0.38]], 0.12, 0.008);
  fin(b, [[-0.36, 0.11], [-0.42, 0.25], [-0.47, 0.25], [-0.46, 0.11]], 0, 0.008);
  const prop = new Parts(0);
  const bl = box(0.012, 0.22, 0.03);
  prop.add(bl, S.black);
  prop.add(cyl(0.012, 0.012, 0.03, 6, 'x'), S.black);
  addRotor(d, { parts: prop, at: [0, 0.2, -0.08], tilt: [0, Math.PI / 2, 0], axis: 'x', rate: 628, blur: 0.11, blurTint: 0x222222 });
  d.muzzle = [0, 0.02, 0.45];
}

/** Orlan-10: high wing, nose propeller, slim fuselage and a conventional tail. */
export function orlan(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.lift = DRONE_LIFT;
  d.dust = 0;
  fuselage(b, L, [[0.85, 0.05, 0.12, 0.2, 2], [0.7, 0.1, 0.05, 0.26, 2.4], [0.1, 0.12, 0.03, 0.3, 2.6], [-0.5, 0.08, 0.08, 0.28, 2.4], [-0.95, 0.03, 0.2, 0.26, 2]], S.smooth, 10);
  wing(b, [[0, 0.32], [1.55, 0.22], [1.55, 0.02], [0, 0.0], [-1.55, 0.02], [-1.55, 0.22]], 0.31, 0.03);
  wing(b, [[0, -0.75], [0.45, -0.8], [0.45, -0.95], [-0.45, -0.95], [-0.45, -0.8]], 0.24, 0.015);
  fin(b, [[-0.7, 0.24], [-0.82, 0.55], [-0.95, 0.55], [-0.94, 0.24]], 0, 0.015);
  // Camera turret under the belly.
  b.add(lathe([[0.001, -0.06], [0.06, -0.03], [0.06, 0.03], [0.001, 0.06]], L.seg(8, 5)), S.black, T(0, 0.03, 0.3));
  const prop = new Parts(0);
  prop.add(box(0.02, 0.4, 0.05), S.black);
  prop.add(cyl(0.03, 0.04, 0.06, 6, 'x'), S.black);
  addRotor(d, { parts: prop, at: [0, 0.16, 0.9], tilt: [0, Math.PI / 2, 0], axis: 'x', rate: -785, blur: 0.2, blurTint: 0x222222 });
  d.muzzle = [0, 0.05, 0.9];
}
