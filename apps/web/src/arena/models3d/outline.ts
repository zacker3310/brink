import * as THREE from 'three';
import { teamColor } from '../palette';

// An inverted-hull outline: each mesh drawn again from behind, pushed out along smoothed normals by
// a fixed number of screen points. Units write 1 to the stencil buffer and the hull draws only where
// it is not 1, so only the outer edge shows (no lines inside, where a unit's parts overlap). Only the
// selected unit and the target in the shot card wear one (no OutlinePass, no post-processing). Hull
// geometry is made once per model geometry and shares its buffers; the materials are shared; nothing
// runs per frame. The renderer needs `stencil: true`.

export type OutlineRole = 'selected' | 'target';

/** Points of outline, and the canvas size in points (set on resize). */
const width = { value: 2 };
const thin = { value: 1.5 };
const view = { value: new THREE.Vector2(393, 852) };

export function setOutlineView(w: number, h: number): void {
  view.value.set(Math.max(1, w), Math.max(1, h));
}

/** The hull vertex: out along the smoothed normal, as seen on screen, by a constant number of points. */
const PUSH = /* glsl */ `#include <project_vertex>
  vec3 hullN = hullNormal;
  #ifdef USE_INSTANCING
  hullN = mat3(instanceMatrix) * hullN;
  #endif
  vec2 hullDir = (projectionMatrix * vec4(normalMatrix * hullN, 0.0)).xy;
  float hullLen = length(hullDir);
  if (hullLen > 1e-6) gl_Position.xy += hullDir / hullLen * outlineWidth * 2.0 / outlineView * gl_Position.w;`;

/** A unit's material marks its pixels in the stencil, so no hull draws over them. Returns it. */
export function stencilled<T extends THREE.Material>(m: T): T {
  if (m.transparent || m.stencilWrite) return m;
  m.stencilWrite = true;
  m.stencilRef = 1;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
  return m;
}

/** Hulls draw after the units (which are all at 0), so the stencil is there to test. */
export const HULL_ORDER = 1;

/**
 * A hull material in a shared colour. `soldier`: the crowd's shader hides the weapon variants a figure
 * does not carry, and so must its hull.
 */
function hullMaterial(color: THREE.Color, soldier: boolean): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, toneMapped: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc });
  m.color = color;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = soldier ? thin : width;
    shader.uniforms.outlineView = view;
    let vs = shader.vertexShader.replace('#include <project_vertex>', PUSH);
    if (soldier) vs = 'attribute float vari;\nattribute vec4 look;\n' + vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(vari - look.w) > 0.5) transformed = vec3(0.0, -1000.0, 0.0);');
    shader.vertexShader = 'attribute vec3 hullNormal;\nuniform float outlineWidth;\nuniform vec2 outlineView;\n' + vs;
  };
  m.customProgramCacheKey = () => (soldier ? 'brink-hull-soldier-1' : 'brink-hull-1');
  return m;
}

const SELECTED = new THREE.Color(0xffffff);
const MATS: Record<OutlineRole, THREE.MeshBasicMaterial> = { selected: hullMaterial(SELECTED, false), target: hullMaterial(teamColor('red'), false) };
/** The crowd's hulls: white, with each figure's role colour on its instance. */
export const SOLDIER_HULL = hullMaterial(SELECTED, true);

/** A role's colour: white for your selection, the foe colour (following the palette) for the target. */
export function hullColor(role: OutlineRole): THREE.Color {
  return role === 'selected' ? SELECTED : teamColor('red');
}

const hulls = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Normals averaged over every face that meets at a point, so the hull stays closed at hard corners
 * (split normals would open gaps there).
 */
function smoothNormals(g: THREE.BufferGeometry): Float32Array {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const at = new Map<number, number>();
  const sums: number[] = [];
  const slot = new Int32Array(n);
  if (!g.boundingSphere) g.computeBoundingSphere();
  const c = g.boundingSphere?.center ?? new THREE.Vector3();
  // Points to 1/30000 of the geometry's size, packed into one exact number: a cheap key, made once per
  // geometry when its unit is first outlined.
  const scale = 30000 / Math.max(1e-6, g.boundingSphere?.radius ?? 1);
  const q = (v: number, o: number) => Math.round((v - o) * scale) + 32768;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = (q(x, c.x) * 65536 + q(y, c.y)) * 65536 + q(z, c.z);
    let k = at.get(key);
    if (k === undefined) {
      k = sums.length;
      at.set(key, k);
      sums.push(0, 0, 0);
    }
    slot[i] = k;
    // No normals: push away from the middle instead.
    const nx = nor ? nor.getX(i) : x - c.x;
    const ny = nor ? nor.getY(i) : y - c.y;
    const nz = nor ? nor.getZ(i) : z - c.z;
    sums[k] = sums[k]! + nx;
    sums[k + 1] = sums[k + 1]! + ny;
    sums[k + 2] = sums[k + 2]! + nz;
  }
  for (let i = 0; i < n; i++) {
    const k = slot[i]!;
    const x = sums[k]!;
    const y = sums[k + 1]!;
    const z = sums[k + 2]!;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    out[i * 3] = x / l;
    out[i * 3 + 1] = y / l;
    out[i * 3 + 2] = z / l;
  }
  return out;
}

/** The hull of a geometry: its own buffers (position, index, and any `keep`), plus smoothed normals. */
export function hullOf(g: THREE.BufferGeometry, keep: readonly string[] = []): THREE.BufferGeometry {
  const hit = hulls.get(g);
  if (hit) return hit;
  const h = new THREE.BufferGeometry();
  h.setAttribute('position', g.attributes.position!);
  for (const k of keep) if (g.attributes[k]) h.setAttribute(k, g.attributes[k]);
  if (g.index) h.setIndex(g.index);
  h.setAttribute('hullNormal', new THREE.Float32BufferAttribute(smoothNormals(g), 3));
  if (!g.boundingSphere) g.computeBoundingSphere();
  h.boundingSphere = g.boundingSphere?.clone() ?? null;
  hulls.set(g, h);
  return h;
}

const onModel = new WeakMap<THREE.Object3D, THREE.Mesh[]>();

/** Outline a model's meshes in a role's colour, or take the outline off (null). Built once, then toggled. */
export function setOutline(root: THREE.Object3D, role: OutlineRole | null): void {
  let list = onModel.get(root);
  if (!role && !list) return;
  if (!list) {
    list = [];
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      // Not the thermal proxies or the rotor blur (it may wear an opaque thermal material just now).
      if (!m.isMesh || o.name === 'heat' || o.name === 'blur' || o.name === 'outline') return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => x.transparent)) return;
      meshes.push(m);
    });
    for (const m of meshes) {
      const hull = new THREE.Mesh(hullOf(m.geometry), MATS.selected);
      hull.name = 'outline';
      hull.renderOrder = HULL_ORDER;
      hull.raycast = () => undefined;
      m.add(hull);
      list.push(hull);
    }
    onModel.set(root, list);
  }
  for (const h of list) {
    h.visible = !!role;
    if (role) h.material = MATS[role];
  }
}

/** Free the hull geometries with the models' own (leaving the battle): they share buffers. */
export function disposeOutlines(): void {
  for (const h of hulls.values()) h.dispose();
  hulls.clear();
}
