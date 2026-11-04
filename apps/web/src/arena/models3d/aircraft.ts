import * as THREE from 'three';
import { fuselage } from './air';
import { Lod, Parts, S, T, box, cyl, lathe, planSlab, sideSlab, solid, type Style, type V2 } from './kit';
import { paintMaterial } from './paint';

// Off-map support in the air and offshore, built in code from real proportions (metres, nose to +z,
// y up, +x the left wing): the F-35A and Su-34 strike jets and their bombs (GBU-31 JDAM, KAB-500), the
// Tomahawk and Kalibr cruise missiles (and the Tomahawk's booster), the Shahed-136 / Geran-2 and the
// LUCAS one-way drones, and the Arleigh Burke destroyer and Slava cruiser seen from the field as
// silhouettes on the horizon. Geometry is built once per kind and shared; so is the material.

export type AirKind = 'f35' | 'su34' | 'gbu31' | 'kab500' | 'tomahawk' | 'kalibr' | 'booster' | 'shahed' | 'lucas';
export type ShipKind = 'burke' | 'slava';

/** Real length in metres of each kind, for the film's scale. */
export const AIR_LENGTH: Record<AirKind, number> = { f35: 15.7, su34: 23.3, gbu31: 3.9, kab500: 3.05, tomahawk: 5.56, kalibr: 6.2, booster: 0.7, shahed: 3.5, lucas: 3.0 };
/** Where each kind's engine nozzle (or motor) is, metres, in its own frame. */
export const NOZZLES: Record<AirKind, [number, number, number][]> = {
  f35: [[0, 0.05, -7.75]],
  su34: [[1.25, -0.6, -10.1], [-1.25, -0.6, -10.1]],
  gbu31: [],
  kab500: [],
  tomahawk: [[0, -0.1, -2.85]],
  kalibr: [[0, -0.1, -3.15]],
  booster: [[0, 0, -0.4]],
  shahed: [],
  lucas: [],
};
/** Wingtips (left), metres, for the vapour trails a hard pull leaves. */
export const WINGTIP: Partial<Record<AirKind, [number, number, number]>> = { f35: [5.3, -0.05, -2.4], su34: [7.3, -0.3, -4.8] };

const geos = new Map<string, THREE.BufferGeometry>();
let material: THREE.MeshStandardMaterial | null = null;

const L = new Lod(0);

/** A flat panel in plan (x, z) outline, `t` thick, centred on `y`. */
function wing(p: Parts, outline: V2[], y: number, t: number, s: Style, both = true): void {
  const g = planSlab(outline, y - t / 2, y + t / 2);
  if (both) p.pair(g, s, T());
  else p.add(g, s);
}

/** A fin in the side plane (z, y) outline, `t` thick, at `x`, canted outward by `cant` radians. */
function fin(p: Parts, outline: V2[], x: number, y: number, t: number, cant: number, s: Style): void {
  const g = sideSlab(outline, -t / 2, t / 2);
  p.pair(g, s, T(x, y, 0, 0, 0, -cant));
}

/** A canopy: a stretched half-sphere of glass. */
function canopy(p: Parts, z: number, y: number, w: number, h: number, len: number): void {
  const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  p.add(g, { ...S.glass, crease: 70 }, T(0, y, z, 0, 0, 0, w, h, len));
}

function f35(p: Parts): void {
  // Have Glass grey: a dark, slightly blue-grey, with lighter edge treatments.
  const skin = solid(0x5d6369, { rough: 0.55, metal: 0.2, crease: 50 });
  const edge = solid(0x6f757a, { rough: 0.5, metal: 0.2 });
  // The wide lifting body: chined nose, the caret intakes either side of the cockpit, the engine bay.
  fuselage(p, L, [
    [7.85, 0.04, -0.02, 0.04, 2],
    [7.1, 0.32, -0.28, 0.24, 2.6],
    [6.0, 0.62, -0.5, 0.5, 3],
    [4.9, 0.85, -0.62, 0.72, 3.2],
    [4.0, 1.55, -0.72, 0.8, 4],
    [1.5, 1.78, -0.78, 0.82, 4.4],
    [-1.5, 1.72, -0.74, 0.78, 4.4],
    [-4.2, 1.42, -0.6, 0.68, 4],
    [-5.9, 0.9, -0.5, 0.52, 2.8],
    [-7.1, 0.62, -0.44, 0.44, 2],
  ], skin, 22);
  canopy(p, 3.7, 0.72, 0.52, 0.5, 1.9);
  // Wings: 35 degree leading edge, the trailing edge swept forward, tips cut square.
  wing(p, [[1.5, 2.4], [5.35, -1.55], [5.35, -3.05], [1.5, -3.85]], -0.08, 0.2, skin);
  wing(p, [[5.25, -1.6], [5.4, -1.6], [5.4, -3.0], [5.25, -3.0]], -0.08, 0.22, edge);
  // All-moving tailplanes.
  wing(p, [[1.15, -4.55], [3.4, -6.35], [3.4, -7.35], [1.05, -7.25]], 0.02, 0.12, skin);
  // Twin fins canted out 25 degrees.
  fin(p, [[-4.3, 0], [-6.1, 2.35], [-7.05, 2.35], [-6.75, 0]], 1.05, 0.45, 0.12, 0.44, skin);
  // The F135's single round nozzle.
  p.add(cyl(0.58, 0.5, 0.75, 16, 'z'), solid(0x3a3836, { rough: 0.45, metal: 0.7 }), T(0, 0.05, -7.4));
  p.add(cyl(0.44, 0.44, 0.06, 16, 'z'), S.black, T(0, 0.05, -7.78));
}

function su34(p: Parts): void {
  // Su-34 grey-blue, the platypus nose and the wide side-by-side cockpit.
  const skin = solid(0x7c8a94, { rough: 0.6, metal: 0.15, crease: 50 });
  const dark = solid(0x5c6870, { rough: 0.6, metal: 0.15, crease: 50 });
  fuselage(p, L, [
    [11.65, 0.06, -0.12, 0.0, 2],
    [10.6, 0.5, -0.36, 0.22, 3.6],
    [9.2, 0.82, -0.55, 0.45, 3.6],
    [7.4, 1.08, -0.72, 0.9, 3.2],
    [5.4, 1.18, -0.75, 1.05, 3],
    [3.0, 1.1, -0.6, 0.85, 3],
    [-1.0, 0.95, -0.45, 0.6, 3],
    [-5.0, 0.75, -0.35, 0.45, 2.6],
    [-9.5, 0.42, -0.25, 0.3, 2],
    [-11.65, 0.18, -0.15, 0.15, 2],
  ], skin, 22);
  canopy(p, 6.0, 0.95, 0.9, 0.55, 2.0);
  // Twin engine nacelles under the wing roots, wide apart.
  for (const s of [1, -1]) {
    fuselageAt(p, s * 1.25, [
      [3.6, 0.55, -1.3, -0.25, 4],
      [1.5, 0.66, -1.35, -0.2, 3.6],
      [-6.0, 0.62, -1.15, -0.1, 3],
      [-9.6, 0.52, -1.0, -0.2, 2],
    ], dark);
    p.add(cyl(0.5, 0.46, 0.6, 14, 'z'), solid(0x3a3836, { rough: 0.45, metal: 0.7 }), T(s * 1.25, -0.6, -9.85));
  }
  // Wing with its long root extension, canards, stabilators and the twin upright fins.
  wing(p, [[0.9, 6.2], [2.3, 1.2], [7.35, -4.3], [7.35, -5.3], [2.1, -6.1]], -0.35, 0.22, skin);
  wing(p, [[1.0, 7.2], [2.75, 6.2], [2.75, 5.6], [1.0, 5.7]], 0.15, 0.1, skin);
  wing(p, [[2.0, -7.6], [4.9, -9.7], [4.9, -10.7], [2.0, -10.3]], -0.5, 0.12, skin);
  fin(p, [[-6.3, 0], [-9.2, 3.5], [-10.4, 3.5], [-10.2, 0]], 2.05, 0.0, 0.14, 0.05, skin);
}

/** A lofted part along z centred at `x` (engine nacelles). */
function fuselageAt(p: Parts, x: number, st: [number, number, number, number, number][], s: Style): void {
  const q = new Parts();
  fuselage(q, L, st, s, 12);
  p.absorb(q, T(x, 0, 0));
}

/** A cruise missile: a slim round body, a wing pair at mid body, a cruciform tail. */
function cruise(p: Parts, len: number, r: number, span: number, wingZ: number, colour: number, nose: number): void {
  const skin = solid(colour, { rough: 0.55, metal: 0.25, crease: 60 });
  const h = len / 2;
  lathe0(p, [[0.001, -h], [r * 0.85, -h], [r, -h + 0.25], [r, h - nose], [r * 0.7, h - nose * 0.45], [r * 0.25, h - 0.06], [0.001, h]], skin);
  wing(p, [[r * 0.6, wingZ + 0.18], [span / 2, wingZ + 0.06], [span / 2, wingZ - 0.12], [r * 0.6, wingZ - 0.2]], 0, 0.04, skin);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const g = planSlab([[0, -h + 0.55], [0.36, -h + 0.18], [0.36, -h + 0.04], [0, -h + 0.06]], -0.012, 0.012);
    p.add(g, skin, T(0, 0, 0, 0, 0, a).multiply(T(r * 0.9, 0, 0)));
  }
  // The turbofan's intake scoop under the body.
  p.add(box(r * 0.8, r * 0.5, 0.6), solid(0x2a2c2c), T(0, -r * 0.95, -h + 0.9));
}

function lathe0(p: Parts, prof: V2[], s: Style): void {
  p.add(lathe(prof, 14, 'z'), s);
}

/** A delta-wing one-way drone: cropped delta, wingtip fins, a round nose and the pusher prop's hub. */
function oneWay(p: Parts, len: number, span: number, colour: number): void {
  const skin = solid(colour, { rough: 0.75, metal: 0.05, crease: 55 });
  const h = len / 2;
  lathe0(p, [[0.001, -h], [0.12, -h + 0.05], [0.2, -h + 0.5], [0.22, h - 0.7], [0.15, h - 0.25], [0.001, h]], skin);
  const half = span / 2;
  wing(p, [[0.12, h - 0.75], [half, -h + 0.55], [half, -h + 0.2], [0.12, -h + 0.08]], 0, 0.07, skin);
  // Winglets standing up and down at the tips.
  fin(p, [[-h + 0.55, -0.12], [-h + 0.15, 0.38], [-h + 0.02, 0.38], [-h + 0.12, -0.18]], half, 0, 0.04, 0, skin);
  p.add(cyl(0.07, 0.05, 0.14, 8, 'z'), S.black, T(0, 0, -h - 0.04));
}

/** A free-fall bomb with a guidance kit: round body, ogive nose, tail fins. */
function bomb(p: Parts, len: number, r: number, colour: number): void {
  const skin = solid(colour, { rough: 0.6, metal: 0.2, crease: 60 });
  const h = len / 2;
  lathe0(p, [[0.001, -h], [r * 0.55, -h], [r * 0.8, -h + 0.5], [r, -h + 1.0], [r, h - 0.9], [r * 0.6, h - 0.3], [0.001, h]], skin);
  for (let i = 0; i < 4; i++) {
    const g = planSlab([[0, -h + 0.85], [r + 0.3, -h + 0.25], [r + 0.3, -h + 0.02], [0, -h + 0.02]], -0.015, 0.015);
    p.add(g, solid(0x5f645e), T(0, 0, 0, 0, 0, Math.PI / 4 + (i * Math.PI) / 2));
  }
  // A yellow nose band: live HE.
  p.add(cyl(r * 0.97, r * 0.97, 0.08, 14, 'z'), solid(0xc9a43a), T(0, 0, h - 1.0));
}

function build(kind: AirKind): THREE.BufferGeometry {
  const p = new Parts(40);
  switch (kind) {
    case 'f35':
      f35(p);
      break;
    case 'su34':
      su34(p);
      break;
    case 'tomahawk':
      cruise(p, 5.56, 0.26, 2.67, -0.2, 0xaeb3b5, 0.75);
      break;
    case 'kalibr':
      cruise(p, 6.2, 0.267, 3.1, -0.9, 0x4f5a55, 1.1);
      break;
    case 'booster':
      lathe0(p, [[0.001, -0.4], [0.24, -0.38], [0.26, -0.3], [0.26, 0.35], [0.001, 0.35]], solid(0x6b6e6a, { rough: 0.6 }));
      break;
    case 'gbu31':
      bomb(p, 3.9, 0.23, 0x6b7064);
      break;
    case 'kab500':
      bomb(p, 3.05, 0.2, 0x5d6b5a);
      break;
    case 'shahed':
      // Geran-2: the Russian-built Shahed-136, flat black.
      oneWay(p, 3.5, 2.5, 0x1f2022);
      break;
    case 'lucas':
      oneWay(p, 3.0, 2.4, 0xa49d8b);
      break;
  }
  return p.build()!;
}

function geometry(kind: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geos.get(kind);
  if (!g) {
    g = make();
    geos.set(kind, g);
  }
  return g;
}

/**
 * An aircraft, missile, bomb or drone as a group at real size x METRE, nose to +z (shared geometry
 * and material: the caller scales and places the group, and never disposes what it shares).
 */
export function buildAircraft(kind: AirKind): THREE.Group {
  material ??= paintMaterial({ scheme: 'drone_grey', dust: 0 });
  const m = new THREE.Mesh(geometry(kind, () => build(kind)), material);
  m.castShadow = true;
  m.name = kind;
  const o = new THREE.Group();
  o.add(m);
  if (kind === 'shahed' || kind === 'lucas') {
    // The pusher prop, turned by the film.
    const prop = new THREE.Mesh(geometry('prop', () => new Parts(40).add(box(1.1, 0.025, 0.09), S.black).build()!), material);
    prop.name = 'prop';
    prop.position.z = -(AIR_LENGTH[kind] / 2 + 0.12) * 0.1;
    o.add(prop);
  }
  return o;
}

// --- Ships ------------------------------------------------------------------------------------------

/** Where each ship's guns are, metres, in its own frame (bow to +z). */
export const SHIP_GUNS: Record<ShipKind, [number, number, number][]> = {
  burke: [[0, 9.5, 54]],
  slava: [[0, 12.5, 60]],
};
export const SHIP_LENGTH: Record<ShipKind, number> = { burke: 155, slava: 186 };

function burke(p: Parts): void {
  const s = solid(0x8a9196);
  // A flared, raked bow; the long low hull; the transom.
  p.add(sideSlab([[-77, 0], [-77.5, 6.5], [40, 7.5], [77, 9.5], [72, 0]], -10, 10, 0), s);
  // Deckhouse with the SPY-1 faces, the tripod mast, two raked funnels, the after deckhouse.
  p.add(sideSlab([[8, 7], [8, 16], [28, 17], [32, 7]], -7, 7), s);
  p.add(sideSlab([[14, 17], [17, 31], [20, 31], [25, 17]], -2.5, 2.5), s);
  p.add(box(0.8, 9, 0.8), s, T(0, 35, 18.5));
  p.add(box(12, 0.6, 0.6), s, T(0, 33, 18.5));
  p.add(sideSlab([[-6, 7], [-4, 21], [2, 21], [3, 7]], -3.5, 3.5), s);
  p.add(sideSlab([[-26, 7], [-24, 20], [-18, 20], [-17, 7]], -3.5, 3.5), s);
  p.add(sideSlab([[-48, 7], [-48, 13], [-34, 13], [-33, 7]], -6, 6), s);
  // The Mk 45 5-inch gun forward, its barrel over the bow.
  p.add(box(3.5, 2.6, 4.5), s, T(0, 8.6, 50));
  p.add(cyl(0.3, 0.25, 7, 6, 'z'), s, T(0, 9.5, 55));
}

function slava(p: Parts): void {
  const s = solid(0x7e868b);
  p.add(sideSlab([[-92, 0], [-93, 7], [45, 8], [93, 10.5], [86, 0]], -10.5, 10.5, 0), s);
  // The sixteen P-500 Bazalt tubes in angled pairs along the forward superstructure.
  for (const x of [-7.5, 7.5]) p.add(sideSlab([[4, 8], [8, 13.5], [46, 11], [46, 8]], x - 2.5, x + 2.5), s);
  // The tall block of the bridge, its lattice mast, the big funnel block and the aft deckhouse.
  p.add(sideSlab([[-14, 8], [-12, 22], [6, 24], [8, 8]], -6, 6), s);
  p.add(sideSlab([[-6, 24], [-4, 44], [-1, 44], [2, 24]], -2, 2), s);
  p.add(box(14, 0.6, 0.6), s, T(0, 40, -2.5));
  p.add(sideSlab([[-40, 8], [-38, 24], [-24, 24], [-22, 8]], -5.5, 5.5), s);
  p.add(sideSlab([[-70, 8], [-70, 15], [-46, 15], [-44, 8]], -7, 7), s);
  // The AK-130's twin 130 mm mount forward.
  p.add(box(6, 3.4, 7), s, T(0, 11.6, 58));
  for (const x of [-1.1, 1.1]) p.add(cyl(0.3, 0.26, 8, 6, 'z'), s, T(x, 12.5, 64));
}

/** A ship's hull and upperworks in one geometry (metres x METRE, bow to +z, waterline at y = 0). */
export function shipGeometry(kind: ShipKind): THREE.BufferGeometry {
  return geometry(kind, () => {
    const p = new Parts(0);
    if (kind === 'burke') burke(p);
    else slava(p);
    return p.build()!;
  });
}
