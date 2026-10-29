import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ROCK, WALL, WALL_KINDS, type BattleMap, type Biome } from '@brink/arena/v2';
import { Geo, type V3 } from './geom';
import type { Heightfield } from './height';
import { LEAF_UV } from './flora';
import { hash, stream } from './noise';

// Walls, boulders and crater rims. Walls run from each wall cell's centre to its wall neighbours,
// so lines and corners join up; each half-run is one instance of a unit-length piece (hedge,
// dry stone, sandbags, Hesco), pitched to follow the ground. A broken wall slumps to a low heap.

type WallKind = (typeof WALL_KINDS)[number];

const lin = (h: string): V3 => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

/** A unit wall piece from x = 0 to 1 along +x, centred on z = 0. */
function wallPiece(kind: WallKind, biome: Biome, seed: number): THREE.BufferGeometry {
  const g = new Geo();
  const rnd = stream(seed);
  if (kind === 'hedge') {
    const green = lin(biome === 'winter' ? '#5a5246' : biome === 'desert' ? '#6f7050' : biome === 'steppe' ? '#5e6038' : '#45522a');
    const [u0, v0, u1, v1] = LEAF_UV.mass;
    // Lumpy body.
    for (let k = 0; k < 4; k++) {
      const x = 0.12 + k * 0.25 + (rnd() - 0.5) * 0.05;
      const h = 0.13 + rnd() * 0.05;
      const ico = new THREE.IcosahedronGeometry(1, 0);
      const p = ico.attributes.position!;
      for (let i = 0; i < p.count; i += 3) {
        const tri: V3[] = [0, 1, 2].map((n) => [x + p.getX(i + n) * 0.17, Math.max(0, h / 2 + p.getY(i + n) * h * 0.55), p.getZ(i + n) * 0.075] as V3);
        const nr = [0, 1, 2].map((n) => {
          const d = new THREE.Vector3(p.getX(i + n), p.getY(i + n) + 0.4, p.getZ(i + n)).normalize();
          return [d.x, d.y, d.z] as V3;
        }) as [V3, V3, V3];
        const top = (tri[0]![1] + tri[1]![1] + tri[2]![1]) / 3 > h * 0.6;
        g.color = biome === 'winter' && top ? lin('#e3e7e9') : green.map((c) => c * (0.7 + rnd() * 0.5)) as V3;
        g.tri(tri[0]!, tri[1]!, tri[2]!, [u0, v1], [u1, v1], [(u0 + u1) / 2, v0], nr);
      }
      ico.dispose();
    }
  } else if (kind === 'stone') {
    const tones = biome === 'desert' ? ['#a89274', '#968066', '#b8a283'] : biome === 'winter' ? ['#7d7c78', '#8a8883', '#6e6d69'] : ['#8c877c', '#7a766d', '#9a9488', '#6f6b63'];
    for (let row = 0; row < 3; row++) {
      let x = rnd() * 0.05;
      while (x < 1) {
        const w = 0.06 + rnd() * 0.06;
        const h = 0.028 + rnd() * 0.01;
        g.color = lin(tones[Math.floor(rnd() * tones.length)]!);
        g.box(x + w / 2, (rnd() - 0.5) * 0.01, w * 0.95, 0.07 - row * 0.008, row * 0.029, row * 0.029 + h, [0, 0, 0, 0]);
        x += w;
      }
    }
    if (biome === 'winter') {
      g.color = lin('#e2e6e8');
      g.box(0.5, 0, 1, 0.07, 0.087, 0.1, [0, 0, 0, 0]);
    }
  } else if (kind === 'sandbag') {
    // A thick double wall of bags, stepped in toward the top.
    const tones = ['#9a8a62', '#8e8058', '#7d7a5c', '#a39370'];
    for (let row = 0; row < 3; row++)
      for (const side of row < 2 ? [-0.045, 0.045] : [0]) {
        let x = (row % 2) * 0.07;
        while (x < 1) {
          const w = 0.14;
          g.color = lin(tones[Math.floor(rnd() * tones.length)]!);
          const m = new THREE.Matrix4().makeRotationY((rnd() - 0.5) * 0.15).setPosition(x + w / 2, 0, side + (rnd() - 0.5) * 0.01);
          g.setMatrix(m);
          g.box(0, 0, w * 0.97, 0.09 - row * 0.008, row * 0.04, row * 0.04 + 0.042, [0, 0, 0, 0]);
          g.setMatrix(null);
          x += w;
        }
      }
    if (biome === 'winter') {
      g.color = lin('#e2e6e8');
      g.box(0.5, 0, 1, 0.08, 0.128, 0.136, [0, 0, 0, 0]);
    }
  } else {
    // Hesco baskets: wire-mesh boxes of sand.
    for (let k = 0; k < 9; k++) {
      const x = k / 9 + 0.5 / 9;
      g.color = lin(['#8a7f5f', '#93886a', '#81775a'][k % 3]!);
      g.box(x, 0, 1 / 9 - 0.004, 0.13, 0, 0.17, [0, 0, 0, 0]);
      g.color = lin('#5d5848');
      g.box(x - 0.5 / 9, 0, 0.004, 0.134, 0, 0.172, [0, 0, 0, 0]);
    }
  }
  return g.geometry();
}

/** Unit Hesco piece from the model: baked into geometry along +x, one unit long, 0.14 tall. */
function hescoFromModel(gltf: GLTF): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  // Turn the model so its long side runs along x.
  const turn = new THREE.Matrix4();
  if (size.z > size.x) turn.makeRotationY(Math.PI / 2);
  const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  const box = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(turn);
    geo.computeBoundingBox();
    box.union(geo.boundingBox!);
    out.push({ geo, mat: mesh.material as THREE.Material });
  });
  const s = box.getSize(new THREE.Vector3());
  const fit = new THREE.Matrix4().makeScale(1 / s.x, 0.17 / s.y, 0.13 / s.z).multiply(new THREE.Matrix4().makeTranslation(-box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const p of out) p.geo.applyMatrix4(fit);
  return out;
}

function boulder(seed: number, biome: Biome): THREE.BufferGeometry {
  const rnd = stream(seed);
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const p = ico.attributes.position!;
  const jitter = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const base = lin(biome === 'desert' ? '#9a8064' : biome === 'winter' ? '#706f6b' : '#86827a');
  const g = new Geo();
  for (let i = 0; i < p.count; i += 3) {
    const tri = [0, 1, 2].map((n) => {
      const x = p.getX(i + n);
      const y = p.getY(i + n);
      const z = p.getZ(i + n);
      const k = key(x, y, z);
      if (!jitter.has(k)) jitter.set(k, 0.7 + rnd() * 0.5);
      const j = jitter.get(k)!;
      return [x * j, Math.max(-0.25, y * j * 0.75), z * j * (0.8 + 0.2 * Math.abs(x))] as V3;
    });
    const yMean = (tri[0]![1] + tri[1]![1] + tri[2]![1]) / 3;
    const shade = 0.55 + (yMean + 0.3) * 0.45 + rnd() * 0.12;
    g.color = biome === 'winter' && yMean > 0.35 ? lin('#e1e5e7') : (base.map((c) => c * shade) as V3);
    g.tri(tri[0]!, tri[1]!, tri[2]!, [0, 0], [1, 0], [0, 1]);
  }
  ico.dispose();
  return g.geometry();
}

function craterRim(biome: Biome): THREE.BufferGeometry {
  const g = new Geo();
  const earth = lin(biome === 'winter' ? '#5e544a' : biome === 'desert' ? '#9a8566' : '#5f513f');
  const seg = 18;
  const rings = [0, 0.45, 0.72, 0.9, 1.15, 1.45];
  const hts = [-0.4, -0.15, 0.1, 0.13, 0.05, -0.01];
  const rnd = stream(77);
  // A lumpy, broken lip of thrown earth, never a neat ring.
  const lobe = Array.from({ length: seg }, () => 0.75 + rnd() * 0.5);
  const P: V3[][] = rings.map((r, k) =>
    Array.from({ length: seg }, (_, a) => {
      const ang = (a / seg) * Math.PI * 2;
      const rr = r * (k === 0 ? 0 : (0.85 + rnd() * 0.3) * (k >= 3 ? lobe[a]! : 1));
      return [Math.cos(ang) * rr, hts[k]! * (0.4 + rnd() * 1.0) * (k >= 2 ? lobe[a]! : 1), Math.sin(ang) * rr] as V3;
    }),
  );
  for (let k = 0; k < rings.length - 1; k++)
    for (let a = 0; a < seg; a++) {
      const a0 = P[k]![a]!;
      const a1 = P[k]![(a + 1) % seg]!;
      const b0 = P[k + 1]![a]!;
      const b1 = P[k + 1]![(a + 1) % seg]!;
      const shade = k <= 1 ? 0.55 : k === 2 ? 0.9 : 1.05;
      g.color = earth.map((c) => c * shade * (0.85 + rnd() * 0.3)) as V3;
      g.tri(a0, a1, b1, [0, 0], [1, 0], [0, 1]);
      g.tri(a0, b1, b0, [0, 0], [1, 0], [0, 1]);
    }
  return g.geometry();
}

interface WallRef {
  mesh: THREE.InstancedMesh;
  i: number;
  m: THREE.Matrix4;
}

export class Props {
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  readonly tops = new Map<number, number>();
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly walls = new Map<number, WallRef[]>();
  private readonly craters: THREE.InstancedMesh;
  private readonly rocks = new Map<number, WallRef[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly map: BattleMap,
    private readonly hf: Heightfield,
    foliage: THREE.Material,
    private readonly seed: number,
    cast: boolean,
    hesco?: GLTF,
  ) {
    const biome = map.biome;
    // Wall runs.
    type Run = { cell: number; kind: WallKind; ax: number; az: number; bx: number; bz: number };
    const runs: Run[] = [];
    const isWall = (x: number, y: number) => x >= 0 && y >= 0 && x < map.w && y < map.h && map.cells[y * map.w + x] === WALL;
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const i = y * map.w + x;
        if (map.cells[i] !== WALL) continue;
        const kind = WALL_KINDS[(map.variant[i] ?? 0) & 3]!;
        const cx = x + 0.5;
        const cz = y + 0.5;
        let any = false;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as const) {
          if (!isWall(x + dx, y + dy)) continue;
          if (dx !== 0 && dy !== 0 && (isWall(x + dx, y) || isWall(x, y + dy))) continue;
          runs.push({ cell: i, kind, ax: cx, az: cz, bx: cx + dx * 0.5, bz: cz + dy * 0.5 });
          any = true;
        }
        if (!any) {
          // A lone wall: a short line across the cell, facing the enemy's side of the field.
          const along = hash(seed, i, 3) < 0.8;
          runs.push({ cell: i, kind, ax: cx - (along ? 0.45 : 0), az: cz - (along ? 0 : 0.45), bx: cx + (along ? 0.45 : 0), bz: cz + (along ? 0 : 0.45) });
        }
        this.tops.set(i, hf.at(cx, cz) + (kind === 'hedge' ? 0.18 : kind === 'hesco' ? 0.17 : kind === 'sandbag' ? 0.13 : 0.1));
      }
    const kinds = [...new Set(runs.map((r) => r.kind))].sort();
    for (const kind of kinds) {
      const mine = runs.filter((r) => r.kind === kind);
      const parts = kind === 'hesco' && hesco ? hescoFromModel(hesco) : [{ geo: wallPiece(kind, biome, seed ^ kind.length), mat: kind === 'hedge' ? foliage : this.material }];
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, mine.length);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.name = `wall-${kind}`;
        mine.forEach((r, k) => {
          const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
          const ha = hf.at(r.ax, r.az);
          const hb = hf.at(r.bx, r.bz);
          const yaw = -Math.atan2(r.bz - r.az, r.bx - r.ax);
          const pitch = Math.atan2(hb - ha, len);
          this.q.setFromEuler(new THREE.Euler(0, yaw, pitch, 'YXZ'));
          const m = new THREE.Matrix4().compose(this.v.set(r.ax, ha - 0.01, r.az), this.q, this.s.set(len + 0.03, 1, 1));
          mesh.setMatrixAt(k, m);
          const list = this.walls.get(r.cell) ?? [];
          list.push({ mesh, i: k, m });
          this.walls.set(r.cell, list);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    }

    // Boulders.
    const shapes = [boulder(seed ^ 1, biome), boulder(seed ^ 2, biome)];
    const rockPlaces: { cell: number; shape: number; m: THREE.Matrix4 }[] = [];
    const rnd = stream(seed ^ 0xb0);
    for (let i = 0; i < map.cells.length; i++) {
      if (map.cells[i] !== ROCK) continue;
      const x = (i % map.w) + 0.5;
      const z = Math.floor(i / map.w) + 0.5;
      const n = 3 + Math.floor(rnd() * 3);
      let top = 0;
      for (let k = 0; k < n; k++) {
        const big = k === 0;
        const s = big ? 0.2 + rnd() * 0.08 : 0.07 + rnd() * 0.08;
        const a = rnd() * Math.PI * 2;
        const d = big ? rnd() * 0.12 : 0.18 + rnd() * 0.22;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        const h = hf.at(px, pz);
        this.q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4));
        rockPlaces.push({ cell: i, shape: k % 2, m: new THREE.Matrix4().compose(new THREE.Vector3(px, h - s * 0.15, pz), this.q.clone(), new THREE.Vector3(s * (1 + rnd() * 0.4), s * (0.8 + rnd() * 0.5), s)) });
        top = Math.max(top, h + s * 0.9);
      }
      this.tops.set(i, top);
    }
    shapes.forEach((geo, si) => {
      const mine = rockPlaces.filter((p) => p.shape === si);
      if (!mine.length) {
        geo.dispose();
        return;
      }
      const mesh = new THREE.InstancedMesh(geo, this.material, mine.length);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = 'rocks';
      mine.forEach((p, k) => {
        mesh.setMatrixAt(k, p.m);
        const list = this.rocks.get(p.cell) ?? [];
        list.push({ mesh, i: k, m: p.m });
        this.rocks.set(p.cell, list);
      });
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.group.add(mesh);
    });

    // Crater rims: room for many; the first come from the map.
    this.craters = new THREE.InstancedMesh(craterRim(biome), this.material, 512);
    this.craters.count = 0;
    this.craters.receiveShadow = true;
    this.craters.frustumCulled = false;
    this.craters.name = 'craters';
    this.group.add(this.craters);
    this.meshes.push(this.craters);
  }

  /** Where a cell's crater sits (a little off centre, from the seed). */
  craterAt(cx: number, cy: number): [number, number] {
    return [cx + 0.5 + (hash(this.seed, cx, cy, 21) - 0.5) * 0.35, cy + 0.5 + (hash(this.seed, cx, cy, 22) - 0.5) * 0.35];
  }

  addCrater(x: number, z: number, r: number): void {
    if (this.craters.count >= this.craters.instanceMatrix.count) return;
    this.hf.normalAt(x, z, this.n);
    this.q.setFromUnitVectors(this.up, this.n);
    const spin = new THREE.Quaternion().setFromAxisAngle(this.up, hash(this.seed, Math.round(x * 10), Math.round(z * 10)) * 6);
    this.q.multiply(spin);
    this.m.compose(this.v.set(x, this.hf.at(x, z) - 0.005, z), this.q, this.s.set(r, r, r));
    this.craters.setMatrixAt(this.craters.count++, this.m);
    this.craters.instanceMatrix.needsUpdate = true;
  }

  /** A wall cell knocked flat: its pieces slump into a low, tumbled heap. */
  breakWall(cell: number): void {
    const list = this.walls.get(cell);
    if (!list) return;
    const rnd = stream(hash(this.seed, cell, 41) * 4294967296);
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (const w of list) {
      w.m.decompose(pos, rot, scl);
      const tumble = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3));
      this.m.compose(pos.setY(pos.y - 0.01), rot.multiply(tumble), scl.set(scl.x * 0.9, 0.28, 1.5));
      w.mesh.setMatrixAt(w.i, this.m);
      w.mesh.instanceMatrix.needsUpdate = true;
    }
    this.walls.delete(cell);
    const t = this.tops.get(cell);
    if (t !== undefined) this.tops.set(cell, t - 0.07);
  }

  /** A rock blown or breached away. */
  clearRock(cell: number): void {
    const list = this.rocks.get(cell);
    if (!list) return;
    for (const r of list) {
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      r.m.decompose(pos, rot, scl);
      this.m.compose(pos.setY(pos.y - scl.y * 0.6), rot, scl.multiplyScalar(0.5));
      r.mesh.setMatrixAt(r.i, this.m);
      r.mesh.instanceMatrix.needsUpdate = true;
    }
    this.rocks.delete(cell);
    this.tops.delete(cell);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}
