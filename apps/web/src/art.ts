import { Assets, type Texture } from 'pixi.js';
import type { Terrain, UnitClass } from '@brink/contracts';

// Imported art (public/art, credits in public/art/CREDITS.md): Sentinel-2 ground per terrain,
// top-down renders of real 3D models per unit class, and effect frames for the replay. Loaded
// once; until it arrives (or if it cannot), the map falls back to its procedural drawing.

const BASE = `${import.meta.env.BASE_URL}art/`;

export type UnitArt = UnitClass | 'air_rotor' | 'depot';

export interface Art {
  ground: Record<Terrain, Texture>;
  units: Record<UnitArt, Texture>;
  /** Sprite edge length in world pixels, and the rotor hub as a fraction of its sprite. */
  size: Record<UnitArt, number>;
  hub: [number, number];
  explosion: Texture[];
  smoke: Texture[];
}

const TERRAINS: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'];
const UNIT_ART: UnitArt[] = ['infantry', 'mechanized', 'armor', 'artillery', 'recon', 'air', 'drone', 'air_rotor', 'depot'];

/** Densest built-up blocks in the urban scene (texture px), where city hexes take their ground. */
export const URBAN_SPOTS: readonly [number, number][] = [
  [310, 230],
  [270, 390],
  [550, 590],
  [550, 230],
  [750, 590],
];

let art: Art | null = null;
let pending: Promise<Art | null> | null = null;

/** The loaded art, or null while it loads or if it failed. */
export function getArt(): Art | null {
  return art;
}

/** URL of a unit's rendered portrait, for React. */
export function unitImage(cls: UnitClass): string {
  return `${BASE}units/${cls}.png`;
}

export function loadArt(): Promise<Art | null> {
  pending ??= (async () => {
    try {
      const manifest = (await (await fetch(`${BASE}units/manifest.json`)).json()) as Record<string, { size: number; hub?: [number, number] }>;
      const tex = (url: string) => Assets.load<Texture>(url);
      const [ground, units, explosion, smoke] = await Promise.all([
        Promise.all(TERRAINS.map((t) => tex(`${BASE}terrain/${t}.jpg`))),
        Promise.all(UNIT_ART.map((u) => tex(`${BASE}units/${u}.png`))),
        Promise.all(Array.from({ length: 9 }, (_, i) => tex(`${BASE}fx/explosion${i}.png`))),
        Promise.all(Array.from({ length: 8 }, (_, i) => tex(`${BASE}fx/smoke${i}.png`))),
      ]);
      art = {
        ground: Object.fromEntries(TERRAINS.map((t, i) => [t, ground[i]!])) as Record<Terrain, Texture>,
        units: Object.fromEntries(UNIT_ART.map((u, i) => [u, units[i]!])) as Record<UnitArt, Texture>,
        size: Object.fromEntries(UNIT_ART.map((u) => [u, manifest[u]?.size ?? 32])) as Record<UnitArt, number>,
        hub: manifest.air_rotor?.hub ?? [0.5, 0.5],
        explosion,
        smoke,
      };
      return art;
    } catch {
      return null;
    }
  })();
  return pending;
}
