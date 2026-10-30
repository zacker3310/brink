import { devices, expect, test, type Page } from '@playwright/test';
import { auditScreen } from './a11y';

// How the battle tells friend from foe and answers a tap, on an iPhone: hostile badges and arrows
// are angled, not only red; the colour-blind palette switches the whole field at once (badges,
// arrows, strength bars, rings and outlines) while the battle runs; the selected unit wears an
// outline; and Fire and End Turn carry the label that gives a haptic tick, which never doubles a tap.

const { userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

const ready = (page: Page) => page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120_000 });

async function audit(page: Page, where: string) {
  const r = await auditScreen(page);
  expect(r.small, `${where}: targets under 44 pt`).toEqual([]);
  expect(r.low, `${where}: text under 4.5:1`).toEqual([]);
}

/** A badge, an arrow or a feed line as the stylesheet draws it, without waiting for one on the field. */
async function drawn(page: Page, html: string, pseudo: string) {
  return page.evaluate(
    ({ html, pseudo }) => {
      const host = document.querySelector('[data-testid="arena-hud"]')!;
      const box = document.createElement('div');
      box.innerHTML = html;
      const el = box.firstElementChild as HTMLElement;
      host.appendChild(el);
      const s = getComputedStyle(el, pseudo || null);
      const out = { clip: s.clipPath, background: s.backgroundColor, radius: s.borderRadius, color: getComputedStyle(el).color };
      el.remove();
      return out;
    },
    { html, pseudo },
  );
}

test('friend and foe by shape and palette, outlines, and the haptic label', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false, difficulty: 'easy', fastEnemy: true, haptics: true, palette: 'standard' })));
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-first-blood').tap();
  await page.getByTestId('arena-fight').tap();
  await ready(page);

  // Shape: hostile badges and arrows are angled (a clipped frame, a diamond), friendly ones rounded.
  const foe = await drawn(page, '<div class="arena-badge" data-side="red"></div>', '::after');
  expect(foe.clip).toContain('polygon');
  expect(foe.background).toBe('rgb(200, 71, 58)');
  const friend = await drawn(page, '<div class="arena-badge" data-side="blue"></div>', '');
  expect(friend.clip).toBe('none');
  expect(friend.radius).toBe('6px');
  expect(friend.background).toBe('rgb(156, 198, 238)');
  const arrow = await drawn(page, '<button class="arena-pointer"></button>', '::before');
  expect(arrow.background).toBe('rgb(200, 71, 58)');
  // Gains and losses carry a sign as well as a colour.
  expect((await drawn(page, '<div class="arena-tone" data-tone="good">x</div>', '::before')).clip).toContain('polygon');
  expect((await drawn(page, '<div class="arena-tone" data-tone="bad">x</div>', '::before')).clip).toContain('polygon');
  await expect(page.getByTestId('pointer-enemy')).toBeVisible();

  // The selected unit wears an outline; one composited layer, not one per badge.
  const sel = await page.evaluate(() => window.__arena!.overlay()!.selected);
  const look = await page.evaluate(() => window.__arena!.look()!);
  expect(look.palette).toBe('standard');
  expect(look.selected).toBe(sel);
  expect(look.hulls).toBeGreaterThan(0);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="arena-hud"]')!).willChange)).toBe('transform');
  expect(await page.evaluate(() => [...document.querySelectorAll('.arena-badge')].filter((b) => getComputedStyle(b).willChange !== 'auto').length)).toBe(0);
  expect(await page.locator('[data-testid^="badge-"]:visible').count()).toBeGreaterThanOrEqual(6);
  await audit(page, 'field, standard');

  // End Turn carries the label over a hidden switch; a tap toggles it (the tick on an iPhone) and
  // asks once, as before.
  const tick = page.locator('[data-testid="arena-end-turn"] [data-testid="haptic-tick"] input');
  await expect(tick).toHaveCount(1);
  expect(await tick.evaluate((el) => el.hasAttribute('switch'))).toBe(true);
  const was = await tick.evaluate((el) => (el as HTMLInputElement).checked);
  await page.getByTestId('arena-end-turn').tap();
  await expect(page.getByTestId('arena-end-confirm')).toBeVisible();
  expect(await tick.evaluate((el) => (el as HTMLInputElement).checked)).toBe(!was);
  await expect(page.getByTestId('arena-end-confirm')).toHaveCount(1);
  await page.getByTestId('arena-end-cancel').tap();
  await expect(page.getByTestId('arena-end-confirm')).toHaveCount(0);

  // The colour-blind palette, switched with the battle running: every friend and foe colour follows.
  await page.getByTestId('arena-pause').tap();
  await page.getByTestId('setting-palette').tap();
  await expect(page.getByTestId('setting-palette')).toHaveAttribute('aria-checked', 'true');
  // Haptics off: the label goes, and End Turn still works.
  await page.getByTestId('setting-haptics').tap();
  await expect(page.getByTestId('setting-haptics')).toHaveAttribute('aria-checked', 'false');
  await audit(page, 'menu');
  await page.getByRole('button', { name: 'Resume' }).tap();
  await ready(page);
  expect((await page.evaluate(() => window.__arena!.look()!)).palette).toBe('colourblind');
  expect((await drawn(page, '<div class="arena-badge" data-side="blue"></div>', '')).background).toBe('rgb(0, 114, 178)');
  expect((await drawn(page, '<div class="arena-badge" data-side="red"></div>', '::after')).background).toBe('rgb(230, 159, 0)');
  expect((await drawn(page, '<button class="arena-pointer"></button>', '::before')).background).toBe('rgb(230, 159, 0)');
  const bars = await page.evaluate(() => [...document.querySelectorAll('.arena-bar-blue, .arena-bar-red')].map((b) => getComputedStyle(b).backgroundColor));
  expect(bars).toEqual(['rgb(86, 180, 233)', 'rgb(230, 159, 0)']);
  const badge = page.locator('.arena-badge[data-side="blue"]:visible').first();
  expect(await badge.evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(0, 114, 178)');
  await audit(page, 'field, colour-blind');
  await expect(page.locator('[data-testid="haptic-tick"]')).toHaveCount(0);
  await page.getByTestId('arena-end-turn').tap();
  await expect(page.getByTestId('arena-end-confirm')).toBeVisible();
  await page.getByTestId('arena-end-cancel').tap();

  // Zoomed out, crowded badges merge into one with a count; none is lost (each is shown or counted).
  await page.getByTestId('cam-overview').tap();
  await ready(page);
  const tally = await page.evaluate(() => {
    const shown = [...document.querySelectorAll<HTMLElement>('.arena-badge')].filter((b) => b.style.display !== 'none');
    const counted = shown.reduce((s, b) => s + Number(b.querySelector('.arena-badge-count')?.textContent || 1), 0);
    const b = window.__arena!.arena()!;
    const seen = b.units.filter((u) => u.alive && !u.carrier && (u.side === 'blue' || b.intel.blue[u.id]?.now)).length;
    return { shown: shown.length, counted, seen };
  });
  expect(tally.counted).toBeLessThanOrEqual(tally.seen);
  expect(tally.shown).toBeLessThanOrEqual(tally.counted);
  await page.getByTestId('cam-overview').tap();
  await ready(page);
  expect(errors).toEqual([]);
});
