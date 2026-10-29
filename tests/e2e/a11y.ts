import type { Page } from '@playwright/test';

// Checks run on every battle screen at iPhone sizes: every control a finger can hit is at least
// 44 by 44 points, and every piece of text has 4.5:1 contrast with what is behind it (3:1 for
// large text). Translucent panels over the 3D field are judged against both a black and a white
// field behind them, the worst case. Disabled controls are exempt (WCAG 1.4.3).

export interface A11yReport {
  small: string[];
  low: string[];
}

export async function auditScreen(page: Page): Promise<A11yReport> {
  // Judge the screen at rest: wait for fades and slides (not endless loops) to finish.
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 8000 })
    .catch(() => undefined);
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    const over = (top: number[], a: number, under: number[]) => top.map((v, i) => v * a + under[i]! * (1 - a));
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      // Only what is on top where it stands: a screen under a full-screen sheet is not on show.
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      return !!top && (top === el || el.contains(top) || top.contains(el));
    };
    const disabled = (el: Element) => !!el.closest('button:disabled, [aria-disabled="true"]');
    const small: string[] = [];
    const low: string[] = [];
    const label = (el: Element) => `${el.tagName.toLowerCase()}[${(el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}]`;
    for (const el of document.querySelectorAll('button, [role="switch"], [role="radio"], a[href]')) {
      if (!visible(el) || disabled(el)) continue;
      // Controls inside a scroller count by their own box; the scroller can clip a partly shown one.
      const r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || disabled(el)) continue;
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
      if (!text) continue;
      const s = getComputedStyle(el);
      // Composite every background from the root down, over a black and a white field.
      const chain: Element[] = [];
      for (let p: Element | null = el; p; p = p.parentElement) chain.unshift(p);
      let worst = Infinity;
      for (const base of [
        [0, 0, 0],
        [255, 255, 255],
      ]) {
        let bg = base;
        let opacity = 1;
        for (const p of chain) {
          const ps = getComputedStyle(p);
          opacity *= Number(ps.opacity);
          const [r, g, b, a] = parse(ps.backgroundColor);
          if (a > 0) bg = over([r, g, b], a, bg);
        }
        const [r, g, b, a] = parse(s.color);
        const fg = over([r, g, b], a * opacity, bg);
        const l1 = lum(fg);
        const l2 = lum(bg);
        worst = Math.min(worst, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
        // An opaque panel does not care what is behind it.
        if (chain.some((p) => parse(getComputedStyle(p).backgroundColor)[3] >= 0.999)) break;
      }
      const size = Number.parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (worst < need) low.push(`${label(el)} ${worst.toFixed(2)}:1 needs ${need}`);
    }
    return { small, low };
  });
}
