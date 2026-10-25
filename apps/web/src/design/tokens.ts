// Brink design tokens for code that cannot read CSS (the Pixi map). Keep in step with the
// @theme block in index.css; docs/design-system.md is the reference for both.

/** APP-6 affiliation colours, darkened for a dark map. Friend = you, hostile = at war. */
export const AFFILIATION = {
  friend: 0x4cc3ff,
  hostile: 0xff5a4e,
  neutral: 0x8fd694,
  unknown: 0xffe14d,
} as const;

export const SURFACE = {
  ink950: 0x0a0c0b,
  ink900: 0x101311,
  ink850: 0x141815,
  line: 0x343e37,
} as const;

export const SIGNAL = 0xf2a93b;
export const GOOD = 0x6fcf7f;
export const TEXT = 0xebe7da;

/** Health ramp for strength bars. */
export function healthColor(ratio: number): number {
  return ratio > 0.6 ? GOOD : ratio > 0.35 ? 0xe8c547 : AFFILIATION.hostile;
}

export const FONT_DISPLAY = "'Barlow Condensed', 'IBM Plex Sans Condensed', system-ui, sans-serif";
export const FONT_UI = "'IBM Plex Sans', system-ui, sans-serif";
export const FONT_DATA = "'IBM Plex Mono', ui-monospace, monospace";
