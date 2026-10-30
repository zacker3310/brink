import * as THREE from 'three';
import type { Side } from '@brink/arena';
import type { Palette } from './quality';

// Friend and foe colours (APP-6 affiliation, never decoration), in the standard pair or a
// colour-blind-safe pair (Okabe-Ito blue and orange). Shape carries affiliation too (hostile badges
// are angled), so colour is never the only cue. The DOM layers read CSS variables switched by
// `data-palette` on the battle's root (index.css); the 3D field shares one THREE.Color per side, so a
// palette change recolours every ring, tint and outline at the next frame with no per-frame work.

interface Pair {
  /** Rings, reach tint, target rings and the rim light in the field. */
  field: number;
  /** Rim light: the same hue, a touch lighter so it reads on dark paint. */
  rim: number;
}

const FIELD: Record<Palette, Record<Side, Pair>> = {
  standard: { blue: { field: 0x7fb2e5, rim: 0x9cc6ee }, red: { field: 0xe0705e, rim: 0xff8a70 } },
  // Okabe-Ito sky blue for the field (the deep blue #0072B2 is for solid badges), orange for the foe.
  colourblind: { blue: { field: 0x56b4e9, rim: 0x7cc8f2 }, red: { field: 0xe69f00, rim: 0xf5b631 } },
};

const TEAM: Record<Side, THREE.Color> = { blue: new THREE.Color(FIELD.standard.blue.field), red: new THREE.Color(FIELD.standard.red.field) };
const RIM: Record<Side, THREE.Color> = { blue: new THREE.Color(FIELD.standard.blue.rim), red: new THREE.Color(FIELD.standard.red.rim) };
let current: Palette = 'standard';

/** A side's colour in the field: one shared, live THREE.Color (assign it, do not copy it). */
export function teamColor(side: Side): THREE.Color {
  return TEAM[side];
}

/** The rim light's colour for a side (shared and live, like `teamColor`). */
export function rimColor(side: Side): THREE.Color {
  return RIM[side];
}

/** A flat material in a side's colour that follows the palette: `teamMaterial('red', { transparent: true, opacity: 0.4 })`. */
export function teamMaterial(side: Side, params: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial(params);
  m.color = TEAM[side];
  return m;
}

export function palette(): Palette {
  return current;
}

/** Switch the field's friend and foe colours (the DOM follows `data-palette` on its own). */
export function setPalette(p: Palette): void {
  current = p;
  for (const side of ['blue', 'red'] as const) {
    TEAM[side].setHex(FIELD[p][side].field);
    RIM[side].setHex(FIELD[p][side].rim);
  }
}
