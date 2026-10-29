import { devices, expect, test, type Page } from '@playwright/test';
import { auditScreen } from './a11y';

// The combined-arms battle on iPhones, driven by touch alone, at the three sizes that matter: the
// small 4.7-inch screen (375 x 667), the common 6.1-inch (393 x 852) and the largest (440 x 956).
// Every battle screen is audited: 44-point targets and 4.5:1 text contrast.

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

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

    test('a battle by touch: brief, select, move, fire, end turn, menu, verdict', async ({ page }) => {
      test.setTimeout(420_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('./');
      await page.getByTestId('menu-skirmish').tap();
      await page.getByTestId('skirmish-first-blood').tap();
      await expect(page.getByTestId('arena-brief')).toBeVisible();
      await audit(page, 'brief');
      await page.getByTestId('arena-fight').tap();
      await expect(page.getByTestId('arena-canvas')).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      await expect(page.getByTestId('arena-round')).toHaveText('1/16');
      // A company: ten or more units of your own in the strip.
      expect(await page.locator('[data-testid^="arena-unit-"]').count()).toBeGreaterThanOrEqual(10);
      await audit(page, 'field');

      // Tap a tank's tile, then a lit cell two ahead of it: it drives there.
      const tank = await page.evaluate(() => {
        const b = window.__arena!.arena()!;
        const u = b.units.find((x) => x.side === 'blue' && x.type === 'm1a2' && !x.carrier)!;
        return { id: u.id, x: u.x, y: u.y };
      });
      await page.getByTestId(`arena-unit-${tank.id}`).tap();
      await expect(page.getByTestId('arena-unit')).toBeVisible();
      await audit(page, 'unit card');
      const cell = await page.evaluate((t) => {
        const b = window.__arena!.arena()!;
        for (const dy of [2, 3, 1, 4])
          for (const dx of [0, 1, -1, 2, -2]) {
            const x = t.x + dx;
            const y = t.y - dy;
            if (!b.units.some((u) => u.alive && u.x === x && u.y === y)) return { x, y, at: window.__arena!.toScreen(x, y) };
          }
        return null;
      }, tank);
      expect(cell).not.toBeNull();
      await page.touchscreen.tap(cell!.at.x, cell!.at.y);
      await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((u) => u.id === id)!.moved, tank.id), { timeout: 15_000 }).toBe(true);

      // End the turn: the enemy plays, then it is round two.
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      await page.getByTestId('arena-end-turn').tap();
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 180_000 });
      await expect(page.getByTestId('arena-round')).toHaveText('2/16');

      // The menu: quality and the switches, all reachable by thumb and readable.
      await page.getByTestId('arena-pause').tap();
      await expect(page.getByTestId('arena-paused')).toBeVisible();
      await audit(page, 'menu');
      await page.getByTestId('quality-low').tap();
      await expect(page.getByTestId('quality-low')).toHaveAttribute('aria-checked', 'true');
      await page.getByTestId('setting-actionCams').tap();
      await page.getByRole('button', { name: 'Resume' }).tap();
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 60_000 });
      expect(await page.evaluate(() => window.__arena!.perf()!.quality)).toBe('low');

      await page.evaluate(() => window.__arena!.win());
      await expect(page.getByTestId('arena-stars')).toBeVisible({ timeout: 30_000 });
      await audit(page, 'verdict');
      await page.getByTestId('arena-continue').tap();
      await expect(page.getByTestId('skirmish')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
