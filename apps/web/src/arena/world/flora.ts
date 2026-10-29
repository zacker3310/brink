import * as THREE from 'three';
import { BUILDING, BRIDGE, ROAD, ROCK, RUBBLE, TREES, TREE_KINDS, WATER, type BattleMap, type Biome } from '@brink/arena/v2';
import { Geo, type UVRect, type V3 } from './geom';
import { edgeHaze, matte, type FieldUniform } from './haze';
import { MARGIN, type Heightfield, type Layout } from './height';
import { clamp, fbm, hash, lattice, stream } from './noise';
import { groundColour, type Paint, type Polyline } from './ground';

// Trees, hedges' leaves, reeds, grass and scrub. Each tree is one small mesh (trunk, a solid
// crown core and a few alpha-tested leaf cards with normals pointing out from the crown, so it
// lights like a soft volume), instanced by kind. Ground clutter is instanced too and follows
// the camera: only the cells near what you look at carry it, refilled when the view moves.

// --- Textures ------------------------------------------------------------------------------------

/**
 * A canvas with cut-out shapes as a texture whose clear texels keep a mid-grey colour, so
 * mipmaps blend toward grey, not black (no dark fringes on leaves and blades from afar).
 */
function cutout(c: HTMLCanvasElement, fill: number): THREE.DataTexture {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const a = d[k + 3]! / 255;
    if (a < 1) {
      d[k] = d[k]! * a + fill * (1 - a);
      d[k + 1] = d[k + 1]! * a + fill * (1 - a);
      d[k + 2] = d[k + 2]! * a + fill * (1 - a);
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), c.width, c.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Leaf atlas: leaf-cluster card, twig card, solid leaf mass, needles, bark (greys; colour comes from vertices). */
export const LEAF_UV = {
  card: [0.01, 0.01, 0.49, 0.49] as UVRect,
  twig: [0.51, 0.01, 0.99, 0.49] as UVRect,
  mass: [0.02, 0.52, 0.48, 0.98] as UVRect,
  needles: [0.52, 0.52, 0.73, 0.98] as UVRect,
  bark: [0.77, 0.52, 0.98, 0.98] as UVRect,
};

export function leafTexture(size: number, seed: number): THREE.DataTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = stream(seed ^ 0x1eaf);
  const h = size / 2;
  const leaf = (x: number, y: number, r: number, v: number) => {
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  };
  // Card: a ragged cluster, dense in the middle so it survives mipmapping.
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * h * 0.47;
    const x = h / 2 + Math.cos(a) * d;
    const y = h / 2 + Math.sin(a) * d;
    leaf(x, y, size * (0.012 + rnd() * 0.012), 165 + Math.floor((1 - d / (h * 0.5)) * 40 + rnd() * 50));
  }
  // Twigs: forking strokes.
  g.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    g.strokeStyle = `rgb(${175 + depth * 12},${172 + depth * 12},${166 + depth * 12})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    if (depth < 5) {
      branch(x2, y2, a - 0.4 - rnd() * 0.3, len * 0.72, w * 0.7, depth + 1);
      branch(x2, y2, a + 0.4 + rnd() * 0.3, len * 0.72, w * 0.7, depth + 1);
    }
  };
  for (let k = 0; k < 5; k++) branch(h + h / 2, h * 0.5, (k / 5) * Math.PI * 2 + rnd(), h * 0.14, size * 0.008, 0);
  // Solid mass.
  g.fillStyle = 'rgb(170,170,170)';
  g.fillRect(0, h, h, h);
  for (let i = 0; i < 900; i++) leaf(rnd() * h, h + rnd() * h, size * (0.01 + rnd() * 0.012), 160 + Math.floor(rnd() * 95));
  // Needles.
  g.fillStyle = 'rgb(165,165,165)';
  g.fillRect(h, h, h / 2, h);
  for (let i = 0; i < 700; i++) {
    const x = h + rnd() * (h / 2);
    const y = h + rnd() * h;
    const v = 150 + Math.floor(rnd() * 105);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 6, y + 4 + rnd() * 6);
    g.stroke();
  }
  // Bark.
  g.fillStyle = 'rgb(200,200,200)';
  g.fillRect(h * 1.5, h, h / 2, h);
  for (let i = 0; i < 260; i++) {
    const v = 140 + Math.floor(rnd() * 100);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(h * 1.5 + rnd() * (h / 2), h + rnd() * h, 1 + rnd() * 2, 4 + rnd() * 18);
  }
  return cutout(c, 205);
}

function grassTexture(size: number, seed: number): THREE.DataTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = stream(seed ^ 0x9a55);
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const x = size * (0.1 + rnd() * 0.8);
    const hgt = size * (0.3 + rnd() * 0.66);
    const lean = (rnd() - 0.5) * size * 0.35;
    const v = 200 + Math.floor(rnd() * 55);
    // Blades darken toward the root, where the clump shades itself.
    const grad = g.createLinearGradient(0, size, 0, size - hgt);
    grad.addColorStop(0, `rgb(${v * 0.6},${v * 0.6},${v * 0.6})`);
    grad.addColorStop(1, `rgb(${v},${v},${v})`);
    g.strokeStyle = grad;
    g.lineWidth = size * (0.018 + rnd() * 0.02);
    g.beginPath();
    g.moveTo(x, size);
    g.quadraticCurveTo(x + lean * 0.3, size - hgt * 0.6, x + lean, size - hgt);
    g.stroke();
  }
  return cutout(c, 215);
}

// --- Tree shapes ---------------------------------------------------------------------------------

type Shape = 'broadleaf' | 'conifer' | 'birch' | 'scrub' | 'acacia' | 'bare' | 'autumn';

const lin = (hexs: string): V3 => {
  const c = new THREE.Color(hexs);
  return [c.r, c.g, c.b];
};
const scaleV = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k];

/** Crown colours by biome and shape (sRGB hex, converted to linear for vertex colours). */
function crownColour(biome: Biome, shape: Shape): V3 {
  if (shape === 'conifer') return lin(biome === 'winter' ? '#2a3a2e' : '#33432c');
  if (shape === 'birch') return lin(biome === 'steppe' ? '#8a8a48' : '#6d7d3e');
  if (shape === 'scrub') return lin(biome === 'desert' ? '#77785a' : biome === 'steppe' ? '#6f6c45' : biome === 'winter' ? '#5f5a4c' : '#4f5c30');
  if (shape === 'acacia') return lin('#5f6a3c');
  if (shape === 'bare') return lin('#6a6058');
  if (shape === 'autumn') return lin('#857a40');
  return lin(biome === 'urban' ? '#4f5d30' : '#4d5c2d');
}

/** Points a card's quad around a centre, facing out along n. */
function card(g: Geo, centre: V3, at: V3, size: number, roll: number, uv: UVRect, crownC: V3, upBias: number): void {
  const n = new THREE.Vector3(at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]).normalize();
  const helper = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3().crossVectors(helper, n).normalize();
  const b = new THREE.Vector3().crossVectors(n, t).normalize();
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const u = t.clone().multiplyScalar(cr).addScaledVector(b, sr).multiplyScalar(size / 2);
  const v = b.clone().multiplyScalar(cr).addScaledVector(t, -sr).multiplyScalar(size / 2);
  const corners: V3[] = [
    [at[0] - u.x - v.x, at[1] - u.y - v.y, at[2] - u.z - v.z],
    [at[0] + u.x - v.x, at[1] + u.y - v.y, at[2] + u.z - v.z],
    [at[0] + u.x + v.x, at[1] + u.y + v.y, at[2] + u.z + v.z],
    [at[0] - u.x + v.x, at[1] - u.y + v.y, at[2] - u.z + v.z],
  ];
  const nrm = corners.map((p) => {
    const d = new THREE.Vector3(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]).normalize();
    d.y += upBias;
    d.normalize();
    return [d.x, d.y, d.z] as V3;
  });
  const [u0, v0, u1, v1] = uv;
  g.color = scaleV(crownC, 0.75 + (at[1] - centre[1] + 0.3) * 0.6);
  g.tri(corners[0]!, corners[1]!, corners[2]!, [u0, v1], [u1, v1], [u1, v0], [nrm[0]!, nrm[1]!, nrm[2]!]);
  g.tri(corners[0]!, corners[2]!, corners[3]!, [u0, v1], [u1, v0], [u0, v0], [nrm[0]!, nrm[2]!, nrm[3]!]);
}

/** A solid crown core with outward normals, darker underneath; snow on top in winter. */
function core(g: Geo, centre: V3, rx: number, ry: number, rz: number, colour: V3, rnd: () => number, snow: boolean, uv: UVRect = LEAF_UV.mass, detail = 0): void {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const p = ico.attributes.position!;
  const verts: V3[] = [];
  for (let i = 0; i < p.count; i++) verts.push([p.getX(i), p.getY(i), p.getZ(i)]);
  ico.dispose();
  // The ico is non-indexed: displace each corner consistently by its direction.
  const jitter = new Map<string, number>();
  const key = (v: V3) => `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
  for (const v of verts) if (!jitter.has(key(v))) jitter.set(key(v), 0.72 + rnd() * 0.5);
  const [u0, v0, u1, v1] = uv;
  for (let i = 0; i < verts.length; i += 3) {
    const tri = [verts[i]!, verts[i + 1]!, verts[i + 2]!].map((v) => {
      const k = jitter.get(key(v))!;
      return [centre[0] + v[0] * rx * k, centre[1] + v[1] * ry * k, centre[2] + v[2] * rz * k] as V3;
    });
    const nrm = [verts[i]!, verts[i + 1]!, verts[i + 2]!].map((v) => {
      const d = new THREE.Vector3(v[0], v[1] + 0.25, v[2]).normalize();
      return [d.x, d.y, d.z] as V3;
    }) as [V3, V3, V3];
    const yMean = (verts[i]![1] + verts[i + 1]![1] + verts[i + 2]![1]) / 3;
    g.color = snow && yMean > 0.25 ? lin('#e4e8ea') : scaleV(colour, 0.55 + (yMean + 1) * 0.28);
    const uvp = (n: number): [number, number] => [u0 + (u1 - u0) * ((verts[i + n]![0] + 1) / 2), v0 + (v1 - v0) * ((verts[i + n]![2] + 1) / 2)];
    g.tri(tri[0]!, tri[1]!, tri[2]!, uvp(0), uvp(1), uvp(2), nrm);
  }
}

function trunk(g: Geo, h: number, r0: number, r1: number, colour: V3, lean = 0, x = 0, z = 0, dir = 0): void {
  const c = new THREE.CylinderGeometry(r1, r0, h, 5, 1, true);
  c.translate(0, h / 2, 0);
  if (lean) c.rotateZ(lean);
  c.rotateY(dir);
  c.translate(x, 0, z);
  g.color = colour;
  g.add(c, LEAF_UV.bark);
  c.dispose();
}

function treeShape(shape: Shape, biome: Biome, seed: number, cards: number, lobes: number): THREE.BufferGeometry {
  const rnd = stream(seed);
  const g = new Geo();
  const col = crownColour(biome, shape);
  const bark = lin(shape === 'birch' ? '#d9d6cc' : biome === 'desert' ? '#6b5a48' : '#4a3f33');
  const snow = biome === 'winter';
  const spread = (centre: V3, r: number, n: number, size: number, uv: UVRect, upper: number) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.6;
      const el = -0.25 + rnd() * (0.25 + upper) + (k % 3 === 0 ? 0.5 : 0);
      const at: V3 = [centre[0] + Math.cos(a) * Math.cos(el) * r, centre[1] + Math.sin(el) * r * 0.85, centre[2] + Math.sin(a) * Math.cos(el) * r];
      card(g, centre, at, size * (0.85 + rnd() * 0.3), rnd() * Math.PI, uv, col, 0.35);
    }
    // One on top, facing up, for the drone's view.
    card(g, centre, [centre[0], centre[1] + r * 0.9, centre[2] + 0.001], size, rnd() * Math.PI, uv, col, 0.5);
  };
  if (shape === 'conifer') {
    trunk(g, 0.3, 0.03, 0.02, bark);
    const tiers = [
      [0.3, 0.22, 0.42],
      [0.24, 0.42, 0.38],
      [0.16, 0.62, 0.34],
      [0.09, 0.8, 0.26],
    ];
    for (const [r, y, h] of tiers) {
      const cone = new THREE.ConeGeometry(r!, h!, 7, 1, true);
      const p = cone.attributes.position!;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < 0) {
          const k = 0.8 + rnd() * 0.45;
          p.setX(i, p.getX(i) * k);
          p.setZ(i, p.getZ(i) * k);
          p.setY(i, p.getY(i) - rnd() * 0.04);
        }
      }
      cone.computeVertexNormals();
      cone.translate(0, y! + h! / 2, 0);
      const nc = cone.toNonIndexed();
      cone.dispose();
      const pp = nc.attributes.position!;
      // Colour by height inside each tier; snow sits on the upper faces.
      for (let i = 0; i < pp.count; i += 3) {
        const yy = (pp.getY(i) + pp.getY(i + 1) + pp.getY(i + 2)) / 3 - y!;
        g.color = snow && rnd() < 0.75 ? lin('#dfe4e6') : scaleV(col, 0.6 + (yy / h!) * 0.6);
        const tri: V3[] = [0, 1, 2].map((n) => [pp.getX(i + n), pp.getY(i + n), pp.getZ(i + n)] as V3);
        const nr = [0, 1, 2].map((n) => {
          const d = new THREE.Vector3(pp.getX(i + n), 0.45, pp.getZ(i + n)).normalize();
          return [d.x, d.y, d.z] as V3;
        }) as [V3, V3, V3];
        const [u0, v0, u1, v1] = LEAF_UV.needles;
        g.tri(tri[0]!, tri[1]!, tri[2]!, [u0, v1], [u1, v1], [(u0 + u1) / 2, v0], nr);
      }
      nc.dispose();
    }
  } else if (shape === 'scrub') {
    core(g, [0, 0.1, 0], 0.17, 0.11, 0.17, col, rnd, snow);
    spread([0, 0.12, 0], 0.15, Math.max(3, cards - 4), 0.2, LEAF_UV.card, 0.6);
  } else if (shape === 'acacia') {
    trunk(g, 0.45, 0.028, 0.018, bark, 0.25, 0, 0, 0);
    trunk(g, 0.42, 0.022, 0.015, bark, -0.3, 0, 0, 1.2);
    core(g, [0, 0.58, 0], 0.4, 0.09, 0.38, col, rnd, snow);
    spread([0, 0.6, 0], 0.32, cards, 0.32, LEAF_UV.card, 0.9);
  } else if (shape === 'bare') {
    trunk(g, 0.6, 0.032, 0.016, bark);
    for (let k = 0; k < 4; k++) trunk(g, 0.32, 0.014, 0.006, bark, 0.65 + rnd() * 0.25, 0, 0, (k / 4) * Math.PI * 2 + rnd());
    const twig = scaleV(bark, 1.15);
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2;
      const at: V3 = [Math.cos(a) * 0.2, 0.68 + rnd() * 0.2, Math.sin(a) * 0.2];
      card(g, [0, 0.66, 0], at, 0.42, rnd() * Math.PI, LEAF_UV.twig, twig, 0.3);
    }
  } else if (shape === 'birch') {
    trunk(g, 0.8, 0.022, 0.012, bark);
    core(g, [0, 0.82, 0], 0.18, 0.3, 0.18, col, rnd, snow);
    spread([0, 0.84, 0], 0.2, Math.max(4, cards - 2), 0.26, LEAF_UV.card, 0.7);
  } else {
    // Broadleaf (and the yellowing late-summer form): two lobes, never a ball.
    trunk(g, 0.5, 0.035, 0.022, bark);
    const c: V3 = [0, 0.7, 0];
    const a = rnd() * Math.PI * 2;
    if (lobes > 1) {
      core(g, [Math.cos(a) * 0.1, 0.68, Math.sin(a) * 0.1], 0.3, 0.25, 0.28, col, rnd, snow);
      core(g, [-Math.cos(a) * 0.12, 0.78, -Math.sin(a) * 0.12], 0.24, 0.22, 0.25, col, rnd, snow);
    } else core(g, c, 0.34, 0.28, 0.33, col, rnd, snow);
    spread(c, 0.34, cards, 0.36, LEAF_UV.card, 0.8);
  }
  return g.geometry();
}

/** Which shapes a TREES cell's kind becomes in each biome. */
function shapeFor(biome: Biome, kind: (typeof TREE_KINDS)[number], r: number): Shape {
  if (kind === 'scrub') return 'scrub';
  if (biome === 'desert') return r < 0.75 ? 'acacia' : 'scrub';
  if (biome === 'winter') return kind === 'conifer' || (kind === 'broadleaf' && r < 0.3) ? 'conifer' : 'bare';
  if (biome === 'steppe') return kind === 'conifer' ? 'conifer' : kind === 'birch' ? 'birch' : r < 0.45 ? 'autumn' : 'broadleaf';
  if (kind === 'conifer') return r < 0.85 ? 'conifer' : 'birch';
  if (kind === 'birch') return r < 0.75 ? 'birch' : 'broadleaf';
  return r < 0.85 ? 'broadleaf' : r < 0.93 ? 'birch' : 'conifer';
}

// --- Forest --------------------------------------------------------------------------------------

interface TreeRef {
  mesh: THREE.InstancedMesh;
  i: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  /** Height over spread, so no two crowns of a kind look alike. */
  tall: number;
  fallen: boolean;
}

interface Fall {
  tree: TreeRef;
  t: number;
  dir: number;
}

export interface WindUniforms {
  uTime: { value: number };
  uWind: { value: number };
}

/**
 * Sway in the wind, and keep each card's normal as built on both faces: a double-sided leaf or
 * blade seen from behind is still lit as part of its crown or tuft, not flipped into shadow.
 */
function addWind(material: THREE.Material, u: WindUniforms, amount: number, from: number, key: string, field: FieldUniform): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    matte(shader);
    edgeHaze(shader, field);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float sway = max(0.0, position.y - ${from.toFixed(3)}) * uWind * ${amount.toFixed(3)};
  transformed.x += sin(uTime * 1.7 + ip.x * 1.3 + ip.z * 0.9) * sway;
  transformed.z += cos(uTime * 1.3 + ip.x * 0.7 + ip.z * 1.1) * sway * 0.7;
}
#endif`,
    );
  };
  material.customProgramCacheKey = () => key;
}

export class Forest {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly byCell = new Map<number, TreeRef[]>();
  /** Highest crown in each cell. */
  readonly tops = new Map<number, number>();
  private readonly falls: Fall[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qy = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly dim = new THREE.Color();
  readonly meshes: THREE.InstancedMesh[] = [];

  constructor(map: BattleMap, layout: Layout, hf: Heightfield, roads: Polyline[], leaf: THREE.Texture, wind: WindUniforms, field: FieldUniform, seed: number, cast: boolean, cards: number, lobes: number, reach: number) {
    this.material = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.42, vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    addWind(this.material, wind, 0.035, 0.35, 'brink-trees', field);
    const biome = map.biome;
    const rnd = stream(seed ^ 0x7ee5);
    type Place = { cell: number; shape: Shape; x: number; z: number; s: number; yaw: number; tint: THREE.Color };
    const places: Place[] = [];
    // Each tree its own shade: lighter or darker, a little yellower or bluer.
    const tint = (k: number) => {
      const h = rnd() - 0.5;
      return new THREE.Color(1 + h * 0.14, 1, 1 - h * 0.2).multiplyScalar(0.76 + k * 0.4);
    };
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const i = y * map.w + x;
        if (map.cells[i] !== TREES) continue;
        const kind = TREE_KINDS[(map.variant[i] ?? 0) & 3]!;
        const n = kind === 'scrub' ? 4 + Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          // Spread within the cell, a little over its edges so woods read as one canopy.
          const a = (k / n) * Math.PI * 2 + rnd();
          const d = 0.08 + rnd() * 0.36;
          const shape = shapeFor(biome, kind, rnd());
          const big = shape === 'scrub' ? 0.9 + rnd() * 0.5 : 0.88 + rnd() * 0.5;
          places.push({ cell: i, shape, x: x + 0.5 + Math.cos(a) * d, z: y + 0.5 + Math.sin(a) * d, s: big, yaw: rnd() * Math.PI * 2, tint: tint(rnd()) });
        }
      }
    // Woods and tree lines beyond the field, never on a river or a road.
    const t = lattice(seed ^ 0x3a7);
    const nearRoad = (x: number, z: number) => {
      for (const r of roads) for (const p of r.pts) if (Math.abs(p.x - x) < 0.8 && Math.abs(p.z - z) < 0.8) return true;
      return false;
    };
    {
      const step = 0.75;
      const belts = biome === 'steppe' || biome === 'temperate';
      for (let z = -MARGIN + 0.5; z < map.h + MARGIN - 0.5; z += step)
        for (let x = -MARGIN + 0.5; x < map.w + MARGIN - 0.5; x += step) {
          const out = Math.max(-x, x - map.w, -z, z - map.h);
          // Beyond `reach` the haze hides them anyway: no triangles spent there.
          if (out < 0.6 || out > reach) continue;
          const jx = x + (hash(seed, Math.round(x * 4), Math.round(z * 4), 1) - 0.5) * step;
          const jz = z + (hash(seed, Math.round(x * 4), Math.round(z * 4), 2) - 0.5) * step;
          const woods = fbm(t, jx * 0.16, jz * 0.16, 3);
          const belt = belts && (Math.abs(((jz + 3) % 9) - 0.2) < 0.32 || Math.abs(((jx + 5) % 13) - 0.2) < 0.32) && fbm(t, jx * 0.3 + 9, jz * 0.3, 2) > 0.45;
          const threshold = biome === 'desert' ? 0.72 : biome === 'urban' ? 0.66 : 0.58;
          if (woods < threshold && !belt) continue;
          if (layout.water[layout.idx(Math.floor(jx), Math.floor(jz))] || layout.sample(layout.distWater, jx, jz) < 0.8) continue;
          if (nearRoad(jx, jz)) continue;
          const kinds: (typeof TREE_KINDS)[number][] = biome === 'winter' ? ['conifer', 'birch', 'broadleaf'] : biome === 'desert' ? ['broadleaf', 'scrub'] : ['broadleaf', 'broadleaf', 'conifer', 'birch'];
          const kind = kinds[Math.floor(hash(seed, Math.round(jx), Math.round(jz), 3) * kinds.length)]!;
          const shape = shapeFor(biome, kind, rnd());
          places.push({ cell: -1, shape, x: jx, z: jz, s: 0.8 + rnd() * 0.5, yaw: rnd() * Math.PI * 2, tint: tint(rnd()) });
        }
    }
    const shapes = [...new Set(places.map((p) => p.shape))].sort();
    for (const shape of shapes) {
      const mine = places.filter((p) => p.shape === shape);
      const geo = treeShape(shape, biome, seed ^ (shapes.indexOf(shape) * 7919), cards, lobes);
      const mesh = new THREE.InstancedMesh(geo, this.material, mine.length);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = `trees-${shape}`;
      mine.forEach((p, i) => {
        const h = hf.at(p.x, p.z) - 0.02;
        const ref: TreeRef = { mesh, i, x: p.x, y: h, z: p.z, yaw: p.yaw, s: p.s, tall: 0.82 + hash(seed, i, shapes.indexOf(shape), 9) * 0.4, fallen: false };
        this.place(ref, 0, 0);
        mesh.setColorAt(i, p.tint);
        if (p.cell >= 0) {
          const list = this.byCell.get(p.cell) ?? [];
          list.push(ref);
          this.byCell.set(p.cell, list);
          const crown = shape === 'scrub' ? 0.25 : shape === 'birch' ? 1.12 : 1.02;
          this.tops.set(p.cell, Math.max(this.tops.get(p.cell) ?? 0, h + crown * p.s));
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private place(r: TreeRef, angle: number, dir: number): void {
    this.qy.setFromAxisAngle(this.v.set(0, 1, 0), r.yaw);
    if (angle !== 0) {
      this.axis.set(Math.sin(dir), 0, -Math.cos(dir));
      this.q.setFromAxisAngle(this.axis, angle).multiply(this.qy);
    } else this.q.copy(this.qy);
    this.m.compose(this.v.set(r.x, r.y - angle * 0.02, r.z), this.q, this.sc.set(r.s, r.s * r.tall, r.s));
    r.mesh.setMatrixAt(r.i, this.m);
    r.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Bring a cell's trees down; `keep` of them stay standing (a cell with hits left). */
  knock(cell: number, keep: number, seed: number): void {
    const list = this.byCell.get(cell);
    if (!list) return;
    let standing = list.filter((t) => !t.fallen).length;
    list.forEach((tree, k) => {
      if (tree.fallen || standing <= keep) return;
      tree.fallen = true;
      standing--;
      this.falls.push({ tree, t: 0, dir: hash(seed, cell, k) * Math.PI * 2 });
      // Broken and wilting: a felled crown is smaller and browner than a standing one.
      tree.s *= 0.82;
      if (tree.mesh.instanceColor) {
        tree.mesh.getColorAt(tree.i, this.dim);
        tree.mesh.setColorAt(tree.i, this.dim.multiply(new THREE.Color(0.72, 0.64, 0.5)));
        tree.mesh.instanceColor.needsUpdate = true;
      }
    });
    if (standing === 0) this.tops.delete(cell);
  }

  update(dt: number): void {
    for (let k = this.falls.length - 1; k >= 0; k--) {
      const f = this.falls[k]!;
      f.t = Math.min(1.2, f.t + dt);
      const p = f.t / 1.2;
      this.place(f.tree, p * p * 1.45, f.dir);
      if (f.t >= 1.2) this.falls.splice(k, 1);
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}

// --- Clutter -------------------------------------------------------------------------------------

interface ClutterKind {
  mesh: THREE.InstancedMesh;
  colours: THREE.Color[];
  /** Share of the items. */
  share: number;
  scale: [number, number];
}

const CLUTTER_COLOURS: Record<Biome, { grass: string[]; bush: string[]; stone: string[]; split: [number, number, number] }> = {
  temperate: { grass: [], bush: ['#5f6c38', '#68713c', '#56623a'], stone: ['#857f74', '#77726a'], split: [0.8, 0.13, 0.07] },
  steppe: { grass: [], bush: ['#837b54', '#77734d'], stone: ['#8a8478', '#7a756b'], split: [0.84, 0.09, 0.07] },
  desert: { grass: [], bush: ['#8f8c70', '#83816a', '#9a9274'], stone: ['#9c8768', '#80735f', '#a8977c'], split: [0.4, 0.12, 0.48] },
  winter: { grass: ['#9a9078', '#aba089', '#8c836e'], bush: ['#8a8578', '#7d7f74'], stone: ['#a4a4a0', '#969692'], split: [0.84, 0.04, 0.12] },
  urban: { grass: [], bush: ['#5c6838', '#646c40'], stone: ['#8c8982', '#8a5e4c', '#6f6d68'], split: [0.45, 0.15, 0.4] },
};

/** Density of clutter by cell. */
function density(c: number | undefined): number {
  if (c === undefined) return 0.8;
  if (c === WATER || c === BRIDGE || c === BUILDING) return 0;
  if (c === ROAD) return 0.12;
  if (c === RUBBLE) return 0.9;
  if (c === ROCK) return 1.2;
  if (c === TREES) return 0.8;
  return 1;
}

export class Clutter {
  readonly group = new THREE.Group();
  private readonly kinds: ClutterKind[] = [];
  private readonly grassMat: THREE.MeshStandardMaterial;
  private readonly stoneMat: THREE.MeshStandardMaterial;
  private readonly side: number;
  private cx = -9999;
  private cz = -9999;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly counts: number[] = [];
  private readonly tint = new THREE.Color();
  /** Cell offsets round the focus, nearest first, so a full budget drops the far edge. */
  private readonly offsets: [number, number][] = [];

  constructor(
    private readonly map: BattleMap,
    private readonly layout: Layout,
    private readonly hf: Heightfield,
    private readonly paint: Paint,
    private readonly seed: number,
    capacity: number,
    foliage: THREE.Material,
    wind: WindUniforms,
    field: FieldUniform,
    texSize: number,
    fine: boolean,
  ) {
    const biome = map.biome;
    const pal = CLUTTER_COLOURS[biome] ?? CLUTTER_COLOURS.temperate;
    this.grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(texSize, seed), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    addWind(this.grassMat, wind, 0.35, 0, 'brink-grass', field);
    this.stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // Grass: three crossed cards, lit like the ground.
    const cards: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const c = new THREE.PlaneGeometry(0.1, 0.075);
      c.translate(0, 0.0375, 0);
      c.rotateY((k / 3) * Math.PI);
      cards.push(c);
    }
    const gg = new Geo();
    for (const c of cards) {
      gg.add(c);
      c.dispose();
    }
    const grassGeo = gg.geometry();
    const n = grassGeo.attributes.normal!;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const uvA = grassGeo.attributes.uv!;
    for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));
    // Bush: a small lumpy core in the leaf atlas, ragged with a few leaf cards.
    const bg = new Geo();
    const br = stream(seed ^ 5);
    core(bg, [0, 0.03, 0], 0.06, 0.045, 0.06, [1, 1, 1], br, biome === 'winter', LEAF_UV.mass, fine ? 1 : 0);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + br();
      card(bg, [0, 0.03, 0], [Math.cos(a) * 0.05, 0.045 + br() * 0.02, Math.sin(a) * 0.05], 0.075, br() * 3, LEAF_UV.card, [1, 1, 1], 0.4);
    }
    const bushGeo = bg.geometry();
    // Stone: a faceted lump, snow-capped in winter.
    const sg = new Geo();
    const ico = new THREE.IcosahedronGeometry(0.04, 0);
    const pp = ico.attributes.position!;
    const sr = stream(seed ^ 9);
    for (let i = 0; i < pp.count; i += 3) {
      const tri: V3[] = [0, 1, 2].map((k) => {
        const x = pp.getX(i + k);
        const y = pp.getY(i + k);
        const z = pp.getZ(i + k);
        return [x * 1.2, Math.max(-0.01, y * 0.6), z] as V3;
      });
      const top = (tri[0]![1] + tri[1]![1] + tri[2]![1]) / 3 > 0.012;
      sg.color = biome === 'winter' && top ? lin('#e3e7e9') : [0.85 + sr() * 0.3, 0.85 + sr() * 0.3, 0.85 + sr() * 0.3];
      sg.tri(tri[0]!, tri[1]!, tri[2]!, [0, 0], [1, 0], [0, 1]);
    }
    ico.dispose();
    const stoneGeo = sg.geometry();
    const caps = pal.split.map((s) => Math.max(1, Math.floor(capacity * s)));
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, colours: string[], share: number, scale: [number, number], name: string) => {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.name = name;
      // Allocate instance colours up front.
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.kinds.push({ mesh, colours: colours.map((c) => new THREE.Color(c)), share, scale });
      this.counts.push(0);
      this.group.add(mesh);
    };
    mk(grassGeo, this.grassMat, caps[0]!, pal.grass, pal.split[0], biome === 'steppe' ? [0.9, 1.7] : [0.7, 1.4], 'clutter-grass');
    mk(bushGeo, foliage, caps[1]!, pal.bush, pal.split[1], [0.8, 1.8], 'clutter-bush');
    mk(stoneGeo, this.stoneMat, caps[2]!, pal.stone, pal.split[2], [0.35, 1.1], 'clutter-stone');
    // A window of cells round the focus, sized so the capacity covers it at a decent density.
    this.side = Math.max(9, Math.round(Math.sqrt(capacity / 6)));
    const half = Math.floor(this.side / 2);
    for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) this.offsets.push([dx, dz]);
    this.offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  }

  /** Refill when the focus has moved two cells or more. */
  update(fx: number, fz: number): void {
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);
    if (Math.max(Math.abs(cx - this.cx), Math.abs(cz - this.cz)) < 2) return;
    this.cx = cx;
    this.cz = cz;
    for (let k = 0; k < this.counts.length; k++) this.counts[k] = 0;
    let total = 0;
    for (const k of this.kinds) total += k.mesh.instanceMatrix.count;
    // Snow buries most of it; the desert carries little.
    const perCell = (total / (this.side * this.side)) * (this.map.biome === 'winter' ? 0.45 : this.map.biome === 'desert' ? 0.7 : 1);
    const map = this.map;
    const grassFromGround = map.biome !== 'winter';
    for (const [dx, dz] of this.offsets) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < -MARGIN || z < -MARGIN || x >= map.w + MARGIN || z >= map.h + MARGIN) continue;
      const inField = x >= 0 && z >= 0 && x < map.w && z < map.h;
      const cell = inField ? map.cells[z * map.w + x] : undefined;
      if (!inField && this.layout.water[this.layout.idx(x, z)]) continue;
      const d = density(cell);
      const n = Math.floor(perCell * d + hash(this.seed, x, z, 7));
      for (let k = 0; k < n; k++) {
        const r0 = hash(this.seed, x, z, k * 4 + 11);
        // Pick a kind by share; rock and rubble cells lean to stones, woods to bushes.
        let pick = r0 < this.kinds[0]!.share ? 0 : r0 < this.kinds[0]!.share + this.kinds[1]!.share ? 1 : 2;
        if ((cell === ROCK || cell === RUBBLE) && r0 < 0.6) pick = 2;
        if (cell === TREES && r0 < 0.4) pick = 1;
        const kind = this.kinds[pick]!;
        const at = this.counts[pick]!;
        if (at >= kind.mesh.instanceMatrix.count) continue;
        const px = x + hash(this.seed, x, z, k * 4 + 12);
        const pz = z + hash(this.seed, x, z, k * 4 + 13);
        const ground = this.hf.at(px, pz);
        if (this.hf.surfaceAt(px, pz) > ground - 0.01 && this.layout.sample(this.layout.distWater, px, pz) < 1.5) continue;
        const r1 = hash(this.seed, x, z, k * 4 + 14);
        const sc = kind.scale[0] + (kind.scale[1] - kind.scale[0]) * r1;
        this.q.setFromAxisAngle(this.up, r1 * 40);
        this.m.compose(this.p.set(px, ground - 0.005, pz), this.q, this.s.set(sc, sc * (0.8 + r0 * 0.4), sc));
        kind.mesh.setMatrixAt(at, this.m);
        // Colours are left alone while the thermal view has taken them away.
        if (kind.mesh.instanceColor) {
          if (pick === 0 && grassFromGround) {
            // Grass takes the colour of the ground it grows from, a little lighter where it catches the sun.
            groundColour(this.paint, px, pz, this.tint).multiplyScalar(0.95 + r1 * 0.45);
            kind.mesh.setColorAt(at, this.tint);
          } else kind.mesh.setColorAt(at, kind.colours[Math.floor(r1 * 97) % kind.colours.length]!);
        }
        this.counts[pick] = at + 1;
      }
    }
    this.kinds.forEach((k, i) => {
      k.mesh.count = this.counts[i]!;
      k.mesh.instanceMatrix.needsUpdate = true;
      if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
    });
  }

  /** Force a refill (after the field changed). */
  refresh(): void {
    const x = this.cx;
    const z = this.cz;
    this.cx = -9999;
    this.update(x + 0.5, z + 0.5);
  }

  get meshes(): THREE.InstancedMesh[] {
    return this.kinds.map((k) => k.mesh);
  }

  dispose(): void {
    for (const k of this.kinds) k.mesh.geometry.dispose();
    this.grassMat.map?.dispose();
    this.grassMat.dispose();
    this.stoneMat.dispose();
  }
}

/** Reeds along temperate and steppe banks (static), sharing the grass material. */
export function reeds(map: BattleMap, layout: Layout, hf: Heightfield, grass: THREE.InstancedMesh, seed: number): THREE.InstancedMesh | null {
  if (map.biome === 'desert' || map.biome === 'winter') return null;
  const spots: [number, number][] = [];
  const rnd = stream(seed ^ 0x4eed);
  for (let z = -MARGIN; z < map.h + MARGIN; z += 0.18)
    for (let x = -MARGIN; x < map.w + MARGIN; x += 0.18) {
      const jx = x + (rnd() - 0.5) * 0.18;
      const jz = z + (rnd() - 0.5) * 0.18;
      const d = layout.sample(layout.distWater, jx, jz);
      if (d < 0.35 || d > 1.0) continue;
      if (rnd() > 0.5) continue;
      const cx = Math.floor(jx);
      const cz = Math.floor(jz);
      if (cx >= 0 && cz >= 0 && cx < map.w && cz < map.h) {
        const c = map.cells[cz * map.w + cx];
        if (c === BRIDGE || c === ROAD || c === BUILDING) continue;
      }
      spots.push([jx, jz]);
    }
  if (!spots.length) return null;
  const mesh = new THREE.InstancedMesh(grass.geometry, grass.material, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const cols = ['#56603a', '#606a40', '#6d6c48'].map((c) => new THREE.Color(c));
  spots.forEach(([x, z], i) => {
    const s = 1.4 + rnd() * 1.2;
    q.setFromAxisAngle(up, rnd() * 6);
    m.compose(new THREE.Vector3(x, Math.max(hf.at(x, z), hf.surfaceAt(x, z)) - 0.01, z), q, new THREE.Vector3(s * 0.8, s * clamp(1.6 + rnd()), s * 0.8));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, cols[i % cols.length]!);
  });
  mesh.receiveShadow = true;
  mesh.name = 'reeds';
  return mesh;
}
