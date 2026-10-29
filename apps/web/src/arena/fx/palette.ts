import * as THREE from 'three';

// Types, budgets and colours for the battle effects. Quality, Biome and Arsenal mirror
// arena/quality.ts and the v2 battle contract so this folder builds on its own; they are plain
// string unions, so the battle's own types pass straight in.

export type Quality = 'low' | 'balanced' | 'high';
export type Biome = 'temperate' | 'steppe' | 'desert' | 'winter' | 'urban';
export type Arsenal = 'us' | 'europe' | 'russia' | 'legacy';
export type Side = 'blue' | 'red';
export type ExplosionKind = 'he' | 'shell' | 'rockets' | 'bombs' | 'mine' | 'airburst';
export type HitKind = 'pen' | 'bounce' | 'small';
export type MissileKind = 'atgm' | 'manpads' | 'rocket' | 'hellfire';
export type DroneKind = 'fpv' | 'switchblade' | 'lancet';
/** What a helicopter hovers over: ground throws the biome's dust (or snow, or sand). */
export type Surface = 'ground' | 'water';

export interface FxBudget {
  /** Smoke, fire, dust and spark sprites alive at once (QUALITY[q].particles). */
  particles: number;
  /** Point lights for flashes and fires (QUALITY[q].flashLights). */
  flashLights: number;
  /** Debris chunks and projectile bodies. */
  debris: number;
  /** Emission density: fewer, bigger sprites on the lower presets. */
  density: number;
}

export const FX_BUDGET: Record<Quality, FxBudget> = {
  low: { particles: 120, flashLights: 0, debris: 40, density: 0.45 },
  balanced: { particles: 300, flashLights: 1, debris: 90, density: 0.7 },
  high: { particles: 700, flashLights: 4, debris: 160, density: 1 },
};

/** The largest preset: GPU buffers are sized for it so the quality can change mid battle. */
export const MAX_PARTICLES = 700;
export const MAX_DEBRIS = 160;

/** World units per metre (one cell is one world unit, models at 10 m a cell). */
export const METRE = 0.1;
/** Gravity for debris and sparks, in world units a second squared: faster than true figure scale so the film stays snappy. */
export const GRAVITY = 4.5;

const lin = (hex: number): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

export interface BiomeColours {
  /** Thrown earth: dark, for dust columns and mines. */
  dirt: [number, number, number];
  /** Fine dust: lighter, for crater dust, tracks and rotor wash. */
  dust: [number, number, number];
  /** What rotor wash lifts. */
  wash: [number, number, number];
}

// Muted, real colours: drone footage, not a cartoon.
export const BIOME: Record<Biome, BiomeColours> = {
  temperate: { dirt: lin(0x4b4136), dust: lin(0x8c7f6b), wash: lin(0x8a7f6c) },
  steppe: { dirt: lin(0x5a4b3a), dust: lin(0xa39275), wash: lin(0xa89678) },
  desert: { dirt: lin(0x8a7152), dust: lin(0xc6ae88), wash: lin(0xcdb48c) },
  winter: { dirt: lin(0x3d3935), dust: lin(0xd9dee2), wash: lin(0xeef2f5) },
  urban: { dirt: lin(0x4a4642), dust: lin(0x9b958d), wash: lin(0x9a948c) },
};

export const SMOKE_WHITE = lin(0xdedcd6);
export const SMOKE_BLACK = lin(0x1a1816);
export const SMOKE_OILY = lin(0x0f0e0d);
export const SMOKE_GREY = lin(0x5a5752);
export const PROPELLANT = lin(0xb9b4aa);
export const TRAIL = lin(0xcfccc4);
export const SPRAY = lin(0xdfe6ea);

/** Tracer colours: NATO burns red, Russian green. */
export const TRACER_RED = lin(0xff4a26);
export const TRACER_GREEN = lin(0x6dff5a);
export const tracerOf = (a: Arsenal): [number, number, number] => (a === 'us' || a === 'europe' ? TRACER_RED : TRACER_GREEN);

export const SPARK = lin(0xffb257);
export const FLASH = lin(0xffd9a0);
export const FIRE_LIGHT = 0xff8a3c;

/** How big a weapon is, from its calibre string ('5.56', '120', 'atgm', 'rocket', ...). */
export type CalibreClass = 'small' | 'hmg' | 'auto' | 'gun' | 'arty' | 'launcher' | 'none';

export function calibreClass(calibre: string): CalibreClass {
  if (calibre === 'atgm' || calibre === 'rocket' || calibre === 'manpads') return 'launcher';
  if (calibre === 'fpv') return 'none';
  const mm = parseFloat(calibre);
  if (!Number.isFinite(mm)) return 'small';
  if (mm < 10) return 'small';
  if (mm < 20) return 'hmg';
  if (mm < 60) return 'auto';
  if (mm < 140) return 'gun';
  return 'arty';
}
