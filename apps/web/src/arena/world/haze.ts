import type * as THREE from 'three';
import { MARGIN } from './height';

// Beyond the field the land melts into the haze: anything drawn in the margin (ground, roads,
// the river, trees) fades to the fog colour with its distance outside the field, so the battle
// sits in a wider country that dissolves rather than on a board with edges.

export interface FieldUniform {
  uField: { value: THREE.Vector4 };
}

/** Patch a material's shader (inside onBeforeCompile) to fade into the fog outside the field. */
export function edgeHaze(shader: THREE.WebGLProgramParametersWithUniforms, field: FieldUniform): void {
  Object.assign(shader.uniforms, field);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vHazeXZ;').replace(
    '#include <project_vertex>',
    `#include <project_vertex>
#ifdef USE_INSTANCING
vHazeXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
#else
vHazeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
#endif`,
  );
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHazeXZ;\nuniform vec4 uField;').replace(
    '#include <fog_fragment>',
    `#include <fog_fragment>
#ifdef USE_FOG
{
  float outside = max(max(uField.x - vHazeXZ.x, vHazeXZ.x - uField.z), max(uField.y - vHazeXZ.y, vHazeXZ.y - uField.w));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(1.5, ${(MARGIN - 0.5).toFixed(1)}, outside));
}
#endif`,
  );
}

export interface GradeUniform {
  uDesat: { value: number };
  /** The grey it pulls toward: cool under the moon, faintly warm in daylight haze. */
  uGradeTint: { value: THREE.Vector3 };
}

/**
 * The documentary grade: pull colour toward grey before tone mapping (a little by day, a lot
 * under the moon). Wraps whatever the material already does to its shader.
 */
export function addGrade(material: THREE.Material, grade: GradeUniform): void {
  const prev = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, grade);
    // Light that a surface gives off itself (lit windows) keeps its colour.
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDesat;\nuniform vec3 uGradeTint;').replace(
      '#include <tonemapping_fragment>',
      `{
  vec3 lit = gl_FragColor.rgb - totalEmissiveRadiance;
  lit = mix(lit, vec3(dot(lit, vec3(0.2126, 0.7152, 0.0722))) * uGradeTint, uDesat);
  gl_FragColor.rgb = lit + totalEmissiveRadiance;
}
#include <tonemapping_fragment>`,
    );
  };
  material.customProgramCacheKey = () => `${key}|graded`;
}

/** Keep only diffuse light (leaves and grass have no shine worth the sky's reflection at grazing angles). */
export function matte(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular = vec3(0.0);');
}
