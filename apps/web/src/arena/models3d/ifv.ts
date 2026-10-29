import { gunOf, turretOf, type Draft } from './draft';
import { antenna, barrel, bundle, grille, hatch, headlight, hook, jerrycans, mg, panoramic, periscope, rack, rws, sightBox, slats, smoke, tiles, tube } from './fittings';
import { C, roadWheels, runningGear, skirt } from './gear';
import { S, T, bar, box, chamfer, convex, cyl, shade, sym } from './kit';

// Infantry fighting vehicles, carriers, light tanks and tank hunters.

const D = Math.PI / 180;

/** M2A3 Bradley: tall box hull with a sloped front, small turret with the 25 mm and the TOW box. */
export function bradley(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.152;
  d.trackKind = 'pads';
  d.dustTop = 1.2;
  b.add(
    convex(
      sym([
        [1.12, 0.45, -3.0],
        [1.12, 0.45, 2.6],
        [1.12, 1.15, 3.28],
        [1.12, 1.15, -3.27],
        [1.12, 0.7, -3.27],
      ]),
    ),
    S.paint,
  );
  // Upper hull: vertical sides out over the tracks, a long sloped front.
  b.add(
    convex(
      sym([
        [1.6, 1.12, -3.27],
        [1.6, 1.12, 3.15],
        [1.6, 2.5, -3.22],
        [1.52, 2.58, -3.15],
        [1.52, 2.58, 1.45],
        [1.6, 1.4, 3.28],
        [1.0, 1.3, 3.3],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.36,
    trackW: 0.53,
    trackT: 0.07,
    wheels: [2.05, 1.24, 0.43, -0.38, -1.19, -2.0],
    wheelR: 0.305,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(2.78, 0.76, 0.28), teeth: 11 },
    idler: C(-2.78, 0.62, 0.29),
    rollers: [C(1.62, 0.98, 0.08), C(0.02, 0.98, 0.08), C(-1.6, 0.98, 0.08)],
    hidden: true,
  });
  skirt(b, 1.64, -3.05, 3.05, 1.15, 0.6, 0.04, shade(0.95), 0.3);
  // BRAT tiles on the hull sides.
  for (const s of [1, -1]) {
    const m = T(s * 1.62, 1.2, s > 0 ? 2.25 : -2.55, 0, s * Math.PI / 2, 0);
    tiles(b, L, m, 9, 2, 4.8, 1.1, 0.13, 0.03, shade(0.97));
  }
  // Rear ramp and its door.
  b.add(box(2.4, 1.75, 0.08), shade(0.92), T(0, 1.47, -3.3));
  if (L.hi) {
    b.add(box(0.75, 1.3, 0.04), shade(0.85), T(-0.55, 1.55, -3.35));
    b.add(box(1.4, 0.45, 0.05), shade(0.88), T(0, 2.0, 2.3, -0.62, 0, 0));
    hatch(b, L, T(0.7, 2.58, 1.2), 0.3);
    periscope(b, L, T(0.7, 2.58, 1.5), 0.2);
    grille(b, L, T(-1.0, 2.0, 2.3, -0.62, 0, 0), 0.9, 0.9, 6);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.35, 1.55, 3.2));
      hook(b, L, T(s * 0.75, 1.1, 3.28, -0.9, 0, 0));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.45, 2.2, -3.28));
    }
    hatch(b, L, T(0, 2.58, -2.3), 0.45);
    bundle(b, T(1.15, 2.72, -2.6), 0.6, 0.3, 1.0, S.canvas, 3);
  }
  d.heat.push({ at: [-0.9, 2.0, 2.3], size: [1.1, 0.5, 1.0], level: 1, parent: 'body' }, { at: [0, 2.6, 2.4], size: [2.4, 0.06, 1.0], level: 0.7, parent: 'body' });

  const t = turretOf(d, [-0.15, 2.58, 0.25]);
  t.add(
    convex(
      sym([
        [0.75, 0, 1.05],
        [1.1, 0, 0.6],
        [1.12, 0, -1.0],
        [0.95, 0, -1.35],
        [0, 0, -1.4],
        [0.5, 0.72, 0.75],
        [0.95, 0.72, 0.4],
        [0.98, 0.72, -1.0],
        [0.8, 0.72, -1.28],
        [0, 0.72, -1.32],
      ]),
    ),
    S.paint,
  );
  // TOW launcher folded on the turret's left side.
  t.add(chamfer(0.5, 0.46, 1.25, 0.04), shade(0.95), T(1.38, 0.38, -0.1));
  if (L.hi) for (const y of [0.28, 0.5]) t.add(cyl(0.085, 0.085, 0.02, 8, 'z'), S.black, T(1.38, y, 0.53));
  t.add(box(0.14, 0.32, 0.6), S.shade, T(1.15, 0.36, -0.1));
  // ISU (gunner, left front) and the commander's independent viewer (right rear).
  sightBox(t, L, T(0.45, 0.72, 0.35), 0.4, 0.34, 0.45);
  panoramic(t, L, T(-0.55, 0.72, -0.55), 0.2, 0.42);
  hatch(t, L, T(-0.5, 0.72, -0.1), 0.32);
  for (const s of [1, -1]) smoke(t, L, T(s * 0.92, 0.5, 0.7, 0, s * 50 * D, 0), 4, 1);
  if (L.hi) {
    rack(t, L, T(0, 0.05, -1.62), 1.8, 0.5, 0.42);
    bundle(t, T(0.1, 0.32, -1.62), 1.4, 0.4, 0.35, S.tarp, 4);
    antenna(t, L, T(0.8, 0.72, -1.1), 2.0);
  }
  const g = gunOf(d, [0, 0.42, 0.92]);
  g.add(chamfer(0.5, 0.36, 0.42, 0.04), S.paint, T(0, 0, 0.2));
  barrel(g, L, { start: 0.38, len: 2.5, r0: 0.055, r1: 0.042, brake: 'flash', bore: 0.0125 }, T(0, 0.03, 0), S.gunsteel);
  if (L.hi) tube(g, L, 0.018, 0.3, 0.9, T(-0.2, -0.06, 0));
  d.muzzle = [0, 0.03, 2.5];
  d.heat.push({ at: [0, 0.03, 1.4], size: [0.1, 0.1, 2.0], level: 0.3, parent: 'gun' });
}

/** BMP-3: low sharp nose, high rear deck, the 100 mm and 30 mm side by side in a wide turret. */
export function bmp3(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.152;
  d.trackKind = 'steel';
  d.dustTop = 1.1;
  b.add(
    convex(
      sym([
        [1.12, 0.45, -3.2],
        [1.12, 0.45, 2.85],
        [1.12, 0.92, 3.57],
        [1.12, 1.15, -3.57],
        [1.12, 0.62, -3.57],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.55, 1.08, -3.57],
        [1.55, 1.08, 3.3],
        [1.55, 1.8, -3.55],
        [1.48, 1.86, -3.5],
        [1.48, 1.72, 0.9],
        [1.48, 1.58, 2.25],
        [1.4, 0.95, 3.57],
        [1.0, 0.93, 3.6],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.3,
    trackW: 0.38,
    trackT: 0.06,
    wheels: [2.1, 1.3, 0.5, -0.3, -1.1, -1.9],
    wheelR: 0.3,
    design: 'light',
    twin: true,
    wheelStyle: shade(0.75, { ao: 0.85 }),
    sprocket: { ...C(-2.95, 0.68, 0.27), teeth: 11 },
    idler: C(2.92, 0.55, 0.26),
    rollers: [C(1.6, 0.87, 0.07), C(0.1, 0.88, 0.07), C(-1.5, 0.88, 0.07)],
  });
  // Fenders and the short top skirts.
  b.pair(box(0.3, 0.04, 6.4), S.paint, T(1.5, 1.09, -0.1));
  skirt(b, 1.6, -3.2, 3.1, 1.1, 0.88, 0.03, shade(0.9), 0.2);
  // The corrugated wave board folded on the upper glacis.
  if (L.hi) for (let i = 0; i < 5; i++) b.add(box(2.4, 0.05, 0.06), shade(0.95), T(0, 1.05 + i * 0.1, 3.3 - i * 0.24, -0.37, 0, 0));
  else b.add(box(2.4, 0.06, 1.2), shade(0.95), T(0, 1.25, 2.85, -0.37, 0, 0));
  // Bow machine gun mounts either side of the driver.
  for (const s of [1, -1]) {
    b.add(cyl(0.12, 0.14, 0.18, L.seg(8, 5), 'z'), S.shade, T(s * 1.0, 1.25, 3.08, -0.4, 0, 0));
    if (L.hi) tube(b, L, 0.015, 0, 0.5, T(s * 1.0, 1.25, 3.1, -0.1, 0, 0));
  }
  // Rear doors, the water-jet grilles and the high engine deck.
  for (const s of [1, -1]) {
    b.add(box(0.62, 0.62, 0.06), shade(0.9), T(s * 0.42, 1.48, -3.58));
    b.add(box(0.55, 0.5, 0.05), S.black, T(s * 1.15, 0.88, -3.58));
    if (L.hi) for (let i = 0; i < 4; i++) b.add(box(0.5, 0.03, 0.04), S.shade, T(s * 1.15, 0.7 + i * 0.12, -3.61));
  }
  if (L.hi) {
    grille(b, L, T(0, 1.87, -2.6), 2.2, 1.2, 8);
    hatch(b, L, T(0, 1.62, 2.1), 0.3);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.25, 1.12, 3.4));
      hatch(b, L, T(s * 0.55, 1.86, -1.5), 0.35);
    }
    jerrycans(b, L, T(1.2, 1.86, -3.2), 3);
  }
  d.heat.push({ at: [0, 1.9, -2.6], size: [2.4, 0.08, 1.6], level: 0.9, parent: 'body' }, { at: [1.15, 0.88, -3.6], size: [0.6, 0.55, 0.06], level: 0.7, parent: 'body' });

  const t = turretOf(d, [0, 1.72, 0.25]);
  t.add(
    convex(
      sym([
        [0.55, 0, 1.1],
        [1.05, 0, 0.75],
        [1.15, 0, -0.5],
        [0.95, 0, -1.05],
        [0, 0, -1.1],
        [0.42, 0.55, 0.85],
        [0.85, 0.55, 0.55],
        [0.95, 0.55, -0.45],
        [0.75, 0.55, -0.95],
        [0, 0.55, -1.0],
      ]),
    ),
    S.paint,
  );
  sightBox(t, L, T(0.55, 0.55, 0.3), 0.36, 0.3, 0.42);
  panoramic(t, L, T(-0.58, 0.55, -0.2), 0.2, 0.38);
  hatch(t, L, T(0.4, 0.55, -0.4), 0.3);
  for (const s of [1, -1]) smoke(t, L, T(s * 0.95, 0.35, 0.8, 0, s * 50 * D, 0), 3, 1);
  if (L.hi) antenna(t, L, T(-0.7, 0.55, -0.85), 2.0);
  const g = gunOf(d, [0, 0.3, 0.9]);
  g.add(chamfer(0.75, 0.38, 0.45, 0.04), S.paint, T(-0.12, 0, 0.18));
  // 100 mm 2A70: a short, thick tube; the 30 mm 2A72 beside it on the right.
  barrel(g, L, { start: 0.38, len: 3.3, r0: 0.1, r1: 0.075, sleeve: { r: 0.1, bands: 3, end: 2.9 }, bore: 0.05 });
  barrel(g, L, { start: 0.38, len: 3.1, r0: 0.045, r1: 0.035, brake: 'flash', bore: 0.015 }, T(-0.26, -0.02, 0), S.gunsteel);
  d.muzzle = [0, 0, 3.3];
  d.heat.push({ at: [-0.1, 0, 1.8], size: [0.4, 0.18, 2.8], level: 0.3, parent: 'gun' });
}

/** CV9035: sloped front, angular turret with the 35 mm, 7 road wheels, bolted armour modules. */
export function cv90(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.152;
  d.trackKind = 'rubber';
  d.dustTop = 1.2;
  b.add(
    convex(
      sym([
        [1.1, 0.45, -3.05],
        [1.1, 0.45, 2.85],
        [1.1, 1.08, 3.4],
        [1.1, 1.12, -3.4],
        [1.1, 0.7, -3.4],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.55, 1.1, -3.4],
        [1.55, 1.1, 3.25],
        [1.55, 1.85, -3.38],
        [1.45, 1.95, -3.3],
        [1.45, 1.95, 1.4],
        [1.55, 1.35, 3.35],
        [1.0, 1.1, 3.42],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.32,
    trackW: 0.53,
    trackT: 0.07,
    wheels: [2.3, 1.55, 0.8, 0.05, -0.7, -1.45, -2.2],
    wheelR: 0.3,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(3.0, 0.78, 0.28), teeth: 11 },
    idler: C(-3.0, 0.65, 0.29),
    rollers: [C(1.2, 1.0, 0.08), C(-1.1, 1.0, 0.08)],
    hidden: true,
  });
  skirt(b, 1.6, -3.2, 3.3, 1.12, 0.56, 0.06, shade(0.95), 0.35);
  // Bolted armour modules on the hull sides, front glacis plate.
  if (L.hi) {
    for (let i = 0; i < 5; i++) b.pair(box(0.07, 0.68, 1.15), shade(0.93 + (i % 2) * 0.04), T(1.6, 1.5, -2.85 + i * 1.2));
    b.add(box(2.2, 0.06, 1.3), shade(0.93), T(0, 1.64, 2.45, -0.48, 0, 0));
  } else b.pair(box(0.07, 0.68, 6.0), shade(0.93), T(1.6, 1.5, -0.45));
  b.add(box(1.7, 1.45, 0.08), shade(0.9), T(0, 1.2, -3.43, 0.1, 0, 0));
  if (L.hi) {
    hatch(b, L, T(0.7, 1.95, 1.2), 0.3);
    grille(b, L, T(-0.75, 1.62, 2.5, -0.48, 0, 0), 0.9, 0.8, 5);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.3, 1.3, 3.3));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.35, 1.7, -3.42));
      hook(b, L, T(s * 0.7, 1.05, 3.4, -0.9, 0, 0));
    }
    rack(b, L, T(0, 1.95, -2.9), 2.4, 0.3, 0.7);
    bundle(b, T(0.3, 2.1, -2.9), 1.8, 0.3, 0.55, S.canvas, 6);
  }
  d.heat.push({ at: [-0.6, 1.7, 2.5], size: [1.3, 0.3, 1.2], level: 1, parent: 'body' });

  const t = turretOf(d, [0, 1.95, -0.15]);
  t.add(
    convex(
      sym([
        [0.6, 0, 1.45],
        [1.3, 0, 0.8],
        [1.32, 0, -1.1],
        [1.1, 0, -1.55],
        [0, 0, -1.6],
        [0.45, 0.82, 1.05],
        [1.05, 0.82, 0.62],
        [1.08, 0.82, -1.05],
        [0.92, 0.82, -1.48],
        [0, 0.82, -1.52],
      ]),
    ),
    S.paint,
  );
  sightBox(t, L, T(0.55, 0.82, 0.55), 0.36, 0.34, 0.45);
  panoramic(t, L, T(-0.6, 0.82, -0.25), 0.21, 0.45);
  hatch(t, L, T(-0.6, 0.82, -0.85), 0.32);
  hatch(t, L, T(0.5, 0.82, -0.55), 0.3);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.25, 0.5, 0.9, 0, s * 55 * D, 0), 3, 2);
  if (L.hi) {
    rack(t, L, T(0, 0.1, -1.82), 2.0, 0.55, 0.45);
    bundle(t, T(0, 0.4, -1.82), 1.6, 0.45, 0.38, S.tarp, 8);
    antenna(t, L, T(0.9, 0.82, -1.3), 2.0);
  }
  const g = gunOf(d, [0, 0.45, 1.35]);
  g.add(chamfer(0.62, 0.42, 0.5, 0.04), S.paint, T(0, 0, 0.18));
  barrel(g, L, { start: 0.42, len: 3.3, r0: 0.07, r1: 0.055, sleeve: { r: 0.075, bands: 2, end: 1.6 }, brake: 'pepper', bore: 0.0175 }, T(), S.gunsteel);
  d.muzzle = [0, 0, 3.3];
  d.heat.push({ at: [0, 0, 1.8], size: [0.14, 0.14, 2.8], level: 0.3, parent: 'gun' });
}

/** The Stryker's flat-sided double-V hull on 8 wheels, slat cage optional. Returns the roof height. */
function strykerHull(d: Draft, cage: boolean): number {
  const L = d.L;
  const b = d.body;
  d.dustTop = 1.0;
  const roof = 2.25;
  // Double-V belly, flat sides, sloped front with the engine to the right of the driver.
  b.add(
    convex(
      sym([
        [0.15, 0.48, -2.9],
        [0.15, 0.48, 2.9],
        [1.05, 0.95, -3.35],
        [1.05, 0.95, 3.25],
        [1.32, 1.15, -3.45],
        [1.32, 1.15, 3.3],
        [1.32, 2.2, -3.45],
        [1.25, roof, -3.4],
        [1.25, roof, 1.6],
        [1.32, 1.55, 3.47],
        [0.9, 1.5, 3.5],
      ]),
    ),
    S.paint,
  );
  // Wheel arch fairings over each pair of wheels.
  for (const z of [1.62, -1.65]) b.pair(box(0.12, 0.08, 2.4), shade(0.92), T(1.38, 1.2, z));
  roadWheels(d, { x: 1.12, zs: [2.22, 1.02, -1.05, -2.25], r: 0.56, w: 0.4 });
  if (L.hi) {
    hatch(b, L, T(0.6, roof, 1.4), 0.32);
    periscope(b, L, T(0.6, roof, 1.72), 0.3);
    grille(b, L, T(-0.6, 1.95, 2.55, -0.55, 0, 0), 0.9, 0.9, 6);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.15, 1.55, 3.42));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.2, 1.9, -3.47));
    }
    // Rear ramp outline, roof hatches, stowage.
    b.add(box(1.6, 1.4, 0.05), shade(0.88), T(0, 1.6, -3.47));
    hatch(b, L, T(0, roof, -1.6), 0.5);
    jerrycans(b, L, T(-0.9, roof, -2.9), 3);
    antenna(b, L, T(1.0, roof, -2.6), 2.4);
    antenna(b, L, T(-1.0, roof, -2.6), 2.4);
  }
  if (cage) {
    // Bar armour standing off the sides, front corners and rear.
    const y0 = 1.0;
    const h = 1.25;
    slats(b, L, T(1.72, y0, 3.1, 0, Math.PI / 2, 0), 6.3, h, 0.13);
    slats(b, L, T(-1.72, y0, -3.2, 0, -Math.PI / 2, 0), 6.3, h, 0.13);
    slats(b, L, T(-1.72, y0, -3.75), 3.44, h, 0.13);
    if (L.hi) for (const s of [1, -1]) b.add(bar([s * 1.33, 1.4, -3.48], [s * 1.72, 1.4, -3.75], 0.05), S.shade);
  }
  d.heat.push({ at: [-0.6, 1.95, 2.55], size: [1.0, 0.4, 1.0], level: 1, parent: 'body' });
  return roof;
}

/** M1126 Stryker ICV: 8x8, flat-sided V-hull, RWS with a .50 cal, slat cage, rear ramp. */
export function stryker(d: Draft): void {
  const roof = strykerHull(d, true);
  const L = d.L;
  // The RWS is the turret: its cradle pitches the M2.
  const t = turretOf(d, [0.35, roof, 0.75]);
  t.add(cyl(0.34, 0.38, 0.14, L.seg(12, 6)), S.shade, T(0, 0.07, 0));
  t.add(chamfer(0.55, 0.34, 0.6, 0.05), S.paint, T(0, 0.3, -0.05));
  t.add(chamfer(0.28, 0.28, 0.42, 0.03), S.paint, T(-0.4, 0.62, 0.05));
  t.add(box(0.18, 0.14, 0.02), S.lens, T(-0.4, 0.64, 0.27));
  t.add(box(0.24, 0.26, 0.32), S.shade, T(0.36, 0.52, -0.05));
  const g = gunOf(d, [0, 0.6, 0.05]);
  mg(g, L, T(0, 0, 0), true);
  d.muzzle = [0, 0, 1.55];
}

/** M1134 Stryker ATGM: the Stryker with the twin TOW ITAS launcher raised on its arm. */
export function m1134(d: Draft): void {
  const roof = strykerHull(d, false);
  const L = d.L;
  const t = turretOf(d, [-0.2, roof, -0.7]);
  t.add(cyl(0.45, 0.5, 0.2, L.seg(14, 7)), S.shade, T(0, 0.1, 0));
  // Elevating arm.
  t.add(chamfer(0.3, 0.75, 0.35, 0.03), S.paint, T(0.3, 0.55, 0));
  const g = gunOf(d, [0, 0.95, 0]);
  // Twin TOW launcher box with the ITAS sight on its side.
  g.add(chamfer(0.62, 0.48, 1.45, 0.04), S.paint, T(-0.05, 0.12, 0.2));
  for (const x of [-0.2, 0.1]) g.add(cyl(0.1, 0.1, 0.02, L.seg(10, 6), 'z'), S.black, T(x, 0.12, 0.93));
  g.add(chamfer(0.32, 0.36, 0.6, 0.03), S.paint, T(0.45, 0.1, 0.35));
  g.add(box(0.22, 0.2, 0.02), S.lens, T(0.45, 0.12, 0.66));
  d.muzzle = [-0.05, 0.12, 0.95];
}

/** M10 Booker: ASCOD-based light tank, angular turret with the 105 mm, 6 road wheels. */
export function m10(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.152;
  d.trackKind = 'pads';
  d.dustTop = 1.2;
  b.add(
    convex(
      sym([
        [1.12, 0.45, -3.2],
        [1.12, 0.45, 2.95],
        [1.12, 1.1, 3.55],
        [1.12, 1.15, -3.55],
        [1.12, 0.7, -3.55],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.68, 1.12, -3.55],
        [1.68, 1.12, 3.4],
        [1.68, 1.75, -3.52],
        [1.6, 1.82, -3.45],
        [1.6, 1.82, 1.55],
        [1.68, 1.35, 3.5],
        [1.0, 1.12, 3.58],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.38,
    trackW: 0.55,
    trackT: 0.07,
    wheels: [2.2, 1.35, 0.5, -0.35, -1.2, -2.05],
    wheelR: 0.33,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(3.08, 0.8, 0.29), teeth: 11 },
    idler: C(-3.05, 0.66, 0.3),
    rollers: [C(1.6, 1.02, 0.08), C(0, 1.03, 0.08), C(-1.6, 1.03, 0.08)],
    hidden: true,
  });
  const panels: [number, number][] = [
    [2.2, 3.45],
    [0.95, 2.18],
    [-0.3, 0.93],
    [-1.55, -0.32],
    [-2.8, -1.57],
    [-3.5, -2.82],
  ];
  if (L.hi) for (const [z0, z1] of panels) skirt(b, 1.72, z0, z1, 1.15, 0.5, 0.08, shade(0.95), z1 > 3.4 ? 0.4 : 0);
  else skirt(b, 1.72, -3.5, 3.45, 1.15, 0.5, 0.08, shade(0.95), 0.4);
  if (L.hi) {
    hatch(b, L, T(0.7, 1.82, 1.45), 0.3);
    periscope(b, L, T(0.7, 1.82, 1.8), 0.25);
    grille(b, L, T(-0.75, 1.55, 2.6, -0.5, 0, 0), 1.0, 1.0, 6);
    grille(b, L, T(0, 1.83, -2.6), 2.4, 1.2, 6);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.4, 1.3, 3.45));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.45, 1.6, -3.56));
      hook(b, L, T(s * 0.7, 1.05, 3.55, -0.9, 0, 0));
    }
  }
  d.heat.push({ at: [-0.7, 1.6, 2.6], size: [1.2, 0.3, 1.2], level: 1, parent: 'body' }, { at: [0, 1.86, -2.6], size: [2.4, 0.08, 1.2], level: 0.7, parent: 'body' });

  const t = turretOf(d, [0, 1.82, -0.35]);
  t.add(
    convex(
      sym([
        [0.6, 0, 1.75],
        [1.45, 0, 1.0],
        [1.5, 0, -1.2],
        [1.32, 0, -2.2],
        [0, 0, -2.25],
        [0.45, 0.78, 1.35],
        [1.2, 0.78, 0.8],
        [1.25, 0.78, -1.15],
        [1.1, 0.78, -2.1],
        [0, 0.78, -2.15],
      ]),
    ),
    S.paint,
  );
  sightBox(t, L, T(-0.7, 0.78, 0.65), 0.42, 0.34, 0.5);
  t.add(cyl(0.13, 0.17, 0.35, L.seg(10, 6)), S.shade, T(-0.75, 0.95, -0.35));
  panoramic(t, L, T(-0.75, 1.1, -0.35), 0.21, 0.45);
  hatch(t, L, T(0.6, 0.78, -0.6), 0.32);
  rws(t, L, T(0.65, 0.84, -1.2), 'crows');
  for (const s of [1, -1]) smoke(t, L, T(s * 1.42, 0.5, 0.95, 0, s * 55 * D, 0), 3, 2);
  if (L.hi) {
    rack(t, L, T(0, 0.15, -2.5), 2.4, 0.5, 0.5);
    bundle(t, T(0, 0.42, -2.5), 1.9, 0.42, 0.42, S.canvas, 12);
    antenna(t, L, T(1.0, 0.78, -1.8), 2.2);
  }
  const g = gunOf(d, [0, 0.4, 1.6]);
  g.add(chamfer(0.6, 0.46, 0.5, 0.05), S.paint, T(0, 0, 0.25));
  barrel(g, L, { start: 0.5, len: 4.4, r0: 0.1, r1: 0.07, sleeve: { r: 0.1, bands: 4, end: 3.8 }, evac: { at: 2.1, len: 0.6, r: 0.12 }, brake: 'pepper', bore: 0.0525 });
  d.muzzle = [0, 0, 4.4];
  d.heat.push({ at: [0, 0, 2.4], size: [0.2, 0.2, 3.8], level: 0.3, parent: 'gun' });
}

/** 2S25M Sprut-SDM1: low BMD-style hull, a big turret and the long 125 mm, 7 small road wheels. */
export function sprut(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.13;
  d.trackKind = 'steel';
  d.dustTop = 0.95;
  b.add(
    convex(
      sym([
        [1.05, 0.42, -3.2],
        [1.05, 0.42, 2.9],
        [1.05, 0.9, 3.54],
        [1.05, 1.0, -3.54],
        [1.05, 0.6, -3.54],
      ]),
    ),
    S.paint,
  );
  // Low boat hull with the BMD's pointed bow.
  b.add(
    convex(
      sym([
        [1.55, 0.95, -3.54],
        [1.55, 0.95, 2.6],
        [1.5, 1.38, -3.5],
        [1.45, 1.4, 1.7],
        [1.0, 1.05, 3.54],
        [0.4, 1.1, 3.6],
        [1.3, 0.95, 3.2],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.3,
    trackW: 0.38,
    trackT: 0.055,
    wheels: [2.4, 1.65, 0.9, 0.15, -0.6, -1.35, -2.1],
    wheelR: 0.25,
    design: 'light',
    twin: true,
    wheelStyle: shade(0.75, { ao: 0.85 }),
    sprocket: { ...C(-2.95, 0.6, 0.24), teeth: 10 },
    idler: C(3.05, 0.5, 0.22),
    rollers: [C(1.9, 0.78, 0.06), C(0.75, 0.78, 0.06), C(-0.4, 0.78, 0.06), C(-1.6, 0.78, 0.06)],
  });
  b.pair(box(0.25, 0.035, 6.6), S.paint, T(1.48, 0.95, -0.2));
  skirt(b, 1.58, -3.3, 3.2, 0.97, 0.78, 0.03, shade(0.85), 0.2);
  if (L.hi) {
    grille(b, L, T(0, 1.39, -2.5), 2.2, 1.4, 8);
    for (const s of [1, -1]) {
      b.add(box(0.5, 0.4, 0.05), S.black, T(s * 0.9, 0.85, -3.56));
      headlight(b, L, T(s * 0.95, 1.1, 3.35));
      hatch(b, L, T(s * 0.55, 1.4, -1.6), 0.3);
    }
    periscope(b, L, T(0, 1.3, 2.4), 0.3);
  }
  d.heat.push({ at: [0, 1.42, -2.5], size: [2.4, 0.08, 1.6], level: 0.9, parent: 'body' });

  const t = turretOf(d, [0, 1.4, 0.1]);
  t.add(
    convex(
      sym([
        [0.55, 0, 1.4],
        [1.25, 0, 0.95],
        [1.32, 0, -1.0],
        [1.12, 0, -1.9],
        [0, 0, -2.0],
        [0.45, 0.82, 1.1],
        [1.05, 0.82, 0.75],
        [1.1, 0.82, -0.95],
        [0.92, 0.82, -1.8],
        [0, 0.82, -1.9],
      ]),
    ),
    S.paint,
  );
  sightBox(t, L, T(-0.6, 0.82, 0.35), 0.42, 0.38, 0.48);
  t.add(cyl(0.12, 0.16, 0.4, L.seg(10, 6)), S.shade, T(-0.75, 1.0, -0.6));
  panoramic(t, L, T(-0.75, 1.18, -0.6), 0.2, 0.42);
  hatch(t, L, T(0.5, 0.82, -0.45), 0.32);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.2, 0.5, 0.8, 0, s * 45 * D, 0), 3, 1);
  if (L.hi) {
    t.add(chamfer(1.6, 0.4, 0.35, 0.03), S.shade, T(0, 0.3, -2.12));
    antenna(t, L, T(0.8, 0.82, -1.4), 2.2);
  }
  const g = gunOf(d, [0, 0.42, 1.25]);
  g.add(chamfer(0.68, 0.48, 0.5, 0.04), S.paint, T(0, 0, 0.2));
  barrel(g, L, { start: 0.45, len: 5.2, r0: 0.115, r1: 0.082, sleeve: { r: 0.115, bands: 4, end: 4.2 }, evac: { at: 2.0, len: 0.6, r: 0.15 }, bore: 0.0625 });
  d.muzzle = [0, 0, 5.2];
  d.heat.push({ at: [0, 0, 2.8], size: [0.22, 0.22, 4.6], level: 0.3, parent: 'gun' });
}

/** 9P163-3 Kornet-D on the Tigr-M: an armoured 4x4 with two quad launchers raised from the roof. */
export function kornetD(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.dustTop = 0.9;
  const roof = 2.05;
  // Body: bonnet, raked windscreen, tall flat-sided cabin.
  b.add(
    convex(
      sym([
        [1.1, 0.55, 2.85],
        [1.1, 1.2, 2.85],
        [1.12, 1.42, 1.75],
        [1.12, 0.55, -2.85],
        [1.15, 1.5, 1.2],
        [1.0, roof, 0.75],
        [1.0, roof, -2.8],
        [1.12, 1.5, -2.85],
      ]),
    ),
    S.paint,
  );
  // Wheel arches.
  for (const z of [1.7, -1.6]) b.pair(convex([[1.0, 0.8, z - 0.7], [1.0, 0.8, z + 0.7], [1.0, 1.25, z - 0.55], [1.0, 1.25, z + 0.55], [1.22, 1.15, z - 0.55], [1.22, 1.15, z + 0.55], [1.22, 0.85, z - 0.65], [1.22, 0.85, z + 0.65]]), shade(0.9), T());
  roadWheels(d, { x: 0.98, zs: [1.7, -1.6], r: 0.53, w: 0.34 });
  // Windscreen in two panes, side windows, grille, bull bar and bumper.
  for (const s of [1, -1]) b.add(box(0.88, 0.48, 0.04), S.glass, T(s * 0.47, 1.76, 1.0, -0.42, 0, 0));
  b.add(box(0.08, 0.5, 0.06), S.paint, T(0, 1.76, 1.0, -0.42, 0, 0));
  if (L.hi) {
    b.pair(box(0.03, 0.36, 0.7), S.glass, T(1.12, 1.68, 0.3));
    b.pair(box(0.03, 0.32, 0.55), S.glass, T(1.06, 1.72, -0.65));
    b.add(box(1.3, 0.34, 0.05), S.black, T(0, 1.0, 2.88));
    for (let i = 0; i < 7; i++) b.add(box(0.04, 0.32, 0.04), shade(0.85), T(-0.54 + i * 0.18, 1.0, 2.9));
    b.add(box(2.1, 0.16, 0.18), shade(0.8), T(0, 0.62, 2.9));
    for (const s of [1, -1]) b.add(bar([s * 0.8, 0.65, 3.02], [s * 0.7, 1.2, 2.95], 0.06), S.shade);
    b.add(bar([-0.75, 1.2, 2.95], [0.75, 1.2, 2.95], 0.06), S.shade);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 0.85, 1.05, 2.86));
      b.add(box(0.08, 0.3, 0.12), S.black, T(s * 1.16, 1.55, 1.25));
      b.add(box(0.12, 0.12, 0.05), S.red, T(s * 1.0, 1.1, -2.86));
    }
    b.add(box(0.8, 1.2, 0.04), shade(0.88), T(-0.3, 1.25, -2.87));
    hatch(b, L, T(0.5, roof, 0.2), 0.3);
    antenna(b, L, T(-0.8, roof, 0.3), 2.0);
  }
  d.heat.push({ at: [0, 1.25, 2.2], size: [1.8, 0.1, 1.2], level: 0.9, parent: 'body' });
  // The launcher mast rises from the rear roof hatch.
  const t = turretOf(d, [0, roof, -1.6]);
  t.add(cyl(0.3, 0.35, 0.18, L.seg(12, 6)), S.shade, T(0, 0.09, 0));
  t.add(chamfer(0.36, 0.7, 0.36, 0.04), S.paint, T(0, 0.5, 0));
  const g = gunOf(d, [0, 0.85, 0]);
  g.add(box(0.95, 0.12, 0.3), S.shade, T(0, 0, 0));
  // Two packs of four Kornet tubes, either side of the mast, and the guidance sight between.
  for (const s of [1, -1]) {
    g.add(chamfer(0.36, 0.36, 1.25, 0.02), S.paint, T(s * 0.55, 0.02, 0.15));
    if (L.hi) for (const [x, y] of [[-0.085, -0.085], [0.085, -0.085], [-0.085, 0.085], [0.085, 0.085]] as const) g.add(cyl(0.07, 0.07, 0.02, 8, 'z'), S.black, T(s * 0.55 + x, 0.02 + y, 0.78));
  }
  g.add(chamfer(0.3, 0.3, 0.4, 0.02), S.paint, T(0, 0.2, 0.05));
  g.add(box(0.2, 0.16, 0.02), S.lens, T(0, 0.22, 0.26));
  d.muzzle = [0.55, 0.02, 0.8];
}

