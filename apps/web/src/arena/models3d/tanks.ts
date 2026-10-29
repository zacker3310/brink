import { gunOf, turretOf, type Draft } from './draft';
import { antenna, bag, barrel, bundle, cable, grille, hatch, headlight, hook, mg, panoramic, periscope, rack, rws, sightBox, slats, smoke } from './fittings';
import { C, fender, runningGear, skirt } from './gear';
import { S, T, box, chamfer, convex, cyl, lathe, rod, shade, sym, type Lod, type Parts, type V3 } from './kit';
import { castTurret, cheekWedges, cupola, eraPlate, fenders, rearDrumsAndLog, rubberSkirt } from './soviet';

// Main battle tanks. Dimensions from the makers' data; layout (wheel stations, turret ring, glacis
// angles) from side and top views.

const D = Math.PI / 180;

/** M1A2 SEPv3 Abrams: long low hull, flat angular turret with a long bustle and rack, CROWS-LP. */
export function abrams(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.192;
  d.trackKind = 'pads';
  d.dustTop = 1.25;
  // Lower hull between the tracks, with the long lower front plate.
  b.add(
    convex(
      sym([
        [1.1, 0.48, -3.5],
        [1.1, 0.48, 2.95],
        [1.1, 1.2, 3.95],
        [1.1, 1.2, -3.97],
        [1.1, 0.72, -3.97],
      ]),
    ),
    S.paint,
  );
  // Upper hull and sponsons over the tracks, the shallow upper glacis.
  b.add(
    convex(
      sym([
        [1.82, 1.18, -3.97],
        [1.82, 1.18, 3.82],
        [1.82, 1.4, -3.97],
        [1.74, 1.56, -3.95],
        [1.74, 1.56, 2.7],
        [1.82, 1.3, 3.6],
        [1.1, 1.22, 3.98],
        [1.6, 1.24, 3.92],
      ]),
    ),
    S.paint,
  );
  // Running gear: 7 road wheels, raised front idler, rear sprocket, 2 return rollers.
  runningGear(d, {
    x: 1.45,
    trackW: 0.635,
    trackT: 0.075,
    wheels: [2.36, 1.56, 0.82, 0.08, -0.65, -1.38, -2.1],
    wheelR: 0.324,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(-3.12, 0.74, 0.31), teeth: 11 },
    idler: C(3.1, 0.58, 0.3),
    rollers: [C(1.2, 0.93, 0.1), C(-1.0, 0.94, 0.1)],
    hidden: true,
  });
  // Side skirts: two heavy ballistic panels at the front, lighter ones behind.
  const sk = shade(0.96);
  const panels: [number, number, number][] = [
    [2.72, 3.86, 0.11],
    [1.62, 2.7, 0.11],
    [0.55, 1.6, 0.07],
    [-0.52, 0.53, 0.07],
    [-1.6, -0.54, 0.07],
    [-2.68, -1.62, 0.07],
    [-3.72, -2.7, 0.07],
  ];
  if (L.hi) for (const [z0, z1, t] of panels) skirt(b, 1.8 - t / 2, z0, z1, 1.2, 0.47, t, sk, z1 > 3.8 ? 0.42 : 0);
  else skirt(b, 1.78, -3.72, 3.86, 1.2, 0.47, 0.08, sk, 0.42);
  fender(b, 1.45, 0.66, 3.82, 4.02, 1.19, S.shade);
  if (L.hi) {
    // Driver's hatch and periscopes, front lights, tow hooks.
    hatch(b, L, T(0, 1.55, 2.45), 0.36);
    for (const x of [-0.24, 0, 0.24]) periscope(b, L, T(x, 1.55, 2.85, 0, x * -0.8, 0), 0.14);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.5, 1.32, 3.75));
      hook(b, L, T(s * 0.75, 1.02, 3.66, -0.9, 0, 0));
    }
    // Rear: turbine exhaust grille across the rear plate, deck grilles, tail lights, tow cable.
    grille(b, L, T(0, 1.18, -3.98, Math.PI / 2, 0, 0), 1.75, 0.55, 7);
    grille(b, L, T(0, 1.565, -2.55), 2.6, 1.0, 6);
    grille(b, L, T(0, 1.565, -3.5), 2.4, 0.6, 4);
    for (const s of [1, -1]) {
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.55, 1.42, -3.98));
      hook(b, L, T(s * 0.95, 0.85, -4.0));
    }
    cable(b, L, [
      [1.55, 1.58, -3.9],
      [1.62, 1.58, -1.4],
      [1.4, 1.58, -1.0],
    ]);
    cable(b, L, [
      [-1.55, 1.58, -3.9],
      [-1.62, 1.58, -1.4],
      [-1.4, 1.58, -1.0],
    ]);
    // Engine deck access doors.
    b.add(box(2.8, 0.03, 1.4), S.shade, T(0, 1.565, -1.6));
  }
  d.heat.push({ at: [0, 1.6, -2.8], size: [2.6, 0.08, 2.0], level: 0.8, parent: 'body' }, { at: [0, 1.18, -4.0], size: [1.75, 0.55, 0.08], level: 1, parent: 'body' });

  // Turret: flat and angular, cheeks sloped back, long bustle.
  const t = turretOf(d, [0, 1.56, -0.1]);
  t.add(
    convex(
      sym([
        [1.18, 0.0, 2.08],
        [1.8, 0.0, 1.3],
        [1.84, 0.0, 0.2],
        [1.68, 0.0, -1.25],
        [1.45, 0.0, -2.62],
        [0, 0.0, -2.68],
        [1.02, 0.86, 1.9],
        [1.46, 0.86, 1.26],
        [1.5, 0.86, 0.2],
        [1.4, 0.86, -1.25],
        [1.26, 0.86, -2.52],
        [0, 0.86, -2.58],
        [1.6, -0.14, 1.32],
        [1.1, -0.14, 1.98],
      ]),
    ),
    S.paint,
  );
  // The mantlet slot behind the gun shield.
  t.add(box(0.95, 0.62, 0.25), S.deep, T(0, 0.42, 1.98));
  // Gunner's primary sight doghouse (right front), CITV (left front).
  sightBox(t, L, T(-0.78, 0.86, 1.1), 0.62, 0.36, 0.8);
  panoramic(t, L, T(0.62, 0.86, 0.7), 0.2, 0.42);
  // Commander's hatch with the CROWS-LP; loader's hatch and M240.
  hatch(t, L, T(-0.6, 0.86, -0.45), 0.38);
  rws(t, L, T(-0.6, 0.93, -0.3), 'crows');
  hatch(t, L, T(0.65, 0.86, -0.3), 0.34);
  if (L.hi) {
    mg(t, L, T(0.68, 1.12, 0.05));
    t.add(box(0.06, 0.25, 0.06), S.shade, T(0.68, 0.98, 0.05));
    // Wind sensor mast and antennas.
    t.add(rod([0, 0.86, -2.2], [0, 1.45, -2.2], 0.015, 4), S.black);
    t.add(box(0.12, 0.08, 0.12), S.black, T(0, 1.48, -2.2));
    antenna(t, L, T(1.1, 0.86, -2.0), 2.4);
    antenna(t, L, T(-1.1, 0.86, -2.0), 2.4);
  }
  // Smoke grenade launchers either side, 2 x 3 tubes.
  for (const s of [1, -1]) smoke(t, L, T(s * 1.56, 0.62, 1.22, 0, s * 55 * D, 0), 3, 2);
  // Bustle rack round the sides and rear, with stowage.
  const rk = S.shade;
  if (L.hi) {
    for (const s of [1, -1]) {
      for (const y of [0.3, 0.86]) t.add(rod([s * 1.74, y, -1.0], [s * 1.6, y, -2.95], 0.025, 4), rk);
      for (let i = 0; i <= 4; i++) {
        const z = -1.0 - i * 0.49;
        t.add(rod([s * (1.74 - i * 0.035), 0.3, z], [s * (1.74 - i * 0.035), 0.86, z], 0.02, 4), rk);
      }
    }
    for (const y of [0.3, 0.86]) t.add(rod([1.6, y, -2.95], [-1.6, y, -2.95], 0.025, 4), rk);
    bundle(t, T(1.45, 0.62, -1.9), 0.4, 0.5, 1.4, S.canvas, 3);
    bundle(t, T(-1.45, 0.62, -2.0), 0.38, 0.48, 1.2, S.tarp, 7);
    bundle(t, T(0.3, 0.62, -2.82), 1.6, 0.5, 0.28, S.canvas, 11);
    bag(t, L, T(0, 0.98, -2.2, 0, Math.PI / 2, 0), 0.9, 0.24, 0.24, S.tarp);
  } else rack(t, L, T(0, 0.3, -2.0), 3.4, 0.56, 1.9, rk);

  // 120 mm M256 L/44 with the thermal sleeve, bore evacuator and muzzle reference sensor.
  const g = gunOf(d, [0, 0.42, 1.72]);
  g.add(chamfer(0.78, 0.56, 0.5, 0.06), S.paint, T(0, 0, 0.42));
  barrel(g, L, { start: 0.6, len: 4.3, r0: 0.125, r1: 0.09, sleeve: { r: 0.125, bands: 5, end: 4.0 }, evac: { at: 2.4, len: 0.75, r: 0.14 }, mrs: true, bore: 0.06 });
  d.muzzle = [0, 0, 4.3];
  d.heat.push({ at: [0, 0, 2.4], size: [0.24, 0.24, 3.6], level: 0.3, parent: 'gun' });
}

/** A slab laid on a sloped plate from `a` (front, low) to `b` (back, high), raised `t` off it. */
function plateSlab(p: Parts, a: V3, b: V3, halfW: number, t: number, style = S.paint): void {
  const dz = b[2] - a[2];
  const dy = b[1] - a[1];
  const l = Math.hypot(dz, dy);
  // The plate's outward normal (up and forward).
  const ny = Math.abs(dz) / l;
  const nz = Math.abs(dy) / l;
  const pts: V3[] = [];
  for (const x of [halfW, -halfW])
    for (const q of [a, b]) {
      pts.push([x, q[1], q[2]]);
      pts.push([x * 0.98, q[1] + ny * t, q[2] + nz * t]);
    }
  p.add(convex(pts), style);
}

/** Leopard 2A7: arrowhead wedge armour on a tall vertical-sided turret, long L55 gun, 7 wheels. */
export function leopard(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.184;
  d.trackKind = 'pads';
  d.dustTop = 1.3;
  b.add(
    convex(
      sym([
        [1.12, 0.54, -3.45],
        [1.12, 0.54, 2.9],
        [1.12, 1.12, 3.85],
        [1.12, 1.2, -3.85],
        [1.12, 0.78, -3.85],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.84, 1.18, -3.85],
        [1.84, 1.18, 3.7],
        [1.84, 1.5, -3.85],
        [1.78, 1.62, -3.83],
        [1.78, 1.62, 2.45],
        [1.84, 1.34, 3.5],
        [1.15, 1.17, 3.88],
        [1.62, 1.19, 3.86],
      ]),
    ),
    S.paint,
  );
  // 2A7 add-on armour block on the lower front plate.
  b.add(
    convex(
      sym([
        [1.0, 0.56, 2.95],
        [1.0, 1.1, 3.86],
        [0.98, 0.5, 3.15],
        [0.98, 1.06, 4.06],
      ]),
    ),
    shade(0.93),
  );
  runningGear(d, {
    x: 1.42,
    trackW: 0.635,
    trackT: 0.08,
    wheels: [2.45, 1.72, 0.98, 0.24, -0.5, -1.24, -1.98],
    wheelR: 0.35,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(-3.18, 0.78, 0.33), teeth: 12 },
    idler: C(3.25, 0.62, 0.32),
    rollers: [C(2.0, 1.02, 0.1), C(0.62, 1.03, 0.1), C(-0.78, 1.04, 0.1), C(-2.1, 1.05, 0.1)],
    hidden: true,
  });
  const panels: [number, number, number, number][] = [
    [2.62, 3.8, 0.13, 0.45],
    [1.5, 2.6, 0.13, 0.45],
    [0.38, 1.48, 0.13, 0.45],
    [-0.72, 0.36, 0.05, 0.55],
    [-1.82, -0.74, 0.05, 0.55],
    [-2.92, -1.84, 0.05, 0.55],
    [-3.72, -2.94, 0.05, 0.55],
  ];
  if (L.hi) for (const [z0, z1, t, bot] of panels) skirt(b, 1.86 - t / 2, z0, z1, 1.19, bot, t, shade(0.96), z1 > 3.7 ? 0.5 : 0);
  else skirt(b, 1.83, -3.72, 3.8, 1.19, 0.5, 0.08, shade(0.96), 0.5);
  if (L.hi) {
    hatch(b, L, T(-0.62, 1.62, 2.25), 0.34);
    periscope(b, L, T(-0.62, 1.62, 2.62), 0.2);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.55, 1.36, 3.62));
      hook(b, L, T(s * 0.7, 1.02, 3.85, -0.9, 0, 0));
      grille(b, L, T(s * 1.2, 1.625, -3.25), 1.0, 0.9, 6);
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.6, 1.45, -3.86));
    }
    grille(b, L, T(0, 1.625, -2.1), 2.4, 1.2, 7);
    b.add(box(3.2, 0.5, 0.1), shade(0.9), T(0, 1.32, -3.88));
    cable(b, L, [
      [1.6, 1.64, -3.7],
      [1.62, 1.64, -1.2],
    ]);
  }
  d.heat.push({ at: [0, 1.66, -2.6], size: [2.8, 0.08, 2.2], level: 0.8, parent: 'body' }, { at: [0, 1.64, -3.3], size: [3.0, 0.1, 0.9], level: 1, parent: 'body' });

  const t = turretOf(d, [0, 1.62, -0.25]);
  t.add(
    convex(
      sym([
        [1.3, 0, 1.25],
        [1.76, 0, 1.0],
        [1.8, 0, -1.4],
        [1.68, 0, -2.65],
        [0, 0, -2.72],
        [1.26, 0.9, 1.18],
        [1.72, 0.9, 0.95],
        [1.76, 0.9, -1.4],
        [1.64, 0.9, -2.6],
        [0, 0.9, -2.66],
      ]),
    ),
    S.paint,
  );
  // The arrowhead: a spaced wedge either side of the gun.
  t.pair(
    convex([
      [0.42, 0.04, 1.2],
      [0.42, 0.04, 2.48],
      [0.42, 0.4, 2.42],
      [0.42, 0.9, 1.12],
      [1.8, 0.04, 0.98],
      [1.78, 0.9, 0.92],
    ]),
    shade(0.97),
    T(),
  );
  // Add-on side armour panels.
  t.pair(box(0.07, 0.62, 1.9), shade(0.93), T(1.82, 0.42, -0.35));
  // Gunner's EMES 15 doghouse and the commander's PERI R17 (right), loader's hatch and FLW 200 (left).
  sightBox(t, L, T(-0.95, 0.9, 0.62), 0.5, 0.44, 0.75);
  panoramic(t, L, T(-1.2, 0.9, -0.55), 0.21, 0.5);
  hatch(t, L, T(-0.55, 0.9, -1.0), 0.37);
  hatch(t, L, T(0.6, 0.9, -0.75), 0.36);
  rws(t, L, T(0.85, 0.94, -1.75), 'flw');
  for (const s of [1, -1]) smoke(t, L, T(s * 1.84, 0.4, -1.35, 0, s * 75 * D, 0), 4, 2);
  // Stowage baskets on the bustle sides and rear.
  if (L.hi) {
    for (const s of [1, -1]) {
      rack(t, L, T(s * 1.98, 0.22, -2.0), 0.36, 0.55, 1.15);
      bundle(t, T(s * 1.98, 0.5, -2.0), 0.32, 0.45, 1.0, s > 0 ? S.canvas : S.tarp, 5 + s);
      antenna(t, L, T(s * 1.2, 0.9, -2.4), 2.3);
    }
    rack(t, L, T(0, 0.22, -2.95), 3.0, 0.55, 0.48);
    bundle(t, T(0.4, 0.48, -2.95), 1.6, 0.45, 0.4, S.canvas, 9);
  } else rack(t, L, T(0, 0.22, -2.4), 4.0, 0.55, 1.4);

  // 120 mm L55, thermal sleeve and muzzle reference sensor.
  const g = gunOf(d, [0, 0.45, 1.45]);
  g.add(chamfer(0.72, 0.62, 0.62, 0.05), S.paint, T(0, 0, 0.34));
  barrel(g, L, { start: 0.64, len: 5.92, r0: 0.12, r1: 0.085, sleeve: { r: 0.12, bands: 6, end: 5.6 }, mrs: true, bore: 0.06 });
  d.muzzle = [0, 0, 5.92];
  d.heat.push({ at: [0, 0, 3.2], size: [0.22, 0.22, 5.2], level: 0.3, parent: 'gun' });
}

/** Challenger 3: slab-sided turret, L55A1, Trophy launchers, Dorchester side armour, rear bar armour. */
export function challenger(d: Draft): void {
  const L = d.L;
  const b = d.body;
  d.pitch = 0.184;
  d.trackKind = 'pads';
  d.dustTop = 1.3;
  b.add(
    convex(
      sym([
        [1.08, 0.5, -3.7],
        [1.08, 0.5, 3.25],
        [1.08, 1.18, 4.15],
        [1.08, 1.22, -4.15],
        [1.08, 0.75, -4.15],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.78, 1.2, -4.15],
        [1.78, 1.2, 4.0],
        [1.76, 1.6, -4.13],
        [1.7, 1.6, 2.75],
        [1.78, 1.36, 3.7],
        [1.0, 1.2, 4.16],
        [1.6, 1.2, 4.12],
      ]),
    ),
    S.paint,
  );
  runningGear(d, {
    x: 1.42,
    trackW: 0.635,
    trackT: 0.08,
    wheels: [2.6, 1.62, 0.64, -0.34, -1.32, -2.3],
    wheelR: 0.36,
    design: 'dished',
    twin: true,
    wheelStyle: shade(0.78, { ao: 0.8 }),
    sprocket: { ...C(-3.42, 0.8, 0.33), teeth: 12 },
    idler: C(3.55, 0.66, 0.33),
    rollers: [C(1.6, 1.06, 0.1), C(-0.1, 1.07, 0.1), C(-1.9, 1.08, 0.1)],
    hidden: true,
  });
  // Dorchester-style side armour: thick slab modules, thinner at the rear.
  const panels: [number, number, number][] = [
    [3.05, 4.08, 0.22],
    [1.85, 3.03, 0.22],
    [0.65, 1.83, 0.22],
    [-0.55, 0.63, 0.22],
    [-1.75, -0.57, 0.2],
    [-2.95, -1.77, 0.08],
    [-3.98, -2.97, 0.08],
  ];
  if (L.hi) for (const [z0, z1, t] of panels) skirt(b, 1.76 + t / 2, z0, z1, t > 0.1 ? 1.56 : 1.22, 0.5, t, shade(0.95), z1 > 4 ? 0.45 : 0.02);
  else skirt(b, 1.86, -3.98, 4.08, 1.5, 0.5, 0.2, shade(0.95), 0.45);
  // Bar armour across the rear and round the rear corners.
  slats(b, L, T(-1.85, 0.5, -4.42), 3.7, 1.15, 0.11);
  slats(b, L, T(1.9, 0.5, -3.55, 0, Math.PI / 2, 0), 0.85, 1.15, 0.11);
  slats(b, L, T(-1.9, 0.5, -4.4, 0, -Math.PI / 2, 0), 0.85, 1.15, 0.11);
  if (L.hi) {
    hatch(b, L, T(0, 1.6, 2.65), 0.36);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.45, 1.35, 3.95));
      hook(b, L, T(s * 0.7, 1.05, 4.1, -0.9, 0, 0));
      b.add(box(0.2, 0.12, 0.05), S.red, T(s * 1.5, 1.45, -4.16));
    }
    grille(b, L, T(0, 1.605, -2.6), 2.6, 1.6, 8);
    grille(b, L, T(0, 1.605, -3.75), 2.6, 0.6, 4);
  }
  d.heat.push({ at: [0, 1.64, -2.9], size: [2.8, 0.08, 2.4], level: 0.8, parent: 'body' }, { at: [0, 1.62, -3.75], size: [2.6, 0.1, 0.6], level: 1, parent: 'body' });

  const t = turretOf(d, [0, 1.6, 0.0]);
  t.add(
    convex(
      sym([
        [1.0, 0, 2.0],
        [1.64, 0, 1.36],
        [1.7, 0, -0.5],
        [1.56, 0, -2.6],
        [0, 0, -2.66],
        [0.82, 0.86, 1.52],
        [1.42, 0.86, 1.08],
        [1.5, 0.86, -0.5],
        [1.38, 0.86, -2.5],
        [0, 0.86, -2.55],
      ]),
    ),
    S.paint,
  );
  t.add(box(0.9, 0.55, 0.3), S.deep, T(0, 0.4, 1.86));
  // Gunner's sight and the commander's panoramic sight on its pedestal, both right.
  sightBox(t, L, T(-0.85, 0.86, 0.85), 0.5, 0.36, 0.62);
  t.add(cyl(0.16, 0.2, 0.36, L.seg(10, 6)), S.shade, T(-0.62, 1.04, 0.05));
  panoramic(t, L, T(-0.62, 1.2, 0.05), 0.24, 0.52);
  hatch(t, L, T(-0.7, 0.86, -0.75), 0.38);
  hatch(t, L, T(0.62, 0.86, -0.4), 0.35);
  if (L.hi) mg(t, L, T(0.62, 1.12, -0.1));
  // Trophy: a launcher on each turret side, radar panels on the corners.
  t.pair(chamfer(0.42, 0.48, 0.62, 0.06), S.paint, T(1.86, 0.55, -1.15));
  t.pair(cyl(0.2, 0.2, 0.22, L.seg(10, 6)), shade(0.9), T(1.9, 0.9, -1.15));
  t.pair(box(0.05, 0.42, 0.38), shade(0.85), T(1.62, 0.52, 1.18, 0, 0.75, 0));
  t.pair(box(0.05, 0.42, 0.38), shade(0.85), T(1.5, 0.52, -2.45, 0, -0.75, 0));
  for (const s of [1, -1]) smoke(t, L, T(s * 1.48, 0.62, 1.15, 0, s * 50 * D, 0), 5, 1);
  if (L.hi) {
    rack(t, L, T(0, 0.2, -2.88), 2.9, 0.62, 0.5);
    bundle(t, T(-0.2, 0.5, -2.88), 1.8, 0.5, 0.42, S.tarp, 13);
    antenna(t, L, T(1.1, 0.86, -2.2), 2.4);
    antenna(t, L, T(-1.1, 0.86, -2.2), 2.4);
  }

  // 120 mm L55A1 smoothbore: thermal sleeve, bore evacuator, reference sensor.
  const g = gunOf(d, [0, 0.42, 1.68]);
  g.add(chamfer(0.8, 0.52, 0.55, 0.05), S.paint, T(0, 0, 0.35));
  barrel(g, L, { start: 0.6, len: 5.67, r0: 0.12, r1: 0.085, sleeve: { r: 0.12, bands: 6, end: 5.35 }, evac: { at: 2.7, len: 0.7, r: 0.14 }, mrs: true, bore: 0.06 });
  d.muzzle = [0, 0, 5.67];
  d.heat.push({ at: [0, 0, 3.1], size: [0.22, 0.22, 5.0], level: 0.3, parent: 'gun' });
}

/** The T-72 / T-90 / T-80 hull: low, long glacis, fenders with boxes, 6 road wheels. */
export function t72Hull(d: Draft, o: { len: number; design: 'ribbed' | 'cast' }): { half: number } {
  const L = d.L;
  const b = d.body;
  const h = o.len / 2;
  d.pitch = 0.137;
  d.trackKind = 'steel';
  d.dustTop = 1.15;
  b.add(
    convex(
      sym([
        [1.08, 0.47, -h + 0.42],
        [1.08, 0.47, h - 0.72],
        [1.08, 0.95, h],
        [1.08, 1.05, -h],
        [1.08, 0.62, -h],
      ]),
    ),
    S.paint,
  );
  b.add(
    convex(
      sym([
        [1.58, 1.04, -h],
        [1.58, 1.04, h - 0.3],
        [1.58, 1.43, -h],
        [1.58, 1.43, 2.12],
        [1.42, 0.98, h],
        [1.08, 0.96, h + 0.01],
      ]),
    ),
    S.paint,
  );
  // Self-entrenching blade under the nose.
  b.add(box(2.6, 0.3, 0.06), shade(0.85), T(0, 0.82, h + 0.02, -0.5, 0, 0));
  const ribbed = o.design === 'ribbed';
  runningGear(d, {
    x: 1.4,
    trackW: 0.58,
    trackT: 0.07,
    wheels: ribbed ? [1.95, 1.22, 0.49, -0.24, -0.97, -1.7] : [2.12, 1.28, 0.44, -0.4, -1.24, -2.08],
    wheelR: ribbed ? 0.375 : 0.335,
    design: o.design,
    twin: true,
    wheelStyle: shade(0.8, { ao: 0.82 }),
    sprocket: { ...C(-h + 0.48, 0.7, 0.31), teeth: 12 },
    idler: C(h - 0.48, 0.6, 0.3),
    rollers: ribbed
      ? [C(1.3, 0.92, 0.12), C(0.2, 0.92, 0.12), C(-0.9, 0.93, 0.12)]
      : [C(1.75, 0.88, 0.09), C(0.85, 0.88, 0.09), C(-0.05, 0.88, 0.09), C(-0.95, 0.89, 0.09), C(-1.85, 0.89, 0.09)],
    hidden: true,
  });
  fenders(b, L, {
    x0: 1.58,
    x1: 1.8,
    y: 1.05,
    z0: -h + 0.05,
    z1: h - 0.2,
    boxes: L.hi
      ? [
          [-2.6, -1.85],
          [-1.8, -1.05],
          [-1.0, -0.25],
          [-0.2, 0.55],
          [0.6, 1.35],
        ]
      : [[-2.6, 1.35]],
    bh: 0.34,
  });
  if (L.hi) {
    hatch(b, L, T(0, 1.43, 2.25), 0.3);
    periscope(b, L, T(0, 1.43, 2.5), 0.22);
    for (const s of [1, -1]) {
      headlight(b, L, T(s * 1.05, 1.18, h - 0.32, -0.2, 0, 0));
      hook(b, L, T(s * 0.85, 0.85, h - 0.05, -0.9, 0, 0));
      b.add(box(0.2, 0.1, 0.05), S.red, T(s * 1.5, 1.2, -h - 0.01));
    }
    grille(b, L, T(0, 1.435, -2.1), 2.2, 1.6, 9);
    // Exhaust louvre on the left rear.
    b.add(box(0.05, 0.25, 0.7), S.black, T(1.6, 1.25, -2.0));
  }
  d.heat.push({ at: [0, 1.46, -2.2], size: [2.4, 0.08, 2.0], level: 0.8, parent: 'body' }, { at: [1.62, 1.25, -2.0], size: [0.1, 0.3, 0.8], level: 1, parent: 'body' });
  return { half: h };
}

/** The 2A46 125 mm gun with its canvas mantlet cover, thermal sleeve and fume extractor. */
function gun125(g: Parts, L: Lod, len: number): void {
  g.add(
    lathe(
      [
        [0.001, -0.05],
        [0.33, -0.05],
        [0.3, 0.2],
        [0.2, 0.48],
        [0.001, 0.5],
      ],
      L.seg(12, 6),
      'z',
    ),
    { ...S.canvas, crease: 60 },
  );
  barrel(g, L, { start: 0.42, len, r0: 0.12, r1: 0.085, sleeve: { r: 0.12, bands: 4, end: len - 1.2 }, evac: { at: 1.95, len: 0.62, r: 0.155 }, bore: 0.0625 });
}

/** T-72B3: cast turret with Kontakt-5 wedges in a V, Sosna-U sight, 2A46M-5, drums and log at the rear. */
export function t72(d: Draft): void {
  const L = d.L;
  const { half } = t72Hull(d, { len: 6.86, design: 'ribbed' });
  const b = d.body;
  // Kontakt-5 on the upper glacis, with the V splash ridge.
  plateSlab(b, [0, 0.98, half - 0.05], [0, 1.42, 2.2], 1.42, 0.16, shade(0.95));
  if (L.hi) {
    b.pair(box(1.4, 0.09, 0.09), S.paint, T(0.62, 1.48, 2.55, 0, 0.42, 0));
    eraPlate(b, L, T(0, 1.06, 3.05, 0.34, 0, 0), 2.5, 0.75, 6, 2, 0.04);
  }
  rubberSkirt(b, L, { x: 1.81, top: 1.05, bottom: 0.56, z0: -half + 0.3, z1: half - 0.25, era: 2.1 });
  rearDrumsAndLog(b, L, -half, 1.0, 3.2);

  const t = turretOf(d, [0, 1.43, -0.25]);
  castTurret(t, L, [
    [-0.02, 1.12, 1.28, 1.38],
    [0.3, 1.1, 1.22, 1.32],
    [0.55, 0.98, 1.02, 1.16],
    [0.72, 0.78, 0.7, 0.95],
    [0.8, 0.52, 0.32, 0.68],
  ]);
  cheekWedges(t, L, { x: 0.68, y: 0.06, z: 1.3, len: 1.12, h: 0.56, t: 0.42, yaw: 30 * D, slope: 18 * D }, shade(0.97));
  eraPlate(t, L, T(0, 0.7, 0.55, -0.28, 0, 0), 1.6, 0.55, 4, 1, 0.1);
  // Sosna-U in its box (right front), commander's cupola with the Kord (right), gunner's hatch (left).
  sightBox(t, L, T(-0.6, 0.66, 0.2), 0.52, 0.42, 0.55);
  cupola(t, L, T(-0.5, 0.74, -0.45));
  hatch(t, L, T(0.5, 0.74, -0.4), 0.33);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.02, 0.5, 0.62, 0, s * 40 * D, 0), 4, 1);
  if (L.hi) {
    // Snorkel tube and stowage box on the turret rear, antenna.
    t.add(cyl(0.11, 0.11, 1.5, 8, 'x'), S.shade, T(0.1, 0.42, -1.52));
    t.add(chamfer(1.3, 0.38, 0.32, 0.03), S.shade, T(-0.15, 0.2, -1.5));
    antenna(t, L, T(0.7, 0.6, -0.95), 2.2);
  }
  const g = gunOf(d, [0, 0.4, 1.0]);
  gun125(g, L, 5.35);
  d.muzzle = [0, 0, 5.35];
  d.heat.push({ at: [0, 0, 2.9], size: [0.22, 0.22, 4.8], level: 0.3, parent: 'gun' });
}

/** T-90M: welded turret with Relikt, big bustle box, slat cage on the turret and hull rear. */
export function t90(d: Draft): void {
  const L = d.L;
  const { half } = t72Hull(d, { len: 6.95, design: 'ribbed' });
  const b = d.body;
  plateSlab(b, [0, 0.98, half - 0.05], [0, 1.42, 2.2], 1.42, 0.2, shade(0.95));
  if (L.hi) eraPlate(b, L, T(0, 1.08, 3.0, 0.34, 0, 0), 2.5, 0.8, 6, 2, 0.05);
  rubberSkirt(b, L, { x: 1.81, top: 1.05, bottom: 0.55, z0: -half + 0.3, z1: half - 0.25, era: 2.6, eraRows: 2 });
  // Slat cage around the engine compartment.
  slats(b, L, T(1.86, 1.05, -half + 0.05, 0, Math.PI / 2, 0).multiply(T(-2.4, 0, 0)), 2.4, 0.75, 0.16);
  slats(b, L, T(-1.86, 1.05, -half + 0.05, 0, -Math.PI / 2, 0), 2.4, 0.75, 0.16);
  slats(b, L, T(-1.86, 0.6, -half - 0.32), 3.72, 1.2, 0.16);
  rearDrumsAndLog(b, L, -half, 1.0, 3.2);

  const t = turretOf(d, [0, 1.43, -0.3]);
  t.add(
    convex(
      sym([
        [0.6, 0, 1.3],
        [1.25, 0, 1.08],
        [1.28, 0, -0.9],
        [1.08, 0, -1.4],
        [0, 0, -1.5],
        [0.55, 0.8, 1.12],
        [1.12, 0.8, 0.92],
        [1.14, 0.8, -0.85],
        [0.95, 0.8, -1.3],
        [0, 0.8, -1.4],
      ]),
    ),
    S.paint,
  );
  cheekWedges(t, L, { x: 0.68, y: 0.02, z: 1.3, len: 1.2, h: 0.72, t: 0.48, yaw: 32 * D, slope: 22 * D }, shade(0.97));
  eraPlate(t, L, T(0, 0.8, 0.45), 1.9, 0.9, 5, 2, 0.08);
  // The big bustle box and the cage round it.
  t.add(chamfer(2.3, 0.62, 0.95, 0.05), S.paint, T(0, 0.36, -1.85));
  slats(t, L, T(1.5, 0.05, -0.55, 0, Math.PI / 2, 0), 1.95, 0.72, 0.14);
  slats(t, L, T(-1.5, 0.05, -2.5, 0, -Math.PI / 2, 0), 1.95, 0.72, 0.14);
  slats(t, L, T(-1.5, 0.05, -2.55), 3.0, 0.72, 0.14);
  // Kalina: gunner's sight (right front), commander's panoramic sight on a tall pedestal, UDP RWS.
  sightBox(t, L, T(-0.62, 0.88, 0.25), 0.44, 0.42, 0.5);
  t.add(cyl(0.12, 0.16, 0.5, L.seg(10, 6)), S.shade, T(-0.95, 1.05, -0.65));
  panoramic(t, L, T(-0.95, 1.25, -0.65), 0.2, 0.44);
  rws(t, L, T(-0.4, 0.82, -0.85), 'udp');
  hatch(t, L, T(0.5, 0.8, -0.45), 0.33);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.2, 0.55, 0.55, 0, s * 45 * D, 0), 3, 2);
  if (L.hi) antenna(t, L, T(0.8, 0.8, -1.2), 2.2);
  const g = gunOf(d, [0, 0.4, 1.0]);
  gun125(g, L, 5.55);
  d.muzzle = [0, 0, 5.55];
  d.heat.push({ at: [0, 0, 3.0], size: [0.22, 0.22, 5.0], level: 0.3, parent: 'gun' });
}

/** T-80BVM: cast turret with Relikt, smaller rubber-tyred wheels, flat turbine deck, big rear exhaust. */
export function t80(d: Draft): void {
  const L = d.L;
  const { half } = t72Hull(d, { len: 7.0, design: 'cast' });
  const b = d.body;
  d.pitch = 0.164;
  plateSlab(b, [0, 0.98, half - 0.05], [0, 1.42, 2.2], 1.42, 0.17, shade(0.95));
  if (L.hi) eraPlate(b, L, T(0, 1.06, 3.1, 0.34, 0, 0), 2.5, 0.75, 6, 2, 0.04);
  rubberSkirt(b, L, { x: 1.81, top: 1.05, bottom: 0.5, z0: -half + 0.3, z1: half - 0.25, era: 2.4 });
  // Turbine exhaust across the rear plate, and the log above it.
  b.add(box(1.7, 0.42, 0.12), S.paint, T(0, 1.18, -half - 0.03));
  if (L.hi) for (let i = 0; i < 6; i++) b.add(box(1.6, 0.03, 0.08), S.black, T(0, 1.02 + i * 0.065, -half - 0.1, 0.5, 0, 0));
  b.add(box(1.6, 0.36, 0.04), S.black, T(0, 1.18, -half - 0.09));
  b.add(cyl(0.13, 0.12, 3.2, L.seg(9, 5), 'x'), { ...S.wood, crease: 50 }, T(0, 1.55, -half - 0.1));
  d.heat.push({ at: [0, 1.18, -half - 0.1], size: [1.7, 0.45, 0.1], level: 1, parent: 'body' });

  const t = turretOf(d, [0, 1.43, -0.35]);
  castTurret(t, L, [
    [-0.02, 1.1, 1.25, 1.36],
    [0.3, 1.08, 1.2, 1.3],
    [0.55, 0.96, 1.0, 1.14],
    [0.72, 0.76, 0.68, 0.94],
    [0.8, 0.5, 0.3, 0.66],
  ]);
  cheekWedges(t, L, { x: 0.68, y: 0.04, z: 1.32, len: 1.14, h: 0.62, t: 0.46, yaw: 31 * D, slope: 20 * D }, shade(0.97));
  eraPlate(t, L, T(0, 0.7, 0.55, -0.28, 0, 0), 1.7, 0.55, 4, 1, 0.1);
  sightBox(t, L, T(-0.6, 0.66, 0.2), 0.52, 0.42, 0.55);
  cupola(t, L, T(-0.5, 0.74, -0.45));
  hatch(t, L, T(0.5, 0.74, -0.4), 0.33);
  for (const s of [1, -1]) smoke(t, L, T(s * 1.02, 0.5, 0.6, 0, s * 40 * D, 0), 4, 1);
  slats(t, L, T(-1.25, 0.02, -1.65), 2.5, 0.62, 0.12);
  if (L.hi) {
    t.add(chamfer(1.4, 0.4, 0.34, 0.03), S.shade, T(0, 0.22, -1.48));
    antenna(t, L, T(0.7, 0.6, -0.95), 2.2);
  }
  const g = gunOf(d, [0, 0.4, 0.98]);
  gun125(g, L, 5.55);
  d.muzzle = [0, 0, 5.55];
  d.heat.push({ at: [0, 0, 3.0], size: [0.22, 0.22, 5.0], level: 0.3, parent: 'gun' });
}
