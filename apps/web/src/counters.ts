import type { Graphics } from 'pixi.js';
import type { UnitClass } from '@brink/contracts';

// Unit counters on the Pixi map, shared by the live map and the turn replay.

export const COUNTER_W = 30;
export const COUNTER_H = 20;

/** A NATO-style class symbol inside a w x h frame at (x, y). */
export function drawSymbol(g: Graphics, cls: UnitClass, x: number, y: number, w: number, h: number, color: number, alpha: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const line = { width: 1.6, color, alpha };
  if (cls === 'infantry' || cls === 'mechanized') g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke(line);
  if (cls === 'mechanized' || cls === 'armor') g.ellipse(cx, cy, w * 0.32, h * 0.26).stroke({ ...line, width: cls === 'armor' ? 2.2 : 1.6 });
  if (cls === 'artillery') g.circle(cx, cy, h * 0.2).fill({ color, alpha });
  if (cls === 'recon') g.moveTo(x, y + h).lineTo(x + w, y).stroke(line);
  if (cls === 'air') g.moveTo(x + w * 0.15, cy + 2).quadraticCurveTo(x + w * 0.32, cy - 6, cx, cy + 2).quadraticCurveTo(x + w * 0.68, cy - 6, x + w * 0.85, cy + 2).stroke(line);
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

/** One counter with its top-left at (x, y): drop shadow, frame, class symbol and health bar. */
export function drawCounter(g: Graphics, x: number, y: number, m: CounterLook, fade = 1) {
  const W = COUNTER_W;
  const H = COUNTER_H;
  const alpha = (m.confirmed ? 1 : 0.45) * fade;
  if (m.selected) g.roundRect(x - 4, y - 4, W + 8, H + 12, 4).fill({ color: 0x7fd3ff, alpha: 0.28 * fade }).stroke({ width: 2, color: 0x7fd3ff, alpha: 0.9 * fade });
  g.roundRect(x + 1.5, y + 2.5, W, H, 2).fill({ color: 0x000000, alpha: 0.45 * alpha });
  g.roundRect(x, y, W, H, 2)
    .fill({ color: m.own ? m.color : 0x10161f, alpha })
    .stroke({ width: m.selected ? 2 : 1.4, color: m.selected ? 0xffffff : m.own ? 0x070b12 : m.color, alpha });
  drawSymbol(g, m.cls, x + 2, y + 2, W - 4, H - 4, m.own ? 0x070b12 : m.color, alpha);
  // Health bar, Civ-style: green to red.
  const ratio = Math.max(0, Math.min(1, m.strength / 1000));
  const hp = ratio > 0.6 ? 0x5fd17a : ratio > 0.35 ? 0xe8c547 : 0xe0523e;
  g.rect(x, y + H + 2, W, 3).fill({ color: 0x070b12, alpha: 0.85 * alpha });
  g.rect(x + 0.5, y + H + 2.5, Math.max(1, (W - 1) * ratio), 2).fill({ color: hp, alpha });
}
