import type { UnitClass } from '@brink/contracts';
import { pictogramSvg } from '../design/pictograms';
import type { BadgeStatus } from './units';

// The layer of plain DOM over the 3D field, driven by the stage every frame (no React in the frame
// loop): a badge over each unit you can see (its pictogram, its strength, what it is doing) that
// stays the same size at every zoom, words that rise over a target when a shot lands, and labels
// pinned to places on the ground (the objective, where the enemy is expected).
//
// Friend and foe differ by shape as well as colour (APP-6): yours are rounded, theirs angled; the
// colours come from CSS variables that follow the palette setting. The layer is one composited
// layer (will-change on it, not on each badge), badges off the screen are hidden rather than moved,
// and badges that sit mostly on top of each other merge into one with a count. A battle has about
// 20 to 35 badges, which the DOM handles well; past 50 to 100 labels a WebGL atlas (one instanced
// quad per badge, drawn with the field) would be worth the work.

export interface BadgeState {
  id: string;
  side: 'blue' | 'red';
  cls: UnitClass;
  /** On screen, CSS pixels relative to the layer; null hides it. */
  at: { x: number; y: number } | null;
  hp: number;
  status: BadgeStatus;
  done: boolean;
  selected: boolean;
}

export type Tone = 'good' | 'bad' | 'plain';

/** A seen enemy (or where they are expected) off the edge of the screen: an arrow you can tap. */
export interface EdgePointer {
  id: string;
  x: number;
  y: number;
  /** Radians, screen space, pointing toward it. */
  angle: number;
  label: string;
  /** More than one in that direction. */
  count?: number;
}

interface Badge {
  el: HTMLDivElement;
  bar: HTMLElement;
  mark: HTMLElement;
  count: HTMLElement;
  key: string;
  /** What was last written, so a frame that changes nothing writes nothing (no style work). */
  last: string;
}

interface Callout {
  el: HTMLDivElement;
  /** Where it stands in the world, read back to the screen each frame. */
  anchor: () => { x: number; y: number } | null;
  born: number;
  /** Lift so several words over one unit do not sit on each other. */
  stack: number;
}

const LIFE = 1.9;

/**
 * Badge sizes in CSS pixels (as index.css draws them), and how much of a badge must lie under one in
 * front for the two to merge: full badges only when stacked (a helicopter over a squad), the small
 * ones of the zoomed-out view as soon as they crowd.
 */
const BOX = { full: { w: 58, h: 20, merge: 0.5 }, compact: { w: 24, h: 16, merge: 0.2 } };
/** A badge or label this far off the layer is hidden, not moved. */
const MARGIN = 48;

const MARKS: Record<BadgeStatus, string> = {
  none: '',
  // An eye: on overwatch.
  watch: '<svg viewBox="0 0 16 16" aria-hidden><path d="M1 8c2-3.5 4.5-5 7-5s5 1.5 7 5c-2 3.5-4.5 5-7 5S3 11.5 1 8Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>',
  // Chevrons pressing down: suppressed, pinned, broken.
  suppressed: '<svg viewBox="0 0 16 16" aria-hidden><path d="M3 5l5 4 5-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  pinned: '<svg viewBox="0 0 16 16" aria-hidden><path d="M3 3l5 4 5-4M3 8l5 4 5-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  broken: '<svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  // A shield: hunkered down.
  hunker: '<svg viewBox="0 0 16 16" aria-hidden><path d="M8 1.5 14 4v4c0 3.5-2.6 5.8-6 6.5C4.6 13.8 2 11.5 2 8V4Z" fill="currentColor"/></svg>',
};

export class FieldHud {
  readonly el: HTMLDivElement;
  private readonly badges = new Map<string, Badge>();
  private readonly labels = new Map<string, HTMLDivElement>();
  private readonly pointers = new Map<string, { el: HTMLButtonElement; arrow: HTMLElement; count: HTMLElement; last: string }>();
  private callouts: Callout[] = [];
  private clock = 0;
  /** The layer's size in CSS pixels, from the stage's resize (never read from the page in the frame). */
  private size = { w: Infinity, h: Infinity };
  /** Reused every frame: who leads a merged badge, and how many it stands for. */
  private readonly order: BadgeState[] = [];
  private readonly leaders: BadgeState[] = [];
  private readonly counts = new Map<string, number>();

  constructor(
    host: HTMLElement,
    private readonly onPointer: (id: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'arena-hud';
    this.el.setAttribute('data-testid', 'arena-hud');
    host.appendChild(this.el);
  }

  /** The layer's size changed (the stage's resize). */
  resize(w: number, h: number): void {
    this.size = { w, h };
  }

  private onLayer(at: { x: number; y: number } | null): at is { x: number; y: number } {
    return !!at && at.x > -MARGIN && at.x < this.size.w + MARGIN && at.y > -MARGIN && at.y < this.size.h + MARGIN;
  }

  /**
   * Which badges lead and how many each stands for. In front first (lower on the screen), the
   * selected unit before all; a badge mostly under one already kept on the same side joins it.
   * Friend and foe never merge.
   */
  private merge(states: readonly BadgeState[], compact: boolean): void {
    const box = compact ? BOX.compact : BOX.full;
    const order = this.order;
    const leaders = this.leaders;
    order.length = 0;
    leaders.length = 0;
    this.counts.clear();
    for (const s of states) if (this.onLayer(s.at)) order.push(s);
    order.sort((a, b) => +b.selected - +a.selected || b.at!.y - a.at!.y || (a.id < b.id ? -1 : 1));
    for (const s of order) {
      let host: BadgeState | undefined;
      for (const l of leaders) {
        if (l.side !== s.side) continue;
        const ox = 1 - Math.abs(l.at!.x - s.at!.x) / box.w;
        const oy = 1 - Math.abs(l.at!.y - s.at!.y) / box.h;
        if (ox > 0 && oy > 0 && ox * oy > box.merge) {
          host = l;
          break;
        }
      }
      if (host) {
        this.counts.set(host.id, (this.counts.get(host.id) ?? 1) + 1);
        this.counts.set(s.id, 0);
      } else {
        leaders.push(s);
        this.counts.set(s.id, 1);
      }
    }
  }

  /** Place every badge; units not in the list, off the screen or merged into another are hidden. */
  setBadges(states: readonly BadgeState[], compact: boolean): void {
    this.merge(states, compact);
    const live = new Set<string>();
    for (const s of states) {
      live.add(s.id);
      let b = this.badges.get(s.id);
      const key = `${s.side}:${s.cls}`;
      if (!b || b.key !== key) {
        b?.el.remove();
        const el = document.createElement('div');
        el.className = 'arena-badge';
        el.dataset.side = s.side;
        el.setAttribute('data-testid', `badge-${s.id}`);
        const glyph = document.createElement('span');
        glyph.className = 'arena-badge-glyph';
        // The badge's ink, so a palette change recolours it from the stylesheet.
        glyph.innerHTML = pictogramSvg(s.cls, 'currentColor');
        const mark = document.createElement('span');
        mark.className = 'arena-badge-mark';
        const bar = document.createElement('i');
        const track = document.createElement('span');
        track.className = 'arena-badge-bar';
        track.appendChild(bar);
        const count = document.createElement('span');
        count.className = 'arena-badge-count';
        el.append(glyph, mark, track, count);
        this.el.appendChild(el);
        b = { el, bar, mark, count, key, last: '' };
        this.badges.set(s.id, b);
      }
      const n = this.counts.get(s.id) ?? 0;
      const x = s.at ? Math.round(s.at.x) : 0;
      const y = s.at ? Math.round(s.at.y) : 0;
      const hp = Math.round(Math.max(0, Math.min(1, s.hp)) * 100);
      const now = n > 0 ? `${x},${y},${hp},${s.status},${+s.done}${+s.selected}${+compact},${n}` : 'hidden';
      if (now === b.last) continue;
      const was = b.last;
      b.last = now;
      if (n === 0) {
        b.el.style.display = 'none';
        continue;
      }
      if (was === 'hidden' || was === '') b.el.style.display = '';
      const c = n > 1 ? String(n) : '';
      if (b.count.textContent !== c) b.count.textContent = c;
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      b.bar.style.width = `${hp}%`;
      if (b.mark.dataset.status !== s.status) {
        b.mark.dataset.status = s.status;
        b.mark.innerHTML = MARKS[s.status];
      }
      b.el.classList.toggle('is-done', s.done);
      b.el.classList.toggle('is-selected', s.selected);
      b.el.classList.toggle('is-compact', compact);
    }
    for (const [id, b] of this.badges)
      if (!live.has(id)) {
        b.el.remove();
        this.badges.delete(id);
      }
  }

  /** Arrows at the screen edge toward what is off it; tapping one brings the camera there. */
  setPointers(list: readonly EdgePointer[]): void {
    const live = new Set<string>();
    for (const p of list) {
      live.add(p.id);
      let ptr = this.pointers.get(p.id);
      if (!ptr) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'arena-pointer';
        el.setAttribute('data-testid', `pointer-${p.id}`);
        el.setAttribute('aria-label', p.label);
        const arrow = document.createElement('span');
        arrow.className = 'arena-pointer-arrow';
        arrow.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const count = document.createElement('span');
        count.className = 'arena-pointer-count';
        el.append(arrow, count);
        // The field under this layer takes taps too: keep this one to ourselves.
        for (const ev of ['pointerdown', 'pointerup', 'pointermove'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPointer(p.id);
        });
        this.el.appendChild(el);
        ptr = { el, arrow, count, last: '' };
        this.pointers.set(p.id, ptr);
      }
      const n = p.count && p.count > 1 ? String(p.count) : '';
      const now = `${Math.round(p.x)},${Math.round(p.y)},${p.angle.toFixed(2)},${n}`;
      if (now === ptr.last) continue;
      ptr.last = now;
      ptr.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      ptr.arrow.style.transform = `rotate(${p.angle.toFixed(2)}rad)`;
      if (ptr.count.textContent !== n) ptr.count.textContent = n;
    }
    for (const [id, ptr] of this.pointers)
      if (!live.has(id)) {
        ptr.el.remove();
        this.pointers.delete(id);
      }
  }

  /** Words over a unit or a point, rising and fading. */
  callout(text: string, tone: Tone, anchor: () => { x: number; y: number } | null, key = ''): void {
    const el = document.createElement('div');
    el.className = 'arena-callout';
    el.dataset.tone = tone;
    el.textContent = text;
    el.setAttribute('data-testid', 'arena-callout');
    this.el.appendChild(el);
    const stack = key ? this.callouts.filter((c) => c.el.dataset.key === key && this.clock - c.born < 0.6).length : 0;
    if (key) el.dataset.key = key;
    this.callouts.push({ el, anchor, born: this.clock, stack });
  }

  /** A label pinned to a place on the ground; null removes it. */
  label(id: string, text: string | null, at: { x: number; y: number } | null): void {
    let el = this.labels.get(id);
    if (!text) {
      el?.remove();
      this.labels.delete(id);
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'arena-place';
      el.setAttribute('data-testid', `place-${id}`);
      this.el.appendChild(el);
      this.labels.set(id, el);
    }
    if (el.textContent !== text) el.textContent = text;
    const on = this.onLayer(at);
    const now = on ? `${Math.round(at.x)},${Math.round(at.y)}` : 'hidden';
    if (el.dataset.last === now) return;
    el.dataset.last = now;
    el.style.display = on ? '' : 'none';
    if (on) el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
  }

  update(dt: number): void {
    this.clock += dt;
    this.callouts = this.callouts.filter((c) => {
      const age = this.clock - c.born;
      if (age >= LIFE) {
        c.el.remove();
        return false;
      }
      const at = c.anchor();
      if (!at) {
        c.el.style.display = 'none';
        return true;
      }
      const rise = 18 + 26 * Math.min(1, age / 0.5) + c.stack * 24;
      const pop = age < 0.12 ? 0.7 + (age / 0.12) * 0.4 : age < 0.24 ? 1.1 - ((age - 0.12) / 0.12) * 0.1 : 1;
      c.el.style.display = '';
      c.el.style.opacity = String(age > LIFE - 0.5 ? (LIFE - age) / 0.5 : 1);
      c.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - rise)}px) translate(-50%, -100%) scale(${pop.toFixed(3)})`;
      return true;
    });
  }

  /** Drop the words still in the air (a skip). */
  clearCallouts(): void {
    for (const c of this.callouts) c.el.remove();
    this.callouts = [];
  }

  dispose(): void {
    this.el.remove();
  }
}
