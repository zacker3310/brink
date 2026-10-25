import type { Graphics } from 'pixi.js';
import type { UnitClass } from '@brink/contracts';

// Unit counters on the Pixi map, shared by the live map and the turn replay.

export const COUNTER_W = 24;
export const COUNTER_H = 16;

/** A NATO-style class symbol inside a w x h frame at (x, y). */
export function drawSymbol(g: Graphics, cls: UnitClass, x: number, y: number, w: number, h: number, color: number, alpha: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const line = { width: 1.4, color, alpha };
  if (cls === 'infantry' || cls === 'mechanized') g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke(line);
  if (cls === 'mechanized' || cls === 'armor') g.ellipse(cx, cy, w * 0.32, h * 0.26).stroke({ ...line, width: cls === 'armor' ? 1.8 : 1.4 });
  if (cls === 'artillery') g.circle(cx, cy, h * 0.18).fill({ color, alpha });
  if (cls === 'recon') g.moveTo(x, y + h).lineTo(x + w, y).stroke(line);
  if (cls === 'air') g.moveTo(x + w * 0.15, cy + 2).quadraticCurveTo(x + w * 0.32, cy - 5, cx, cy + 2).quadraticCurveTo(x + w * 0.68, cy - 5, x + w * 0.85, cy + 2).stroke(line);
}

export interface CounterLook {
  cls: UnitClass;
  color: number;
  own: boolean;
  confirmed: boolean;
  /** 0..1000. */
  strength: number;
  selected?: boolean;
}

/** One counter with its top-left at (x, y): frame, class symbol and strength strip. */
export function drawCounter(g: Graphics, x: number, y: number, m: CounterLook, fade = 1) {
  const W = COUNTER_W;
  const H = COUNTER_H;
  const alpha = (m.confirmed ? 1 : 0.45) * fade;
  if (m.selected) g.roundRect(x - 3, y - 3, W + 6, H + 9, 3).fill({ color: 0xffffff, alpha: 0.18 * fade });
  g.rect(x, y, W, H).fill({ color: m.own ? m.color : 0x0d121c, alpha }).stroke({ width: m.selected ? 2 : 1.2, color: m.selected ? 0xffffff : m.own ? 0x070b12 : m.color, alpha });
  drawSymbol(g, m.cls, x, y, W, H, m.own ? 0x070b12 : m.color, alpha);
  g.rect(x, y + H + 1, W, 2.5).fill({ color: 0x070b12, alpha: 0.8 * alpha });
  const sw = Math.max(1, Math.round((W * m.strength) / 1000));
  g.rect(x, y + H + 1, sw, 2.5).fill({ color: m.strength < 400 ? 0xd9534f : m.own ? 0x6fbf8e : m.color, alpha });
}
