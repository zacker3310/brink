import * as THREE from 'three';
import type { Quality } from '../quality';
import { MARGIN, type Heightfield } from './height';
import { stream } from './noise';

// Weather that moves: rain streaks and snowflakes in a box that follows what the camera looks at
// (each drop keeps its place in the world; the box wraps round it, so nothing swims), and low mist
// lying in hollows and along the river. All of it is animated on the GPU from a time uniform.

const BOX = new THREE.Vector3(26, 14, 26);

export class Precipitation {
  readonly mesh: THREE.LineSegments | THREE.Points;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(kind: 'rain' | 'snow', quality: Quality, seed: number, night: boolean) {
    const count = kind === 'rain' ? { low: 1400, balanced: 2800, high: 6000 }[quality] : { low: 1500, balanced: 3000, high: 6500 }[quality];
    const rnd = stream(seed ^ 0x7a1);
    const vel = kind === 'rain' ? new THREE.Vector3(1.2, -16, 0.6) : new THREE.Vector3(0.35, -0.9, 0.15);
    this.uniforms = {
      uTime: { value: 0 },
      uCentre: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uVel: { value: vel },
      uStreak: { value: 0.55 },
      uScale: { value: 400 },
      uColor: { value: night ? new THREE.Color(0.45, 0.5, 0.58) : new THREE.Color(0.78, 0.8, 0.84) },
    };
    const g = new THREE.BufferGeometry();
    if (kind === 'rain') {
      const pos = new Float32Array(count * 6);
      const end = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const x = rnd() * BOX.x;
        const y = rnd() * BOX.y;
        const z = rnd() * BOX.z;
        pos.set([x, y, z, x, y, z], i * 6);
        end[i * 2] = 0;
        end[i * 2 + 1] = 1;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    } else {
      const pos = new Float32Array(count * 3);
      const ph = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        pos.set([rnd() * BOX.x, rnd() * BOX.y, rnd() * BOX.z], i * 3);
        ph[i] = rnd() * 100;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(ph, 1));
    }
    const vertexShader = `
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uStreak;
uniform float uScale;
attribute float aEnd;
varying float vFade;
void main() {
  vec3 base = uCentre - uBox * 0.5;
  vec3 p = position + uVel * uTime;
  ${kind === 'snow' ? 'p.x += sin(uTime * 0.9 + aEnd) * 0.35; p.z += cos(uTime * 0.7 + aEnd * 1.3) * 0.35;' : ''}
  p = base + mod(p - base, uBox);
  ${kind === 'rain' ? 'p -= normalize(uVel) * uStreak * aEnd;' : ''}
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fade at the box's edges so it has no visible walls.
  vec3 q = abs(p - uCentre) / (uBox * 0.5);
  vFade = 1.0 - smoothstep(0.7, 1.0, max(q.x, q.z));
  ${kind === 'snow' ? 'gl_PointSize = uScale * 0.045 / max(0.5, -mv.z);' : ''}
}`;
    const fragmentShader = `
uniform vec3 uColor;
varying float vFade;
void main() {
  ${kind === 'snow' ? 'vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(c));' : 'float a = 1.0;'}
  gl_FragColor = vec4(uColor, a * vFade * ${kind === 'rain' ? '0.32' : '0.85'});
}`;
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false });
    this.mesh = kind === 'rain' ? new THREE.LineSegments(g, material) : new THREE.Points(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.name = kind;
  }

  update(t: number, focus: THREE.Vector3, pixelHeight: number): void {
    this.uniforms.uTime!.value = t;
    (this.uniforms.uCentre!.value as THREE.Vector3).set(focus.x, focus.y + BOX.y * 0.35, focus.z);
    this.uniforms.uScale!.value = pixelHeight;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function mistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rnd = stream(31);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rnd() * 48;
    const y = 48 + rnd() * 32;
    const r = 12 + rnd() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  // Fade every edge to nothing, so no sheet shows its outline.
  const img = g.getImageData(0, 0, 128, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const dx = (x - 63.5) / 64;
      const dy = (y - 63.5) / 64;
      const k = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      img.data[(y * 128 + x) * 4 + 3] = img.data[(y * 128 + x) * 4 + 3]! * Math.min(1, k * 2.2);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Low mist: soft camera-facing sheets in the hollows and over the river. */
export class Mist {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly tex: THREE.CanvasTexture;

  constructor(hf: Heightfield, w: number, h: number, seed: number, amount: number, color: THREE.Color) {
    const rnd = stream(seed ^ 0x3157);
    const spots: [number, number, number, number][] = [];
    const L = hf.layout;
    for (let z = -MARGIN * 0.6; z < h + MARGIN * 0.6; z += 1.6)
      for (let x = -MARGIN * 0.6; x < w + MARGIN * 0.6; x += 1.6) {
        const px = x + rnd() * 1.6;
        const pz = z + rnd() * 1.6;
        const here = hf.at(px, pz);
        const around = (hf.at(px - 2, pz) + hf.at(px + 2, pz) + hf.at(px, pz - 2) + hf.at(px, pz + 2)) / 4;
        const hollow = around - here;
        const river = L.sample(L.distWater, px, pz) < 1.5;
        const keep = river ? 0.75 : hollow > 0.03 ? 0.6 : 0.16 * amount;
        if (rnd() > keep) continue;
        spots.push([px, here + 0.12 + rnd() * 0.25, pz, 2.5 + rnd() * 3.5]);
      }
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position!);
    geo.setAttribute('uv', plane.attributes.uv!);
    const off = new Float32Array(spots.length * 4);
    spots.forEach((s, i) => off.set(s, i * 4));
    geo.setAttribute('aSpot', new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = spots.length;
    this.tex = mistTexture();
    this.uniforms = { uTime: { value: 0 }, uMap: { value: this.tex }, uColor: { value: color.clone() }, uAmount: { value: amount } };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
attribute vec4 aSpot;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vec3 centre = aSpot.xyz + vec3(sin(uTime * 0.05 + aSpot.x) * 0.6, 0.0, cos(uTime * 0.04 + aSpot.z) * 0.4);
  vec4 mv = modelViewMatrix * vec4(centre, 1.0);
  // Sheets lie flat-ish: wide across the view, squashed in height.
  mv.xy += position.xy * vec2(aSpot.w, aSpot.w * 0.45);
  vFade = smoothstep(1.0, 4.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;
varying float vFade;
void main() {
  float a = texture2D(uMap, vUv).a * uAmount * vFade;
  gl_FragColor = vec4(uColor, a);
}`,
      transparent: true,
      depthWrite: false,
      // Low sheets would cut hard lines where they meet the ground; mist lies over everything instead.
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.name = 'mist';
  }

  update(t: number): void {
    this.uniforms.uTime!.value = t;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
