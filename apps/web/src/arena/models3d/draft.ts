import type * as THREE from 'three';
import { Lod, Parts, type V3 } from './kit';
import type { Scheme, TrackKind } from './paint';

// A model before it is assembled: geometry collected per draw call, pivots and the moving parts, all in
// metres. The builders fill one of these; `assemble` turns it into meshes for a unit.

export interface RotorDraft {
  /** Blades and hub, in the rotor's frame (spin axis local y or x). */
  parts: Parts;
  /** Hub position in the parent's frame. */
  at: V3;
  /** Mount rotation (a canted tail rotor). */
  tilt?: V3;
  axis: 'y' | 'x';
  /** rad/s at hover; the sign is the real direction. */
  rate: number;
  /** Blur disc radius in metres; 0 for none. */
  blur: number;
  blurTint?: number;
  parent: 'body' | 'turret';
}

export interface HeatDraft {
  at: V3;
  size: V3;
  level: number;
  parent: 'body' | 'turret' | 'gun';
}

export interface Belt {
  geo: THREE.BufferGeometry;
}

export interface Draft {
  L: Lod;
  scheme: Scheme;
  body: Parts;
  belts: Belt[];
  trackKind: TrackKind;
  /** Track link pitch in metres. */
  pitch: number;
  turret: Parts | null;
  turretAt: V3;
  gun: Parts | null;
  /** Trunnion in the turret's frame. */
  gunAt: V3;
  /** Primary muzzle in the gun's frame (or the turret's when there is no gun). */
  muzzle: V3;
  /** Rest elevation of the gun, radians (howitzers travel level). */
  gunPitch: number;
  rotors: RotorDraft[];
  heat: HeatDraft[];
  /** Road wheel radius, metres: the reference for the wheel spin. */
  wheelR: number;
  /** Flight height in world units. */
  lift: number;
  dustTop: number;
  dust: number;
  /** Real size in metres: length, width, height. */
  dims: [number, number, number];
}

export function newDraft(lod: 0 | 1, scheme: Scheme, dims: [number, number, number]): Draft {
  return {
    L: new Lod(lod),
    scheme,
    body: new Parts(0),
    belts: [],
    trackKind: 'pads',
    pitch: 0.19,
    turret: null,
    turretAt: [0, 0, 0],
    gun: null,
    gunAt: [0, 0, 0],
    muzzle: [0, 0, 1],
    gunPitch: 0,
    rotors: [],
    heat: [],
    wheelR: 0.35,
    lift: 0,
    dustTop: 1.1,
    dust: 0.85,
    dims,
  };
}

/** Give the draft a turret frame at `at` (hull frame, metres). */
export function turretOf(d: Draft, at: V3): Parts {
  d.turretAt = at;
  d.turret = new Parts(at[1]);
  return d.turret;
}

/** Give the turret a gun frame at the trunnion `at` (turret frame, metres). */
export function gunOf(d: Draft, at: V3): Parts {
  d.gunAt = at;
  d.gun = new Parts(d.turretAt[1] + at[1]);
  return d.gun;
}
