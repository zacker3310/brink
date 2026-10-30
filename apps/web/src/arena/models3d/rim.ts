import type * as THREE from 'three';
import type { Side } from '@brink/arena';
import { rimColor } from '../palette';

// A team-tinted fresnel rim on every unit (the TF2 trick): surfaces turning away from the eye pick up
// their side's colour, so a unit parts from the ground by its edge as well as by its badge. Injected
// into the materials the units already wear: no extra pass. Colour and strength are shared uniforms,
// set when the palette or the light changes, so nothing runs per frame.

type Time = 'dawn' | 'day' | 'dusk' | 'night';

const strength = { value: 0.22 };
/** Each rimmed material's own gain (0 on a wreck). Not in userData: a clone would copy it as JSON. */
const gains = new WeakMap<THREE.Material, { value: number }>();
const colour: Record<Side, { value: THREE.Color }> = { blue: { value: rimColor('blue') }, red: { value: rimColor('red') } };

/** Subtle by day, stronger at dawn and dusk, strongest at night, when the edge is most of what you see. */
export function setRimLight(time: Time): void {
  strength.value = time === 'night' ? 0.5 : time === 'day' ? 0.22 : 0.34;
}

/** The shared uniforms, for a shader that picks the side per instance (the soldiers). */
export function rimUniforms(): { rimBlue: { value: THREE.Color }; rimRed: { value: THREE.Color }; rimStrength: { value: number } } {
  return { rimBlue: colour.blue, rimRed: colour.red, rimStrength: strength };
}

/** Fresnel cubed: a thin edge, not a glow. `normal` and `vViewPosition` are the standard material's own. */
export const RIM_TERM = /* glsl */ `pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0)`;

/** Give a unit's material the rim in its side's colour, after any shader edit it already has. */
export function addRim(mat: THREE.Material, side: Side): void {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.transparent || gains.has(m)) return;
  const gain = { value: 1 };
  gains.set(m, gain);
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.uniforms.rimColor = colour[side];
    shader.uniforms.rimStrength = strength;
    shader.uniforms.rimGain = gain;
    shader.fragmentShader =
      'uniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimGain;\n' +
      shader.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight += rimColor * (rimStrength * rimGain * ${RIM_TERM});\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${key}+rim`;
}

/** A wreck belongs to no one: its rim goes out. */
export function rimOff(mats: readonly THREE.Material[]): void {
  for (const m of mats) {
    const gain = gains.get(m);
    if (gain) gain.value = 0;
  }
}
