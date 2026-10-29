import type * as THREE from 'three';
import { gunOf, turretOf, type Draft } from './draft';
import { antenna, barrel, bundle, grille, hatch, headlight, hook, jerrycans, panoramic, periscope, rack, sightBox, smoke } from './fittings';
import { C, runningGear, skirt } from './gear';
import { Parts, S, T, bar, box, chamfer, convex, cyl, lathe, shade, superellipse, sym, type Lod, type V3 } from './kit';
import { cupola, rearDrumsAndLog, rubberSkirt } from './soviet';
import { t72Hull } from './tanks';

// Air defence guns, self-propelled howitzers and recovery vehicles.

const D = Math.PI / 180;

/** A curved radar antenna: a lens of `w` x `h` half sizes, `t` deep, facing +z. */
function antennaDish(p: Parts, L: Lod, m: THREE.Matrix4, w: number, h: number, t: number): void {
  const n = L.seg(16, 8);
  const front = superellipse(w, h, 2.6, n).map(([x, y]) => [x, y, 0] as V3);
  const back = superellipse(w * 0.82, h * 0.82, 2.6, n).map(([x, y]) => [x, y, -t] as V3);
  p.add(convex([...front, ...back]), shade(0.92), m);
  if (L.hi) p.add(convex([...superellipse(w * 0.92, h * 0.9, 2.6, n).map(([x, y]) => [x, y, 0.012] as V3), ...superellipse(w * 0.9, h * 0.88, 2.6, n).map(([x, y]) => [x, y, 0.004] as V3)]), shade(0.75), m);
}

/** A round tracking radar dish in its housing, facing +z. */
function trackingDish(p: Parts, L: Lod, m: THREE.Matrix4, r: number): void {
  p.add(cyl(r * 1.05, r * 1.1, 0.3, L.seg(14, 7), 'z'), S.paint, m);
  p.add(lathe([[r, 0.15], [r * 0.6, 0.11], [0.001, 0.1]], L.seg(14, 7), 'z'), shade(0.75), m);
}

/** Flakpanzer Gepard 1A2: Leopard 1 hull, big turret, a 35 mm gun on each side, two radars. */
export function gepard(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.164;
  d.trackKind = 'pads';
  d.dustTop = 1.15;
  b.add(
    convex(
      sym([
        [1.08, 0.44, -3.0],
        [1.08, 0.44, 2.65],
        [1.08, 0.98, 3.42],
        [1.08, 1.05, -3.42],
        [1.08, 0.66, -3.42],
      ]),
    ),
    S.paint,
  );
  // Leopard 1 hull: the sharp wedge nose, flat deck.
  b.add(
    convex(
      sym([
        [1.6, 1.04, -3.42],
        [1.6, 1.04, 3.05],
        [1.6, 1.52, -3.4],
        [1.52, 1.58, -3.35],
        [1.52, 1.58, 1.75],
        [1.5, 1.02, 3.44],
        [1.0, 1.0, 3.46],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.38,
    trackW: 0.55,
    trackT: 0.07,
    wheels: [2.38, 1.62, 0.86, 0.1, -0.66, -1.42, -2.18],
    wheelR: 0.34,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(-2.95, 0.72, 0.3), teeth: 11 },
    idler: C(3.0, 0.6, 0.3),
    rollers: [C(1.95, 1.0, 0.09), C(0.5, 1.0, 0.09), C(-0.95, 1.01, 0.09), C(-2.35, 1.02, 0.09)],
    hidden: true,
  });
  b.pair(box(0.3, 0.035, 6.7), S.paint, T(1.5, 1.05, -0.05));
  skirt(b, 1.66, -3.2, 3.3, 1.05, 0.76, 0.03, shade(0.9), 0.3);
  if (L.hi) {
    hatch(b, L, T(-0.65, 1.58, 2.0), 0.3);
    periscope(b, L, T(-0.65, 1.58, 2.35), 0.22);
    grille(b, L, T(0, 1.585, -2.3), 2.4, 1.6, 8);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.35, 1.25, 3.15, -0.3, 0, 0));
      hook(b, L, T(s * 0.75, 0.95, 3.4, -0.9, 0, 0));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.45, 1.4, -3.43));
    }
  }
  d.heat.push({ at: [0, 1.62, -2.3], size: [2.4, 0.08, 1.8], level: 0.8, parent: 'body' });

  const t = turretOf(d, [0, 1.58, -0.4]);
  t.add(
    convex(
      sym([
        [0.9, 0, 1.35],
        [1.22, 0, 0.9],
        [1.22, 0, -1.55],
        [1.05, 0, -1.8],
        [0, 0, -1.82],
        [0.75, 1.25, 0.95],
        [1.12, 1.25, 0.65],
        [1.12, 1.25, -1.5],
        [0.98, 1.25, -1.72],
        [0, 1.25, -1.74],
      ]),
    ),
    S.paint,
  );
  // Tracking radar on the front, search radar mast at the rear (the antenna turns: a rotor).
  trackingDish(t, L, T(0, 0.9, 1.05), 0.45);
  t.add(chamfer(0.5, 0.75, 0.45, 0.05), S.paint, T(0, 1.55, -1.25));
  sightBox(t, L, T(0.7, 1.25, 0.35), 0.34, 0.3, 0.4);
  hatch(t, L, T(-0.6, 1.25, -0.2), 0.32);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.2, 0.95, -1.0, 0, s * 80 * D, 0), 4, 1);
  if (L.hi) antenna(t, L, T(0.9, 1.25, -1.55), 1.8);
  const radar = new Parts(1.58 + 2.0);
  antennaDish(radar, L, T(0, 0.3, 0.15), 0.95, 0.3, 0.12);
  radar.add(box(0.12, 0.3, 0.3), S.shade, T(0, 0.1, 0));
  d.rotors.push({ parts: radar, at: [0, 1.9, -1.25], axis: 'y', rate: 6.3, blur: 0, parent: 'turret' });
  // The two 35 mm KDA guns on the turret sides; they elevate together.
  const g = gunOf(d, [0, 0.82, 0.1]);
  for (const s of [1, -1]) {
    g.add(chamfer(0.44, 0.62, 1.9, 0.05), S.paint, T(s * 1.48, 0, -0.1));
    barrel(g, L, { start: 0.85, len: 3.55, r0: 0.055, r1: 0.045, brake: 'pepper', bore: 0.0175 }, T(s * 1.48, 0.05, 0), S.gunsteel);
  }
  d.muzzle = [1.48, 0.05, 3.55];
  d.heat.push({ at: [1.48, 0.05, 2.2], size: [0.12, 0.12, 2.6], level: 0.3, parent: 'gun' });
}

/** 2K22M1 Tunguska-M1: tracked, twin 30 mm guns and four missile tubes a side, search and tracking radars. */
export function tunguska(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.14;
  d.trackKind = 'steel';
  d.dustTop = 1.1;
  b.add(
    convex(
      sym([
        [1.0, 0.45, -3.3],
        [1.0, 0.45, 2.9],
        [1.0, 1.0, 3.6],
        [1.0, 1.05, -3.6],
        [1.0, 0.65, -3.6],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.52, 1.02, -3.6],
        [1.52, 1.02, 3.3],
        [1.52, 1.62, -3.58],
        [1.45, 1.68, -3.5],
        [1.45, 1.68, 2.0],
        [1.45, 1.0, 3.62],
        [1.0, 0.98, 3.64],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.3,
    trackW: 0.48,
    trackT: 0.06,
    wheels: [2.3, 1.43, 0.56, -0.31, -1.18, -2.05],
    wheelR: 0.33,
    design: 'light',
    twin: true,
    wheelStyle: shade(0.75, { ao: 0.85 }),
    sprocket: { ...C(-3.05, 0.72, 0.29), teeth: 11 },
    idler: C(3.1, 0.62, 0.28),
    rollers: [C(1.7, 0.98, 0.08), C(0, 0.98, 0.08), C(-1.7, 0.99, 0.08)],
  });
  b.pair(box(0.3, 0.035, 7.0), S.paint, T(1.5, 1.03, -0.05));
  skirt(b, 1.62, -3.4, 3.4, 1.04, 0.84, 0.03, shade(0.85), 0.2);
  if (L.hi) {
    grille(b, L, T(0, 1.685, -2.5), 2.3, 1.6, 8);
    hatch(b, L, T(0.6, 1.68, 2.2), 0.3);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.2, 1.2, 3.35, -0.3, 0, 0));
      b.add(box(0.2, 0.1, 0.05), S.red, T(s * 1.4, 1.4, -3.61));
    }
    jerrycans(b, L, T(-1.0, 1.68, -3.3), 2);
  }
  d.heat.push({ at: [0, 1.72, -2.5], size: [2.3, 0.08, 1.8], level: 0.8, parent: 'body' });

  const t = turretOf(d, [0, 1.68, -0.25]);
  t.add(
    convex(
      sym([
        [0.95, 0, 1.3],
        [1.15, 0, 0.9],
        [1.15, 0, -1.55],
        [0.95, 0, -1.75],
        [0, 0, -1.78],
        [0.8, 1.0, 1.0],
        [1.05, 1.0, 0.7],
        [1.05, 1.0, -1.5],
        [0.9, 1.0, -1.68],
        [0, 1.0, -1.7],
      ]),
    ),
    S.paint,
  );
  trackingDish(t, L, T(0, 0.72, 1.05), 0.42);
  t.add(chamfer(0.45, 0.5, 0.4, 0.05), S.paint, T(0, 1.25, -1.2));
  sightBox(t, L, T(-0.6, 1.0, 0.45), 0.34, 0.32, 0.4);
  hatch(t, L, T(0.55, 1.0, -0.4), 0.3);
  const radar = new Parts(1.68 + 1.6);
  antennaDish(radar, L, T(0, 0.28, 0.1), 0.9, 0.36, 0.14);
  radar.add(box(0.14, 0.24, 0.24), S.shade, T(0, 0.08, 0));
  d.rotors.push({ parts: radar, at: [0, 1.5, -1.2], axis: 'y', rate: 6.3, blur: 0, parent: 'turret' });
  // Twin-barrel 30 mm guns on the sides, four 9M311 tubes above each.
  const g = gunOf(d, [0, 0.62, 0.35]);
  for (const s of [1, -1]) {
    g.add(chamfer(0.34, 0.46, 1.4, 0.04), S.paint, T(s * 1.38, 0, 0));
    for (const y of [0.09, -0.09]) barrel(g, L, { start: 0.7, len: 3.0, r0: 0.04, r1: 0.032, brake: 'flash', bore: 0.015 }, T(s * 1.38, y, 0), S.gunsteel);
    if (L.hi)
      for (const [dx, dy] of [
        [0, 0.38],
        [0.2, 0.38],
        [0, 0.58],
        [0.2, 0.58],
      ] as const)
        g.add(cyl(0.09, 0.09, 2.5, 8, 'z'), shade(0.9), T(s * (1.32 + dx), dy, 0.05));
    else g.add(box(0.38, 0.38, 2.5), shade(0.9), T(s * 1.42, 0.48, 0.05));
    if (L.hi) g.add(box(0.48, 0.42, 0.12), shade(0.8), T(s * 1.42, 0.48, -1.2));
  }
  d.muzzle = [1.38, 0.09, 3.0];
  d.heat.push({ at: [1.38, 0, 1.8], size: [0.12, 0.3, 2.4], level: 0.3, parent: 'gun' });
}

/** M109A7 Paladin: big boxy turret, long 155 mm with a double-baffle brake, 7 road wheels. */
export function paladin(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.152;
  d.trackKind = 'pads';
  d.dustTop = 1.15;
  b.add(
    convex(
      sym([
        [1.1, 0.45, -3.1],
        [1.1, 0.45, 2.85],
        [1.1, 1.12, 3.42],
        [1.1, 1.15, -3.4],
        [1.1, 0.7, -3.4],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.68, 1.12, -3.4],
        [1.68, 1.12, 3.3],
        [1.68, 1.62, -3.38],
        [1.6, 1.7, -3.3],
        [1.6, 1.7, 2.1],
        [1.6, 1.25, 3.45],
        [1.0, 1.15, 3.46],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.45,
    trackW: 0.53,
    trackT: 0.07,
    wheels: [2.4, 1.6, 0.8, 0, -0.8, -1.6, -2.4],
    wheelR: 0.31,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.82 }),
    sprocket: { ...C(3.02, 0.76, 0.28), teeth: 11 },
    idler: C(-3.02, 0.62, 0.29),
    // No return rollers: the top run rests on the road wheels.
    rollers: [C(1.6, 0.69, 0.02), C(0, 0.69, 0.02), C(-1.6, 0.69, 0.02)],
  });
  b.pair(box(0.62, 0.04, 6.9), S.paint, T(1.45, 1.13, 0));
  if (L.hi) {
    hatch(b, L, T(0.75, 1.7, 2.0), 0.3);
    periscope(b, L, T(0.75, 1.7, 2.35), 0.25);
    grille(b, L, T(-0.7, 1.5, 2.75, -0.35, 0, 0), 1.0, 0.8, 6);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.45, 1.3, 3.35));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.5, 1.5, -3.41));
      // Travel lock A-frame on the glacis.
      b.add(bar([s * 0.45, 1.3, 3.3], [0, 2.38, 3.35], 0.08), S.shade);
    }
    b.add(box(0.5, 0.2, 0.2), S.shade, T(0, 2.4, 3.35));
    b.add(box(1.6, 1.2, 0.05), shade(0.88), T(0, 0.95, -3.42));
  }
  d.heat.push({ at: [-0.7, 1.55, 2.7], size: [1.1, 0.4, 1.0], level: 1, parent: 'body' });

  const t = turretOf(d, [0, 1.7, -0.75]);
  t.add(
    convex(
      sym([
        [1.0, 0, 1.6],
        [1.56, 0, 1.3],
        [1.56, 0, -2.6],
        [0, 0, -2.66],
        [0.9, 1.55, 1.25],
        [1.5, 1.55, 1.05],
        [1.5, 1.55, -2.55],
        [0, 1.55, -2.6],
      ]),
    ),
    S.paint,
  );
  cupola(t, L, T(-0.75, 1.55, 0.3), 0.38);
  hatch(t, L, T(0.7, 1.55, -0.3), 0.34);
  sightBox(t, L, T(0.55, 1.55, 0.75), 0.3, 0.26, 0.35);
  if (L.hi) {
    // Side stowage boxes and the rear rack.
    t.pair(chamfer(0.3, 0.45, 1.6, 0.03), shade(0.92), T(1.68, 0.8, -1.2));
    rack(t, L, T(0, 1.1, -2.8), 2.6, 0.4, 0.3);
    bundle(t, T(0.4, 1.3, -2.8), 1.6, 0.35, 0.25, S.canvas, 3);
    antenna(t, L, T(1.2, 1.55, -2.2), 2.3);
    antenna(t, L, T(-1.2, 1.55, -2.2), 2.3);
  }
  const g = gunOf(d, [0, 0.72, 1.32]);
  g.add(chamfer(1.05, 0.85, 0.55, 0.06), S.paint, T(0, 0, 0.2));
  barrel(g, L, { start: 0.48, len: 5.75, r0: 0.14, r1: 0.105, evac: { at: 3.9, len: 0.85, r: 0.165 }, brake: 'double', bore: 0.0775 });
  d.muzzle = [0, 0, 5.75];
  d.heat.push({ at: [0, 0, 3.0], size: [0.26, 0.26, 5.2], level: 0.3, parent: 'gun' });
}

/** 2S19M2 Msta-S: T-80 type running gear, a huge turret, long 152 mm with a slotted muzzle brake. */
export function msta(d: Draft): void {
  const L = d.L;
  const { half } = t72Hull(d, { len: 7.15, design: 'cast' });
  const b = d.body;
  rubberSkirt(b, L, { x: 1.81, top: 1.05, bottom: 0.55, z0: -half + 0.3, z1: half - 0.25, era: 0 });
  b.add(cyl(0.13, 0.12, 3.2, L.seg(9, 5), 'x'), { ...S.wood, crease: 50 }, T(0, 1.55, -half - 0.1));

  const t = turretOf(d, [0, 1.43, -0.55]);
  t.add(
    convex(
      sym([
        [1.0, 0, 1.75],
        [1.62, 0, 1.25],
        [1.62, 0, -2.95],
        [1.4, 0, -3.1],
        [0, 0, -3.12],
        [0.8, 1.4, 1.2],
        [1.52, 1.4, 0.85],
        [1.52, 1.4, -2.9],
        [1.32, 1.4, -3.02],
        [0, 1.4, -3.04],
      ]),
    ),
    S.paint,
  );
  // Remote NSVT on the commander's cupola (right), gunner's sight and hatch (left), side stowage.
  cupola(t, L, T(-0.8, 1.4, 0.0), 0.4);
  sightBox(t, L, T(0.6, 1.4, 0.55), 0.36, 0.3, 0.42);
  panoramic(t, L, T(0.9, 1.4, -0.5), 0.18, 0.36);
  hatch(t, L, T(0.5, 1.4, -1.2), 0.32);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.45, 1.0, 1.0, 0, s * 45 * D, 0), 3, 2);
  if (L.hi) {
    t.pair(chamfer(0.3, 0.5, 1.9, 0.03), shade(0.92), T(1.75, 0.8, -1.5));
    t.add(box(0.9, 1.0, 0.05), shade(0.85), T(0, 0.6, -3.14));
    antenna(t, L, T(1.1, 1.4, -2.5), 2.2);
  }
  const g = gunOf(d, [0, 0.66, 1.42]);
  g.add(chamfer(1.0, 0.85, 0.6, 0.06), S.paint, T(0, 0, 0.18));
  // Recoil cylinders over the tube.
  for (const x of [-0.16, 0.16]) g.add(cyl(0.07, 0.07, 1.4, L.seg(8, 5), 'z'), S.shade, T(x, 0.25, 1.1));
  barrel(g, L, { start: 0.5, len: 7.25, r0: 0.135, r1: 0.1, evac: { at: 4.9, len: 0.9, r: 0.17 }, brake: 'slotted', bore: 0.076 });
  d.muzzle = [0, 0, 7.25];
  d.heat.push({ at: [0, 0, 3.8], size: [0.26, 0.26, 6.6], level: 0.3, parent: 'gun' });
}

/** M88A2 Hercules: big forward superstructure, A-frame boom laid back over it, dozer blade. */
export function m88(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.19;
  d.trackKind = 'pads';
  d.dustTop = 1.25;
  b.add(
    convex(
      sym([
        [1.1, 0.45, -3.9],
        [1.1, 0.45, 3.7],
        [1.1, 1.15, 4.3],
        [1.1, 1.18, -4.3],
        [1.1, 0.75, -4.3],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.68, 1.15, -4.3],
        [1.68, 1.15, 4.2],
        [1.68, 1.62, -4.28],
        [1.6, 1.68, -4.2],
        [1.6, 1.68, 3.8],
        [1.6, 1.3, 4.32],
      ]),
    ),
    S.paint,
  );
  // The crew and crane superstructure over the front two thirds.
  b.add(
    convex(
      sym([
        [1.62, 1.6, -0.6],
        [1.62, 1.6, 3.4],
        [1.62, 2.72, -0.6],
        [1.55, 2.78, -0.5],
        [1.55, 2.78, 2.85],
        [1.62, 2.5, 3.2],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.42,
    trackW: 0.71,
    trackT: 0.08,
    wheels: [2.6, 1.6, 0.6, -0.4, -1.4, -2.4],
    wheelR: 0.34,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(-3.5, 0.78, 0.31), teeth: 12 },
    idler: C(3.55, 0.64, 0.31),
    rollers: [C(1.6, 1.08, 0.09), C(-0.1, 1.08, 0.09), C(-1.8, 1.08, 0.09)],
    hidden: true,
  });
  skirt(b, 1.78, -4.1, 4.1, 1.18, 0.62, 0.05, shade(0.94), 0.3);
  // Dozer blade raised at the front, its arms back to the hull.
  b.add(
    convex([
      [-1.78, 0.55, 4.55],
      [1.78, 0.55, 4.55],
      [-1.78, 1.45, 4.42],
      [1.78, 1.45, 4.42],
      [-1.78, 0.55, 4.4],
      [1.78, 0.55, 4.4],
      [-1.78, 1.35, 4.3],
      [1.78, 1.35, 4.3],
    ]),
    shade(0.88),
  );
  for (const s of [1, -1]) b.add(bar([s * 1.2, 0.9, 4.35], [s * 1.2, 0.85, 3.3], 0.16), S.shade);
  // A-frame boom laid back along the cab roof edges, pivots at the cab's front corners.
  const apex: V3 = [0, 2.98, -0.75];
  for (const s of [1, -1]) {
    b.add(bar([s * 1.45, 2.88, 3.0], apex, 0.2, 0.24), shade(0.95));
    b.add(box(0.3, 0.4, 0.34), S.shade, T(s * 1.45, 2.78, 3.0));
  }
  b.add(bar([-1.05, 2.92, 1.4], [1.05, 2.92, 1.4], 0.14), shade(0.95));
  b.add(box(0.42, 0.34, 0.5), S.shade, T(0, 2.95, -0.85));
  cupola(b, L, T(-0.8, 2.78, 1.9), 0.38);
  if (L.hi) {
    hatch(b, L, T(0.7, 2.78, 1.2), 0.34);
    for (const z of [2.2, 1.6]) periscope(b, L, T(0.6, 2.78, z + 0.6), 0.2);
    grille(b, L, T(0, 1.685, -2.4), 2.6, 1.8, 8);
    b.pair(box(0.03, 0.35, 0.5), S.glass, T(1.63, 2.35, 2.4));
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.45, 1.75, 4.1));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.5, 1.45, -4.31));
      hook(b, L, T(s * 0.9, 0.9, -4.32));
    }
    rack(b, L, T(0, 1.68, -3.6), 2.8, 0.35, 1.0);
    bundle(b, T(0.5, 1.85, -3.6), 1.4, 0.32, 0.8, S.tarp, 4);
    jerrycans(b, L, T(-1.2, 1.68, -1.2), 3);
    antenna(b, L, T(1.2, 2.78, -0.3), 2.3);
  }
  d.heat.push({ at: [0, 1.72, -2.4], size: [2.8, 0.08, 2.2], level: 0.8, parent: 'body' });
  d.muzzle = [-0.8, 3.25, 3.4];
}

/** BREM-1M: T-72 hull with a crane laid along the left side, dozer blade, cargo platform. */
export function brem(d: Draft): void {
  const L = d.L;
  const { half } = t72Hull(d, { len: 6.9, design: 'ribbed' });
  const b = d.body;
  rubberSkirt(b, L, { x: 1.81, top: 1.05, bottom: 0.56, z0: -half + 0.3, z1: half - 0.25, era: 0 });
  rearDrumsAndLog(b, L, -half, 1.0, 3.2);
  // Crew superstructure on the front right, commander's cupola with the NSVT.
  b.add(chamfer(1.5, 0.45, 2.0, 0.05), S.paint, T(-0.55, 1.65, 1.15));
  cupola(b, L, T(-0.6, 1.88, 0.9), 0.36);
  hatch(b, L, T(0.55, 1.43, 1.4), 0.32);
  // Crane: turntable on the left front, boom laid back along the left side.
  b.add(cyl(0.45, 0.5, 0.35, L.seg(14, 7)), shade(0.92), T(1.0, 1.6, 2.0));
  b.add(chamfer(0.5, 0.5, 0.6, 0.05), S.paint, T(1.0, 1.95, 2.0));
  b.add(bar([1.0, 2.05, 2.1], [1.15, 1.9, -2.8], 0.3, 0.34), shade(0.96));
  b.add(bar([1.0, 2.05, 2.1], [1.05, 2.0, -0.6], 0.38, 0.4), shade(0.96));
  if (L.hi) b.add(box(0.2, 0.35, 0.2), S.steel, T(1.15, 1.7, -2.85));
  // Dozer blade at the front.
  b.add(
    convex([
      [-1.65, 0.4, half + 0.3],
      [1.65, 0.4, half + 0.3],
      [-1.65, 1.05, half + 0.18],
      [1.65, 1.05, half + 0.18],
      [-1.65, 0.4, half + 0.15],
      [1.65, 0.4, half + 0.15],
      [-1.65, 0.98, half + 0.06],
      [1.65, 0.98, half + 0.06],
    ]),
    shade(0.88),
  );
  // Cargo platform with its rails and a load of spares.
  rack(b, L, T(-0.25, 1.43, -1.9), 2.6, 0.38, 2.2);
  if (L.hi) {
    bundle(b, T(-0.6, 1.65, -1.6), 1.2, 0.45, 1.0, S.tarp, 2);
    b.add(chamfer(0.9, 0.4, 0.6, 0.03), shade(0.82), T(0.35, 1.63, -2.4));
    b.add(cyl(0.3, 0.3, 0.2, 10), S.steel, T(0.5, 1.53, -1.3));
  }
  d.muzzle = [-0.6, 2.45, 1.2];
}

