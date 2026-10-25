import { Sprite, Texture, type Container, type Graphics } from 'pixi.js';
import type { UnitClass } from '@brink/contracts';
import { AFFILIATION, healthColor, SURFACE } from './design/tokens';
import { symbolCanvas, type Affiliation } from './design/symbols';

// Unit counters on the Pixi map: an APP-6 symbol sprite plus a health bar and selection ring.
// Shared by the live map and the turn replay so both draw identical units.

/** milsymbol size for map counters; a friend frame comes out about 30 x 20 world px. */
const SYMBOL_SIZE = 20;
/** Symbols render at this multiple and are scaled down, so they stay sharp when zoomed in. */
const RES = 3;

export interface CounterLook {
  cls: UnitClass;
  aff: Affiliation;
  /** Owning nation's colour, as #rrggbb. */
  fill: string;
  /** False for a last-known contact: dashed frame, faded. */
  confirmed: boolean;
  /** 0..1000. */
  strength: number;
  selected?: boolean;
  /** A ghost at a planned destination. */
  planned?: boolean;
}

const textures = new Map<string, Texture>();

function texture(m: CounterLook) {
  const look = { cls: m.cls, aff: m.aff, fill: m.fill, planned: m.planned || !m.confirmed, size: SYMBOL_SIZE };
  const c = symbolCanvas(look, RES);
  const key = JSON.stringify(look);
  let t = textures.get(key);
  if (!t) {
    t = Texture.from(c.canvas);
    textures.set(key, t);
  }
  return { t, c };
}

/** World-space extent of a counter around its centre. */
export function counterExtent(m: CounterLook): { up: number; down: number; half: number } {
  const { c } = texture(m);
  return { up: c.anchor.y / RES, down: (c.height - c.anchor.y) / RES, half: c.width / RES / 2 };
}

/** A sprite for the counter, centred on (0, 0). Callers position it. */
export function counterSprite(m: CounterLook): Sprite {
  const { t, c } = texture(m);
  const s = new Sprite(t);
  s.anchor.set(c.anchor.x / c.width, c.anchor.y / c.height);
  s.scale.set(1 / RES);
  return s;
}

/** Selection ring and health bar for a counter centred at (x, y). */
export function drawCounterChrome(g: Graphics, x: number, y: number, m: CounterLook, fade = 1) {
  const e = counterExtent(m);
  const alpha = (m.confirmed ? 1 : 0.45) * fade;
  const w = Math.max(26, e.half * 2 - 4);
  if (m.selected) {
    g.roundRect(x - e.half - 4, y - e.up - 2, e.half * 2 + 8, e.up + e.down + 10, 4)
      .fill({ color: AFFILIATION.friend, alpha: 0.22 * fade })
      .stroke({ width: 2, color: AFFILIATION.friend, alpha: 0.95 * fade });
  }
  if (m.planned) return;
  const ratio = Math.max(0, Math.min(1, m.strength / 1000));
  const top = y + e.down - 1;
  g.rect(x - w / 2, top, w, 3.5).fill({ color: SURFACE.ink950, alpha: 0.9 * alpha });
  g.rect(x - w / 2 + 0.5, top + 0.5, Math.max(1, (w - 1) * ratio), 2.5).fill({ color: healthColor(ratio), alpha });
}

/** Add a complete counter (sprite into `layer`, chrome into `g`) centred at (x, y). */
export function addCounter(layer: Container, g: Graphics, x: number, y: number, m: CounterLook, fade = 1): Sprite {
  const s = counterSprite(m);
  s.position.set(x, y);
  s.alpha = (m.confirmed ? 1 : 0.55) * (m.planned ? 0.55 : 1) * fade;
  layer.addChild(s);
  drawCounterChrome(g, x, y, m, fade);
  return s;
}

/** Affiliation of a unit as the viewer sees it. */
export function affiliationOf(own: boolean, relation: string | undefined): Affiliation {
  if (own || relation === 'alliance') return 'friend';
  return relation === 'war' ? 'hostile' : 'neutral';
}
