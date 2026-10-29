import * as THREE from 'three';
import type { Heightfield } from './height';

// The amber capture circle, draped on the ground: a crisp rim, a faint wash inside, and a sweep
// that fills clockwise from north as the capture progresses (0..1).

export class Zone {
  readonly group = new THREE.Group();
  private readonly uniforms = { uProgress: { value: 0 }, uTime: { value: 0 } };
  private readonly meshes: THREE.Mesh[] = [];

  constructor(hf: Heightfield, cx: number, cz: number, r: number) {
    const seg = 96;
    const rings = 10;
    const lift = 0.035;
    // Fill: a polar grid carrying its angle and radius.
    const pos: number[] = [];
    const pol: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= rings; k++)
      for (let a = 0; a <= seg; a++) {
        const rr = (k / rings) * r;
        const ang = (a / seg) * Math.PI * 2;
        const x = cx + Math.sin(ang) * rr;
        const z = cz - Math.cos(ang) * rr;
        pos.push(x, hf.at(x, z) + lift, z);
        pol.push(a / seg, k / rings);
        if (k > 0 && a > 0) {
          const p = k * (seg + 1) + a;
          const q = (k - 1) * (seg + 1) + a;
          idx.push(q - 1, q, p, q - 1, p, p - 1);
        }
      }
    const fill = new THREE.BufferGeometry();
    fill.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fill.setAttribute('aPolar', new THREE.Float32BufferAttribute(pol, 2));
    fill.setIndex(idx);
    const amber = new THREE.Color(1.0, 0.76, 0.24);
    const fillMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uColor: { value: amber } },
      vertexShader: `
attribute vec2 aPolar;
varying vec2 vPolar;
void main() {
  vPolar = aPolar;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
uniform float uProgress;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vPolar;
void main() {
  float wash = 0.03 + smoothstep(0.7, 1.0, vPolar.y) * 0.07;
  float swept = step(vPolar.x, uProgress) * (0.12 + 0.03 * sin(uTime * 3.0));
  float lead = smoothstep(0.02, 0.0, abs(vPolar.x - uProgress)) * step(0.001, uProgress) * step(uProgress, 0.999) * 0.5;
  gl_FragColor = vec4(uColor, wash + swept + lead);
}`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    // Rim: a band draped on the ground.
    const rp: number[] = [];
    const ri: number[] = [];
    const w = 0.07;
    for (let a = 0; a <= seg; a++) {
      const ang = (a / seg) * Math.PI * 2;
      for (const rr of [r - w, r]) {
        const x = cx + Math.sin(ang) * rr;
        const z = cz - Math.cos(ang) * rr;
        rp.push(x, hf.at(x, z) + lift + 0.004, z);
      }
      if (a > 0) {
        const p = a * 2;
        ri.push(p - 2, p - 1, p, p - 1, p + 1, p);
      }
    }
    const rim = new THREE.BufferGeometry();
    rim.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rim.setIndex(ri);
    const rimMat = new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    for (const [g, m] of [
      [fill, fillMat],
      [rim, rimMat],
    ] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 5;
      mesh.name = 'zone';
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  set(progress: number): void {
    this.uniforms.uProgress.value = Math.max(0, Math.min(1, progress));
  }

  update(t: number): void {
    this.uniforms.uTime.value = t;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
