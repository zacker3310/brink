// Render quality for the battle (docs/arena-v2.md, section 8). Phones start on Balanced, computers on
// High; the battle menu changes it and the choice is remembered on this device.

export type Quality = 'low' | 'balanced' | 'high';

export interface QualityPreset {
  /** Device pixel ratio cap. */
  pixelRatio: number;
  /** Shadow map size; 0 turns shadows off. */
  shadowMap: number;
  /** Grass, scrub and small ground clutter instances. */
  clutter: number;
  /** Smoke, fire and dust sprites alive at once. */
  particles: number;
  /** Point lights used for muzzle flashes and fires. */
  flashLights: number;
  /** Vehicles nearer than this many cells to the camera focus use their full model. */
  detailCells: number;
  /** Soldiers cast shadows. */
  soldierShadows: boolean;
  /** Antialiasing on the canvas. */
  antialias: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, shadowMap: 0, clutter: 600, particles: 120, flashLights: 0, detailCells: 0, soldierShadows: false, antialias: false },
  balanced: { pixelRatio: 1.6, shadowMap: 1024, clutter: 1500, particles: 300, flashLights: 1, detailCells: 14, soldierShadows: false, antialias: true },
  high: { pixelRatio: 2, shadowMap: 2048, clutter: 4000, particles: 700, flashLights: 4, detailCells: 30, soldierShadows: true, antialias: true },
};

export interface ArenaSettings {
  quality: Quality;
  /** Short cuts to the action on big hits. */
  actionCams: boolean;
  /** Radio calls from your side. */
  radio: boolean;
}

const KEY = 'brink.arena.settings.v1';

function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
}

export function defaultSettings(): ArenaSettings {
  return { quality: isPhone() ? 'balanced' : 'high', actionCams: true, radio: true };
}

export function readSettings(): ArenaSettings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<ArenaSettings>;
    return {
      quality: s.quality === 'low' || s.quality === 'balanced' || s.quality === 'high' ? s.quality : base.quality,
      actionCams: typeof s.actionCams === 'boolean' ? s.actionCams : base.actionCams,
      radio: typeof s.radio === 'boolean' ? s.radio : base.radio,
    };
  } catch {
    return base;
  }
}

export function writeSettings(s: ArenaSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage is optional: the choice just does not persist.
  }
}

/** World units per metre: models are drawn at 10 m a cell (one cell is one world unit). */
export const METRE = 0.1;
/** World units per elevation level. */
export const LEVEL = 0.4;
