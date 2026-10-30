import * as THREE from 'three';

// Lines of sight from a cell, for a long-press on the field: solid to each enemy the selected unit
// could hit from there, dashed to each it could only see, and a ring on the cell. Drawn over the
// field (no depth test) so a hill or a roof between the eye and the camera never hides them.

export interface ProbeLine {
  to: THREE.Vector3;
  /** It could fire on it from there (else it could only see it). */
  shot: boolean;
}

const THICK = 0.035;
const DASH = 0.32;
const GAP = 0.22;

export class SightProbe {
  private readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly lines: THREE.Mesh;
  private readonly dashes: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const mat = (opacity: number) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 40).rotateX(-Math.PI / 2), mat(0.95));
    this.lines = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.95));
    this.dashes = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.75));
    for (const m of [this.ring, this.lines, this.dashes]) {
      m.renderOrder = 7;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Show the lines from `from` (the eye over the cell), or hide them all (null). */
  set(from: THREE.Vector3 | null, lines: readonly ProbeLine[]): void {
    this.group.visible = !!from;
    if (!from) return;
    this.ring.position.set(from.x, from.y - 0.3, from.z);
    const solid: number[] = [];
    const dashed: number[] = [];
    for (const l of lines) {
      if (l.shot) prism(solid, from, l.to);
      else {
        const d = l.to.clone().sub(from);
        const n = d.length();
        for (let s = 0; s < n; s += DASH + GAP) prism(dashed, from.clone().addScaledVector(d, s / n), from.clone().addScaledVector(d, Math.min(n, s + DASH) / n));
      }
    }
    this.fill(this.lines, solid);
    this.fill(this.dashes, dashed);
  }

  private fill(mesh: THREE.Mesh, pos: number[]): void {
    mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    mesh.geometry = g;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of [this.ring, this.lines, this.dashes]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** A thin square tube from `a` to `b`, as triangles. */
function prism(out: number[], a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = b.clone().sub(a);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(THICK);
  const w = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(THICK);
  const corners = [u.clone().add(w), u.clone().sub(w), u.clone().negate().sub(w), u.clone().negate().add(w)];
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i]!;
    const c1 = corners[(i + 1) % 4]!;
    const p = [a.clone().add(c0), b.clone().add(c0), b.clone().add(c1), a.clone().add(c1)];
    for (const k of [0, 1, 2, 0, 2, 3]) out.push(p[k]!.x, p[k]!.y, p[k]!.z);
  }
}
