import * as THREE from 'three';

// The white-hot thermal view. Every world surface gets a cached flat material whose grey is its
// heat (cool fields, warmer roads and walls, windows leaking heat, cold water), keeping only the
// alpha of leaves, grass and road edges; a full-screen quad lays sensor grain and a vignette over
// the picture. `thermalMaterialFor` gives the lead the same look for units.

const unitCache = new Map<number, THREE.MeshBasicMaterial>();

/** A white-hot material for a heat level 0 (ambient) .. 1 (hot engine, a running man). */
export function thermalMaterialFor(level: number): THREE.Material {
  const k = Math.round(Math.max(0, Math.min(1, level)) * 32);
  let m = unitCache.get(k);
  if (!m) {
    const v = 0.22 + (k / 32) * 0.78;
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(v, v, v, THREE.SRGBColorSpace), toneMapped: false, fog: true });
    m.name = `thermal-${k}`;
    unitCache.set(k, m);
  }
  return m;
}

/**
 * A thermal stand-in for a world material: a flat grey heat, varied a little by the original
 * texture's light and dark, keeping its alpha (cards, road edges).
 */
export function thermalLike(src: THREE.Material, heat: number, spread = 0.12): THREE.MeshBasicMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshBasicMaterial({
    map: s.map ?? null,
    alphaTest: s.alphaTest,
    transparent: s.transparent,
    side: s.side,
    toneMapped: false,
    depthWrite: s.depthWrite,
    polygonOffset: s.polygonOffset,
    polygonOffsetFactor: s.polygonOffsetFactor,
    polygonOffsetUnits: s.polygonOffsetUnits,
  });
  const u = { uHeat: { value: heat }, uSpread: { value: spread } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHeat;\nuniform float uSpread;').replace(
      '#include <map_fragment>',
      `#include <map_fragment>
{
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  // Heat is the grey seen on screen: back to linear for the output conversion.
  diffuseColor.rgb = vec3(pow(clamp(uHeat + (lum - 0.35) * uSpread, 0.0, 1.0), 2.2));
}`,
    );
  };
  m.customProgramCacheKey = () => `thermal-like-${heat.toFixed(3)}-${spread.toFixed(3)}-${!!s.map}`;
  return m;
}

/** Grain and vignette over the whole screen, in front of everything. */
export function thermalOverlay(): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 }, uGrain: { value: 0.09 }, uVignette: { value: 0.55 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
    fragmentShader: `
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
varying vec2 vUv;
float h(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  float n = h(floor(gl_FragCoord.xy * 0.75) + fract(uTime * 7.31) * 113.0);
  vec2 c = vUv - 0.5;
  float vig = smoothstep(0.35, 0.85, length(c * vec2(1.0, 0.8))) * uVignette;
  // Scan bands drift slowly, as on a real sensor.
  float band = sin(vUv.y * 380.0 + uTime * 3.0) * 0.012;
  float a = clamp(uGrain + vig + abs(band), 0.0, 1.0);
  vec3 col = vec3(n) * uGrain / max(a, 0.001);
  gl_FragColor = vec4(col, a);
}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.visible = false;
  mesh.name = 'thermal-overlay';
  return { mesh, uniforms };
}

/** Swaps world materials for thermal ones and back. */
export class ThermalSwap {
  private readonly saved = new Map<THREE.Mesh, { material: THREE.Material | THREE.Material[]; instanceColor: THREE.InstancedBufferAttribute | null }>();
  private readonly made = new Set<THREE.Material>();
  on = false;

  /** `pick` returns the thermal material for a mesh (built once and cached by the caller). */
  apply(meshes: THREE.Mesh[], pick: (mesh: THREE.Mesh) => THREE.Material): void {
    if (this.on) return;
    this.on = true;
    for (const mesh of meshes) {
      const inst = mesh as THREE.InstancedMesh;
      this.saved.set(mesh, { material: mesh.material, instanceColor: inst.isInstancedMesh ? inst.instanceColor : null });
      const t = pick(mesh);
      this.made.add(t);
      mesh.material = t;
      // Instance tints are colour; heat is grey.
      if (inst.isInstancedMesh) inst.instanceColor = null;
    }
  }

  restore(): void {
    if (!this.on) return;
    this.on = false;
    for (const [mesh, s] of this.saved) {
      mesh.material = s.material;
      const inst = mesh as THREE.InstancedMesh;
      if (inst.isInstancedMesh) inst.instanceColor = s.instanceColor;
    }
    this.saved.clear();
  }

  /** Whether a mesh is currently showing a thermal material. */
  has(mesh: THREE.Mesh): boolean {
    return this.saved.has(mesh);
  }

  dispose(): void {
    this.restore();
    for (const m of this.made) m.dispose();
    this.made.clear();
  }
}
