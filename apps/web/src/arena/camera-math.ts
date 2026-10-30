import * as THREE from 'three';
import type { Pt } from './gestures';

// The battle camera as numbers, so the stage, the gestures and the tests share one model.
//
// Projection model. A perspective camera (vertical field of view `fov`, aspect width / height)
// looks at a point on the ground from `dist` world units away, pitched `tilt` below the horizon,
// from heading `yaw` (0 is north-up: the eye stands south of the point, at +z, looking toward -z;
// a larger yaw turns the map clockwise on screen). The focus (fx, fz), the ground you work on, is
// not the point looked at: the HUD covers `hud[0]` of the screen at the top and `hud[1]` at the
// bottom, and the look point is moved along the heading so the focus is seen `delta` above the
// view axis, in the middle of the band between the bars (exact for flat ground):
//   delta = atan((hud[1] - hud[0]) * tan(fov / 2))
//   h = sin(tilt) * dist, r = cos(tilt) * dist, s = h / tan(tilt - delta) - r
//   look = focus + (sin yaw, cos yaw) * s, at the ground height under the focus
//   eye = look + (sin yaw, cos yaw) * r, raised by h
// A world point's screen position is three.js's projection through that camera, in CSS pixels
// from the canvas corner.

export interface CameraView {
  /** The focus on the ground (world x, z). */
  fx: number;
  fz: number;
  /** Heading off north (radians, clockwise positive on screen). */
  yaw: number;
  /** Pitch below the horizon (radians). */
  tilt: number;
  /** World units from the eye to the point it looks at. */
  dist: number;
  /** Fractions of the screen height the HUD covers at the top and bottom. */
  hud: readonly [number, number];
}

/** Ground height under a world point. */
export type Ground = (x: number, z: number) => number;

export interface Size {
  width: number;
  height: number;
}

/** What a gesture may not take the camera past: the zoom range and the field (world units). */
export interface Limits {
  minDist: number;
  maxDist: number;
  w: number;
  h: number;
}

/** The point the eye looks at (lx, gy, lz) and the eye's height and run back from it. */
export function aim(v: CameraView, fov: number, ground: Ground): { lx: number; lz: number; gy: number; h: number; r: number } {
  const half = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const delta = Math.atan((v.hud[1] - v.hud[0]) * half);
  const h = Math.sin(v.tilt) * v.dist;
  const r = Math.cos(v.tilt) * v.dist;
  const s = h / Math.tan(Math.max(0.05, v.tilt - delta)) - r;
  return { lx: v.fx + Math.sin(v.yaw) * s, lz: v.fz + Math.cos(v.yaw) * s, gy: ground(v.fx, v.fz), h, r };
}

/** Put a camera where a view says (its lens, fov and aspect, as it is). */
export function pose(cam: THREE.PerspectiveCamera, v: CameraView, ground: Ground): void {
  const { lx, lz, gy, h, r } = aim(v, cam.fov, ground);
  cam.position.set(lx + Math.sin(v.yaw) * r, gy + h, lz + Math.cos(v.yaw) * r);
  cam.lookAt(lx, gy, lz);
  cam.updateMatrixWorld(true);
}

const scratch = new THREE.Vector3();

/** A world point on screen through a posed camera (CSS pixels from the canvas corner). */
export function onScreen(cam: THREE.PerspectiveCamera, p: THREE.Vector3, size: Size): Pt {
  scratch.copy(p).project(cam);
  return { x: ((scratch.x + 1) / 2) * size.width, y: ((1 - scratch.y) / 2) * size.height };
}

/** Where a screen point (CSS pixels from the canvas corner) meets the ground, or null off it. */
export function hitGround(cam: THREE.PerspectiveCamera, at: Pt, size: Size, ground: Ground, far = 400): THREE.Vector3 | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((at.x / size.width) * 2 - 1, -(at.y / size.height) * 2 + 1), cam);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  const below = (s: number) => o.y + d.y * s <= ground(o.x + d.x * s, o.z + d.z * s);
  // March along the ray to the heightfield, then refine between the last two samples.
  let prev = 0;
  for (let s = 0; s < far; s += 0.25) {
    if (below(s)) {
      let lo = prev;
      let hi = s;
      for (let i = 0; i < 10; i++) {
        const m = (lo + hi) / 2;
        if (below(m)) hi = m;
        else lo = m;
      }
      return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
    }
    prev = s;
  }
  return null;
}

/**
 * The view that puts each pinned ground point under its screen point: the focus always, the heading
 * and the distance when `free` lets them change; the tilt and the HUD band are held. Least squares
 * from `v`, so a small move of the fingers is a small move of the camera. Where no view fits
 * (perspective, the zoom range, the field's edge) the error grows smoothly: past the zoom range the
 * distance stops at its limit and the focus and heading take up the rest; past the field's edge the
 * focus stops there and the ground slides under the fingers (the map never turns or zooms to make up
 * for a drag it cannot follow).
 */
export function solve(
  cam: THREE.PerspectiveCamera,
  v: CameraView,
  pins: readonly THREE.Vector3[],
  to: readonly Pt[],
  free: { turn?: boolean; zoom?: boolean },
  limits: Limits,
  ground: Ground,
  size: Size,
): CameraView {
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const fit = (start: CameraView, turn: boolean, zoom: boolean): CameraView => {
    const base = [start.fx, start.fz, start.yaw, Math.log(start.dist)];
    const params = [0, 1, ...(turn ? [2] : []), ...(zoom ? [3] : [])];
    const view = (x: readonly number[]): CameraView => {
      const p = [...base];
      params.forEach((j, i) => (p[j] = x[i]!));
      return { ...start, fx: p[0]!, fz: p[1]!, yaw: p[2]!, dist: Math.exp(p[3]!) };
    };
    const residuals = (x: readonly number[]) => {
      pose(cam, view(x), ground);
      return pins.flatMap((pin, i) => {
        const s = onScreen(cam, pin, size);
        return [s.x - to[i]!.x, s.y - to[i]!.y];
      });
    };
    return view(leastSquares(params.map((j) => base[j]!), residuals, params.map((j) => (j < 2 ? 0.002 : 0.0005))));
  };
  let s = fit(v, !!free.turn, !!free.zoom);
  const dist = clamp(s.dist, limits.minDist, Math.max(limits.minDist, limits.maxDist));
  if (dist !== s.dist) s = fit({ ...s, dist }, !!free.turn, false);
  return { ...s, fx: clamp(s.fx, 0, limits.w), fz: clamp(s.fz, 0, limits.h) };
}

/**
 * Least squares by Levenberg-Marquardt with finite differences: the `x` that brings the residuals
 * of `f` nearest zero, from a start near the answer. `step` is the difference step per parameter.
 * For a handful of parameters.
 */
export function leastSquares(x0: readonly number[], f: (x: readonly number[]) => number[], step: readonly number[], iterations = 8): number[] {
  let x = [...x0];
  let r = f(x);
  let cost = r.reduce((s, e) => s + e * e, 0);
  let damp = 1e-3;
  for (let it = 0; it < iterations && cost > 1e-6; it++) {
    // The Jacobian, a column per parameter.
    const cols = x.map((_, j) => {
      const xe = [...x];
      xe[j] = xe[j]! + step[j]!;
      return f(xe).map((e, i) => (e - r[i]!) / step[j]!);
    });
    const A = cols.map((cj) => cols.map((ck) => cj.reduce((s, e, i) => s + e * ck[i]!, 0)));
    const g = cols.map((cj) => cj.reduce((s, e, i) => s + e * r[i]!, 0));
    let better = false;
    for (let tries = 0; tries < 5 && !better; tries++) {
      const d = solveLinear(
        A.map((row, j) => row.map((e, k) => (j === k ? e + damp * Math.max(e, 1e-6) : e))),
        g.map((e) => -e),
      );
      const xn = d ? x.map((e, j) => e + d[j]!) : null;
      const rn = xn ? f(xn) : null;
      const cn = rn ? rn.reduce((s, e) => s + e * e, 0) : Infinity;
      if (xn && rn && cn < cost) {
        x = xn;
        r = rn;
        cost = cn;
        damp = Math.max(1e-7, damp / 3);
        better = true;
      } else damp *= 4;
    }
    if (!better) break;
  }
  return x;
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = c + 1; r < n; r++) {
      const k = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= n; j++) m[r]![j] = m[r]![j]! - k * m[c]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let j = r + 1; j < n; j++) s -= m[r]![j]! * x[j]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/** The largest distance (CSS pixels) between a pinned point on screen and its touch, for a view. */
export function anchorError(cam: THREE.PerspectiveCamera, v: CameraView, pins: readonly THREE.Vector3[], to: readonly Pt[], ground: Ground, size: Size): number {
  pose(cam, v, ground);
  return Math.max(0, ...pins.map((pin, i) => {
    const s = onScreen(cam, pin, size);
    return Math.hypot(s.x - to[i]!.x, s.y - to[i]!.y);
  }));
}
