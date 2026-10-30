import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { aim, anchorError, hitGround, leastSquares, onScreen, pose, solve, type CameraView, type Ground, type Limits, type Size } from './camera-math';
import { TwoFingers, type Pt } from './gestures';

// The two-finger anchoring invariant, measured. Two fingers land on the field, the ground under
// each is pinned, and the fingers twist, pinch and pan together in small steps, as a hand does;
// after every step the solve moves the camera, and the error is how far (CSS pixels) each pinned
// point is drawn from its finger. Across zoom levels, headings, the tilt range, portrait and
// landscape screens, HUD bands of several heights and rolling ground it must stay within 4 px.
// Where no camera fits (the zoom limits, the field's edge) the error grows smoothly instead.

const deg = (d: number) => (d * Math.PI) / 180;
const flat: Ground = () => 0;
/** Rolling ground, about the battle's relief (a level is 0.4 world units). */
const hills: Ground = (x, z) => 0.6 + 0.6 * Math.sin(x / 3.1) * Math.cos(z / 4.3);
const LIMITS: Limits = { minDist: 3.5, maxDist: 120, w: 30, h: 45 };
const PHONE: Size = { width: 393, height: 852 };
const BASE: CameraView = { fx: 15, fz: 30, yaw: 0, tilt: deg(42), dist: 11.5, hud: [0.12, 0.3] };

function lens(size: Size): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(40, size.width / size.height, 0.1, 400);
  cam.updateProjectionMatrix();
  return cam;
}

const p95 = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] ?? 0;

interface Run {
  /** Anchoring error after each step (px). */
  errors: number[];
  /** How far the ground between the pins moved on screen per step, over how far the fingers moved (a jump shows as a large ratio). */
  jump: number;
  start: CameraView;
  end: CameraView;
}

/**
 * Fingers on two points of the field, then turned by `turn`, spread by `scale` and moved by `pan`
 * about their midpoint over `steps` steps, the camera solved after each.
 */
function gesture(size: Size, view: CameraView, ground: Ground, o: { turn?: number; scale?: number; pan?: Pt; steps?: number; a?: Pt; b?: Pt; free?: { turn: boolean; zoom: boolean } } = {}): Run {
  const cam = lens(size);
  const top = view.hud[0] * size.height;
  const bottom = (1 - view.hud[1]) * size.height;
  const a0 = o.a ?? { x: size.width * 0.34, y: top + (bottom - top) * 0.58 };
  const b0 = o.b ?? { x: size.width * 0.66, y: top + (bottom - top) * 0.42 };
  pose(cam, view, ground);
  const pa = hitGround(cam, a0, size, ground);
  const pb = hitGround(cam, b0, size, ground);
  if (!pa || !pb) throw new Error('a finger is off the field');
  const pins = [pa, pb];
  const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const steps = o.steps ?? 48;
  const turn = o.turn ?? deg(50);
  const scale = o.scale ?? 1.5;
  const pan = o.pan ?? { x: 40, y: -30 };
  const errors: number[] = [];
  let jump = 0;
  let v = view;
  let was = [a0, b0];
  pose(cam, v, ground);
  let midWas = onScreen(cam, mid, size);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const th = turn * f;
    const s = Math.pow(scale, f);
    const at = (p: Pt): Pt => {
      const dx = p.x - m0.x;
      const dy = p.y - m0.y;
      return { x: m0.x + pan.x * f + s * (dx * Math.cos(th) - dy * Math.sin(th)), y: m0.y + pan.y * f + s * (dx * Math.sin(th) + dy * Math.cos(th)) };
    };
    const to = [at(a0), at(b0)];
    v = solve(cam, v, pins, to, o.free ?? { turn: true, zoom: true }, LIMITS, ground, size);
    errors.push(anchorError(cam, v, pins, to, ground, size));
    const fingers = Math.max(...to.map((p, i) => Math.hypot(p.x - was[i]!.x, p.y - was[i]!.y)));
    const m = onScreen(cam, mid, size);
    jump = Math.max(jump, Math.hypot(m.x - midWas.x, m.y - midWas.y) / Math.max(0.5, fingers));
    midWas = m;
    was = to;
  }
  return { errors, jump, start: view, end: v };
}

const table: { config: string; max: number; p95: number; steps: number }[] = [];
afterAll(() => {
  // The measured error per configuration, for the record.
  console.log(['Two-finger anchoring error (CSS px)', ...table.map((r) => `${r.config.padEnd(46)} max ${r.max.toFixed(3).padStart(7)}  p95 ${r.p95.toFixed(3).padStart(7)}  (${r.steps} steps)`)].join('\n'));
});

function expectAnchored(config: string, r: Run) {
  table.push({ config, max: Math.max(...r.errors), p95: p95(r.errors), steps: r.errors.length });
  expect(Math.max(...r.errors), `${config}: worst error`).toBeLessThanOrEqual(4);
  expect(r.jump, `${config}: the ground between the fingers never jumps`).toBeLessThan(4);
}

describe('camera model', () => {
  it('puts the focus in the middle of the band between the HUD bars (flat ground)', () => {
    for (const hud of [[0, 0], [0.12, 0.26], [0.12, 0.45], [0.2, 0.55]] as const)
      for (const tilt of [28, 42, 64, 82])
        for (const yaw of [0, 1.1, -2.4]) {
          const cam = lens(PHONE);
          const v = { ...BASE, hud, tilt: deg(tilt), yaw };
          pose(cam, v, flat);
          const s = onScreen(cam, new THREE.Vector3(v.fx, 0, v.fz), PHONE);
          expect(Math.abs(s.x - PHONE.width / 2)).toBeLessThan(0.01);
          expect(Math.abs(s.y - ((hud[0] + 1 - hud[1]) / 2) * PHONE.height)).toBeLessThan(0.5);
        }
  });

  it('north-up looks up the field (toward -z), and a larger heading turns the map clockwise', () => {
    const cam = lens(PHONE);
    pose(cam, BASE, flat);
    const here = onScreen(cam, new THREE.Vector3(15, 0, 30), PHONE);
    const ahead = onScreen(cam, new THREE.Vector3(15, 0, 25), PHONE);
    expect(ahead.y).toBeLessThan(here.y);
    expect(Math.abs(ahead.x - here.x)).toBeLessThan(0.01);
    pose(cam, { ...BASE, yaw: deg(30) }, flat);
    const h2 = onScreen(cam, new THREE.Vector3(15, 0, 30), PHONE);
    const a2 = onScreen(cam, new THREE.Vector3(15, 0, 25), PHONE);
    // North now leans to the right of up: turned clockwise.
    expect(a2.x).toBeGreaterThan(h2.x);
  });

  it('finds the ground under a screen point where the point is drawn', () => {
    const cam = lens(PHONE);
    const v = { ...BASE, yaw: 0.7, tilt: deg(55) };
    pose(cam, v, hills);
    for (const [x, z] of [
      [12, 28],
      [17.5, 33.2],
      [9, 22],
    ] as const) {
      const p = new THREE.Vector3(x, hills(x, z), z);
      const hit = hitGround(cam, onScreen(cam, p, PHONE), PHONE, hills);
      expect(hit).not.toBeNull();
      expect(hit!.distanceTo(p)).toBeLessThan(0.02);
    }
  });

  it('the stage draws with the same model: the look point is the focus moved along the heading', () => {
    const a = aim({ ...BASE, hud: [0.1, 0.1] }, 40, flat);
    expect(Math.hypot(a.lx - BASE.fx, a.lz - BASE.fz)).toBeLessThan(1e-9);
    const b = aim({ ...BASE, hud: [0.1, 0.4] }, 40, flat);
    // A taller bottom bar: the look point moves toward the eye (south of the focus at heading 0), so the focus rises on screen.
    expect(b.lz).toBeGreaterThan(BASE.fz);
  });
});

describe('two-finger anchoring through twist, pinch and pan', () => {
  it('across zoom levels', () => {
    for (const dist of [4.5, 11.5, 30, 80]) expectAnchored(`zoom: distance ${dist}`, gesture(PHONE, { ...BASE, dist }, hills, { scale: dist < 8 ? 1 / 1.5 : 1.5 }));
  });

  it('across headings', () => {
    for (const yaw of [0, 45, 135, -110]) expectAnchored(`heading ${yaw} deg`, gesture(PHONE, { ...BASE, yaw: deg(yaw) }, hills));
  });

  it('across the tilt range', () => {
    for (const tilt of [28, 42, 64, 82]) expectAnchored(`tilt ${tilt} deg`, gesture(PHONE, { ...BASE, tilt: deg(tilt) }, hills));
  });

  it('on portrait and landscape screens', () => {
    for (const size of [
      { width: 375, height: 667 },
      { width: 393, height: 852 },
      { width: 440, height: 956 },
      { width: 852, height: 393 },
      { width: 956, height: 440 },
    ])
      expectAnchored(`screen ${size.width}x${size.height}`, gesture(size, BASE, hills));
  });

  it('with the bottom card at different heights', () => {
    for (const hud of [[0, 0], [0.12, 0.26], [0.12, 0.45], [0.2, 0.55]] as const) expectAnchored(`HUD band ${hud[0]} / ${hud[1]}`, gesture(PHONE, { ...BASE, hud }, hills));
  });

  it('on flat ground, both twist directions, and a twist of a half turn', () => {
    expectAnchored('flat ground', gesture(PHONE, BASE, flat));
    expectAnchored('twist anticlockwise 70 deg', gesture(PHONE, BASE, hills, { turn: deg(-70) }));
    expectAnchored('twist 180 deg in 96 steps', gesture(PHONE, BASE, hills, { turn: deg(180), scale: 1, pan: { x: 0, y: 0 }, steps: 96 }));
  });

  it('in mixed settings', () => {
    // A fixed spread of mixed settings (deterministic, no random draw).
    const sizes = [
      { width: 375, height: 667 },
      { width: 852, height: 393 },
      { width: 440, height: 956 },
    ];
    for (let i = 0; i < 12; i++) {
      const size = sizes[i % 3]!;
      const v: CameraView = { fx: 8 + ((i * 7) % 15), fz: 12 + ((i * 11) % 22), yaw: deg(-170 + i * 31), tilt: deg(30 + ((i * 13) % 50)), dist: 6 + ((i * 17) % 40), hud: [0.05 + (i % 3) * 0.06, 0.15 + (i % 4) * 0.1] };
      const label = `mixed ${size.width}x${size.height} yaw ${Math.round((v.yaw * 180) / Math.PI)} tilt ${Math.round((v.tilt * 180) / Math.PI)} dist ${v.dist}`;
      expectAnchored(label, gesture(size, v, i % 2 ? hills : flat, { turn: deg(i % 2 ? 40 : -35), scale: i % 3 ? 1.4 : 1 / 1.3 }));
    }
  });

  it('the map turns with the fingers: a clockwise twist turns the heading clockwise', () => {
    const r = gesture(PHONE, BASE, flat, { turn: deg(40), scale: 1, pan: { x: 0, y: 0 } });
    expect(r.end.yaw - r.start.yaw).toBeGreaterThan(deg(30));
    const l = gesture(PHONE, BASE, flat, { turn: deg(-40), scale: 1, pan: { x: 0, y: 0 } });
    expect(l.end.yaw - l.start.yaw).toBeLessThan(deg(-30));
  });
});

describe('where no camera fits', () => {
  it('past the closest zoom the error grows smoothly and the distance stops at the limit', () => {
    const r = gesture(PHONE, { ...BASE, dist: 4.2 }, hills, { turn: 0, scale: 2, pan: { x: 0, y: 0 } });
    table.push({ config: 'pinch past the closest zoom (infeasible)', max: Math.max(...r.errors), p95: p95(r.errors), steps: r.errors.length });
    expect(r.end.dist).toBeCloseTo(LIMITS.minDist, 3);
    expect(Math.max(...r.errors)).toBeGreaterThan(4);
    for (let i = 1; i < r.errors.length; i++) expect(Math.abs(r.errors[i]! - r.errors[i - 1]!)).toBeLessThan(4);
    expect(r.jump).toBeLessThan(4);
  });

  it('at the edge of the field the error grows smoothly and the focus stops at the edge', () => {
    const r = gesture(PHONE, { ...BASE, fx: 1.5, dist: 20 }, hills, { turn: 0, scale: 1, pan: { x: 420, y: 0 }, steps: 60 });
    table.push({ config: 'drag past the field edge (infeasible)', max: Math.max(...r.errors), p95: p95(r.errors), steps: r.errors.length });
    expect(r.end.fx).toBeCloseTo(0, 3);
    // The fingers move 7 px a step: the error never grows faster than twice that.
    for (let i = 1; i < r.errors.length; i++) expect(Math.abs(r.errors[i]! - r.errors[i - 1]!)).toBeLessThan(14);
    expect(r.jump).toBeLessThan(4);
  });

  it('one finger with only the focus free keeps its ground under it', () => {
    const cam = lens(PHONE);
    pose(cam, BASE, hills);
    const a0 = { x: 150, y: 500 };
    const pin = hitGround(cam, a0, PHONE, hills)!;
    let v = BASE;
    const errors: number[] = [];
    for (let k = 1; k <= 40; k++) {
      const to = { x: a0.x + k * 4, y: a0.y - k * 3 };
      v = solve(cam, v, [pin], [to], {}, LIMITS, hills, PHONE);
      errors.push(anchorError(cam, v, [pin], [to], hills, PHONE));
    }
    table.push({ config: 'one-finger drag', max: Math.max(...errors), p95: p95(errors), steps: errors.length });
    expect(Math.max(...errors)).toBeLessThanOrEqual(4);
    expect(v.yaw).toBe(BASE.yaw);
    expect(v.dist).toBe(BASE.dist);
  });
});

describe('with the gesture dead zones (gestures.ts)', () => {
  /** Real finger positions through TwoFingers, the camera solved for its targets. */
  function throughDeadZones(fingers: (k: number) => [Pt, Pt], steps: number) {
    const cam = lens(PHONE);
    pose(cam, BASE, hills);
    const [a0, b0] = fingers(0);
    const pins = [hitGround(cam, a0, PHONE, hills)!, hitGround(cam, b0, PHONE, hills)!];
    const two = new TwoFingers(a0, b0);
    let v = BASE;
    const toTargets: number[] = [];
    const toFingers: number[] = [];
    for (let k = 1; k <= steps; k++) {
      const f = fingers(k);
      const step = two.move(f[0], f[1]);
      if (step.kind !== 'map') continue;
      v = solve(cam, v, pins, [step.a, step.b], { turn: true, zoom: true }, LIMITS, hills, PHONE);
      toTargets.push(anchorError(cam, v, pins, [step.a, step.b], hills, PHONE));
      toFingers.push(anchorError(cam, v, pins, f, hills, PHONE));
    }
    return { v, toTargets, toFingers };
  }
  const around = (m: Pt, r: number, a: number): [Pt, Pt] => [
    { x: m.x - r * Math.cos(a), y: m.y - r * Math.sin(a) },
    { x: m.x + r * Math.cos(a), y: m.y + r * Math.sin(a) },
  ];

  it('a plain two-finger drag keeps both points exactly under the fingers, turning the map only a hair', () => {
    const r = throughDeadZones((k) => around({ x: 196 - k * 2, y: 430 + k * 1.5 }, 70, 0), 40);
    table.push({ config: 'two-finger drag through the dead zones', max: Math.max(...r.toFingers), p95: p95(r.toFingers), steps: r.toFingers.length });
    expect(Math.max(...r.toFingers)).toBeLessThanOrEqual(4);
    expect(Math.abs(r.v.yaw)).toBeLessThan(deg(4));
  });

  it('a pinch with a small unmeant turn zooms but does not turn the map', () => {
    // Fingers spread to 1.6 times apart while turning 8 degrees (inside the 12 degree dead zone).
    const r = throughDeadZones((k) => around({ x: 196, y: 430 }, 60 * Math.pow(1.6, k / 40), deg(8 * (k / 40))), 40);
    expect(r.v.dist).toBeLessThan(BASE.dist / 1.4);
    expect(Math.abs(r.v.yaw)).toBeLessThan(deg(1.5));
    expect(Math.max(...r.toTargets)).toBeLessThanOrEqual(4);
  });

  it('a twist past the dead zone catches up with the fingers, then holds the ground under them', () => {
    const steps = 60;
    const r = throughDeadZones((k) => around({ x: 196, y: 430 }, 80 * Math.pow(1.3, k / steps), deg(60 * (k / steps))), steps);
    // Caught up once the fingers have turned twice the dead zone (24 degrees, step 24) and spread 10%.
    const after = r.toFingers.slice(26);
    table.push({ config: 'twist 60 + pinch 1.3 through dead zones (caught up)', max: Math.max(...after), p95: p95(after), steps: after.length });
    expect(Math.max(...after)).toBeLessThanOrEqual(4);
    expect(Math.max(...r.toTargets)).toBeLessThanOrEqual(4);
    expect(r.v.yaw).toBeGreaterThan(deg(50));
  });
});

describe('least squares', () => {
  it('solves a small nonlinear system and stops at the best fit when it cannot be met', () => {
    const exact = leastSquares([1, 1], ([x, y]) => [x! * x! - 4, x! + y! - 5], [1e-4, 1e-4]);
    expect(exact[0]).toBeCloseTo(2, 4);
    expect(exact[1]).toBeCloseTo(3, 4);
    // Two wishes for one number: the best fit is their mean.
    const fit = leastSquares([0], ([x]) => [x! - 1, x! - 3], [1e-4]);
    expect(fit[0]).toBeCloseTo(2, 4);
  });
});
