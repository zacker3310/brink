import { devices, expect, test, type Page } from '@playwright/test';
import { auditScreen } from './a11y';

// Getting round the battlefield on an iPhone, by touch alone, at the three sizes: the zoom buttons,
// a two-finger pinch, a one-finger drag, back to your unit, the whole-field view and its way back,
// the arrow toward where the enemy is expected, and the badges over the units. Sizes are measured
// on screen (how many points one cell spans), not taken on trust.

const SIZES = [
  { name: 'iPhone SE (375 x 667)', width: 375, height: 667 },
  { name: 'iPhone 15 (393 x 852)', width: 393, height: 852 },
  { name: 'iPhone 16 Pro Max (440 x 956)', width: 440, height: 956 },
];
const { userAgent } = devices['iPhone 14 Pro'];

async function audit(page: Page, where: string) {
  const r = await auditScreen(page);
  expect(r.small, `${where}: targets under 44 pt`).toEqual([]);
  expect(r.low, `${where}: text under 4.5:1`).toEqual([]);
}

const ready = (page: Page) => page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });

/** Points one cell spans on screen at a unit's cell, and where that cell is. */
async function cellAt(page: Page, id: string) {
  return page.evaluate((uid) => {
    const u = window.__arena!.arena()!.units.find((x) => x.id === uid)!;
    const a = window.__arena!.toScreen(u.x, u.y);
    const b = window.__arena!.toScreen(u.x + 1, u.y);
    return { x: a.x, y: a.y, px: Math.hypot(b.x - a.x, b.y - a.y) };
  }, id);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

    test('zoom, pinch, drag, back to the unit, whole field, toward the enemy', async ({ page }) => {
      test.setTimeout(1_200_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('./');
      // Low quality: the test machine renders WebGL in software.
      await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false, difficulty: 'easy', fastEnemy: true })));
      await page.getByTestId('menu-skirmish').tap();
      await page.getByTestId('skirmish-first-blood').tap();
      await page.getByTestId('arena-fight').tap();
      await ready(page);
      const cdp = await page.context().newCDPSession(page);
      const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1 })) });

      // A unit is selected and the camera is close enough to read it: a cell spans 30 points or more.
      const sel = (await page.evaluate(() => window.__arena!.overlay()!.selected))!;
      expect(sel).toBeTruthy();
      const start = await cellAt(page, sel);
      expect(start.px).toBeGreaterThanOrEqual(30);

      // Badges over the units, and an arrow toward where the enemy is expected.
      expect(await page.locator('[data-testid^="badge-"]:visible').count()).toBeGreaterThanOrEqual(6);
      await expect(page.getByTestId('pointer-enemy')).toBeVisible();
      await audit(page, 'field');

      // The zoom buttons.
      await page.getByTestId('cam-in').tap();
      await ready(page);
      const zin = await cellAt(page, sel);
      expect(zin.px).toBeGreaterThan(start.px * 1.3);
      await page.getByTestId('cam-out').tap();
      await page.getByTestId('cam-out').tap();
      await ready(page);
      const zout = await cellAt(page, sel);
      expect(zout.px).toBeLessThan(zin.px / 1.5);

      // Two fingers spread apart zoom in.
      const box = (await page.getByTestId('arena-canvas').boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height * 0.45;
      await touch('touchStart', [
        { x: cx - 30, y: cy },
        { x: cx + 30, y: cy },
      ]);
      for (let i = 1; i <= 8; i++)
        await touch('touchMove', [
          { x: cx - 30 - i * 12, y: cy },
          { x: cx + 30 + i * 12, y: cy },
        ]);
      await touch('touchEnd', []);
      await ready(page);
      const pinched = await cellAt(page, sel);
      expect(pinched.px).toBeGreaterThan(zout.px * 1.5);

      // One finger drags the field: the unit moves on screen with it.
      const before = await cellAt(page, sel);
      await touch('touchStart', [{ x: cx, y: cy }]);
      for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: cx + i * 12, y: cy + i * 14 }]);
      await touch('touchEnd', []);
      await ready(page);
      const dragged = await cellAt(page, sel);
      expect(Math.hypot(dragged.x - before.x, dragged.y - before.y)).toBeGreaterThan(80);

      // Back to the unit: it comes to the middle of the screen.
      await page.getByTestId('cam-unit').tap();
      await ready(page);
      const back = await cellAt(page, sel);
      expect(Math.abs(back.x - box.width / 2)).toBeLessThan(box.width * 0.25);
      expect(back.y).toBeGreaterThan(box.height * 0.15);
      expect(back.y).toBeLessThan(box.height * 0.75);

      // The whole field fits on screen, then the button takes you back where you were.
      const view = await cellAt(page, sel);
      await page.getByTestId('cam-overview').tap();
      await expect(page.getByTestId('cam-overview')).toHaveAttribute('aria-pressed', 'true');
      await ready(page);
      const corners = await page.evaluate(() => {
        const b = window.__arena!.arena()!;
        return [window.__arena!.toScreen(0, 0), window.__arena!.toScreen(b.map.w - 1, 0), window.__arena!.toScreen(0, b.map.h - 1), window.__arena!.toScreen(b.map.w - 1, b.map.h - 1)];
      });
      for (const c of corners) {
        expect(c.x).toBeGreaterThanOrEqual(-2);
        expect(c.x).toBeLessThanOrEqual(box.width + 2);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThanOrEqual(box.height);
      }
      await audit(page, 'whole field');
      await page.getByTestId('cam-overview').tap();
      await expect(page.getByTestId('cam-overview')).toHaveAttribute('aria-pressed', 'false');
      await ready(page);
      const restored = await cellAt(page, sel);
      expect(Math.abs(restored.px - view.px)).toBeLessThan(view.px * 0.1);

      // The arrow toward the enemy brings the camera that way.
      const far = async () =>
        page.evaluate(() => {
          const b = window.__arena!.arena()!;
          const s = b.map.redSpawn;
          const x = Math.round(s.reduce((t, p) => t + p.x, 0) / s.length);
          const y = Math.round(s.reduce((t, p) => t + p.y, 0) / s.length);
          return window.__arena!.toScreen(x, y);
        });
      const was = await far();
      await page.getByTestId('pointer-enemy').tap();
      await ready(page);
      const now = await far();
      const mid = { x: box.width / 2, y: box.height / 2 };
      expect(Math.hypot(now.x - mid.x, now.y - mid.y)).toBeLessThan(Math.hypot(was.x - mid.x, was.y - mid.y));

      expect(errors).toEqual([]);
    });
  });
}
