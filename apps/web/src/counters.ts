import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { UnitClass } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { getArt, type Art, type UnitArt } from './art';
import { AFFILIATION, healthColor, SIGNAL, SURFACE } from './design/tokens';
import { camoFor, MODEL_RES, modelCanvas, type Part } from './design/models';
import { symbolCanvas, type Affiliation } from './design/symbols';

// Units on the Pixi map: a top-down model of the formation (tanks, a rifle section, a helicopter
// with its rotor turning, a drone team circling), with a small APP-6 chip and health bar above it
// carrying the affiliation. Shared by the live map and the turn replay so both draw the same.

/** Size of the APP-6 chip above a model, in milsymbol units. */
const CHIP_SIZE = 9;
const CHIP_RES = 3;

export interface CounterLook {
  cls: UnitClass;
  aff: Affiliation;
  /** Owning nation's colour, as #rrggbb. */
  fill: string;
  /** False for a last-known contact: dashed chip, faded. */
  confirmed: boolean;
  /** 0..1000. */
  strength: number;
  selected?: boolean;
  /** A ghost at a planned destination. */
  planned?: boolean;
  /** Has no orders yet (own units). */
  idle?: boolean;
  /** Heading in radians; 0 faces east. */
  facing?: number;
}

const textures = new Map<string, Texture>();

function tex(key: string, make: () => HTMLCanvasElement): Texture {
  let t = textures.get(key);
  if (!t) {
    t = Texture.from(make());
    textures.set(key, t);
  }
  return t;
}

function partSprite(cls: UnitClass, fill: string, part: Part): Sprite {
  const camo = camoFor(fill);
  const s = new Sprite(tex(`${cls}|${camo}|${fill}|${part}`, () => modelCanvas(cls, camo, fill, part)));
  s.anchor.set(0.5);
  s.scale.set(1 / MODEL_RES);
  return s;
}

function chipSprite(m: CounterLook): Sprite {
  const look = { cls: m.cls, aff: m.aff, fill: m.fill, planned: m.planned || !m.confirmed, size: CHIP_SIZE, echelon: false };
  const c = symbolCanvas(look, CHIP_RES);
  const s = new Sprite(tex(`chip|${JSON.stringify(look)}`, () => c.canvas));
  s.anchor.set(c.anchor.x / c.width, c.anchor.y / c.height);
  s.scale.set(1 / CHIP_RES);
  return s;
}

/** A sprite of imported art, centred, at its true world size. */
function artSprite(art: Art, key: UnitArt): Sprite {
  const s = new Sprite(art.units[key]);
  s.anchor.set(0.5);
  s.scale.set(art.size[key] / s.texture.width);
  return s;
}

const hexOf = (c: string) => Number.parseInt(c.replace('#', ''), 16);

const live = new Set<UnitModel>();
let zoom = 1;

/** Advance every model's animation (rotors, drone orbits). Call once per frame. */
export function tickModels(now: number): void {
  for (const m of live) m.tick(now);
}

const steady = new Set<{ scale: { set(v: number): void }; destroyed: boolean }>();

/** The map's zoom: chips and map labels hold their size on screen while the ground grows. */
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

/** One formation on the map. Position the container at the formation's point. */
export class UnitModel extends Container {
  readonly look: CounterLook;
  private readonly body = new Container();
  private readonly ground = new Container();
  private readonly chrome = new Graphics();
  private readonly badge = new Container();
  private readonly bar = new Graphics();
  /** Everything that turns with the unit's heading. */
  private readonly craft = new Container();
  private rotor: Sprite | null = null;
  private shadow: Sprite | null = null;
  private drones: { craft: Container; shade: Graphics; phase: number }[] = [];
  private readonly airborne: boolean;
  private readonly seed: number;

  constructor(look: CounterLook) {
    super();
    this.look = { ...look };
    this.airborne = !UNITS[look.cls].ground;
    this.seed = Math.random() * 1000;
    this.addChild(this.ground, this.body, this.chrome);
    this.body.addChild(this.craft);
    this.craft.rotation = look.facing ?? 0;
    const art = getArt();
    if (look.cls === 'drone') {
      for (let i = 0; i < 3; i++) {
        const shade = new Graphics().ellipse(0, 0, 3, 2).fill({ color: 0x000000, alpha: 0.28 });
        const craft = new Container();
        craft.addChild(art ? artSprite(art, 'drone') : partSprite('drone', look.fill, 'drone'));
        this.ground.addChild(shade);
        this.body.addChild(craft);
        this.drones.push({ craft, shade, phase: (i * Math.PI * 2) / 3 });
      }
    } else if (look.cls === 'air') {
      // The airframe flies above its own shadow; the rotor turns on its real hub.
      const shade = art ? artSprite(art, 'air') : partSprite('air', look.fill, 'body');
      shade.tint = 0x000000;
      shade.alpha = 0.32;
      shade.position.set(5, 7);
      shade.rotation = look.facing ?? 0;
      shade.scale.set(shade.scale.x * 0.9);
      this.shadow = shade;
      this.ground.addChild(shade);
      if (art) {
        this.craft.addChild(artSprite(art, 'air'));
        const rotor = new Sprite(art.units.air_rotor);
        const k = art.size.air_rotor / rotor.texture.width;
        rotor.anchor.set(art.hub[0], art.hub[1]);
        rotor.scale.set(k);
        rotor.position.set((art.hub[0] - 0.5) * art.size.air_rotor, (art.hub[1] - 0.5) * art.size.air_rotor);
        this.rotor = rotor;
        this.craft.addChild(rotor);
      } else {
        this.craft.addChild(partSprite('air', look.fill, 'body'));
        this.rotor = partSprite('air', look.fill, 'rotor');
        this.craft.addChild(this.rotor);
      }
      this.body.y = -5;
    } else {
      this.craft.addChild(art ? artSprite(art, look.cls) : partSprite(look.cls, look.fill, 'body'));
    }
    // Recognition panel in the nation colour, the way real vehicles mark themselves from the air.
    if (art && look.cls !== 'infantry' && look.cls !== 'drone') {
      const mark = new Graphics().rect(-5, -1.6, 3.2, 3.2).fill({ color: hexOf(look.fill), alpha: 0.95 }).stroke({ width: 0.5, color: 0x000000, alpha: 0.6 });
      this.craft.addChild(mark);
    }
    if (look.planned) {
      this.body.alpha = 0.42;
      this.ground.alpha = 0.3;
    }
    if (!look.planned) {
      this.badge.addChild(chipSprite(look), this.bar);
      this.addChild(this.badge);
    }
    this.alpha = look.confirmed ? 1 : 0.5;
    this.drawChrome(look.strength);
    live.add(this);
    this.applyZoom();
    this.tick(performance.now());
  }

  /** Keep the chip a constant size on screen, riding above the model. */
  applyZoom() {
    const k = Math.min(1.15, 1.25 / zoom) / Math.max(0.5, this.scale.x);
    this.badge.scale.set(k);
    this.badge.position.set(0, (this.airborne ? -20 : -15) - 6 * k);
  }

  /** Selection ring on the ground; health bar and idle marker under the chip. */
  private drawChrome(strength: number) {
    const g = this.chrome;
    g.clear();
    const m = this.look;
    if (m.selected) {
      g.ellipse(0, 1, 17, 12).fill({ color: AFFILIATION.friend, alpha: 0.14 }).stroke({ width: 1.4, color: AFFILIATION.friend, alpha: 0.95 });
    }
    if (m.planned) return;
    const b = this.bar;
    b.clear();
    const ratio = Math.max(0, Math.min(1, strength / 1000));
    b.rect(-7.5, 5.5, 15, 2.4).fill({ color: SURFACE.ink950, alpha: 0.85 });
    b.rect(-7.1, 5.9, Math.max(0.8, 14.2 * ratio), 1.6).fill({ color: healthColor(ratio) });
    if (m.idle) b.circle(9, -2, 2.4).fill({ color: SIGNAL }).stroke({ width: 0.8, color: SURFACE.ink950 });
  }

  setStrength(strength: number) {
    this.drawChrome(strength);
  }

  /** Turn ground vehicles and aircraft to a new heading. */
  setFacing(rad: number) {
    if (this.look.cls === 'drone') return;
    this.craft.rotation = rad;
    if (this.shadow) this.shadow.rotation = rad;
  }

  tick(now: number) {
    const t = (now + this.seed * 37) / 1000;
    if (this.rotor) {
      this.rotor.rotation = t * 22;
      this.body.y = -5 + Math.sin(t * 1.7) * 0.6;
    }
    for (const d of this.drones) {
      const a = t * 0.9 + d.phase;
      const x = Math.cos(a) * 11;
      const y = Math.sin(a) * 7;
      d.craft.position.set(x, y - 8 + Math.sin(t * 3 + d.phase) * 0.5);
      d.craft.rotation = a + Math.PI / 2;
      d.shade.position.set(x + 3, y + 3);
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    live.delete(this);
    super.destroy(options);
  }
}

/** Formation slots inside a hex for 1, 2 or 3 units, so a stack reads as a deployment. */
export function slotOffsets(n: number): { x: number; y: number; scale: number }[] {
  // Imported renders are drawn at true size (a tank is about 32 world px); the fallback art is smaller.
  const k = getArt() ? 0.8 : 1.3;
  if (n <= 1) return [{ x: 0, y: 2, scale: k }];
  if (n === 2)
    return [
      { x: -10, y: -5, scale: k * 0.8 },
      { x: 10, y: 7, scale: k * 0.8 },
    ];
  return [
    { x: -12, y: -8, scale: k * 0.7 },
    { x: 12, y: -5, scale: k * 0.7 },
    { x: 0, y: 12, scale: k * 0.7 },
  ];
}

/** Add a unit model to `layer` at (x, y). */
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
