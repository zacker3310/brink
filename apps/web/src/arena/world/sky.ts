import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import type { Conditions, TimeOfDay, Weather } from '@brink/arena/v2';

// Light and air for the conditions: where the sun (or moon) is and its colour, the sky's fill
// light, the exposure, the haze colour and how far one sees, and which Poly Haven sky lights the
// scene (image-based light, served from public/art/env). The visible sky is a graded dome whose
// horizon is exactly the haze colour, so the land dissolves into it.

export interface Look {
  /** Unit vector from the ground toward the sun or moon. */
  toSun: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  shadowIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  env: string;
  envIntensity: number;
  /** Azimuth of the sun in the sky image (u, 0..1), to turn the image so its sun matches ours. */
  envSunU: number;
  exposure: number;
  /** Haze and sky colours as they should appear on screen (sRGB). */
  fog: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  /** Fog distances as multiples of the camera's distance to what it looks at (near, far). */
  fogNear: number;
  fogFar: number;
  /** Fixed-distance fog for real fog: cells of visibility past the focus. */
  fogCells: number;
  /** Lit windows: share and strength. */
  windowsLit: number;
  windowGlow: number;
  wet: number;
  /** How far colour is pulled toward grey (the grade). */
  desat: number;
}

const srgb = (h: string) => new THREE.Color().setStyle(h, THREE.LinearSRGBColorSpace);
const c = (h: string) => new THREE.Color(h);

const TIMES: Record<TimeOfDay, Omit<Look, 'fogNear' | 'fogFar' | 'fogCells' | 'wet'>> = {
  dawn: {
    toSun: new THREE.Vector3(0.88, 0.16, 0.42).normalize(),
    sunColor: c('#ffb07a'),
    sunIntensity: 2.4,
    shadowIntensity: 0.85,
    hemiSky: c('#9aaac4'),
    hemiGround: c('#4a4038'),
    hemiIntensity: 0.55,
    env: 'dawn.exr',
    envIntensity: 0.5,
    envSunU: 0.625,
    exposure: 0.95,
    fog: srgb('#b4a7a2'),
    skyTop: srgb('#6c82a2'),
    skyHorizon: srgb('#d6b3a0'),
    windowsLit: 0.1,
    windowGlow: 0.6,
    desat: 0.12,
  },
  day: {
    toSun: new THREE.Vector3(-0.45, 0.72, 0.52).normalize(),
    sunColor: c('#fff4e6'),
    sunIntensity: 2.9,
    shadowIntensity: 0.9,
    hemiSky: c('#c4cfdb'),
    hemiGround: c('#5a5040'),
    hemiIntensity: 0.45,
    env: 'park.exr',
    envIntensity: 0.5,
    envSunU: 0.6,
    exposure: 1.0,
    fog: srgb('#a9b1b4'),
    skyTop: srgb('#7896b2'),
    skyHorizon: srgb('#c6cdcd'),
    windowsLit: 0,
    windowGlow: 0,
    desat: 0.16,
  },
  dusk: {
    toSun: new THREE.Vector3(-0.9, 0.12, 0.36).normalize(),
    sunColor: c('#ff9558'),
    sunIntensity: 2.2,
    shadowIntensity: 0.85,
    hemiSky: c('#8a96b8'),
    hemiGround: c('#4a3a34'),
    hemiIntensity: 0.5,
    env: 'dusk.exr',
    envIntensity: 0.45,
    envSunU: 0.6,
    exposure: 0.95,
    fog: srgb('#a4958f'),
    skyTop: srgb('#4c5b7e'),
    skyHorizon: srgb('#d69c78'),
    windowsLit: 0.14,
    windowGlow: 1.2,
    desat: 0.1,
  },
  night: {
    toSun: new THREE.Vector3(-0.32, 0.62, 0.55).normalize(),
    sunColor: c('#87a3dc'),
    sunIntensity: 0.7,
    shadowIntensity: 0.7,
    hemiSky: c('#2c4272'),
    hemiGround: c('#111216'),
    hemiIntensity: 0.55,
    env: 'night.exr',
    envIntensity: 0.45,
    envSunU: 0.34,
    exposure: 1.25,
    fog: srgb('#151b24'),
    skyTop: srgb('#060910'),
    skyHorizon: srgb('#1a2230'),
    windowsLit: 0.2,
    windowGlow: 1.7,
    desat: 0.6,
  },
};

/** How much each weather greys the light and closes in the air. */
const WEATHER: Record<Weather, { sun: number; shadow: number; hemi: number; env: number; grey: number; fogTint: string; near: number; far: number; cells: number; exposure: number; wet: number }> = {
  clear: { sun: 1, shadow: 1, hemi: 1, env: 1, grey: 0, fogTint: '#a9b1b4', near: 0.6, far: 2.8, cells: 0, exposure: 1, wet: 0 },
  overcast: { sun: 0.3, shadow: 0.35, hemi: 1.9, env: 0.8, grey: 0.65, fogTint: '#9da2a5', near: 0.5, far: 2.8, cells: 0, exposure: 1.08, wet: 0 },
  rain: { sun: 0.18, shadow: 0.25, hemi: 1.8, env: 0.75, grey: 0.8, fogTint: '#7f878b', near: 0.4, far: 2.2, cells: 0, exposure: 1.05, wet: 1 },
  fog: { sun: 0.22, shadow: 0.25, hemi: 2.0, env: 0.8, grey: 0.85, fogTint: '#b2b6b7', near: 0, far: 0, cells: 7, exposure: 1.06, wet: 0.35 },
  snow: { sun: 0.3, shadow: 0.35, hemi: 1.9, env: 0.85, grey: 0.75, fogTint: '#c3c8cb', near: 0.4, far: 2.0, cells: 0, exposure: 1.02, wet: 0 },
};

export function lookFor(cond: Conditions): Look {
  const t = TIMES[cond.time] ?? TIMES.day;
  const w = WEATHER[cond.weather] ?? WEATHER.clear;
  // Weather's grey, scaled to the light of the hour.
  const lum = t.fog.r * 0.3 + t.fog.g * 0.59 + t.fog.b * 0.11;
  const tint = srgb(w.fogTint);
  const tintLum = tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11;
  const greyFog = tint.clone().multiplyScalar(cond.time === 'day' ? 1 : lum / tintLum);
  const fog = t.fog.clone().lerp(greyFog, w.grey);
  const hemiSky = t.hemiSky.clone().lerp(new THREE.Color(0.75, 0.77, 0.8).multiplyScalar(t.hemiSky.r + t.hemiSky.g + t.hemiSky.b > 1.5 ? 1 : 0.35), w.grey * 0.6);
  return {
    ...t,
    toSun: t.toSun.clone(),
    sunColor: t.sunColor.clone().lerp(new THREE.Color(0.9, 0.92, 0.95), w.grey * 0.5),
    sunIntensity: t.sunIntensity * w.sun,
    shadowIntensity: t.shadowIntensity * w.shadow,
    hemiSky,
    hemiGround: t.hemiGround.clone(),
    hemiIntensity: t.hemiIntensity * w.hemi,
    envIntensity: t.envIntensity * w.env,
    exposure: t.exposure * w.exposure,
    fog,
    skyTop: t.skyTop.clone().lerp(fog.clone().multiplyScalar(0.92), w.grey),
    skyHorizon: t.skyHorizon.clone().lerp(fog, Math.max(w.grey, 0.0)),
    fogNear: cond.time === 'night' && cond.weather === 'clear' ? 0.6 : w.near,
    fogFar: cond.time === 'night' && cond.weather === 'clear' ? 2.7 : w.far,
    fogCells: w.cells,
    wet: w.wet,
    desat: Math.min(0.75, t.desat + w.grey * 0.12),
  };
}

// --- Sky dome ------------------------------------------------------------------------------------

export function skyDome(look: Look): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const v3 = (col: THREE.Color) => new THREE.Vector3(col.r, col.g, col.b);
  const uniforms: Record<string, THREE.IUniform> = {
    uTop: { value: v3(look.skyTop) },
    uHorizon: { value: v3(look.skyHorizon) },
    uFog: { value: v3(look.fog) },
    uSunDir: { value: look.toSun.clone() },
    uSun: { value: v3(look.sunColor.clone().convertLinearToSRGB()) },
    uSunAmount: { value: Math.min(1, look.sunIntensity / 2.5) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`,
    fragmentShader: `
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform float uSunAmount;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  // A band of haze sitting on the horizon, and the land's haze below it.
  col = mix(col, uFog, smoothstep(0.12, 0.0, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSun * (pow(s, 600.0) * 1.2 + pow(s, 24.0) * 0.18 + pow(s, 4.0) * 0.06) * uSunAmount;
  gl_FragColor = vec4(col, 1.0);
}`,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

// --- Image-based light ---------------------------------------------------------------------------

const skies = new Map<string, Promise<THREE.DataTexture>>();

/** Load (once) a sky image from public/art/env. */
export function loadSky(file: string): Promise<THREE.DataTexture> {
  let p = skies.get(file);
  if (!p) {
    const loader = new EXRLoader();
    loader.setDataType(THREE.FloatType);
    p = loader.loadAsync(`${import.meta.env.BASE_URL}art/env/${file}`).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      // Keep the sky's light and shape, drop most of its colour: a park's blue sky and green
      // lawn would tint every wall lavender. The grade wants grey daylight.
      const d = t.image.data as unknown as Float32Array;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i]! * 0.2126 + d[i + 1]! * 0.7152 + d[i + 2]! * 0.0722;
        d[i] = l + (d[i]! - l) * 0.35;
        d[i + 1] = l + (d[i + 1]! - l) * 0.35;
        d[i + 2] = l + (d[i + 2]! - l) * 0.35;
      }
      t.needsUpdate = true;
      return t;
    });
    p.catch(() => skies.delete(file));
    skies.set(file, p);
  }
  return p;
}

/** Turn the sky image about the vertical so its sun stands where ours does. */
export function skyRotation(look: Look): number {
  const want = Math.atan2(look.toSun.z, look.toSun.x);
  const have = (look.envSunU - 0.5) * Math.PI * 2;
  return have - want;
}
