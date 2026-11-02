import type { UnitClass } from '@brink/contracts';

// Unit pictograms: side profiles (a quadcopter from above) on a 32 x 24 grid, drawn to read at 20 px
// on a counter. One set for the map (Path2D) and the interface (SVG), so a unit looks the same
// everywhere. Shapes, not text or NATO frames: a tank should look like a tank to anyone.

export const PICTO_W = 32;
export const PICTO_H = 24;

interface Shape {
  d: string;
  /** Stroke width; absent means filled. */
  stroke?: number;
}

const ring = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

export const PICTOGRAMS: Record<UnitClass, Shape[]> = {
  infantry: [
    { d: ring(13.6, 4.6, 2.6) },
    { d: 'M10 8h7l1.2 7.2H8.8z' },
    { d: 'M9.4 15h3.1v7H9.4zM14.6 15h3.1v7h-3.1z' },
    { d: 'M5 15.5L26 8.5', stroke: 1.8 },
  ],
  mechanized: [
    { d: 'M5 17h21a2.5 2.5 0 0 1 0 5H5a2.5 2.5 0 0 1 0-5z' },
    { d: 'M3 16.2V9.5L8.5 7H29v9.2z' },
    { d: 'M14 3.5h8v3.5h-8z' },
    { d: 'M21 4.6h9v1.4h-9z' },
  ],
  armor: [
    { d: 'M5 15.5h22a3.4 3.4 0 0 1 0 6.8H5a3.4 3.4 0 0 1 0-6.8z' },
    { d: 'M3.5 15.5l2.5-4.2h20.5l3 4.2z' },
    { d: 'M10.5 11.3l2.2-4.3h8.6l2.2 4.3z' },
    { d: 'M21 8.2h10.5v2H21z' },
  ],
  artillery: [
    { d: 'M5 17h17a2.5 2.5 0 0 1 0 5H5a2.5 2.5 0 0 1 0-5z' },
    { d: 'M3 17.2l1-5.2h20l1.4 5.2z' },
    { d: 'M5.5 7.5h12v4.5h-12z' },
    { d: 'M14 9L31 2', stroke: 2.6 },
  ],
  recon: [
    { d: 'M3 15.5l1-5.3 5-2.2h15l5 3.4v4.1z' },
    { d: `${ring(8, 17.6, 3)}${ring(16, 17.6, 3)}${ring(24, 17.6, 3)}` },
    { d: 'M13 4.8h6.5v3.2H13z' },
  ],
  air: [
    { d: 'M2.5 13.4c0-3 4-5.2 9.4-5.2 5 0 8 1.9 8.6 3.9l10-1.1v2.6l-10 1.5c-.9 2.1-4 3.4-8.6 3.4-5.4 0-9.4-2.1-9.4-5.1z' },
    { d: 'M27 6.6h3.2l-1.2 5.3h-3z' },
    { d: 'M10.8 5.2h2.2v3.2h-2.2z' },
    { d: 'M.5 4.2h23v1.6H.5z' },
    { d: 'M5 20.4h14M8 17.6v2.8M15 17.6v2.8', stroke: 1.3 },
  ],
  drone: [
    { d: 'M8 5L24 19M24 5L8 19', stroke: 2.4 },
    { d: 'M13 9h6v6h-6z' },
    { d: `${ring(8, 5, 4)}${ring(24, 5, 4)}${ring(8, 19, 4)}${ring(24, 19, 4)}`, stroke: 1.6 },
  ],
  // A warship in profile: hull, superstructure, mast, a gun forward.
  fleet: [
    { d: 'M1 15h30l-3.6 5.4H5.2z' },
    { d: 'M10 10.5h11v4.5H10z' },
    { d: 'M13.2 6.5h4.4v4h-4.4z' },
    { d: 'M15.4 1.5v5', stroke: 1.4 },
    { d: 'M22.5 13h2.6v2h-2.6zM24.5 13.6l5-1.6', stroke: 1.5 },
  ],
  // A landing ship: a deep hull with the bow ramp down.
  transport: [
    { d: 'M4 13h21l4.5 7H6.5z' },
    { d: 'M5 8h7v5H5z' },
    { d: 'M25 13l5.5-4', stroke: 2.2 },
    { d: 'M14 10.5h9v2.5h-9z' },
  ],
  // A carrier: a long flat deck, the island to starboard, an aircraft on deck.
  carrier: [
    { d: 'M1 13.5h30l-2.6 6.5H4.5z' },
    { d: 'M.5 11.5h31v2H.5z' },
    { d: 'M20.5 5.5h4v6h-4z' },
    { d: 'M6 9.6h7.5l1.5-1.2h1v1.2h1.5v1.1H6z' },
  ],
};

/** The pictogram as SVG markup, for the interface. */
export function pictogramSvg(cls: UnitClass, color: string): string {
  const body = PICTOGRAMS[cls]
    .map((s) => (s.stroke ? `<path d="${s.d}" fill="none" stroke="${color}" stroke-width="${s.stroke}" stroke-linecap="round"/>` : `<path d="${s.d}" fill="${color}"/>`))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PICTO_W} ${PICTO_H}">${body}</svg>`;
}

/** The pictogram on a transparent canvas, `scale` pixels per grid unit, for the map. */
export function pictogramCanvas(cls: UnitClass, color: string, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(PICTO_W * scale);
  c.height = Math.ceil(PICTO_H * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  for (const s of PICTOGRAMS[cls]) {
    const p = new Path2D(s.d);
    if (s.stroke) {
      ctx.strokeStyle = color;
      ctx.lineWidth = s.stroke;
      ctx.lineCap = 'round';
      ctx.stroke(p);
    } else {
      ctx.fillStyle = color;
      ctx.fill(p);
    }
  }
  return c;
}
