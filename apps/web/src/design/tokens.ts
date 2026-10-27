// Brink design tokens for code that cannot read CSS (the Pixi map). Keep in step with the
// @theme block in index.css; docs/design-system.md is the reference for both.

/** APP-6 affiliation colours, darkened for a dark map. Friend = you, hostile = at war. */
export const AFFILIATION = {
  friend: 0x4fb3ff,
  hostile: 0xff5a4e,
  neutral: 0x9ad69c,
  unknown: 0xffe14d,
} as const;

export const SURFACE = {
  ink950: 0x0d1114,
  ink900: 0x141a1e,
  ink850: 0x1a2126,
  line: 0x33404a,
} as const;

export const SIGNAL = 0xffc23d;
export const GOOD = 0x4fd18b;
export const TEXT = 0xf3f5f6;

/** Health ramp for strength bars. */
export function healthColor(ratio: number): number {
  return ratio > 0.6 ? GOOD : ratio > 0.35 ? 0xe8c547 : AFFILIATION.hostile;
}

export const FONT_DISPLAY = "'Barlow Condensed', 'Barlow', system-ui, sans-serif";
export const FONT_UI = "'Barlow', system-ui, sans-serif";
export const FONT_DATA = "'Barlow', system-ui, sans-serif";
