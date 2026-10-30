import type { Exposure, HullFace } from '@brink/arena';

// The facing glyph at a move being looked at (report item 6): for a vehicle, its hull seen from
// above, front up, each face shaded by how many known enemies would strike it there; for troops, a
// shield, full or half for the cover they would have. A flank warning is its own shape, a warning
// triangle on the side it is exposed, not just a colour. One set of paths in a 100 x 100 box, drawn
// as SVG on the move card and with Path2D on the field.

export type Face = Exclude<HullFace, 'top'>;

export interface FacingGlyph {
  kind: 'hull' | 'shield';
  /** Heading after the move, radians (0 faces +x, y runs down the field). */
  facing: number;
  /** How many known enemies would strike each face. */
  faces: Record<Face, number>;
  shield: 'full' | 'half' | 'none';
  flanked: boolean;
  /** Where the warning triangle goes: the exposed face struck most. */
  warn: Exclude<Face, 'front'> | null;
}

/** The glyph for a move's exposure, or null for aircraft (nothing to show). */
export function glyphOf(e: Exposure | null, flying: boolean): FacingGlyph | null {
  if (!e || flying) return null;
  const faces: Record<Face, number> = { front: 0, left: 0, right: 0, rear: 0 };
  for (const t of e.threats) if (t.face && t.face !== 'top') faces[t.face]++;
  const exposed = (['rear', 'left', 'right'] as const).filter((f) => faces[f] > 0).sort((p, q) => faces[q] - faces[p]);
  const warn = e.flanked ? (e.vehicle ? (exposed[0] ?? null) : 'right') : null;
  return { kind: e.vehicle ? 'hull' : 'shield', facing: e.facing, faces, shield: e.shield, flanked: e.flanked, warn };
}

/** Hull faces, front up: trapezoids round a box 36 wide and 62 long. */
export const HULL_FACES: Record<Face, string> = {
  front: 'M32 16H68L60 32H40Z',
  rear: 'M40 64H60L68 78H32Z',
  left: 'M32 16L40 32V64L32 78Z',
  right: 'M68 16L60 32V64L68 78Z',
};
/** The gun, pointing to the front. */
export const HULL_GUN = 'M47.5 8H52.5V44H47.5Z';
export const HULL_TURRET = 'M50 38m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0';
export const SHIELD = 'M50 12L76 22V46C76 66 65 79 50 86C35 79 24 66 24 46V22Z';
export const SHIELD_HALF = 'M50 12L24 22V46C24 66 35 79 50 86Z';

const WARN_AT: Record<Exclude<Face, 'front'>, [number, number]> = { left: [16, 38], right: [84, 38], rear: [50, 81] };

/** The warning triangle, pointing up, centred on the exposed side (the shield's sits top right). */
export function warnPath(where: Exclude<Face, 'front'>, shield = false): { tri: string; mark: string } {
  const [cx, top] = shield ? [85, 4] : WARN_AT[where];
  return { tri: `M${cx} ${top}L${cx + 11} ${top + 18}H${cx - 11}Z`, mark: `M${cx - 1.6} ${top + 5.5}H${cx + 1.6}V${top + 12}H${cx - 1.6}ZM${cx - 1.6} ${top + 13.6}H${cx + 1.6}V${top + 16}H${cx - 1.6}Z` };
}

/** Fill of a hull face: unexposed faint white, struck by one or more known enemies red. */
export function faceFill(n: number): { colour: 'white' | 'red'; alpha: number } {
  return n <= 0 ? { colour: 'white', alpha: 0.22 } : { colour: 'red', alpha: n === 1 ? 0.62 : 0.92 };
}

/** Draw the glyph into a square canvas: a dark disc for contrast, then the shapes. */
export function drawGlyph(ctx: CanvasRenderingContext2D, g: FacingGlyph, size: number, red: string): void {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(50, 50, 49, 0, Math.PI * 2);
  ctx.fill();
  const fill = (d: string, colour: string, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    ctx.fill(new Path2D(d));
  };
  const stroke = (d: string) => {
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(d));
  };
  if (g.kind === 'hull') {
    for (const f of ['front', 'rear', 'left', 'right'] as const) {
      const { colour, alpha } = faceFill(g.faces[f]);
      fill(HULL_FACES[f], colour === 'red' ? red : '#ffffff', alpha);
      stroke(HULL_FACES[f]);
    }
    fill(HULL_TURRET, '#ffffff', 0.95);
    fill(HULL_GUN, '#ffffff', 0.95);
  } else {
    if (g.shield !== 'none') fill(g.shield === 'full' ? SHIELD : SHIELD_HALF, '#ffffff', 0.9);
    if (g.shield === 'none') ctx.setLineDash([7, 5]);
    stroke(SHIELD);
    ctx.setLineDash([]);
  }
  if (g.warn) {
    const w = warnPath(g.warn, g.kind === 'shield');
    fill(w.tri, red, 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke(new Path2D(w.tri));
    fill(w.mark, '#ffffff', 1);
  }
  ctx.restore();
}
