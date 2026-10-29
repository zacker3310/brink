import * as THREE from 'three';
import { Parts, S, T, box, cyl, lathe, shade, type Style, type V2 } from './kit';
import { paintMaterial } from './paint';

// Projectiles and loitering munitions, real size x METRE, nose to +z: an FPV quadcopter with an RPG
// warhead strapped under it, the Switchblade 600, the Lancet, an ATGM, an unguided rocket and a shell.

export type ProjectileKind = 'fpv' | 'switchblade' | 'lancet' | 'atgm' | 'rocket' | 'shell';

const cache = new Map<ProjectileKind, THREE.BufferGeometry>();
let material: THREE.MeshStandardMaterial | null = null;

/** A body of revolution along +z from a (radius, z) profile. */
function body(p: Parts, prof: V2[], style: Style, segs = 10, m = T()): void {
  p.add(lathe(prof, segs, 'z'), { ...style, crease: 50 }, m);
}

/** A thin flat wing panel in the frame's xz plane: root chord at x = 0, tip at x = span. */
function panel(p: Parts, span: number, root: number, tip: number, sweep: number, t: number, style: Style, m: THREE.Matrix4): void {
  const shape = new THREE.Shape([new THREE.Vector2(0, root / 2), new THREE.Vector2(span, root / 2 - sweep), new THREE.Vector2(span, root / 2 - sweep - tip), new THREE.Vector2(0, -root / 2)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  // Shape (x, y) to (x, z), thickness along y.
  g.rotateX(Math.PI / 2);
  g.translate(0, t / 2, 0);
  p.add(g, style, m);
}

function build(kind: ProjectileKind): THREE.BufferGeometry {
  const p = new Parts(0);
  if (kind === 'fpv') {
    // A 7 inch carbon quad: X frame, four motors and props, battery on top, the PG-7VL warhead slung under.
    for (const a of [Math.PI / 4, -Math.PI / 4]) p.add(box(0.36, 0.008, 0.025), S.black, T(0, 0, 0, 0, a, 0));
    p.add(box(0.07, 0.03, 0.12), S.black, T(0, 0.02, 0));
    p.add(box(0.05, 0.035, 0.11), solidStyle(0x2c3b52), T(0, 0.05, -0.01));
    for (const [x, z] of [[0.127, 0.127], [-0.127, 0.127], [0.127, -0.127], [-0.127, -0.127]] as const) {
      p.add(cyl(0.014, 0.014, 0.02, 6), S.gunsteel, T(x, 0.014, z));
      p.add(box(0.17, 0.003, 0.016), S.black, T(x, 0.027, z, 0, x * z > 0 ? 0.6 : -0.6, 0));
    }
    // PG-7VL: the warhead cone and its fuze, pointing forward under the frame.
    body(p, [[0.001, -0.18], [0.035, -0.18], [0.035, -0.02], [0.047, 0.03], [0.047, 0.1], [0.012, 0.24], [0.006, 0.28], [0.001, 0.28]], solidStyle(0x55603c), 10, T(0, -0.045, 0.02));
    p.add(box(0.02, 0.012, 0.06), S.black, T(0, -0.005, 0.02));
  } else if (kind === 'switchblade') {
    // Tube body, two pairs of pop-out wings in tandem, a twin fin and the pusher prop.
    body(p, [[0.001, -0.62], [0.06, -0.6], [0.065, -0.4], [0.065, 0.45], [0.05, 0.58], [0.001, 0.64]], shade(0.8), 12);
    for (const s of [1, -1]) {
      panel(p, 0.48, 0.09, 0.07, 0.03, 0.006, shade(0.85), T(s * 0.05, 0.04, 0.32, 0, 0, s > 0 ? 0.06 : Math.PI - 0.06));
      panel(p, 0.52, 0.1, 0.08, 0.04, 0.006, shade(0.85), T(s * 0.05, -0.03, -0.35, 0, 0, s > 0 ? -0.04 : Math.PI + 0.04));
      p.add(box(0.005, 0.1, 0.08), shade(0.85), T(s * 0.04, -0.07, -0.5, 0, 0, s * 0.4));
    }
    p.add(box(0.3, 0.012, 0.03), S.black, T(0, 0, -0.65));
  } else if (kind === 'lancet') {
    // Cylindrical body with two cruciform (X) wing sets, front and rear, and a pusher prop.
    body(p, [[0.001, -0.78], [0.07, -0.74], [0.09, -0.5], [0.09, 0.55], [0.07, 0.75], [0.001, 0.85]], shade(0.85), 12);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      panel(p, 0.4, 0.22, 0.12, 0.08, 0.008, shade(0.88), T(0, 0, 0.28, 0, 0, a).multiply(T(0.08, 0, 0)));
      panel(p, 0.48, 0.26, 0.14, 0.1, 0.008, shade(0.88), T(0, 0, -0.48, 0, 0, a).multiply(T(0.08, 0, 0)));
    }
    p.add(box(0.32, 0.014, 0.035), S.black, T(0, 0, -0.8));
    p.add(lathe([[0.001, -0.02], [0.04, 0], [0.001, 0.04]], 8, 'z'), S.lens, T(0, -0.06, 0.62));
  } else if (kind === 'atgm') {
    // A wire- or laser-guided missile in flight: body, nose, four tail fins, four canards.
    body(p, [[0.001, -0.55], [0.065, -0.55], [0.068, 0.35], [0.05, 0.5], [0.02, 0.58], [0.001, 0.6]], shade(0.82), 10);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      panel(p, 0.12, 0.16, 0.08, 0.06, 0.004, shade(0.8), T(0, 0, -0.42, 0, 0, a).multiply(T(0.06, 0, 0)));
      panel(p, 0.06, 0.06, 0.04, 0.02, 0.004, shade(0.8), T(0, 0, 0.32, 0, 0, a).multiply(T(0.06, 0, 0)));
    }
    p.add(cyl(0.045, 0.05, 0.03, 8, 'z'), S.black, T(0, 0, -0.56));
  } else if (kind === 'rocket') {
    // Hydra 70 / S-8: slim tube, ogive, wrap-around fins.
    body(p, [[0.001, -0.75], [0.035, -0.75], [0.036, 0.4], [0.03, 0.58], [0.012, 0.72], [0.001, 0.75]], shade(0.82), 8);
    for (let i = 0; i < 4; i++) panel(p, 0.08, 0.12, 0.08, 0.03, 0.003, S.gunsteel, T(0, 0, -0.66, 0, 0, (i * Math.PI) / 2).multiply(T(0.034, 0, 0)));
  } else {
    // A 152/155 mm HE shell in flight: ogive nose, driving band, boat tail.
    body(
      p,
      [
        [0.001, -0.35],
        [0.06, -0.35],
        [0.075, -0.28],
        [0.078, -0.24],
        [0.08, -0.22],
        [0.078, -0.2],
        [0.077, 0.08],
        [0.06, 0.24],
        [0.03, 0.34],
        [0.015, 0.38],
        [0.001, 0.4],
      ],
      solidStyle(0x58603f),
      12,
    );
    body(p, [[0.0786, -0.24], [0.0806, -0.22], [0.0786, -0.2]], solidStyle(0x8a5a2e, { metal: 0.7, rough: 0.4 }), 12);
  }
  const g = p.build()!;
  return g;
}

function solidStyle(tint: number, extra: Partial<Style> = {}): Style {
  return { tint, paint: 0, ...extra };
}

/** A projectile or loitering munition (shared geometry and material). */
export function buildProjectile(kind: ProjectileKind): THREE.Object3D {
  let g = cache.get(kind);
  if (!g) {
    g = build(kind);
    cache.set(kind, g);
  }
  material ??= paintMaterial({ scheme: 'drone_grey', dust: 0 });
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.name = kind;
  const o = new THREE.Group();
  o.add(m);
  return o;
}

