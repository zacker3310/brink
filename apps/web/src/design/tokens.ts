// Brink design tokens for code that cannot read CSS (the Pixi map). Keep in step with the
// @theme block in index.css; docs/design-system.md is the reference for both.

/** APP-6 affiliation colours, darkened for a dark map. Friend = you, hostile = at war. */
export const AFFILIATION = {
  friend: 0x49b8ff,
  hostile: 0xff4d42,
  neutral: 0x8fd694,
  unknown: 0xffe14d,
} as const;

export const SURFACE = {
  ink950: 0x070909,
  ink900: 0x0c0f10,
  ink850: 0x111516,
  line: 0x252c2e,
} as const;

export const SIGNAL = 0xd2f249;
export const GOOD = 0x57d3a0;
export const TEXT = 0xeef1ee;

/** Health ramp for strength bars. */
export function healthColor(ratio: number): number {
  return ratio > 0.6 ? GOOD : ratio > 0.35 ? 0xe8c547 : AFFILIATION.hostile;
}

export const FONT_DISPLAY = "'Archivo Variable', 'Archivo', system-ui, sans-serif";
export const FONT_UI = "'Archivo Variable', 'Archivo', system-ui, sans-serif";
export const FONT_DATA = "'Martian Mono', ui-monospace, monospace";
