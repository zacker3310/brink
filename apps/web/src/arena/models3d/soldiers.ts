import * as THREE from 'three';
import { METRE } from '../quality';
import type { SoldierKit } from './dims';
import { convex, creaseNormals, cyl, lathe, loft, superellipse, type V3 } from './kit';
import { HULL_ORDER, hullColor, hullOf, SOLDIER_HULL, stencilled, type OutlineRole } from './outline';
import { RIM_TERM, rimUniforms } from './rim';

// Soldiers as articulated figures, every body part one instanced mesh for the whole battle (head and
// helmet, torso with plate carrier, pack, upper and lower arms, upper and lower legs, and a mesh per
// weapon family), so 400 soldiers draw in 12 calls. Each soldier is posed in code every frame: a pose
// sets the pelvis, torso, head, feet and weapon; arms reach the weapon's grips and legs the feet by
// two-bone IK; pose changes blend. Uniforms are coloured in the shader by part: OCP-like for the West,
// EMR digital flora for the East, with a slight shade and skin variation per soldier.

export type Pose = 'stand' | 'walk' | 'run' | 'kneel' | 'prone' | 'aim' | 'fire' | 'throw' | 'dead' | 'wounded';

// --- Colour slots (per vertex) ------------------------------------------------------------------------

const UNIFORM = 0;
const GEAR = 1;
const HELMET = 2;
const SKIN = 3;
const BOOTS = 4;
const METAL = 5;
const FURNITURE = 6;
const LAUNCHER = 7;
const PACK = 8;

// --- Weapons ---------------------------------------------------------------------------------------------

type WeaponMesh = 'rifle' | 'mg' | 'sniper' | 'tube' | 'heavy';
type Hold = 'rifle' | 'shoulder' | 'ground' | 'hand';

interface KitDef {
  mesh: WeaponMesh;
  variant: number;
  hold: Hold;
  /** Right and left hand grips in the weapon's frame (metres). */
  gripR: V3;
  gripL: V3;
  /** Pack size. */
  pack: number;
  /** Seconds between recoil kicks when firing. */
  cycle: number;
  kick: number;
}

const KITS: Record<SoldierKit, KitDef> = {
  rifle: { mesh: 'rifle', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.01, 0.27], pack: 1, cycle: 0.32, kick: 1 },
  grenadier: { mesh: 'rifle', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.03, 0.24], pack: 1, cycle: 0.32, kick: 1 },
  medic: { mesh: 'rifle', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.01, 0.27], pack: 1.35, cycle: 0.32, kick: 1 },
  sapper: { mesh: 'rifle', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.01, 0.27], pack: 1.5, cycle: 0.32, kick: 1 },
  saw: { mesh: 'mg', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.02, 0.3], pack: 1, cycle: 0.08, kick: 0.7 },
  pkm: { mesh: 'mg', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.02, 0.3], pack: 1, cycle: 0.09, kick: 0.7 },
  sniper: { mesh: 'sniper', variant: 0, hold: 'rifle', gripR: [0, 0, 0], gripL: [0, -0.03, 0.34], pack: 0.9, cycle: 1.6, kick: 1.6 },
  rpg: { mesh: 'tube', variant: 0, hold: 'shoulder', gripR: [0, -0.07, 0], gripL: [0, -0.07, 0.24], pack: 1.2, cycle: 3, kick: 2 },
  at4: { mesh: 'tube', variant: 1, hold: 'shoulder', gripR: [0, -0.07, 0], gripL: [0, -0.07, 0.26], pack: 1, cycle: 3, kick: 2 },
  gustaf: { mesh: 'tube', variant: 2, hold: 'shoulder', gripR: [0, -0.08, 0], gripL: [0, -0.08, 0.3], pack: 1.2, cycle: 3, kick: 2 },
  manpads: { mesh: 'tube', variant: 3, hold: 'shoulder', gripR: [0, -0.08, 0], gripL: [0, -0.08, 0.28], pack: 1, cycle: 4, kick: 1.5 },
  javelin: { mesh: 'heavy', variant: 0, hold: 'shoulder', gripR: [0, -0.1, 0], gripL: [0.04, -0.1, 0.14], pack: 1.1, cycle: 4, kick: 1.2 },
  kornet: { mesh: 'heavy', variant: 1, hold: 'ground', gripR: [-0.12, 0.04, -0.3], gripL: [0.12, 0.04, -0.3], pack: 1.1, cycle: 4, kick: 0.6 },
  mortar: { mesh: 'heavy', variant: 2, hold: 'ground', gripR: [0.0, 0.5, 0.38], gripL: [0.06, 0.25, 0.3], pack: 1.2, cycle: 2.5, kick: 0 },
  operator: { mesh: 'heavy', variant: 3, hold: 'hand', gripR: [-0.08, 0, 0], gripL: [0.08, 0, 0], pack: 1.1, cycle: 1, kick: 0 },
};

// --- Geometry ---------------------------------------------------------------------------------------------

/** A part of a soldier: triangles with a colour slot and a variant id per vertex. */
class Piece {
  pos: number[] = [];
  slot: number[] = [];
  vari: number[] = [];
  add(g: THREE.BufferGeometry, slot: number, m?: THREE.Matrix4, variant = 0): this {
    let geo = g.index ? g.toNonIndexed() : g;
    if (m) geo = geo.clone().applyMatrix4(m);
    const p = geo.attributes.position!.array as Float32Array;
    for (let i = 0; i < p.length; i++) this.pos.push(p[i]!);
    for (let i = 0; i < p.length / 3; i++) {
      this.slot.push(slot);
      this.vari.push(variant);
    }
    return this;
  }
  get tris(): number {
    return this.pos.length / 9;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('slot', new THREE.Float32BufferAttribute(this.slot, 1));
    g.setAttribute('vari', new THREE.Float32BufferAttribute(this.vari, 1));
    creaseNormals(g, 50);
    return g;
  }
}

const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const bx = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A limb segment hanging from its joint along -y: an open prism, `r0` at the joint, `r1` at the end. */
function limb(len: number, r0: number, r1: number, sides = 5, d0 = 1, d1 = 1): THREE.BufferGeometry {
  const ring = (y: number, r: number, k: number): V3[] => superellipse(r, r * k, 2, sides).map(([x, z]) => [x, y, z] as V3);
  return loft([ring(0.02, r0, d0), ring(-len, r1, d1)], [false, false]);
}

function headPiece(): Piece {
  const p = new Piece();
  // Neck and head: a rounded block, the face forward.
  const head: V3[] = [];
  for (const [y, rx, rz] of [
    [-0.02, 0.045, 0.05],
    [0.12, 0.08, 0.1],
    [0.2, 0.075, 0.095],
  ] as const)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
      head.push([Math.cos(a) * rx, y, Math.sin(a) * rz + 0.01]);
    }
  p.add(convex(head), SKIN);
  // Helmet with its brim, sitting low over the ears; night vision mount on the front.
  p.add(
    lathe(
      [
        [0.128, 0.125],
        [0.13, 0.16],
        [0.115, 0.225],
        [0.07, 0.262],
        [0.001, 0.272],
      ],
      7,
    ),
    HELMET,
    M(0, 0, -0.008),
  );
  p.add(bx(0.05, 0.035, 0.025), METAL, M(0, 0.2, 0.125));
  return p;
}

function torsoPiece(): Piece {
  const p = new Piece();
  // Hips, chest and shoulders in one block.
  p.add(
    convex([
      [-0.16, -0.09, -0.1],
      [0.16, -0.09, -0.1],
      [-0.16, -0.09, 0.1],
      [0.16, -0.09, 0.1],
      [-0.2, 0.42, -0.09],
      [0.2, 0.42, -0.09],
      [-0.2, 0.42, 0.09],
      [0.2, 0.42, 0.09],
      [-0.08, 0.5, -0.05],
      [0.08, 0.5, -0.05],
      [-0.08, 0.5, 0.06],
      [0.08, 0.5, 0.06],
    ]),
    UNIFORM,
  );
  // Plate carrier, its front pouches and the belt.
  p.add(bx(0.33, 0.27, 0.3), GEAR, M(0, 0.31, 0.005));
  p.add(bx(0.26, 0.1, 0.05), GEAR, M(0, 0.23, 0.17));
  return p;
}

function packPiece(): Piece {
  const p = new Piece();
  p.add(convex([[-0.13, 0.12, -0.15], [0.13, 0.12, -0.15], [-0.13, 0.12, -0.3], [0.13, 0.12, -0.3], [-0.12, 0.44, -0.15], [0.12, 0.44, -0.15], [-0.1, 0.48, -0.27], [0.1, 0.48, -0.27], [0, 0.5, -0.22]]), PACK);
  return p;
}

function upperArm(): Piece {
  return new Piece().add(limb(0.31, 0.058, 0.047, 5), UNIFORM);
}

function lowerArm(): Piece {
  const p = new Piece().add(limb(0.26, 0.047, 0.036, 5), UNIFORM);
  p.add(bx(0.05, 0.09, 0.075), BOOTS, M(0, -0.3, 0.01));
  return p;
}

function upperLeg(): Piece {
  return new Piece().add(limb(0.44, 0.088, 0.064, 5, 1.1, 1), UNIFORM);
}

function lowerLeg(): Piece {
  const p = new Piece().add(limb(0.38, 0.064, 0.05, 5), UNIFORM);
  // Boot: ankle to the sole, the toe forward.
  p.add(convex([[-0.05, -0.36, -0.06], [0.05, -0.36, -0.06], [-0.05, -0.36, 0.05], [0.05, -0.36, 0.05], [-0.05, -0.5, -0.07], [0.05, -0.5, -0.07], [-0.055, -0.5, 0.18], [0.055, -0.5, 0.18], [-0.045, -0.44, 0.17], [0.045, -0.44, 0.17]]), BOOTS);
  return p;
}

/** Rifle: grip at the origin, muzzle toward +z. */
function rifle(): Piece {
  const p = new Piece();
  p.add(bx(0.04, 0.085, 0.36), METAL, M(0, 0.03, 0.04));
  p.add(bx(0.035, 0.08, 0.22), FURNITURE, M(0, 0.02, -0.24));
  p.add(bx(0.04, 0.05, 0.36), FURNITURE, M(0, 0.045, 0.38));
  p.add(bx(0.028, 0.12, 0.055), METAL, M(0, -0.06, 0.1, 0.25, 0, 0));
  p.add(bx(0.03, 0.04, 0.09), METAL, M(0, 0.095, 0.06));
  return p;
}

/** Light machine gun (M249, PKM): longer, heavier, with a belt box. */
function machineGun(): Piece {
  const p = new Piece();
  p.add(bx(0.055, 0.09, 0.4), METAL, M(0, 0.04, 0.08));
  p.add(bx(0.04, 0.09, 0.26), FURNITURE, M(0, 0.02, -0.24));
  p.add(bx(0.024, 0.024, 0.42), METAL, M(0, 0.05, 0.48));
  p.add(bx(0.07, 0.1, 0.11), FURNITURE, M(0.0, -0.05, 0.12));
  p.add(bx(0.06, 0.03, 0.2), METAL, M(0, 0.03, 0.4));
  p.add(bx(0.03, 0.08, 0.035), FURNITURE, M(0, -0.03, -0.005, -0.3, 0, 0));
  return p;
}

/** Bolt-action sniper rifle with a long scope. */
function sniperRifle(): Piece {
  const p = new Piece();
  p.add(bx(0.045, 0.08, 0.5), FURNITURE, M(0, 0.02, 0.0));
  p.add(bx(0.02, 0.02, 0.5), METAL, M(0, 0.05, 0.48));
  p.add(cyl(0.022, 0.022, 0.32, 6, 'z'), METAL, M(0, 0.11, 0.08));
  p.add(bx(0.03, 0.08, 0.035), FURNITURE, M(0, -0.03, -0.005, -0.3, 0, 0));
  return p;
}

/** Shoulder-fired tubes: RPG-7 (0), AT4 (1), Carl Gustaf (2), Stinger or Igla (3). Grip at the origin. */
function tubes(): Piece {
  const p = new Piece();
  // RPG-7: tube, the PG-7 warhead, two pistol grips, the sight.
  p.add(cyl(0.032, 0.032, 0.95, 6, 'z'), METAL, M(0, 0.02, -0.12), 0);
  p.add(lathe([[0.03, 0.32], [0.047, 0.4], [0.047, 0.5], [0.015, 0.66], [0.001, 0.7]], 6, 'z'), LAUNCHER, M(0, 0.02, 0.02), 0);
  p.add(cyl(0.045, 0.034, 0.12, 6, 'z'), METAL, M(0, 0.02, -0.6), 0);
  p.add(bx(0.03, 0.08, 0.035), FURNITURE, M(0, -0.04, 0, -0.2, 0, 0), 0);
  p.add(bx(0.03, 0.08, 0.035), FURNITURE, M(0, -0.04, 0.24, -0.2, 0, 0), 0);
  // AT4: a fat olive tube.
  p.add(cyl(0.045, 0.045, 1.0, 7, 'z'), LAUNCHER, M(0, 0.03, -0.05), 1);
  p.add(bx(0.03, 0.08, 0.04), LAUNCHER, M(0, -0.03, 0, -0.2, 0, 0), 1);
  p.add(bx(0.03, 0.06, 0.035), LAUNCHER, M(0, -0.03, 0.26, -0.2, 0, 0), 1);
  // Carl Gustaf: tube, venturi flared at the back, front grip, the sight on the left.
  p.add(cyl(0.05, 0.05, 1.0, 7, 'z'), METAL, M(0, 0.03, 0.0), 2);
  p.add(lathe([[0.05, -0.62], [0.075, -0.52], [0.05, -0.45]], 7, 'z'), METAL, M(0, 0.03, 0), 2);
  p.add(bx(0.04, 0.06, 0.12), FURNITURE, M(0.07, 0.06, 0.15), 2);
  p.add(bx(0.03, 0.08, 0.04), FURNITURE, M(0, -0.04, 0, -0.2, 0, 0), 2);
  p.add(bx(0.03, 0.07, 0.04), FURNITURE, M(0, -0.04, 0.3, -0.2, 0, 0), 2);
  // MANPADS: long thin tube with the gripstock and the IFF antenna.
  p.add(cyl(0.038, 0.038, 1.5, 7, 'z'), LAUNCHER, M(0, 0.03, 0.15), 3);
  p.add(bx(0.03, 0.1, 0.05), METAL, M(0, -0.04, 0, -0.15, 0, 0), 3);
  p.add(bx(0.12, 0.03, 0.12), METAL, M(-0.08, 0.06, 0.2), 3);
  p.add(bx(0.03, 0.05, 0.04), METAL, M(0, -0.03, 0.28), 3);
  return p;
}

/** Crew weapons: Javelin (0), Kornet on its tripod (1), mortar on its bipod (2), drone controller (3). */
function heavy(): Piece {
  const p = new Piece();
  // Javelin: the launch tube with the command launch unit on its left.
  p.add(cyl(0.075, 0.075, 1.2, 8, 'z'), LAUNCHER, M(0, 0.04, 0.1), 0);
  p.add(bx(0.26, 0.17, 0.2), FURNITURE, M(0.15, -0.02, -0.05), 0);
  p.add(bx(0.12, 0.08, 0.04), METAL, M(0.15, 0.0, -0.17), 0);
  // Kornet: launcher tube on a tripod, the sight box at the rear.
  p.add(cyl(0.08, 0.08, 1.2, 8, 'z'), LAUNCHER, M(0, 0.12, 0.2), 1);
  p.add(bx(0.18, 0.16, 0.24), METAL, M(0.1, 0.05, -0.2), 1);
  for (const a of [0, 2.1, -2.1]) p.add(cyl(0.015, 0.015, 0.6, 4), METAL, M(Math.sin(a) * 0.18, -0.24, Math.cos(a) * 0.18 - 0.05, Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55), 1);
  // Mortar: baseplate on the ground, tube at 50 degrees, bipod.
  p.add(cyl(0.25, 0.27, 0.04, 8), METAL, M(0, 0.02, 0), 2);
  p.add(cyl(0.045, 0.045, 1.2, 7), METAL, M(0, 0.47, 0.38, 0.69, 0, 0), 2);
  p.add(cyl(0.014, 0.014, 0.75, 4), METAL, M(0.15, 0.32, 0.62, -0.25, 0, 0.25), 2);
  p.add(cyl(0.014, 0.014, 0.75, 4), METAL, M(-0.15, 0.32, 0.62, -0.25, 0, -0.25), 2);
  p.add(bx(0.08, 0.1, 0.06), METAL, M(0, 0.62, 0.62), 2);
  // Drone controller with its antennas.
  p.add(bx(0.24, 0.035, 0.14), METAL, M(0, 0, 0.0), 3);
  p.add(bx(0.17, 0.008, 0.1), FURNITURE, M(0, 0.02, 0.0), 3);
  for (const x of [-0.1, 0.1]) p.add(cyl(0.006, 0.006, 0.16, 3), METAL, M(x, 0.08, -0.06, -0.3, 0, 0), 3);
  return p;
}

// --- Shader ----------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
attribute float slot;
attribute float vari;
attribute vec4 look;
varying float vSlot;
varying vec4 vLook;
varying vec3 vLocal;
`;

const FRAG = /* glsl */ `
varying float vSlot;
varying vec4 vLook;
varying vec3 vLocal;
float sh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh3(i), sh3(i + vec3(1, 0, 0)), f.x), mix(sh3(i + vec3(0, 1, 0)), sh3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sh3(i + vec3(0, 0, 1)), sh3(i + vec3(1, 0, 1)), f.x), mix(sh3(i + vec3(0, 1, 1)), sh3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
// OCP-like scorpion: soft coyote and olive blotches on a light tan-green.
vec3 ocp(vec3 p) {
  float a = vn3(p * 9.0 + 1.7);
  float b = vn3(p * 14.0 + 9.1);
  vec3 c = srgb(vec3(0.5, 0.47, 0.37));
  c = mix(c, srgb(vec3(0.59, 0.55, 0.43)), smoothstep(0.55, 0.62, b));
  c = mix(c, srgb(vec3(0.37, 0.37, 0.27)), smoothstep(0.56, 0.62, a));
  c = mix(c, srgb(vec3(0.3, 0.26, 0.19)), smoothstep(0.68, 0.72, b * 0.6 + a * 0.5));
  return c;
}
// EMR digital flora: square pixels of dark green, tan and near black on light green.
vec3 emr(vec3 p) {
  vec3 q = floor(p * 45.0) / 45.0;
  float a = vn3(q * 11.0 + 3.3);
  float b = vn3(q * 17.0 + 1.1);
  vec3 c = srgb(vec3(0.42, 0.44, 0.32));
  c = mix(c, srgb(vec3(0.29, 0.31, 0.22)), step(0.52, a));
  c = mix(c, srgb(vec3(0.55, 0.52, 0.38)), step(0.66, b));
  c = mix(c, srgb(vec3(0.2, 0.2, 0.16)), step(0.72, a * 0.55 + b * 0.5));
  return c;
}
`;

const FRAG_COLOUR = /* glsl */ `
  float east = mod(vLook.x, 2.0);
  int s = int(vSlot + 0.5);
  vec3 col;
  vec3 camo = east > 0.5 ? emr(vLocal) : ocp(vLocal);
  if (s == ${UNIFORM}) col = camo;
  else if (s == ${GEAR}) col = east > 0.5 ? srgb(vec3(0.3, 0.32, 0.23)) : srgb(vec3(0.5, 0.43, 0.32));
  else if (s == ${HELMET}) col = east > 0.5 ? emr(vLocal * 1.4) : srgb(vec3(0.47, 0.42, 0.32));
  else if (s == ${SKIN}) col = srgb(mix(vec3(0.76, 0.58, 0.46), vec3(0.42, 0.3, 0.22), vLook.z));
  else if (s == ${BOOTS}) col = east > 0.5 ? srgb(vec3(0.1, 0.1, 0.09)) : srgb(vec3(0.42, 0.35, 0.25));
  else if (s == ${METAL}) col = srgb(vec3(0.12, 0.12, 0.11));
  else if (s == ${FURNITURE}) col = east > 0.5 ? srgb(vec3(0.16, 0.15, 0.13)) : srgb(vec3(0.42, 0.37, 0.28));
  else if (s == ${LAUNCHER}) col = srgb(vec3(0.3, 0.32, 0.22));
  else col = east > 0.5 ? srgb(vec3(0.32, 0.34, 0.25)) : srgb(vec3(0.48, 0.42, 0.31));
  if (s != ${METAL}) col *= vLook.y;
  diffuseColor.rgb *= col;
`;

/** look.x is east (0, 1) plus twice the side (0 none, 1 blue, 2 red): the side picks the rim's colour. */
const FRAG_RIM = /* glsl */ `
  float team = floor(vLook.x * 0.5 + 0.25);
  if (team > 0.5) outgoingLight += (team > 1.5 ? rimRed : rimBlue) * (rimStrength * ${RIM_TERM});
  #include <opaque_fragment>`;

function soldierMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const rim = rimUniforms();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, rim);
    sh.vertexShader = VERT + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      if (abs(vari - look.w) > 0.5) transformed = vec3(0.0, -1000.0, 0.0);
      vSlot = slot;
      vLook = look;
      vLocal = position;`,
    );
    sh.fragmentShader = 'uniform vec3 rimBlue;\nuniform vec3 rimRed;\nuniform float rimStrength;\n' + FRAG + sh.fragmentShader.replace('#include <map_fragment>', FRAG_COLOUR).replace('#include <opaque_fragment>', FRAG_RIM);
  };
  m.customProgramCacheKey = () => 'brink-soldier-2';
  return stencilled(m);
}

/** Shadow pass: hide the unused weapon variants there too. */
function depthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float vari;\nattribute vec4 look;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(vari - look.w) > 0.5) transformed = vec3(0.0, -1000.0, 0.0);');
  };
  m.customProgramCacheKey = () => 'brink-soldier-depth-1';
  return m;
}

// --- Poses ------------------------------------------------------------------------------------------------

/**
 * A pose sample in the soldier's frame (metres, feet on y = 0, facing +z). Laid out flat so two
 * samples blend by lerping every number.
 */
const P = {
  pelvis: 0, // 3
  torso: 3, // euler 3
  head: 6, // euler 3
  wpos: 9, // weapon position 3 (soldier frame)
  wrot: 12, // weapon euler 3 (soldier frame)
  footL: 15,
  footR: 18,
  kneeL: 21,
  kneeR: 24,
  handL: 27, // override targets
  handR: 30,
  handW: 33, // override weights L, R
  elbowL: 35,
  elbowR: 38,
  size: 41,
} as const;

type Sample = Float32Array;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s1 = new THREE.Vector3(1, 1, 1);
const _p2 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();
const _e2 = new THREE.Euler();

function set3(s: Sample, at: number, x: number, y: number, z: number): void {
  s[at] = x;
  s[at + 1] = y;
  s[at + 2] = z;
}

/** The torso transform from a sample. */
function torsoMatrix(s: Sample, out: THREE.Matrix4): THREE.Matrix4 {
  _q.setFromEuler(_e.set(s[P.torso]!, s[P.torso + 1]!, s[P.torso + 2]!, 'YXZ'));
  return out.compose(_v.set(s[P.pelvis]!, s[P.pelvis + 1]!, s[P.pelvis + 2]!), _q, _s1);
}

/** Place the weapon given in the torso's frame into the sample (soldier frame). */
function weaponInTorso(s: Sample, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  torsoMatrix(s, _m);
  _m2.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'XYZ')), _s1);
  _m.multiply(_m2);
  _m.decompose(_p2, _q2, _v);
  _e2.setFromQuaternion(_q2, 'YXZ');
  set3(s, P.wpos, _p2.x, _p2.y, _p2.z);
  set3(s, P.wrot, _e2.x, _e2.y, _e2.z);
}

function weaponInSoldier(s: Sample, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  _q2.setFromEuler(_e.set(rx, ry, rz, 'XYZ'));
  _e2.setFromQuaternion(_q2, 'YXZ');
  set3(s, P.wpos, x, y, z);
  set3(s, P.wrot, _e2.x, _e2.y, _e2.z);
}

interface PoseCtx {
  t: number;
  phase: number;
  kit: KitDef;
  /** 0..1 per soldier. */
  seed: number;
}

/** Hold the kit's weapon for an upright pose. */
function holdWeapon(s: Sample, c: PoseCtx, mode: 'ready' | 'aim' | 'port' | 'prone'): void {
  const h = c.kit.hold;
  const sway = Math.sin(c.t * 1.3 + c.seed * 9) * 0.012;
  if (h === 'ground') {
    if (mode === 'port') weaponInTorso(s, -0.02, 0.32, 0.22, -0.3, 0.9, 0.3);
    else if (c.kit.variant === 1) weaponInSoldier(s, 0.02, mode === 'prone' ? 0.28 : 0.5, mode === 'prone' ? 0.85 : 0.62, 0, 0, 0);
    else weaponInSoldier(s, 0.28, 0, 0.42, 0, -0.2, 0);
    return;
  }
  if (h === 'hand') {
    if (mode === 'port') weaponInTorso(s, 0, 0.28, 0.25, -0.2, 0, 0);
    else weaponInTorso(s, 0, 0.3, 0.27, -0.7 + sway, 0, 0);
    return;
  }
  if (mode === 'aim') {
    if (h === 'shoulder') weaponInTorso(s, -0.15, 0.42, 0.2, sway, 0.12, 0);
    else weaponInTorso(s, -0.1, 0.4, 0.28, sway, 0.12, 0);
  } else if (mode === 'prone') {
    weaponInSoldier(s, -0.07, 0.24, 0.55, -0.05 + sway, 0, 0);
  } else if (mode === 'port') {
    weaponInTorso(s, -0.02, 0.3, 0.2, -0.35, 0.95, 0.35);
  } else if (h === 'shoulder') {
    // Resting on the shoulder, muzzle up.
    weaponInTorso(s, -0.16, 0.38, 0.1, -0.45, 0.05, 0);
  } else {
    // Low ready.
    weaponInTorso(s, -0.09, 0.25, 0.2, 0.55 + sway, 0.18, 0);
  }
}

function standBase(s: Sample): void {
  set3(s, P.pelvis, 0, 0.935, 0);
  set3(s, P.torso, 0.06, 0, 0);
  set3(s, P.head, -0.04, 0, 0);
  set3(s, P.footL, 0.11, 0.07, 0.05);
  set3(s, P.footR, -0.11, 0.07, -0.05);
  set3(s, P.kneeL, 0.1, 0, 1);
  set3(s, P.kneeR, -0.1, 0, 1);
  set3(s, P.elbowL, 0.8, -0.8, -0.2);
  set3(s, P.elbowR, -0.8, -0.8, -0.2);
  s[P.handW] = 0;
  s[P.handW + 1] = 0;
}

const POSES: Record<Pose, (s: Sample, c: PoseCtx) => void> = {
  stand(s, c) {
    standBase(s);
    s[P.pelvis + 1]! += Math.sin(c.t * 1.6 + c.seed * 6) * 0.004;
    holdWeapon(s, c, 'ready');
  },
  walk(s, c) {
    standBase(s);
    const f = c.phase;
    const stride = 0.27;
    set3(s, P.footL, 0.1, 0.07 + Math.max(0, Math.cos(f)) * 0.1, Math.sin(f) * stride);
    set3(s, P.footR, -0.1, 0.07 + Math.max(0, -Math.cos(f)) * 0.1, -Math.sin(f) * stride);
    s[P.pelvis + 1] = 0.915 + Math.cos(f * 2) * 0.015;
    s[P.torso] = 0.1;
    s[P.torso + 1] = Math.sin(f) * 0.08;
    holdWeapon(s, c, 'ready');
  },
  run(s, c) {
    standBase(s);
    const f = c.phase;
    const stride = 0.42;
    set3(s, P.footL, 0.09, 0.07 + Math.max(0, Math.cos(f)) * 0.26, Math.sin(f) * stride + 0.05);
    set3(s, P.footR, -0.09, 0.07 + Math.max(0, -Math.cos(f)) * 0.26, -Math.sin(f) * stride + 0.05);
    s[P.pelvis + 1] = 0.86 + Math.cos(f * 2) * 0.03;
    s[P.pelvis + 2] = 0.04;
    s[P.torso] = 0.32;
    s[P.torso + 1] = Math.sin(f) * 0.12;
    s[P.head] = -0.25;
    holdWeapon(s, c, 'port');
  },
  kneel(s, c) {
    standBase(s);
    // Right knee down, left foot planted forward.
    set3(s, P.pelvis, 0.0, 0.52, -0.06);
    set3(s, P.footL, 0.14, 0.07, 0.36);
    set3(s, P.footR, -0.12, 0.1, -0.5);
    set3(s, P.kneeR, -0.1, -0.6, 1);
    s[P.torso] = 0.12;
    s[P.torso + 1] = -0.18;
    holdWeapon(s, c, c.kit.hold === 'ground' ? 'ready' : 'aim');
    s[P.head] = 0.05;
    s[P.head + 1] = 0.12;
  },
  prone(s, c) {
    standBase(s);
    set3(s, P.pelvis, 0, 0.14, -0.3);
    set3(s, P.torso, 1.42, 0, 0);
    set3(s, P.head, -1.15, 0, 0);
    set3(s, P.footL, 0.26, 0.05, -1.18);
    set3(s, P.footR, -0.2, 0.05, -1.2);
    set3(s, P.kneeL, 0.2, -1, 0);
    set3(s, P.kneeR, -0.2, -1, 0);
    set3(s, P.elbowL, 0.6, -1, 0.2);
    set3(s, P.elbowR, -0.8, -1, 0);
    holdWeapon(s, c, 'prone');
  },
  aim(s, c) {
    standBase(s);
    set3(s, P.footL, 0.13, 0.07, 0.2);
    set3(s, P.footR, -0.14, 0.07, -0.16);
    s[P.torso] = 0.1;
    s[P.torso + 1] = -0.18;
    s[P.head] = 0.22;
    s[P.head + 1] = 0.14;
    s[P.head + 2] = 0.14;
    set3(s, P.elbowR, -1, -0.2, -0.1);
    holdWeapon(s, c, 'aim');
  },
  fire(s, c) {
    POSES.aim(s, c);
    const k = c.kit.kick * Math.exp(-((c.t % c.kit.cycle) / 0.05));
    // Recoil: the weapon kicks back and up, the shoulder rocks.
    s[P.wrot]! -= 0.08 * k;
    _v.set(0, 0.004 * k, -0.035 * k).applyEuler(_e.set(s[P.wrot]!, s[P.wrot + 1]!, s[P.wrot + 2]!, 'YXZ'));
    s[P.wpos]! += _v.x;
    s[P.wpos + 1]! += _v.y;
    s[P.wpos + 2]! += _v.z;
    s[P.torso]! -= 0.03 * k;
  },
  throw(s, c) {
    standBase(s);
    set3(s, P.footL, 0.12, 0.07, 0.24);
    set3(s, P.footR, -0.12, 0.07, -0.2);
    const k = (c.t % 1.3) / 1.3;
    // Wind up behind the head, release high in front, follow through low.
    const a = k < 0.45 ? k / 0.45 : 1;
    const b = k < 0.45 ? 0 : Math.min(1, (k - 0.45) / 0.25);
    const r = k < 0.7 ? 0 : (k - 0.7) / 0.3;
    const hx = -0.24 + b * 0.12 + r * 0.15;
    const hy = 1.25 + a * 0.45 - r * 0.6;
    const hz = -0.08 - a * 0.22 + b * 0.75 - r * 0.1;
    set3(s, P.handR, hx, hy, hz);
    s[P.handW + 1] = 1;
    s[P.torso + 1] = 0.35 * a - 0.7 * b;
    s[P.torso] = 0.05 + 0.25 * b;
    set3(s, P.elbowR, -1, 0.2, -0.6);
    // The weapon hangs in the left hand.
    weaponInSoldier(s, 0.26, 0.85, 0.12, 1.2, 0.2, 0);
    set3(s, P.handL, 0.26, 0.85, 0.12);
    s[P.handW] = 0;
  },
  dead(s, c) {
    standBase(s);
    const m = c.seed > 0.5 ? 1 : -1;
    set3(s, P.pelvis, 0, 0.16, -0.25);
    set3(s, P.torso, -1.5, 0.15 * m, 0.08 * m);
    set3(s, P.head, 0.2, 0.7 * m, 0);
    set3(s, P.footL, 0.32, 0.06, 0.78);
    set3(s, P.footR, -0.16, 0.06, 0.8);
    set3(s, P.kneeL, 1, 0.25, 0);
    set3(s, P.kneeR, -1, 0.25, 0);
    set3(s, P.handL, 0.68, 0.06, -0.5 + c.seed * 0.3);
    set3(s, P.handR, -0.62, 0.06, -0.35 - c.seed * 0.3);
    s[P.handW] = 1;
    s[P.handW + 1] = 1;
    set3(s, P.elbowL, 0.3, 0.1, 1);
    set3(s, P.elbowR, -0.3, 0.1, 1);
    weaponInSoldier(s, 0.6 * m, 0.03, 0.2, 0, 0.8 * m, Math.PI / 2);
  },
  wounded(s, c) {
    POSES.dead(s, c);
    const t = c.t;
    // Propped up a little, clutching a leg, the other leg drawing up and down.
    s[P.torso] = -1.2 + Math.sin(t * 1.7) * 0.06;
    s[P.head] = -0.25 + Math.sin(t * 0.9) * 0.2;
    s[P.head + 1] = Math.sin(t * 0.6) * 0.3;
    set3(s, P.handR, 0.08, 0.2, 0.3 + Math.sin(t * 2.3) * 0.03);
    set3(s, P.handL, 0.42, 0.12 + Math.max(0, Math.sin(t * 1.1)) * 0.2, -0.1);
    set3(s, P.footL, 0.28, 0.06, 0.45 + Math.sin(t * 1.3) * 0.18);
    set3(s, P.kneeL, 0.3, 1, 0.2);
  },
};

// --- IK -----------------------------------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Joint between `root` and `end` for segment lengths a, b, bending toward `pole`. */
function solve(root: THREE.Vector3, end: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, out: THREE.Vector3): void {
  _u.subVectors(end, root);
  const d = Math.min(Math.max(_u.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  _u.normalize();
  const ca = (a * a + d * d - b * b) / (2 * a * d);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.set(0, 0, 1).addScaledVector(_u, -_u.z);
  _w.normalize();
  out.copy(root).addScaledVector(_u, a * ca).addScaledVector(_w, a * sa);
}

/** A limb part's matrix: origin at `from`, local -y toward `to`, local z toward `hint`. */
function segment(from: THREE.Vector3, to: THREE.Vector3, hint: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  _y.subVectors(from, to).normalize();
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  return out.makeBasis(_x, _y, _z).setPosition(from);
}

// --- The crowd ---------------------------------------------------------------------------------------------

interface Soldier {
  id: string;
  east: boolean;
  /** 0 no side, 1 blue, 2 red: the rim light's colour. */
  team: number;
  kit: KitDef;
  x: number;
  y: number;
  z: number;
  facing: number;
  want: number;
  pose: Pose;
  prev: Pose;
  blend: number;
  t: number;
  phase: number;
  speed: number;
  seed: number;
  height: number;
  shade: number;
  skin: number;
  /** Not drawn yet: a pose set now is taken at once, not blended from standing. */
  fresh: boolean;
}

type PartName = 'head' | 'torso' | 'pack' | 'uarm' | 'larm' | 'uleg' | 'lleg' | WeaponMesh;

const UPPER_ARM = 0.31;
const LOWER_ARM = 0.33;
const UPPER_LEG = 0.44;
const LOWER_LEG = 0.43;

export class SoldierCrowd {
  readonly group = new THREE.Group();
  private readonly max: number;
  private readonly soldiers: Soldier[] = [];
  private readonly byId = new Map<string, Soldier>();
  private readonly meshes = new Map<PartName, THREE.InstancedMesh>();
  private readonly material = soldierMaterial();
  private readonly depth = depthMaterial();
  private readonly tris: Record<PartName, number>;
  private looksDirty = true;
  /** Soldiers wearing an outline (the selected squad, the target), and the hull meshes drawing it. */
  private readonly outlined = new Map<string, OutlineRole>();
  private readonly hulls = new Map<PartName, THREE.InstancedMesh>();
  private readonly sa = new Float32Array(P.size);
  private readonly sb = new Float32Array(P.size);

  /** Figures drawn this much larger than life, so a squad reads from a drone's height (miniatures do the same). */
  private readonly scale: number;

  constructor(opts: { max: number; shadows: boolean; scale?: number }) {
    this.max = opts.max;
    this.scale = opts.scale ?? 1;
    this.group.name = 'soldiers';
    const pieces: Record<PartName, [Piece, number]> = {
      head: [headPiece(), 1],
      torso: [torsoPiece(), 1],
      pack: [packPiece(), 1],
      uarm: [upperArm(), 2],
      larm: [lowerArm(), 2],
      uleg: [upperLeg(), 2],
      lleg: [lowerLeg(), 2],
      rifle: [rifle(), 1],
      mg: [machineGun(), 1],
      sniper: [sniperRifle(), 1],
      tube: [tubes(), 1],
      heavy: [heavy(), 1],
    };
    this.tris = {} as Record<PartName, number>;
    for (const [name, [piece, per]] of Object.entries(pieces) as [PartName, [Piece, number]][]) {
      const g = piece.build();
      const n = this.max * per;
      g.setAttribute('look', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      const mesh = new THREE.InstancedMesh(g, this.material, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = opts.shadows;
      mesh.receiveShadow = opts.shadows;
      mesh.customDepthMaterial = this.depth;
      mesh.name = `soldier-${name}`;
      this.meshes.set(name, mesh);
      this.group.add(mesh);
      this.tris[name] = piece.tris;
    }
  }

  /** `facing` is a yaw like Object3D.rotation.y: 0 faces +z. Position in world units. */
  add(id: string, faction: 'west' | 'east', kit: SoldierKit, x: number, z: number, facing: number, side?: 'blue' | 'red'): void {
    if (this.byId.has(id) || this.soldiers.length >= this.max) return;
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    const r = (k: number) => (((h >>> 0) * (k * 2654435761)) % 1000003) / 1000003;
    const s: Soldier = {
      id,
      east: faction === 'east',
      team: side === 'blue' ? 1 : side === 'red' ? 2 : 0,
      kit: KITS[kit],
      x,
      y: 0,
      z,
      facing,
      want: facing,
      pose: 'stand',
      prev: 'stand',
      blend: 1,
      t: r(3) * 10,
      phase: r(5) * Math.PI * 2,
      speed: 0,
      seed: r(7),
      height: (1.75 + r(11) * 0.1) / 1.8,
      shade: 0.9 + r(13) * 0.2,
      skin: r(17),
      fresh: true,
    };
    this.soldiers.push(s);
    this.byId.set(id, s);
    this.looksDirty = true;
  }

  set(id: string, st: { x?: number; z?: number; y?: number; facing?: number; pose?: Pose; speed?: number }): void {
    const s = this.byId.get(id);
    if (!s) return;
    if (st.x !== undefined) s.x = st.x;
    if (st.z !== undefined) s.z = st.z;
    if (st.y !== undefined) s.y = st.y;
    if (st.facing !== undefined) s.want = st.facing;
    if (st.speed !== undefined) s.speed = st.speed;
    if (st.pose !== undefined && st.pose !== s.pose) {
      s.prev = s.fresh ? st.pose : s.pose;
      s.pose = st.pose;
      s.blend = s.fresh ? 1 : 0;
    }
  }

  remove(id: string): void {
    const s = this.byId.get(id);
    if (!s) return;
    this.byId.delete(id);
    this.soldiers.splice(this.soldiers.indexOf(s), 1);
    this.looksDirty = true;
  }

  /**
   * Whether a soldier `seen` passes moves visibly: walking, firing, throwing, writhing, turning or
   * changing pose; with `idle`, any soldier still standing (a weapon sways at rest), for close views.
   */
  moving(seen: (x: number, y: number, z: number) => boolean, idle: boolean): boolean {
    for (const s of this.soldiers) {
      const turning = Math.abs(Math.atan2(Math.sin(s.want - s.facing), Math.cos(s.want - s.facing))) > 1e-3;
      const live = s.blend < 1 || turning || s.pose === 'walk' || s.pose === 'run' || s.pose === 'fire' || s.pose === 'throw' || s.pose === 'wounded';
      if ((live || (idle && s.pose !== 'dead')) && seen(s.x, s.y, s.z)) return true;
    }
    return false;
  }

  /** Thermal view: the soldiers' group as warm bodies. */
  heat(): { group: THREE.Object3D; level: number } {
    return { group: this.group, level: 0.85 };
  }

  /** Draw calls and triangles per soldier, as built. */
  stats(): { calls: number; trisPer: number } {
    const t = this.tris;
    return { calls: this.meshes.size, trisPer: Math.round(t.head + t.torso + t.pack + 2 * (t.uarm + t.larm + t.uleg + t.lleg) + t.rifle) };
  }

  update(dt: number): void {
    const counts = new Map<PartName, number>();
    for (const k of this.meshes.keys()) counts.set(k, 0);
    const root = new THREE.Matrix4();
    const torso = new THREE.Matrix4();
    const part = new THREE.Matrix4();
    const weapon = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    const sL = new THREE.Vector3();
    const sR = new THREE.Vector3();
    const hipL = new THREE.Vector3();
    const hipR = new THREE.Vector3();
    const target = new THREE.Vector3();
    const joint = new THREE.Vector3();
    const pole = new THREE.Vector3();
    const look = (name: PartName, idx: number, s: Soldier, variant: number) => {
      if (!this.looksDirty && name !== 'tube' && name !== 'heavy') return;
      const attr = this.meshes.get(name)!.geometry.attributes.look as THREE.InstancedBufferAttribute;
      attr.setXYZW(idx, (s.east ? 1 : 0) + 2 * s.team, s.shade, s.skin, variant);
      attr.needsUpdate = true;
    };
    const hullCounts = this.outlined.size ? new Map<PartName, number>() : null;
    const put = (name: PartName, m: THREE.Matrix4, s: Soldier, variant = 0) => {
      const mesh = this.meshes.get(name)!;
      const i = counts.get(name)!;
      part.multiplyMatrices(root, m);
      mesh.setMatrixAt(i, part);
      look(name, i, s, variant);
      counts.set(name, i + 1);
      const role = hullCounts && this.outlined.get(s.id);
      if (role) this.hullAt(name, hullCounts!, part, variant, role);
    };

    for (const s of this.soldiers) {
      s.fresh = false;
      s.t += dt;
      s.blend = Math.min(1, s.blend + dt / 0.28);
      // Turn toward the wanted facing.
      let d = s.want - s.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.facing += Math.sign(d) * Math.min(Math.abs(d), dt * 7);
      // Gait: cadence from speed (world units a second), with a floor so the cycle shows in place.
      if (s.pose === 'walk' || s.pose === 'run') {
        const stride = (s.pose === 'run' ? 1.7 : 1.3) * METRE;
        const cadence = Math.max(s.pose === 'run' ? 2.6 : 1.7, s.speed / stride);
        s.phase += dt * cadence * Math.PI * 2;
      }
      const ctx: PoseCtx = { t: s.t, phase: s.phase, kit: s.kit, seed: s.seed };
      const cur = this.sa;
      POSES[s.pose](cur, ctx);
      if (s.blend < 1) {
        const old = this.sb;
        POSES[s.prev](old, ctx);
        const k = s.blend * s.blend * (3 - 2 * s.blend);
        for (let i = 0; i < P.size; i++) cur[i] = old[i]! + (cur[i]! - old[i]!) * k;
      }
      const smp = cur;
      const sc = METRE * s.height * this.scale;
      root.compose(_v.set(s.x, s.y, s.z), _q.setFromAxisAngle(_y.set(0, 1, 0), s.facing), _a.set(sc, sc, sc));
      torsoMatrix(smp, torso);
      put('torso', torso, s);
      tmp.compose(_v.set(0, 0, 0), _q.identity(), _a.set(1, 1, s.kit.pack)).premultiply(torso);
      put('pack', tmp, s);
      // Head on the neck.
      tmp.compose(_v.set(0, 0.5, 0.01), _q.setFromEuler(_e.set(smp[P.head]!, smp[P.head + 1]!, smp[P.head + 2]!, 'YXZ')), _s1).premultiply(torso);
      put('head', tmp, s);
      // Weapon.
      weapon.compose(_v.set(smp[P.wpos]!, smp[P.wpos + 1]!, smp[P.wpos + 2]!), _q.setFromEuler(_e.set(smp[P.wrot]!, smp[P.wrot + 1]!, smp[P.wrot + 2]!, 'YXZ')), _s1);
      put(s.kit.mesh, weapon, s, s.kit.variant);
      // Arms reach the grips (or the pose's own hand targets).
      sL.set(0.19, 0.45, 0).applyMatrix4(torso);
      sR.set(-0.19, 0.45, 0).applyMatrix4(torso);
      for (const side of [0, 1] as const) {
        const sh = side === 0 ? sL : sR;
        const grip = side === 0 ? s.kit.gripL : s.kit.gripR;
        const w = smp[P.handW + side]!;
        const ho = side === 0 ? P.handL : P.handR;
        target.set(grip[0], grip[1], grip[2]).applyMatrix4(weapon);
        if (w > 0) target.lerp(_b.set(smp[ho]!, smp[ho + 1]!, smp[ho + 2]!), w);
        const eo = side === 0 ? P.elbowL : P.elbowR;
        pole.set(smp[eo]!, smp[eo + 1]!, smp[eo + 2]!);
        solve(sh, target, UPPER_ARM, LOWER_ARM, pole, joint);
        put('uarm', segment(sh, joint, pole, tmp), s);
        put('larm', segment(joint, target, pole, tmp), s);
      }
      // Legs reach the feet.
      hipL.set(0.095, -0.03, 0).applyMatrix4(torso);
      hipR.set(-0.095, -0.03, 0).applyMatrix4(torso);
      for (const side of [0, 1] as const) {
        const hip = side === 0 ? hipL : hipR;
        const fo = side === 0 ? P.footL : P.footR;
        const ko = side === 0 ? P.kneeL : P.kneeR;
        target.set(smp[fo]!, smp[fo + 1]!, smp[fo + 2]!);
        pole.set(smp[ko]!, smp[ko + 1]!, smp[ko + 2]!);
        solve(hip, target, UPPER_LEG, LOWER_LEG, pole, joint);
        put('uleg', segment(hip, joint, pole, tmp), s);
        put('lleg', segment(joint, target, pole, tmp), s);
      }
    }
    for (const [name, mesh] of this.meshes) {
      mesh.count = counts.get(name)!;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
    for (const [name, hull] of this.hulls) {
      hull.count = hullCounts?.get(name) ?? 0;
      hull.visible = hull.count > 0;
      if (hull.count) {
        hull.instanceMatrix.needsUpdate = true;
        hull.geometry.attributes.look!.needsUpdate = true;
        if (hull.instanceColor) hull.instanceColor.needsUpdate = true;
      }
    }
    this.looksDirty = false;
  }

  /** Outline these soldiers (a squad) in a role's colour, or take theirs off (null). */
  outline(ids: readonly string[], role: OutlineRole | null): void {
    for (const id of ids) {
      if (role) this.outlined.set(id, role);
      else this.outlined.delete(id);
    }
    if (role && !this.hulls.size) this.buildHulls();
  }

  /** One hull mesh per part, sharing the part's buffers, for up to a few squads at once. */
  private buildHulls(): void {
    const room = 24;
    for (const [name, mesh] of this.meshes) {
      const per = name === 'uarm' || name === 'larm' || name === 'uleg' || name === 'lleg' ? 2 : 1;
      // The part's buffers and smoothed normals, with looks of its own (only the weapon variant is read).
      const base = hullOf(mesh.geometry, ['vari']);
      const g = new THREE.BufferGeometry();
      for (const [k, attr] of Object.entries(base.attributes)) g.setAttribute(k, attr);
      g.setIndex(base.index);
      g.setAttribute('look', new THREE.InstancedBufferAttribute(new Float32Array(room * per * 4), 4));
      const hull = new THREE.InstancedMesh(g, SOLDIER_HULL, room * per);
      hull.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hull.setColorAt(0, hullColor('selected'));
      hull.count = 0;
      hull.visible = false;
      hull.frustumCulled = false;
      hull.name = 'outline';
      hull.renderOrder = HULL_ORDER;
      this.hulls.set(name, hull);
      this.group.add(hull);
    }
  }

  private hullAt(name: PartName, counts: Map<PartName, number>, m: THREE.Matrix4, variant: number, role: OutlineRole): void {
    const hull = this.hulls.get(name);
    if (!hull) return;
    const i = counts.get(name) ?? 0;
    if (i >= hull.instanceMatrix.count) return;
    hull.setMatrixAt(i, m);
    (hull.geometry.attributes.look as THREE.InstancedBufferAttribute).setW(i, variant);
    // One material for both roles: the colour rides on the instance (the target's follows the palette).
    hull.setColorAt(i, hullColor(role));
    counts.set(name, i + 1);
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
    this.depth.dispose();
    for (const h of this.hulls.values()) {
      h.geometry.dispose();
      h.dispose();
    }
    this.group.removeFromParent();
  }
}

