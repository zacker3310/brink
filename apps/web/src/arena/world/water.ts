import * as THREE from 'three';
import type { Biome } from '@brink/arena/v2';
import { edgeHaze, type FieldUniform } from './haze';
import { MARGIN, type Heightfield } from './height';
import { clamp, fbm, lattice } from './noise';

// The river: a surface at the water level over every river cell and its banks (the banks' ground
// hides the edge, so the shoreline is wherever the ground rises out of it), tinted by depth,
// rippled by two scrolling normal layers, iced along the edges in winter.

function rippleNormals(size: number, seed: number): THREE.DataTexture {
  const t = lattice(seed ^ 0x3a7e);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fbm(t, (x / size) * 8, (y / size) * 8, 3, 8);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = h[y * size + ((x + 1) % size)]! - h[y * size + ((x + size - 1) % size)]!;
      const dy = h[((y + 1) % size) * size + x]! - h[((y + size - 1) % size) * size + x]!;
      const v = new THREE.Vector3(-dx * 7, -dy * 7, 1).normalize();
      const k = (y * size + x) * 4;
      data[k] = (v.x * 0.5 + 0.5) * 255;
      data[k + 1] = (v.y * 0.5 + 0.5) * 255;
      data[k + 2] = (v.z * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const COLOURS: Record<Biome, { deep: string; shallow: string }> = {
  temperate: { deep: '#1d2924', shallow: '#4c4a36' },
  steppe: { deep: '#1f2822', shallow: '#4f4a38' },
  desert: { deep: '#253834', shallow: '#6d6a50' },
  winter: { deep: '#1a242a', shallow: '#3b464b' },
  urban: { deep: '#1f2627', shallow: '#46463c' },
};

export interface WaterUniforms {
  uTime: { value: number };
  uIce: { value: number };
  uRain: { value: number };
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
}

export class Water {
  readonly mesh: THREE.Mesh | null = null;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: WaterUniforms;
  private readonly normals: THREE.DataTexture;

  constructor(hf: Heightfield, biome: Biome, seed: number, field: FieldUniform) {
    const L = hf.layout;
    const pal = COLOURS[biome] ?? COLOURS.temperate;
    this.uniforms = {
      uTime: { value: 0 },
      uIce: { value: biome === 'winter' ? 1 : 0 },
      uRain: { value: 0 },
      uDeep: { value: new THREE.Color(pal.deep) },
      uShallow: { value: new THREE.Color(pal.shallow) },
    };
    this.normals = rippleNormals(128, seed);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.05, normalMap: this.normals, normalScale: new THREE.Vector2(0.28, 0.28), transparent: true, envMapIntensity: 1.3 });
    const u = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      edgeHaze(shader, field);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;\nvarying vec2 vXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDepth;\nvarying vec2 vXZ;\nuniform float uTime;\nuniform float uIce;\nuniform float uRain;\nuniform vec3 uDeep;\nuniform vec3 uShallow;\nfloat gIce;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  float d = clamp(vDepth, 0.0, 1.0);
  diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, 0.8, d));
  diffuseColor.a = mix(0.55, 0.96, smoothstep(0.0, 0.5, d));
  float n = sin(vXZ.x * 3.1 + vXZ.y * 1.7) * 0.5 + sin(vXZ.x * 7.3 - vXZ.y * 5.1) * 0.25;
  // Shore ice: thick and snowy by the bank, thinning to dark grey ice, then open water.
  float ice = uIce * smoothstep(0.8, 0.3, d + n * 0.18);
  gIce = ice;
  vec3 iceColour = mix(vec3(0.3, 0.34, 0.37), vec3(0.66, 0.7, 0.73), smoothstep(0.55, 0.3, d + n * 0.1));
  diffuseColor.rgb = mix(diffuseColor.rgb, iceColour * (0.92 + n * 0.08), ice);
  diffuseColor.a = mix(diffuseColor.a, 1.0, ice);
}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
  vec2 uvA = vXZ * 0.35 + vec2(uTime * 0.035, uTime * 0.012);
  vec2 uvB = vXZ * 0.6 - vec2(uTime * 0.02, -uTime * 0.03);
  vec3 nA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(normalMap, uvB).xyz * 2.0 - 1.0;
  vec3 mapN = normalize(vec3((nA.xy + nB.xy) * (normalScale.x + uRain * 0.35) * (1.0 - gIce * 0.9), 1.0));
  normal = normalize(tbn * mapN);
}`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor + uRain * 0.08, 0.55, gIce);');
    };
    this.material.customProgramCacheKey = () => 'brink-water';

    // Only cells of river and the bank beside them.
    const res = 2;
    const nx = L.ew * res + 1;
    const nz = L.eh * res + 1;
    const keep = (ex: number, ey: number) => L.distWater[ey * L.ew + ex]! <= 1.5;
    const pos: number[] = [];
    const depth: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const vid = new Int32Array(nx * nz).fill(-1);
    const vert = (i: number, j: number) => {
      const k = j * nx + i;
      if (vid[k]! >= 0) return vid[k]!;
      const x = i / res - MARGIN;
      const z = j / res - MARGIN;
      const s = hf.surfaceAt(x, z);
      vid[k] = pos.length / 3;
      pos.push(x, s, z);
      depth.push(clamp((s - hf.at(x, z)) / 0.16, 0, 1));
      uv.push(x * 0.5, z * 0.5);
      return vid[k]!;
    };
    for (let ey = 0; ey < L.eh; ey++)
      for (let ex = 0; ex < L.ew; ex++) {
        if (!keep(ex, ey)) continue;
        for (let sj = 0; sj < res; sj++)
          for (let si = 0; si < res; si++) {
            const i = ex * res + si;
            const j = ey * res + sj;
            const a = vert(i, j);
            const b = vert(i + 1, j);
            const c = vert(i, j + 1);
            const d = vert(i + 1, j + 1);
            index.push(a, c, b, b, c, d);
          }
      }
    if (!index.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'water';
    this.mesh = mesh;
  }

  update(t: number): void {
    this.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.normals.dispose();
  }
}
