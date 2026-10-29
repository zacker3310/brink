import * as THREE from 'three';
import { GRAVITY } from './palette';

// Thrown earth, rubble and metal: one instanced mesh of faceted chunks on ballistic arcs that
// bounce and settle, then sink away. Projectile bodies (missiles, shells, drones without a model)
// share the mesh, so all of it is one draw call.

function chunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position!;
  // The same lumpy shape every time: jitter each corner by its position (corners are shared by faces).
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 0.7 + 0.5 * (h - Math.floor(h));
    p.setXYZ(i, x * k, y * k * 0.7, z * k);
  }
  g.computeVertexNormals();
  return g;
}

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private limit: number;
  private n = 0;
  private bodies = 0;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly rx: Float32Array;
  private readonly ry: Float32Array;
  private readonly rz: Float32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wz: Float32Array;
  private readonly size: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly col: Float32Array;
  private readonly rest: Uint8Array;
  private readonly fields: Float32Array[];
  /** Chunks still in the air. */
  flying = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly mRange = { start: 0, count: 0 };
  private readonly cRange = { start: 0, count: 0 };

  constructor(cap: number, limit: number) {
    this.cap = cap;
    this.limit = Math.min(cap, limit);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.05, flatShading: true });
    this.mesh = new THREE.InstancedMesh(chunkGeometry(), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.rx = f();
    this.ry = f();
    this.rz = f();
    this.wx = f();
    this.wy = f();
    this.wz = f();
    this.size = f();
    this.age = f();
    this.life = f();
    this.col = new Float32Array(cap * 3);
    this.rest = new Uint8Array(cap);
    this.fields = [this.x, this.y, this.z, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz, this.size, this.age, this.life];
  }

  setLimit(limit: number): void {
    this.limit = Math.min(this.cap, limit);
    if (this.n > this.limit) this.n = this.limit;
  }

  /** Throw a chunk. Past the budget, the oldest chunk is reused. */
  throw(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, c: readonly number[], shade: number, life: number, r: number): void {
    let i = this.n;
    if (i >= this.limit) {
      let oldest = 0;
      for (let k = 1; k < this.n; k++) if (this.age[k]! / this.life[k]! > this.age[oldest]! / this.life[oldest]!) oldest = k;
      i = oldest;
    } else this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.rx[i] = r * 6.28;
    this.ry[i] = r * 17.1;
    this.rz[i] = r * 3.7;
    this.wx[i] = (r - 0.5) * 22;
    this.wy[i] = (0.5 - r) * 14;
    this.wz[i] = r * 9;
    this.size[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
    this.rest[i] = 0;
    this.col[i * 3] = c[0]! * shade;
    this.col[i * 3 + 1] = c[1]! * shade;
    this.col[i * 3 + 2] = c[2]! * shade;
  }

  /** Start a frame: projectile bodies are written first, then the chunks. */
  begin(): void {
    this.bodies = 0;
  }

  /** A projectile body this frame, stretched along its heading. */
  body(pos: THREE.Vector3, quat: THREE.Quaternion, sx: number, sy: number, sz: number, r: number, g: number, b: number): void {
    if (this.bodies >= 24) return;
    const i = this.bodies++;
    this.s.set(sx, sy, sz);
    this.m.compose(pos, quat, this.s);
    this.m.toArray(this.mesh.instanceMatrix.array, i * 16);
    const c = this.mesh.instanceColor!.array;
    c[i * 3] = r;
    c[i * 3 + 1] = g;
    c[i * 3 + 2] = b;
  }

  update(dt: number, heightAt: (x: number, z: number) => number): void {
    const mat = this.mesh.instanceMatrix.array;
    const colours = this.mesh.instanceColor!.array;
    this.flying = 0;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) continue;
      let x = this.x[i]!;
      let y = this.y[i]!;
      let z = this.z[i]!;
      if (!this.rest[i]) {
        this.flying++;
        let vy = this.vy[i]! - GRAVITY * dt;
        const kd = Math.exp(-0.35 * dt);
        let vx = this.vx[i]! * kd;
        let vz = this.vz[i]! * kd;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        const g = heightAt(x, z) + this.size[i]! * 0.3;
        if (y < g && vy < 0) {
          y = g;
          vy = -vy * 0.3;
          vx *= 0.5;
          vz *= 0.5;
          this.wx[i] = this.wx[i]! * 0.5;
          this.wy[i] = this.wy[i]! * 0.5;
          this.wz[i] = this.wz[i]! * 0.5;
          if (vy < 0.35) this.rest[i] = 1;
        }
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.vz[i] = vz;
        this.rx[i] = this.rx[i]! + this.wx[i]! * dt;
        this.ry[i] = this.ry[i]! + this.wy[i]! * dt;
        this.rz[i] = this.rz[i]! + this.wz[i]! * dt;
      }
      // Compact in place so the live chunks stay at the front.
      if (w !== i) this.copy(i, w);
      this.age[w] = age;
      this.x[w] = x;
      this.y[w] = y;
      this.z[w] = z;
      // Settled chunks sink into the ground over their last second.
      const left = this.life[w]! - age;
      const sink = left < 1 ? left : 1;
      this.e.set(this.rx[w]!, this.ry[w]!, this.rz[w]!);
      this.q.setFromEuler(this.e);
      this.p.set(x, y - (1 - sink) * this.size[w]! * 0.6, z);
      const sz = this.size[w]! * (0.4 + 0.6 * sink);
      this.s.set(sz, sz, sz);
      this.m.compose(this.p, this.q, this.s);
      const o = this.bodies + w;
      this.m.toArray(mat, o * 16);
      colours[o * 3] = this.col[w * 3]!;
      colours[o * 3 + 1] = this.col[w * 3 + 1]!;
      colours[o * 3 + 2] = this.col[w * 3 + 2]!;
      w++;
    }
    this.n = w;
    const total = this.bodies + this.n;
    this.mesh.count = total;
    this.mesh.visible = total > 0;
    if (total > 0) {
      this.mRange.count = total * 16;
      this.cRange.count = total * 3;
      if (this.mesh.instanceMatrix.updateRanges.length === 0) this.mesh.instanceMatrix.updateRanges.push(this.mRange);
      if (this.mesh.instanceColor!.updateRanges.length === 0) this.mesh.instanceColor!.updateRanges.push(this.cRange);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }

  private copy(from: number, to: number): void {
    const fs = this.fields;
    for (let k = 0; k < fs.length; k++) fs[k]![to] = fs[k]![from]!;
    this.rest[to] = this.rest[from]!;
    this.col[to * 3] = this.col[from * 3]!;
    this.col[to * 3 + 1] = this.col[from * 3 + 1]!;
    this.col[to * 3 + 2] = this.col[from * 3 + 2]!;
  }

  clear(): void {
    this.n = 0;
    this.bodies = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
