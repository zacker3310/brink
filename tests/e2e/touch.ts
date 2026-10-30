import type { Page } from '@playwright/test';

// Fingers on the glass for the battle's gestures. Playwright's touchscreen only taps, so a finger
// that stays down, a second finger and a long-press go through the Chrome DevTools Protocol
// (Input.dispatchTouchEvent): each call is one moment of the touch stream, listing every finger
// still down. These are synthetic events in desktop Chromium's input pipeline. They show how the
// page reads a touch stream; they do not prove how iOS Safari delivers touches from real glass.
// Each call waits for the page to take the event, which on a machine drawing WebGL in software
// can be a whole slow frame: a finger "held" between two calls may in fact rest for seconds.

export interface Pt {
  x: number;
  y: number;
}

export async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', pts: readonly Pt[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  return {
    /** Fingers down at these points (list the ones already down too, in the same order, to add one). */
    down: (...pts: Pt[]) => send('touchStart', pts),
    move: (...pts: Pt[]) => send('touchMove', pts),
    up: () => send('touchEnd', []),
    cancel: () => send('touchCancel', []),
  };
}

/** Two points turned by `turn` (radians, clockwise on screen) and spread by `scale` about their midpoint, then moved by `pan`. */
export function about(a: Pt, b: Pt, turn: number, scale: number, pan: Pt = { x: 0, y: 0 }): [Pt, Pt] {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const at = (p: Pt) => {
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    return { x: m.x + pan.x + scale * (dx * Math.cos(turn) - dy * Math.sin(turn)), y: m.y + pan.y + scale * (dx * Math.sin(turn) + dy * Math.cos(turn)) };
  };
  return [at(a), at(b)];
}

/** Until `n` more frames have been drawn. */
export function frames(page: Page, n = 2): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let k = 0;
        const step = () => (++k >= count ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}
