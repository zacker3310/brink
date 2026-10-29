// The effects shader: one instanced quad per sprite, smoke and fire in the same sorted draw call,
// blended with premultiplied alpha.
// Smoke: lit like a volume from the atlas normals (sun side bright, underside in shade, a silver
// rim when backlit, fire glowing on its belly), soft where it meets the ground and near the camera.
// Fire: flames in heat colours eroding through turbulence as they cool, soft glows, ground glows,
// and streaks stretched along a world axis for tracers and sparks. Fire adds light; flames also
// hold back a little of what is behind them.

const CAMERA_AXES = /* glsl */ `
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camBack = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
`;

const VARYINGS = /* glsl */ `
varying vec2 vUv;
varying vec2 vQ;
varying vec2 vRot;
varying vec4 vColor; // colour, and fire glow (smoke) or intensity (fire)
varying vec4 vP; // smoke: alpha, thickness, heat, ring | fire: hold-back, heat, streak length, width
varying vec3 vM; // fire (1) or smoke (0), shape (fire) or flat (smoke), height above ground (smoke)
varying float vSoft;
`;

export const FX_VERT = /* glsl */ `
// Smoke: iA position, size | iB rotation, alpha, flat, ground height | iC colour, fire glow | iD thickness, heat, ring, frame 0..3
// Fire:  iA position, size | iB streak axis, hold-back | iC colour, intensity | iD rotation, heat, shape, frame 8..11
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iD;
${VARYINGS}
#include <fog_pars_vertex>
void main() {
  ${CAMERA_AXES}
  vec2 q = position.xy;
  bool fire = iD.w > 7.5;
  float frame = fire ? iD.w - 8.0 : iD.w;
  vUv = (vec2(mod(frame, 2.0), floor(frame * 0.5)) + q * 0.98 + 0.5) * 0.5;
  vColor = iC;
  vSoft = 1.0;
  vec3 wp;
  if (fire) {
    float shape = iD.z;
    vM = vec3(1.0, shape, 1.0);
    vP = vec4(iB.w, iD.y, 0.0, iA.w);
    if (shape > 1.5 && shape < 2.5) {
      float len = length(iB.xyz);
      vec3 dir = len > 1e-5 ? iB.xyz / len : camUp;
      vec3 side = cross(dir, normalize(cameraPosition - iA.xyz));
      float sl = length(side);
      side = sl > 1e-4 ? side / sl : camRight;
      // The head sits on the particle; the tail trails back along the axis.
      float along = mix(-len - iA.w * 0.5, iA.w * 0.5, q.y + 0.5);
      wp = iA.xyz + dir * along + side * q.x * iA.w;
      vQ = vec2(q.x * 2.0, along);
      vP.z = len;
      vRot = vec2(1.0, 0.0);
    } else {
      float c = cos(iD.x);
      float s = sin(iD.x);
      vec2 rq = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
      wp = shape > 2.5 ? iA.xyz + vec3(rq.x, 0.0, -rq.y) * iA.w : iA.xyz + (camRight * rq.x + camUp * rq.y) * iA.w;
      vQ = q * 2.0;
      vRot = vec2(c, s);
    }
  } else {
    float c = cos(iB.x);
    float s = sin(iB.x);
    vec2 rq = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    wp = iB.z > 0.5 ? iA.xyz + vec3(rq.x, 0.0, -rq.y) * iA.w : iA.xyz + (camRight * rq.x + camUp * rq.y) * iA.w;
    vQ = q;
    vRot = vec2(c, s);
    vP = vec4(iB.y, iD.x, iD.y, iD.z);
    vM = vec3(0.0, iB.z, wp.y - iB.w);
    vSoft = max(0.04, iA.w * 0.3);
  }
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // A smoke sprite reaching the camera fades instead of filling the screen.
  if (!fire) vP.x *= clamp((-mvPosition.z - 0.25) / max(0.1, iA.w * 0.9), 0.0, 1.0);
  #include <fog_vertex>
}
`;

export const FX_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uFire;
uniform float uThermal;
${VARYINGS}
#include <fog_pars_fragment>
vec3 heat(float t) {
  vec3 c = mix(vec3(0.0), vec3(0.32, 0.03, 0.0), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3(0.92, 0.2, 0.02), smoothstep(0.25, 0.55, t));
  c = mix(c, vec3(1.0, 0.48, 0.1), smoothstep(0.5, 0.8, t));
  c = mix(c, vec3(1.0, 0.76, 0.46), smoothstep(0.8, 1.0, t));
  return c * (0.5 + 1.8 * t);
}
void main() {
  ${CAMERA_AXES}
  vec4 t = texture2D(uMap, vUv);
  vec3 col;
  float a;
  bool fire = vM.x > 0.5;
  if (fire) {
    float shape = vM.y;
    a = 0.0;
    if (shape < 0.5) {
      // Flame: the turbulence burns away as the flame cools.
      float m = t.a * (0.35 + 0.65 * t.b);
      float e = smoothstep(1.0 - vP.y - 0.05, 1.0 - vP.y + 0.35, m);
      col = heat(clamp(m * (0.25 + 0.72 * vP.y), 0.0, 1.0)) * e;
      a = vP.x * e * t.a;
    } else if (shape < 1.5 || shape > 2.5) {
      float r2 = dot(vQ, vQ);
      float g = (exp(-r2 * 6.0) * 0.8 + exp(-r2 * 2.0) * 0.35) * clamp(1.0 - r2, 0.0, 1.0);
      col = vColor.rgb * g;
    } else {
      // Streak: a hot white core, a coloured halo, a tail fading back from the head.
      float x2 = vQ.x * vQ.x;
      float along = vQ.y;
      float tail = along < 0.0 ? clamp(1.0 + along / max(vP.z, 1e-4), 0.0, 1.0) : 1.0 - smoothstep(0.0, vP.w * 0.5, along);
      float across = exp(-x2 * 5.0) * clamp(1.0 - x2, 0.0, 1.0);
      float core = exp(-x2 * 28.0);
      col = (vColor.rgb * across + vec3(1.0, 0.95, 0.85) * core * 0.9) * tail * tail;
    }
    col *= vColor.a;
    if (uThermal > 0.5) col = vec3(dot(col, vec3(0.4, 0.4, 0.2)) * 1.8);
    if (max(max(col.r, col.g), col.b) < 0.002 && a < 0.004) discard;
  } else {
    float d = t.a;
    float ring = vP.w;
    if (ring > 0.0) {
      float r = length(vQ) * 2.0;
      d *= smoothstep(ring - 0.45, ring, r) * (1.0 - smoothstep(ring, ring + 0.1, r));
    }
    a = d * vP.x * smoothstep(0.0, vSoft, vM.z);
    if (a < 0.004) discard;
    vec2 n2 = t.rg * 2.0 - 1.0;
    n2 = vec2(vRot.x * n2.x - vRot.y * n2.y, vRot.y * n2.x + vRot.x * n2.y);
    float nz = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vM.y > 0.5 ? vec3(n2.x, nz, -n2.y) : camRight * n2.x + camUp * n2.y + camBack * nz;
    float ndl = dot(n, uSunDir);
    float thick = d * vP.y;
    // Wrapped sun light; thick parts self-shadow on the side away from the sun.
    float wrap = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    float diff = wrap * wrap * (1.0 - 0.5 * thick * (1.0 - wrap));
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5) * (1.0 - 0.3 * thick);
    float behind = clamp(dot(uSunDir, -camBack), 0.0, 1.0);
    float rim = (1.0 - nz) * (1.0 - nz) * behind * (1.0 - 0.7 * d);
    col = vColor.rgb * (amb + uSunCol * (diff + rim));
    // Fire under a column lights its belly.
    col += uFire * vColor.a * (0.45 + 0.55 * clamp(0.5 - n.y, 0.0, 1.0)) * (0.5 + 0.5 * d);
    if (uThermal > 0.5) {
      // Thermal sees through most of it: grey, thin, warmer where it is fresh or near fire.
      col = vec3(0.1 + 0.55 * vP.z + 0.04 * diff);
      a *= 0.25;
    }
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    if (fire) gl_FragColor.rgb *= 1.0 - fogFactor;
    else gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
  // Premultiplied: smoke covers what is behind it; fire adds light and holds back only its alpha.
  if (!fire) gl_FragColor.rgb *= gl_FragColor.a;
}
`;
