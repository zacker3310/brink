import * as THREE from 'three';

// A growable triangle soup (position, normal, uv, colour and a per-face random) that the world's
// builders write into, with an optional transform, and turn into BufferGeometry. Ranges let one
// merged mesh hold many cells and hide one later without rebuilding the rest.

export type V3 = [number, number, number];
/** A rectangle in texture space: u0, v0, u1, v1 (v down the canvas: textures here are not flipped). */
export type UVRect = [number, number, number, number];

class Grow {
  data: Float32Array;
  n = 0;
  constructor(size = 4096) {
    this.data = new Float32Array(size);
  }
  push(a: number, b: number, c?: number): void {
    const need = this.n + 3;
    if (need > this.data.length) {
      const next = new Float32Array(Math.max(need, this.data.length * 2));
      next.set(this.data);
      this.data = next;
    }
    this.data[this.n++] = a;
    this.data[this.n++] = b;
    if (c !== undefined) this.data[this.n++] = c;
  }
  view(): Float32Array {
    return this.data.subarray(0, this.n);
  }
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Geo {
  private readonly pos = new Grow();
  private readonly nrm = new Grow();
  private readonly uv = new Grow();
  private readonly col = new Grow();
  private readonly rnd = new Grow();
  private matrix: THREE.Matrix4 | null = null;
  private readonly normalMatrix = new THREE.Matrix3();
  color: V3 = [1, 1, 1];
  /** Per-face random (lit windows pick from it). */
  rand = 0;

  /** Vertices so far. */
  get count(): number {
    return this.pos.n / 3;
  }

  setMatrix(m: THREE.Matrix4 | null): void {
    this.matrix = m;
    if (m) this.normalMatrix.getNormalMatrix(m);
  }

  private vert(p: V3, n: V3, u: number, v: number): void {
    _v.set(p[0], p[1], p[2]);
    _n.set(n[0], n[1], n[2]);
    if (this.matrix) {
      _v.applyMatrix4(this.matrix);
      _n.applyMatrix3(this.normalMatrix).normalize();
    }
    this.pos.push(_v.x, _v.y, _v.z);
    this.nrm.push(_n.x, _n.y, _n.z);
    this.uv.push(u, v);
    this.col.push(this.color[0], this.color[1], this.color[2]);
    this.rnd.push(this.rand, 0);
  }

  /** A triangle with its own face normal (or given per-vertex normals). */
  tri(a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number], normals?: [V3, V3, V3]): void {
    let na: V3;
    let nb: V3;
    let nc: V3;
    if (normals) [na, nb, nc] = normals;
    else {
      _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _a.cross(_b).normalize();
      na = nb = nc = [_a.x, _a.y, _a.z];
    }
    this.vert(a, na, ua[0], ua[1]);
    this.vert(b, nb, ub[0], ub[1]);
    this.vert(c, nc, uc[0], uc[1]);
  }

  /** A quad p0 p1 p2 p3, counter-clockwise seen from its front, mapped to a UV rectangle (p0 at u0,v1). */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, r: UVRect): void {
    const [u0, v0, u1, v1] = r;
    this.tri(p0, p1, p2, [u0, v1], [u1, v1], [u1, v0]);
    this.tri(p0, p2, p3, [u0, v1], [u1, v0], [u0, v0]);
  }

  /**
   * A vertical wall from a to b between heights y0 and y1. A footprint walked (x0,z0), (x1,z0),
   * (x1,z1), (x0,z1) gives walls facing out; u runs left to right seen from outside.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, r: UVRect): void {
    this.quad([bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], r);
  }

  /** An upward-facing horizontal rectangle. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, r: UVRect): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], r);
  }

  /** A box centred on (x, z), standing from y0 to y1; every face gets the same UV rectangle. */
  box(x: number, z: number, sx: number, sz: number, y0: number, y1: number, r: UVRect, bottom = false): void {
    const x0 = x - sx / 2;
    const x1 = x + sx / 2;
    const z0 = z - sz / 2;
    const z1 = z + sz / 2;
    this.wall(x0, z0, x1, z0, y0, y1, r);
    this.wall(x1, z0, x1, z1, y0, y1, r);
    this.wall(x1, z1, x0, z1, y0, y1, r);
    this.wall(x0, z1, x0, z0, y0, y1, r);
    this.flat(x0, z0, x1, z1, y1, r);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], r);
  }

  /** Append another geometry (non-indexed or indexed) with this builder's colour and matrix. */
  add(g: THREE.BufferGeometry, r?: UVRect): void {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.attributes.position!;
    const n = src.attributes.normal;
    const t = src.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const u = t ? t.getX(i) : 0;
      const v = t ? t.getY(i) : 0;
      const uu = r ? r[0] + (r[2] - r[0]) * u : u;
      const vv = r ? r[3] + (r[1] - r[3]) * v : v;
      this.vert([p.getX(i), p.getY(i), p.getZ(i)], n ? [n.getX(i), n.getY(i), n.getZ(i)] : [0, 1, 0], uu, vv);
    }
    if (src !== g) src.dispose();
  }

  /** A copy of the arrays from vertex `start` on (for one cell's chunk). */
  slice(start: number, end = this.count): Chunk {
    return {
      pos: this.pos.data.slice(start * 3, end * 3),
      nrm: this.nrm.data.slice(start * 3, end * 3),
      uv: this.uv.data.slice(start * 2, end * 2),
      col: this.col.data.slice(start * 3, end * 3),
      rnd: this.rnd.data.slice(start * 2, end * 2),
    };
  }

  geometry(): THREE.BufferGeometry {
    return chunkGeometry({ pos: this.pos.view().slice(), nrm: this.nrm.view().slice(), uv: this.uv.view().slice(), col: this.col.view().slice(), rnd: this.rnd.view().slice() });
  }
}

/** One cell's vertices, kept so a merged mesh can be rebuilt or a cell lifted out. */
export interface Chunk {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  rnd: Float32Array;
}

export function chunkGeometry(c: Chunk): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(c.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(c.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(c.col, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(c.rnd, 2));
  g.computeBoundingSphere();
  return g;
}

/** Several chunks in one geometry, with the vertex range of each. */
export function mergeChunks(chunks: { key: number; chunk: Chunk }[]): { geometry: THREE.BufferGeometry; ranges: Map<number, [number, number]> } {
  let n = 0;
  for (const c of chunks) n += c.chunk.pos.length / 3;
  const all: Chunk = { pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3), rnd: new Float32Array(n * 2) };
  const ranges = new Map<number, [number, number]>();
  let at = 0;
  for (const { key, chunk } of chunks) {
    const k = chunk.pos.length / 3;
    all.pos.set(chunk.pos, at * 3);
    all.nrm.set(chunk.nrm, at * 3);
    all.uv.set(chunk.uv, at * 2);
    all.col.set(chunk.col, at * 3);
    all.rnd.set(chunk.rnd, at * 2);
    ranges.set(key, [at, k]);
    at += k;
  }
  return { geometry: chunkGeometry(all), ranges };
}

/** Collapse a vertex range to nothing, so it draws no pixels, without touching the rest. */
export function hideRange(g: THREE.BufferGeometry, start: number, count: number): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const arr = p.array as Float32Array;
  arr.fill(0, start * 3, (start + count) * 3);
  p.addUpdateRange(start * 3, count * 3);
  p.needsUpdate = true;
}

/** A range's vertices as their own geometry (for a building's collapse). */
export function extractRange(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const pick = (name: string, size: number) => (g.attributes[name]!.array as Float32Array).slice(start * size, (start + count) * size);
  return chunkGeometry({ pos: pick('position', 3), nrm: pick('normal', 3), uv: pick('uv', 2), col: pick('color', 3), rnd: pick('aRand', 2) });
}
