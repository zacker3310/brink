import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { UnitClass } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { pictogramCanvas, PICTO_W } from './design/pictograms';
import { AFFILIATION, FONT_DISPLAY, SIGNAL, SURFACE } from './design/tokens';

// Units on the Pixi map as wargame counters: a rounded tile with a pictogram of the unit and its
// strength as one number, 1 to 10. Yours are solid in your colour; everyone else's are dark tiles
// edged in theirs, with a red tab when you are at war. A hex holding several units shows one counter
// with a stack behind it and a count. Shared by the live map and the turn replay.

/** Counter edge in world pixels (a hex is 52 across). */
export const COUNTER = 27;
const PICTO_RES = 4;

/** Friend (you and allies), hostile (at war), neutral (at peace), unknown. */
export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown';

export interface CounterLook {
  cls: UnitClass;
  aff: Affiliation;
  /** Owning nation's colour, as #rrggbb. */
  fill: string;
  /** False for a last-known contact: faded. */
  confirmed: boolean;
  /** 0..1000. */
  strength: number;
  selected?: boolean;
  /** A ghost at a planned destination. */
  planned?: boolean;
  /** Has no orders yet (own units). */
  idle?: boolean;
  /** Heading in radians; kept for the replay's API, counters do not turn. */
  facing?: number;
  /** Units in the hex this counter stands for. */
  count?: number;
}

/** Strength as the counter prints it: 1 to 10, never 0 while the unit lives. */
export function steps(strength: number): number {
  return Math.max(1, Math.min(10, Math.ceil(strength / 100)));
}

const textures = new Map<string, Texture>();

function picto(cls: UnitClass, color: string): Texture {
  const key = `${cls}|${color}`;
  let t = textures.get(key);
  if (!t) {
    t = Texture.from(pictogramCanvas(cls, color, PICTO_RES));
    textures.set(key, t);
  }
  return t;
}

const hexOf = (c: string) => Number.parseInt(c.replace('#', ''), 16);

/** Black or white, whichever reads on a nation colour. */
function inkOn(color: string): string {
  const n = hexOf(color);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#0d1114' : '#ffffff';
}

const live = new Set<UnitModel>();
let zoom = 1;

/** Kept for callers that animate per frame; counters are still. */
export function tickModels(_now: number): void {}

const steady = new Set<{ scale: { set(v: number): void }; destroyed: boolean }>();

/** The map's zoom: counters and labels hold a readable size on screen while the ground grows. */
export function setModelZoom(z: number): void {
  if (Math.abs(z - zoom) < 0.01) return;
  zoom = z;
  for (const m of live) m.applyZoom();
  for (const o of steady) {
    if (o.destroyed) steady.delete(o);
    else o.scale.set(Math.min(1, 1.3 / zoom));
  }
}

/** Keep a map label the same size on screen at any zoom. */
export function keepScreenSize(o: { scale: { set(v: number): void }; destroyed: boolean }): void {
  steady.add(o);
  o.scale.set(Math.min(1, 1.3 / zoom));
}

/** One counter on the map. Position the container at the hex (or slot) it stands on. */
export class UnitModel extends Container {
  readonly look: CounterLook;
  private readonly tile = new Container();
  private readonly strengthText: Text | null = null;
  private shown = -1;

  constructor(look: CounterLook) {
    super();
    this.look = { ...look };
    const own = look.aff === 'friend' && !look.planned ? look.fill : null;
    const S = COUNTER;
    const r = 5;
    const g = new Graphics();
    const count = look.count ?? 1;
    // The stack: up to two counters peeking out behind.
    for (let i = Math.min(2, count - 1); i >= 1; i--) {
      g.roundRect(-S / 2 + i * 3, -S / 2 - i * 3, S, S, r)
        .fill({ color: own ? hexOf(look.fill) : SURFACE.ink900 })
        .stroke({ width: 1.2, color: own ? 0x0d1114 : hexOf(look.fill), alpha: 0.9 });
    }
    if (look.selected) g.roundRect(-S / 2 - 4, -S / 2 - 4, S + 8, S + 8, r + 3).stroke({ width: 3, color: AFFILIATION.friend });
    // Shadow, then the counter itself.
    g.roundRect(-S / 2 + 1.5, -S / 2 + 2.5, S, S, r).fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(-S / 2, -S / 2, S, S, r)
      .fill({ color: own ? hexOf(look.fill) : SURFACE.ink900 })
      .stroke({ width: own ? 1.6 : 2.2, color: own ? 0xffffff : hexOf(look.fill), alpha: own ? 0.95 : 1 });
    if (look.aff === 'hostile') g.roundRect(-S / 2 + 3, -S / 2 - 1.2, S - 6, 3.2, 1.5).fill({ color: AFFILIATION.hostile });
    this.tile.addChild(g);

    const ink = own ? inkOn(look.fill) : look.fill;
    const p = new Sprite(picto(look.cls, ink));
    const w = S * 0.74;
    p.scale.set(w / (PICTO_W * PICTO_RES));
    p.anchor.set(0.5);
    p.position.set(0, -2.5);
    this.tile.addChild(p);

    if (!look.planned) {
      this.strengthText = new Text({
        text: '',
        resolution: 4,
        style: { fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: '800', fill: ink, stroke: { color: own ? hexOf(look.fill) : SURFACE.ink900, width: 2.5, join: 'round' } },
      });
      this.strengthText.anchor.set(1, 1);
      this.strengthText.position.set(S / 2 - 2.5, S / 2 + 0.5);
      this.tile.addChild(this.strengthText);
      this.setStrength(look.strength);
      if (count > 1) {
        const badge = new Container();
        const b = new Graphics().circle(0, 0, 6.5).fill({ color: 0xffffff }).stroke({ width: 1.5, color: 0x0d1114 });
        const n = new Text({ text: String(count), resolution: 4, style: { fontFamily: FONT_DISPLAY, fontSize: 9.5, fontWeight: '800', fill: 0x0d1114 } });
        n.anchor.set(0.5);
        n.position.set(0, 0.3);
        badge.addChild(b, n);
        badge.position.set(S / 2, -S / 2);
        this.tile.addChild(badge);
      }
      if (look.idle) {
        this.tile.addChild(new Graphics().circle(-S / 2 + 1, -S / 2 + 1, 4.2).fill({ color: SIGNAL }).stroke({ width: 1.4, color: 0x0d1114 }));
      }
    }
    // Air units ride a little higher, over a shadow on the ground.
    if (!UNITS[look.cls].ground) {
      this.tile.y = -3;
      const shade = new Graphics().ellipse(2, S / 2 + 2, S * 0.42, 3.5).fill({ color: 0x000000, alpha: 0.35 });
      this.addChild(shade);
    }
    this.addChild(this.tile);
    if (look.planned) this.alpha = 0.42;
    else if (!look.confirmed) this.alpha = 0.55;
    live.add(this);
    this.applyZoom();
  }

  /** Below a readable size on screen the counter grows (up to the hex), so it can always be read and tapped. */
  applyZoom() {
    const onScreen = COUNTER * zoom * Math.max(0.5, this.scale.x);
    const k = onScreen < 30 ? Math.min(1.7, 30 / onScreen) : 1;
    this.tile.scale.set(k);
  }

  setStrength(strength: number) {
    const n = steps(strength);
    if (!this.strengthText || n === this.shown) return;
    this.shown = n;
    this.strengthText.text = String(n);
  }

  setFacing(_rad: number) {}

  tick(_now: number) {}

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    live.delete(this);
    super.destroy(options);
  }
}

/** Where several counters in one hex sit during the replay, fanned so each can be followed. */
export function slotOffsets(n: number): { x: number; y: number; scale: number }[] {
  if (n <= 1) return [{ x: 0, y: 0, scale: 1 }];
  if (n === 2)
    return [
      { x: -8, y: -5, scale: 0.82 },
      { x: 8, y: 5, scale: 0.82 },
    ];
  return [
    { x: -10, y: -7, scale: 0.72 },
    { x: 10, y: -4, scale: 0.72 },
    { x: 0, y: 9, scale: 0.72 },
  ];
}

/** Add a counter to `layer` at (x, y). */
export function addUnit(layer: Container, x: number, y: number, m: CounterLook, scale = 1): UnitModel {
  const u = new UnitModel(m);
  u.position.set(x, y);
  u.scale.set(scale);
  u.applyZoom();
  layer.addChild(u);
  return u;
}

/** Affiliation of a unit as the viewer sees it. */
export function affiliationOf(own: boolean, relation: string | undefined): Affiliation {
  if (own || relation === 'alliance') return 'friend';
  return relation === 'war' ? 'hostile' : 'neutral';
}
