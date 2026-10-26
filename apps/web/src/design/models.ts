import type { UnitClass } from '@brink/contracts';
import { NATIONS } from '@brink/scenarios';

// Top-down unit models, drawn with Canvas 2D and cached as textures. Every model faces +x and is
// centred on (0, 0) in world pixels (a hex is about 52 px across). Vehicles wear their nation's
// camouflage; the nation colour appears only as recognition markings (roof panels, turret
// chevrons, tape), the way real forces tell themselves apart from the air.

/** Texture pixels per world pixel, so models stay sharp when the map is zoomed in. */
export const MODEL_RES = 4;

export interface Camo {
  base: string;
  dark: string;
  light: string;
  /** Tracks, tyres, gun steel. */
  steel: string;
}

/** One scheme per nation slot: woodland, Eastern green, desert, urban grey. */
export const CAMOS: readonly Camo[] = [
  { base: '#4f5535', dark: '#2c3020', light: '#6f6142', steel: '#1d1f1a' },
  { base: '#46553a', dark: '#33402a', light: '#5d6c46', steel: '#1b1e18' },
  { base: '#9c8760', dark: '#7c6a48', light: '#b8a67c', steel: '#2a261d' },
  { base: '#5c615e', dark: '#434745', light: '#7b807c', steel: '#1c1e1d' },
];

/** Camouflage scheme for a nation, by its slot in the scenario. */
export function camoFor(fill: string): number {
  return Math.max(0, NATIONS.findIndex((n) => n.color.toLowerCase() === fill.toLowerCase()));
}

type Ctx = CanvasRenderingContext2D;

/** Deterministic pseudo-random sequence (mulberry32) for camo blots. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Fill the current path with camo: base, then blots clipped to it. */
function camo(c: Ctx, k: Camo, seed: number, x: number, y: number, w: number, h: number) {
  c.save();
  c.fillStyle = k.base;
  c.fill();
  c.clip();
  const r = rng(seed);
  for (let i = 0; i < 9; i++) {
    c.fillStyle = i % 2 ? k.dark : k.light;
    c.globalAlpha = 0.75;
    c.beginPath();
    c.ellipse(x + r() * w, y + r() * h, 1.5 + r() * w * 0.18, 1 + r() * h * 0.22, r() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Soft ground shadow under a footprint. */
function shadow(c: Ctx, draw: () => void, dx = 1.6, dy = 2.2, blur = 2.5) {
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = blur * MODEL_RES;
  c.shadowOffsetX = dx * MODEL_RES;
  c.shadowOffsetY = dy * MODEL_RES;
  draw();
  c.restore();
}

function edge(c: Ctx, color = 'rgba(0,0,0,0.55)', w = 0.5) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.stroke();
}

function tracks(c: Ctx, k: Camo, len: number, half: number, tw: number) {
  for (const s of [-1, 1]) {
    const y = s > 0 ? half - tw : -half;
    roundRect(c, -len / 2, y, len, tw, 1.2);
    c.fillStyle = k.steel;
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 0.35;
    for (let x = -len / 2 + 1; x < len / 2; x += 1.4) {
      c.beginPath();
      c.moveTo(x, y + 0.3);
      c.lineTo(x, y + tw - 0.3);
      c.stroke();
    }
  }
}

function hatch(c: Ctx, x: number, y: number, r: number, k: Camo) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = k.dark;
  c.fill();
  edge(c, 'rgba(0,0,0,0.6)', 0.35);
}

/** Recognition chevron in the nation colour. */
function chevron(c: Ctx, x: number, y: number, s: number, mark: string) {
  c.beginPath();
  c.moveTo(x - s, y - s);
  c.lineTo(x + s * 0.4, y);
  c.lineTo(x - s, y + s);
  c.strokeStyle = mark;
  c.lineWidth = s * 0.55;
  c.lineCap = 'square';
  c.stroke();
}

function tank(c: Ctx, k: Camo, mark: string) {
  shadow(c, () => {
    roundRect(c, -12, -7.5, 24, 15, 2);
    c.fillStyle = k.steel;
    c.fill();
  });
  tracks(c, k, 25, 7.8, 3.4);
  roundRect(c, -11.5, -5.2, 23, 10.4, 1.6);
  camo(c, k, 11, -11.5, -5.2, 23, 10.4);
  edge(c);
  // Engine deck grille.
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 0.4;
  for (let x = -10.5; x < -6; x += 1.1) {
    c.beginPath();
    c.moveTo(x, -3.6);
    c.lineTo(x, 3.6);
    c.stroke();
  }
  // Turret, set back, with a long gun and muzzle brake.
  shadow(c, () => {
    c.beginPath();
    c.moveTo(-6, -4.6);
    c.lineTo(3.5, -4.2);
    c.lineTo(6, -2);
    c.lineTo(6, 2);
    c.lineTo(3.5, 4.2);
    c.lineTo(-6, 4.6);
    c.closePath();
    c.fillStyle = k.base;
    c.fill();
  }, 1, 1.4, 1.5);
  c.beginPath();
  c.moveTo(-6, -4.6);
  c.lineTo(3.5, -4.2);
  c.lineTo(6, -2);
  c.lineTo(6, 2);
  c.lineTo(3.5, 4.2);
  c.lineTo(-6, 4.6);
  c.closePath();
  camo(c, k, 23, -6, -4.6, 12, 9.2);
  edge(c);
  roundRect(c, 5.5, -0.75, 13, 1.5, 0.5);
  c.fillStyle = k.dark;
  c.fill();
  roundRect(c, 17.2, -1.1, 2.4, 2.2, 0.4);
  c.fillStyle = k.steel;
  c.fill();
  hatch(c, -2.5, -2, 1.3, k);
  hatch(c, -2.5, 2.2, 1, k);
  chevron(c, -4, 0, 1.6, mark);
}

function ifv(c: Ctx, k: Camo, mark: string) {
  shadow(c, () => {
    roundRect(c, -11, -6.5, 22, 13, 2);
    c.fillStyle = k.steel;
    c.fill();
  });
  tracks(c, k, 22, 6.8, 2.8);
  c.beginPath();
  c.moveTo(-10.5, -4.6);
  c.lineTo(7, -4.6);
  c.lineTo(10.8, -1.5);
  c.lineTo(10.8, 1.5);
  c.lineTo(7, 4.6);
  c.lineTo(-10.5, 4.6);
  c.closePath();
  camo(c, k, 37, -10.5, -4.6, 21.3, 9.2);
  edge(c);
  // Rear troop hatches.
  for (const y of [-2.2, 2.2]) {
    roundRect(c, -9.5, y - 1.3, 5, 2.6, 0.5);
    c.fillStyle = k.dark;
    c.fill();
  }
  // Small offset turret with a thin autocannon.
  roundRect(c, -1, -3.2, 6, 5, 1.2);
  c.fillStyle = k.base;
  c.fill();
  edge(c);
  roundRect(c, 4.5, -1.2, 9, 0.9, 0.3);
  c.fillStyle = k.steel;
  c.fill();
  // Recognition panel on the roof.
  roundRect(c, -4.4, -3.6, 2.4, 7.2, 0.3);
  c.fillStyle = mark;
  c.fill();
}

function spg(c: Ctx, k: Camo, mark: string) {
  shadow(c, () => {
    roundRect(c, -13, -7, 26, 14, 2);
    c.fillStyle = k.steel;
    c.fill();
  });
  tracks(c, k, 26, 7.3, 3.1);
  roundRect(c, -12.5, -4.9, 25, 9.8, 1.5);
  camo(c, k, 53, -12.5, -4.9, 25, 9.8);
  edge(c);
  // Big boxy turret aft, very long barrel forward over the hull.
  roundRect(c, -11, -4.6, 11, 9.2, 1);
  c.fillStyle = k.base;
  c.fill();
  camo(c, k, 59, -11, -4.6, 11, 9.2);
  edge(c);
  roundRect(c, -1, -0.8, 22, 1.6, 0.5);
  c.fillStyle = k.dark;
  c.fill();
  roundRect(c, 19.5, -1.2, 2.2, 2.4, 0.4);
  c.fillStyle = k.steel;
  c.fill();
  chevron(c, -7, 0, 1.6, mark);
}

function wheeled(c: Ctx, k: Camo, mark: string) {
  shadow(c, () => {
    roundRect(c, -9, -5, 18, 10, 2);
    c.fillStyle = k.steel;
    c.fill();
  });
  for (const [x, y] of [
    [-6, -5.2],
    [5, -5.2],
    [-6, 3.6],
    [5, 3.6],
  ] as const) {
    roundRect(c, x - 2, y, 4, 1.6, 0.6);
    c.fillStyle = k.steel;
    c.fill();
  }
  roundRect(c, -8.8, -4, 17.6, 8, 2);
  camo(c, k, 71, -8.8, -4, 17.6, 8);
  edge(c);
  // Windscreen and bonnet.
  roundRect(c, 1.5, -3.2, 2, 6.4, 0.5);
  c.fillStyle = '#25313a';
  c.fill();
  // Roof weapon station.
  c.beginPath();
  c.arc(-2.5, 0, 2, 0, Math.PI * 2);
  c.fillStyle = k.dark;
  c.fill();
  roundRect(c, -2.5, -0.35, 6, 0.7, 0.2);
  c.fillStyle = k.steel;
  c.fill();
  // Recognition tape across the roof.
  roundRect(c, -7.5, -3.6, 1.4, 7.2, 0.2);
  c.fillStyle = mark;
  c.fill();
}

function soldier(c: Ctx, x: number, y: number, k: Camo, mark: string, rifle = true) {
  shadow(c, () => {
    c.beginPath();
    c.ellipse(x, y, 1.3, 2, 0, 0, Math.PI * 2);
    c.fillStyle = k.base;
    c.fill();
  }, 0.7, 0.9, 0.8);
  if (rifle) {
    c.beginPath();
    c.moveTo(x + 0.2, y + 0.9);
    c.lineTo(x + 3.2, y + 0.4);
    c.strokeStyle = '#151612';
    c.lineWidth = 0.55;
    c.stroke();
  }
  c.beginPath();
  c.arc(x - 0.1, y, 1.05, 0, Math.PI * 2);
  c.fillStyle = k.dark;
  c.fill();
  // Armband tape.
  c.beginPath();
  c.arc(x - 0.1, y - 1.5, 0.45, 0, Math.PI * 2);
  c.fillStyle = mark;
  c.fill();
}

/** A rifle section in a wedge, point man forward. */
function infantry(c: Ctx, k: Camo, mark: string) {
  const wedge: [number, number][] = [
    [7, 0],
    [3, -4],
    [3, 4],
    [-1, -8],
    [-1, 8],
    [-5, -3],
    [-5, 3],
  ];
  for (const [x, y] of wedge) soldier(c, x, y, k, mark);
}

function mechanized(c: Ctx, k: Camo, mark: string) {
  c.save();
  c.translate(-2, 0);
  ifv(c, k, mark);
  c.restore();
  for (const [x, y] of [
    [11, -7],
    [12, 7],
    [8, -9],
  ] as const)
    soldier(c, x, y, k, mark);
}

function recon(c: Ctx, k: Camo, mark: string) {
  wheeled(c, k, mark);
}

/** Attack helicopter airframe, rotor drawn separately. */
function helicopter(c: Ctx, k: Camo, mark: string) {
  // Tail boom and tail rotor.
  roundRect(c, -17, -0.9, 12, 1.8, 0.8);
  c.fillStyle = k.base;
  c.fill();
  edge(c, 'rgba(0,0,0,0.5)', 0.3);
  roundRect(c, -18, -3.2, 1.6, 6.4, 0.5);
  c.fillStyle = k.dark;
  c.fill();
  // Stub wings with rocket pods and missiles.
  roundRect(c, -2.5, -7, 3.2, 14, 0.6);
  c.fillStyle = k.dark;
  c.fill();
  for (const y of [-6.2, 5.2]) {
    roundRect(c, -3.2, y, 4.6, 1.2, 0.5);
    c.fillStyle = k.steel;
    c.fill();
  }
  // Fuselage with tandem cockpit.
  c.beginPath();
  c.moveTo(-6, -2.4);
  c.lineTo(5, -2.2);
  c.quadraticCurveTo(10, -1.4, 10.5, 0);
  c.quadraticCurveTo(10, 1.4, 5, 2.2);
  c.lineTo(-6, 2.4);
  c.closePath();
  camo(c, k, 89, -6, -2.4, 16.5, 4.8);
  edge(c);
  for (const x of [3.2, 6.4]) {
    c.beginPath();
    c.ellipse(x, 0, 1.4, 1.2, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(60,85,95,0.95)';
    c.fill();
  }
  // Chin gun.
  roundRect(c, 9.5, -0.3, 3.5, 0.6, 0.2);
  c.fillStyle = k.steel;
  c.fill();
  chevron(c, -10, 0, 1.2, mark);
}

/** Four blades plus a faint motion disc; rotated every frame. */
function rotor(c: Ctx, radius: number, blades: number) {
  c.beginPath();
  c.arc(0, 0, radius, 0, Math.PI * 2);
  c.fillStyle = 'rgba(20,22,20,0.16)';
  c.fill();
  for (let i = 0; i < blades; i++) {
    c.save();
    c.rotate((i * Math.PI * 2) / blades);
    roundRect(c, 0, -0.45, radius, 0.9, 0.4);
    c.fillStyle = 'rgba(15,16,14,0.85)';
    c.fill();
    c.restore();
  }
  c.beginPath();
  c.arc(0, 0, 1, 0, Math.PI * 2);
  c.fillStyle = '#111';
  c.fill();
}

/** A small quadcopter seen from above. */
function quad(c: Ctx, k: Camo, mark: string) {
  c.strokeStyle = '#191a17';
  c.lineWidth = 0.7;
  for (const [x, y] of [
    [2.4, 2.4],
    [2.4, -2.4],
    [-2.4, 2.4],
    [-2.4, -2.4],
  ] as const) {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(x, y);
    c.stroke();
    c.beginPath();
    c.arc(x, y, 1.7, 0, Math.PI * 2);
    c.fillStyle = 'rgba(25,26,23,0.28)';
    c.fill();
  }
  roundRect(c, -1.5, -1, 3, 2, 0.6);
  c.fillStyle = k.dark;
  c.fill();
  c.beginPath();
  c.arc(1.3, 0, 0.5, 0, Math.PI * 2);
  c.fillStyle = mark;
  c.fill();
}

const DRAW: Record<Exclude<UnitClass, 'air' | 'drone'>, (c: Ctx, k: Camo, mark: string) => void> = {
  infantry,
  mechanized,
  armor: tank,
  artillery: spg,
  recon,
};

export type Part = 'body' | 'rotor' | 'drone';

/** Half-size of each part's canvas in world px. */
const EXTENT: Record<Part, number> = { body: 22, rotor: 15, drone: 7 };

const cache = new Map<string, HTMLCanvasElement>();

/** A cached canvas for one part of a model. The body of `air` is the airframe without rotor. */
export function modelCanvas(cls: UnitClass, camoIndex: number, mark: string, part: Part = 'body'): HTMLCanvasElement {
  const key = `${cls}|${camoIndex}|${mark}|${part}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const half = EXTENT[part];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = half * 2 * MODEL_RES;
  const c = canvas.getContext('2d');
  if (c) {
    c.scale(MODEL_RES, MODEL_RES);
    c.translate(half, half);
    const k = CAMOS[camoIndex % CAMOS.length]!;
    if (part === 'rotor') rotor(c, 13, 4);
    else if (part === 'drone') {
      c.scale(1.4, 1.4);
      quad(c, k, mark);
    }
    else if (cls === 'air') helicopter(c, k, mark);
    else if (cls !== 'drone') DRAW[cls](c, k, mark);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Data URL of a model, for React portraits. */
export function modelDataUrl(cls: UnitClass, camoIndex: number, mark: string): string {
  if (cls === 'drone') {
    const key = `portrait|drone|${camoIndex}|${mark}`;
    const hit = cache.get(key);
    if (hit) return hit.toDataURL();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 44 * MODEL_RES;
    const c = canvas.getContext('2d');
    if (c) {
      c.scale(MODEL_RES, MODEL_RES);
      c.translate(22, 22);
      const k = CAMOS[camoIndex % CAMOS.length]!;
      for (const [x, y, s] of [
        [-8, -6, 1.7],
        [8, -2, 1.7],
        [-2, 9, 1.7],
      ] as const) {
        c.save();
        c.translate(x, y);
        c.scale(s, s);
        quad(c, k, mark);
        c.restore();
      }
    }
    cache.set(key, canvas);
    return canvas.toDataURL();
  }
  return modelCanvas(cls, camoIndex, mark, 'body').toDataURL();
}
