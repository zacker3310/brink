import * as THREE from 'three';
import type { Draft } from './draft';
import { MIRROR, S, T, box, convex, fixWinding, lathe, shade, sideSlab, type Parts, type Style, type V2 } from './kit';

// Running gear: road wheels, drive sprocket, idler and return rollers by the real count, the track
// belt that follows their run, and road wheels for wheeled vehicles. The wheels turn in the paint
// shader (per-vertex hub), so all of them together stay in the body's single draw call.

export type WheelDesign = 'dished' | 'ribbed' | 'cast' | 'spoked' | 'light';

export interface Circle {
  z: number;
  y: number;
  r: number;
}

export interface Running {
  /** Track centre line distance from the hull centre (both sides). */
  x: number;
  trackW: number;
  /** Belt thickness. */
  trackT: number;
  /** Road wheel centres (z) and radius; they sit on the belt on the ground. */
  wheels: number[];
  wheelR: number;
  design: WheelDesign;
  /** Twin wheels with a gap for the guide horns. */
  twin?: boolean;
  sprocket: Circle & { teeth: number };
  idler: Circle;
  rollers: Circle[];
  /** Wheel tint (painted) and tyre. */
  wheelStyle?: Style;
  /** Draw only the gear's outer half (skirts hide the rest). */
  hidden?: boolean;
}

/** The circles the belt wraps, in loop order (rear to front along the ground, back over the top). */
function loopOf(g: Running): Circle[] {
  const ground: Circle[] = g.wheels.map((z) => ({ z, y: g.wheelR + g.trackT, r: g.wheelR }));
  const ends = [g.sprocket, g.idler].sort((a, b) => a.z - b.z);
  const front = ends[1]!;
  const rear = ends[0]!;
  const top = [...g.rollers].sort((a, b) => b.z - a.z);
  return [...ground.sort((a, b) => a.z - b.z), front, ...top, rear];
}

interface PathPt {
  z: number;
  y: number;
  /** Outward normal. */
  nz: number;
  ny: number;
  s: number;
}

/** The belt's centre line: tangents between the circles and arcs around them, with arc length. */
function beltPath(circles: Circle[], half: number, step: number): PathPt[] {
  const n = circles.length;
  const R = circles.map((c) => c.r + half);
  // Outward normal of the tangent from circle i to i + 1 (circles on the left of travel).
  const tn: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = circles[i]!;
    const b = circles[(i + 1) % n]!;
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    const L = Math.hypot(dz, dy) || 1e-6;
    const ez = dz / L;
    const ey = dy / L;
    const k = Math.max(-1, Math.min(1, (R[i]! - R[(i + 1) % n]!) / L));
    const c = Math.sqrt(1 - k * k);
    // Right of travel is (ey, -ez).
    tn.push([c * ey + k * ez, c * -ez + k * ey]);
  }
  const pts: PathPt[] = [];
  let s = 0;
  let last: [number, number] | null = null;
  const push = (z: number, y: number, nz: number, ny: number) => {
    if (last) s += Math.hypot(z - last[0], y - last[1]);
    last = [z, y];
    pts.push({ z, y, nz, ny, s });
  };
  for (let i = 0; i < n; i++) {
    const c = circles[i]!;
    const nin = tn[(i - 1 + n) % n]!;
    const nout = tn[i]!;
    const a0 = Math.atan2(nin[1], nin[0]);
    let da = Math.atan2(nout[1], nout[0]) - a0;
    while (da < 0) da += Math.PI * 2;
    if (da > Math.PI * 1.9) da = 0;
    const steps = Math.max(1, Math.ceil(da / step));
    for (let k = 0; k <= (da < 1e-4 ? 0 : steps); k++) {
      const a = a0 + (da * k) / steps;
      const nz = Math.cos(a);
      const ny = Math.sin(a);
      push(c.z + nz * R[i]!, c.y + ny * R[i]!, nz, ny);
    }
  }
  // Close the loop.
  const f = pts[0]!;
  push(f.z, f.y, f.nz, f.ny);
  return pts;
}

/** The belt as a solid band: outer face with the links, inner face and both edges. */
export function beltGeometry(circles: Circle[], x: number, w: number, t: number, repeat: number, step: number, far = false): THREE.BufferGeometry {
  const path = beltPath(circles, t / 2, step);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const strip = (off: number, sign: number, u0: number, u1: number, xa: number, xb: number, edge: number) => {
    const base = pos.length / 3;
    for (const p of path) {
      const z = p.z + p.nz * off;
      const y = p.y + p.ny * off;
      const v = p.s / repeat;
      pos.push(xa, y, z, xb, y, z);
      if (edge) nor.push(edge, 0, 0, edge, 0, 0);
      else nor.push(0, p.ny * sign, p.nz * sign, 0, p.ny * sign, p.nz * sign);
      uv.push(u0, v, u1, v);
    }
    for (let i = 0; i + 1 < path.length; i++) {
      const a = base + i * 2;
      const b = a + 2;
      if (sign > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
      else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };
  // The outer face; the inner face is never seen past the wheels.
  strip(t / 2, 1, 0, 1, x0, x1, 0);
  // Edges: built as strips between the outer and inner faces.
  const edge = (xe: number, nx: number) => {
    const base = pos.length / 3;
    for (const p of path) {
      const v = p.s / repeat;
      pos.push(xe, p.y + (p.ny * t) / 2, p.z + (p.nz * t) / 2, xe, p.y - (p.ny * t) / 2, p.z - (p.nz * t) / 2);
      nor.push(nx, 0, 0, nx, 0, 0);
      uv.push(0.02, v, 0.08, v);
    }
    for (let i = 0; i + 1 < path.length; i++) {
      const a = base + i * 2;
      const b = a + 2;
      if (nx > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
      else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };
  if (!far || x > 0) edge(x1, 1);
  if (!far || x < 0) edge(x0, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// --- Wheels ---------------------------------------------------------------------------------------------

/**
 * One road wheel in its own frame: axis along x, the outer face toward +x, centred. Returns the
 * painted disc and the rubber tyre separately so each takes its own style.
 */
export function wheelGeometry(r: number, w: number, design: WheelDesign, segs: number, hi: boolean): { disc: THREE.BufferGeometry[]; tyre: THREE.BufferGeometry[] } {
  const h = w / 2;
  const tyreT = design === 'cast' ? r * 0.16 : design === 'light' ? r * 0.18 : r * 0.13;
  const rim = r - tyreT;
  // The tyre: tread and the outer sidewall (the inner side is never seen). Twin wheels show a groove.
  const tyreProfile: V2[] = [
    [r, -h],
    [r * 0.99, h],
    [rim, h + 0.004],
  ];
  const tyre = [lathe(tyreProfile, segs, 'x')];
  // The disc: dished in from the rim to the hub, with a raised hub cap.
  // Two bands: the dish down to the hub ring, then the raised hub cap.
  const dish: Record<WheelDesign, V2[]> = {
    dished: [
      [rim, h],
      [rim * 0.3, h - 0.04],
      [0.001, h + 0.05],
    ],
    ribbed: [
      [rim, h],
      [rim * 0.26, h - 0.06],
      [0.001, h + 0.035],
    ],
    cast: [
      [rim, h],
      [rim * 0.28, h + 0.035],
      [0.001, h + 0.075],
    ],
    spoked: [
      [rim, h],
      [rim * 0.26, h - 0.06],
      [0.001, h + 0.03],
    ],
    light: [
      [rim, h],
      [rim * 0.3, h - 0.02],
      [0.001, h + 0.03],
    ],
  };
  const disc = [lathe(hi ? dish[design] : [[rim, h], [0.001, h + 0.02]], segs, 'x')];
  if (hi && design === 'ribbed') {
    // Eight radial ribs across the dish: low triangular ridges.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rl = rim * 0.5;
      const rib = convex([
        [h - 0.07, -rl / 2, -0.02],
        [h - 0.07, rl / 2, -0.02],
        [h - 0.07, -rl / 2, 0.02],
        [h - 0.07, rl / 2, 0.02],
        [h - 0.02, -rl / 2, 0],
        [h - 0.035, rl / 2, 0],
      ]);
      rib.applyMatrix4(T(0, Math.cos(a) * rim * 0.6, Math.sin(a) * rim * 0.6, a, 0, 0));
      disc.push(rib);
    }
  }
  return { disc, tyre };
}

function sprocketGeometry(r: number, w: number, teeth: number, segs: number, hi: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = w / 2;
  // Hub and the dished carrier.
  out.push(
    lathe(
      [
        [r * 0.8, h - 0.04],
        [r * 0.3, h + 0.03],
        [r * 0.2, h + 0.08],
        [0.001, h + 0.08],
      ],
      segs,
      'x',
    ),
  );
  // Two toothed rings.
  const step = (Math.PI * 2) / teeth;
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [f, rr] of [
      [0, 0.9],
      [0.3, 1.09],
      [0.62, 0.9],
    ] as const)
      ring.push(new THREE.Vector2(Math.cos(a + f * step) * r * rr, Math.sin(a + f * step) * r * rr));
  }
  for (const xr of [0]) {
    const depth = hi ? w * 0.7 : w * 0.8;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(ring), { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    // Shape plane (x, y) to the wheel plane (z, y), extrusion along x.
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, xr, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    out.push(fixWinding(g));
  }
  return out;
}

/** A flat disc of radius `r` in the x = 0 plane, facing +x. */
export function fanDisc(r: number, n: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(0, 0, 0, 0, Math.sin(a0) * r, -Math.cos(a0) * r, 0, Math.sin(a1) * r, -Math.cos(a1) * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Road wheels, sprocket, idler, rollers and both track belts. */
export function runningGear(d: Draft, g: Running): void {
  const L = d.L;
  const body = d.body;
  d.wheelR = g.wheelR;
  const segs = L.seg(12, 7);
  const ws = g.wheelStyle ?? S.paint;
  const sides = [1, -1];
  const wheelW = g.twin ? g.trackW * 0.9 : g.trackW * 0.75;
  const place = (p: Parts, geo: THREE.BufferGeometry, st: Style, side: number, x: number, c: Circle) => {
    const m = T(x, c.y, c.z);
    p.add(geo, st, side > 0 ? m : MIRROR.clone().multiply(m), { y: c.y, z: c.z, r: c.r });
  };
  const far = fanDisc(1, 7);
  const wheel = (c: Circle, design: WheelDesign, w: number) => {
    if (!L.hi) {
      // Far away a wheel is a flat disc on the outer face.
      const m = T(g.x + w / 2, c.y, c.z, 0, 0, 0, 1, c.r, c.r);
      body.add(far, shade(0.42), m, { y: c.y, z: c.z, r: c.r });
      body.add(far, shade(0.42), MIRROR.clone().multiply(m), { y: c.y, z: c.z, r: c.r });
      return;
    }
    const geo = wheelGeometry(c.r, w, design, segs, L.hi);
    for (const side of sides) {
      for (const disc of geo.disc) place(body, disc, ws, side, g.x, c);
      for (const t of geo.tyre) place(body, t, S.tyre, side, g.x, c);
    }
  };
  for (const z of g.wheels) wheel({ z, y: g.wheelR + g.trackT, r: g.wheelR }, g.design, wheelW);
  wheel(g.idler, g.design === 'spoked' ? 'light' : g.design, wheelW);
  if (L.hi || !g.hidden) for (const r of g.rollers) wheel(r, 'light', g.trackW * 0.35);
  // Sprocket.
  if (L.hi) {
    const sp = sprocketGeometry(g.sprocket.r, g.trackW * 0.8, g.sprocket.teeth, segs, L.hi);
    for (const side of sides) for (const geo of sp) place(body, geo, S.shade, side, g.x, g.sprocket);
  } else wheel(g.sprocket, 'light', wheelW);
  // Belts.
  const loop = loopOf(g);
  const repeat = 4 * d.pitch;
  const step = L.hi ? 0.26 : 0.6;
  for (const side of sides) {
    const geo = beltGeometry(loop, side * g.x, g.trackW, g.trackT, repeat, step, !L.hi);
    if (L.hi) d.belts.push({ geo });
    else body.add(geo, S.track);
  }
}

// --- Wheeled vehicles -------------------------------------------------------------------------------

export interface Axles {
  /** Wheel centre distance from the hull centre. */
  x: number;
  zs: number[];
  r: number;
  w: number;
  /** Rim style: 'military' with the central tyre inflation hub. */
  hub?: 'military' | 'plain';
}

export function roadWheels(d: Draft, a: Axles): void {
  const L = d.L;
  d.wheelR = a.r;
  const r = a.r;
  const h = a.w / 2;
  if (!L.hi) {
    // Far away: the tyre as a short drum.
    const drum = lathe(
      [
        [r, -h],
        [r, h],
        [0.001, h + 0.02],
      ],
      7,
      'x',
    );
    for (const z of a.zs) for (const side of [1, -1]) {
      const m = T(a.x, r, z);
      d.body.add(drum, S.tyre, side > 0 ? m : MIRROR.clone().multiply(m), { y: r, z, r });
    }
    return;
  }
  const segs = 14;
  // Off-road tyre with a squared shoulder; the rim recessed inside it.
  const tyre = lathe(
    [
      [r * 0.95, -h],
      [r, -h * 0.7],
      [r, h * 0.7],
      [r * 0.93, h + 0.01],
      [r * 0.64, h + 0.005],
    ],
    segs,
    'x',
  );
  const rim = lathe(
    [
      [r * 0.64, h],
      [r * 0.34, h - 0.05],
      [r * 0.22, h + 0.03],
      [0.001, h + 0.05],
    ],
    segs,
    'x',
  );
  // Tread blocks round the tyre.
  const lugs: THREE.BufferGeometry[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const lug = convex([
      [-h * 0.8, r - 0.01, -0.05],
      [h * 0.8, r - 0.01, -0.05],
      [-h * 0.8, r - 0.01, 0.05],
      [h * 0.8, r - 0.01, 0.05],
      [-h * 0.75, r + 0.025, -0.03],
      [h * 0.75, r + 0.025, 0.03],
    ]);
    lug.applyMatrix4(T(0, 0, 0, ang, 0, 0));
    lugs.push(lug);
  }
  for (const z of a.zs) {
    const c = { z, y: r, r };
    for (const side of [1, -1]) {
      const m = T(a.x, r, z);
      const mm = side > 0 ? m : MIRROR.clone().multiply(m);
      d.body.add(tyre, S.tyre, mm, c);
      for (const l of lugs) d.body.add(l, S.tyre, mm, c);
      d.body.add(rim, S.shade, mm, c);
    }
  }
}

/** Side skirt plates along the track, top edge at `top`, bottom at `bottom`, between z0 and z1. */
export function skirt(p: Parts, x: number, z0: number, z1: number, top: number, bottom: number, thick: number, style: Style, frontRake = 0.25): void {
  const outline: V2[] = [
    [z0, top],
    [z0, bottom + 0.05],
    [z1 - frontRake, bottom],
    [z1, top - 0.08],
    [z1, top],
  ];
  p.pair(sideSlab(outline, x - thick / 2, x + thick / 2), style, T());
}

/** A fender run along a side (top of the track), mirrored. */
export function fender(p: Parts, x: number, w: number, z0: number, z1: number, y: number, style: Style = S.paint): void {
  const g = box(w, 0.04, z1 - z0);
  p.pair(g, style, T(x, y, (z0 + z1) / 2));
}

/** A point helper for circles. */
export const C = (z: number, y: number, r: number): Circle => ({ z, y, r });

