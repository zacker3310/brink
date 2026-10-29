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

/** The battle film run to its end with Skip, until it is your turn again (or it is over). */
async function settle(page: Page) {
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended)) return;
    const skip = page.getByTestId('arena-skip');
    if (await skip.isVisible().catch(() => false)) await skip.tap({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  throw new Error('the battle did not come back to your turn');
}

/** A free cell near a unit that is on the open field on screen (not under the header, the footer or the camera buttons). */
async function freeCellOnField(page: Page, t: { x: number; y: number }, offsets: (readonly [number, number])[]) {
  return page.evaluate(
    ({ t, offsets }) => {
      const b = window.__arena!.arena()!;
      const top = document.querySelector('[data-testid="arena-header"]')!.getBoundingClientRect().bottom + 12;
      const bottom = document.querySelector('[data-testid="arena-footer"]')!.getBoundingClientRect().top - 12;
      const right = innerWidth - 64;
      for (const [dx, dy] of offsets) {
        const x = t.x + dx;
        const y = t.y + dy;
        if (x < 0 || y < 0 || x >= b.map.w || y >= b.map.h || b.units.some((u) => u.alive && !u.carrier && u.x === x && u.y === y)) continue;
        const at = window.__arena!.toScreen(x, y);
        // Not under a button (the camera buttons, an arrow at the edge): a tap there is the button's.
        const over = document.elementFromPoint(at.x, at.y);
        if (at.y > top && at.y < bottom && at.x > 12 && at.x < right && !over?.closest('button')) return { x, y, at };
      }
      return null;
    },
    { t, offsets },
  );
}

async function audit(page: Page, where: string) {
  const r = await auditScreen(page);
  expect(r.small, `${where}: targets under 44 pt`).toEqual([]);
  expect(r.low, `${where}: text under 4.5:1`).toEqual([]);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

    test('a battle by touch: brief, difficulty, select, advice, move, undo, fire, end turn, menu, verdict', async ({ page }) => {
      test.setTimeout(1_800_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('./');
      // Action cams off until the menu step turns them on: the test machine renders WebGL in software.
      await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'balanced', actionCams: false, radio: true, difficulty: 'easy', fastEnemy: true })));
      await page.getByTestId('menu-skirmish').tap();
      await page.getByTestId('skirmish-first-blood').tap();
      await expect(page.getByTestId('arena-brief')).toBeVisible();
      // Difficulty: three choices, Easy by default, remembered.
      await expect(page.getByTestId('difficulty-easy')).toHaveAttribute('aria-checked', 'true');
      await page.getByTestId('difficulty-hard').tap();
      await expect(page.getByTestId('difficulty-hard')).toHaveAttribute('aria-checked', 'true');
      await audit(page, 'brief');
      await page.getByTestId('difficulty-easy').tap();
      await page.getByTestId('arena-fight').tap();
      await expect(page.getByTestId('arena-canvas')).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      await expect(page.getByTestId('arena-round')).toHaveText('1/16');
      // A company: ten or more units of your own in the strip.
      expect(await page.locator('[data-testid^="arena-unit-"]').count()).toBeGreaterThanOrEqual(10);
      expect(await page.evaluate(() => window.__arena!.arena()!.difficulty)).toBe('easy');
      // A unit is selected, with advice and a button that does it.
      await expect(page.getByTestId('arena-advice')).toBeVisible();
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
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      const ahead2: [number, number][] = [];
      for (const dy of [2, 3, 1, 4]) for (const dx of [0, 1, -1, 2, -2]) ahead2.push([dx, -dy]);
      const cell = await freeCellOnField(page, tank, ahead2);
      expect(cell).not.toBeNull();

      // A move that showed nothing can be taken back: one cell back or aside, away from the enemy, then Undo.
      const aside: [number, number][] = [];
      for (const dy of [0, 1, 2]) for (const dx of [1, -1, 2, -2, 0, 3, -3]) if (dx || dy) aside.push([dx, dy]);
      const back = await freeCellOnField(page, tank, aside);
      expect(back).not.toBeNull();
      // The first tap shows where it would go and what that means; Move commits.
      await page.touchscreen.tap(back!.at.x, back!.at.y);
      await expect(page.getByTestId('move-card')).toBeVisible();
      await audit(page, 'move card');
      await page.getByTestId('arena-move').tap();
      await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((u) => u.id === id)!.moved, tank.id), { timeout: 15_000 }).toBe(true);
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      await expect(page.getByTestId('arena-undo')).toBeVisible();
      await audit(page, 'undo');
      await page.getByTestId('arena-undo').tap();
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      expect(await page.evaluate((id) => { const u = window.__arena!.arena()!.units.find((x) => x.id === id)!; return [u.x, u.y, u.moved]; }, tank.id)).toEqual([tank.x, tank.y, false]);
      await expect(page.getByTestId('arena-undo')).toHaveCount(0);

      // Now the move forward, aimed after the camera has come back to the tank.
      await page.getByTestId(`arena-unit-${tank.id}`).tap();
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      const forward = await freeCellOnField(page, tank, ahead2);
      expect(forward).not.toBeNull();
      const ahead = forward!.at;
      // Tapping the same cell twice also goes.
      await page.touchscreen.tap(ahead.x, ahead.y);
      await expect(page.getByTestId('move-card')).toBeVisible();
      await page.touchscreen.tap(ahead.x, ahead.y);
      await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((u) => u.id === id)!.moved, tank.id), { timeout: 15_000 }).toBe(true);

      // The advice for another unit, done with one tap.
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      const other = await page.evaluate((tid) => window.__arena!.arena()!.units.find((u) => u.side === 'blue' && u.alive && !u.carrier && !u.moved && !u.acted && u.id !== tid)!.id, tank.id);
      await page.getByTestId(`arena-unit-${other}`).tap();
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      if (await page.getByTestId('arena-do-it').count()) {
        await page.getByTestId('arena-do-it').tap();
        await expect.poll(() => page.evaluate((id) => { const u = window.__arena!.arena()!.units.find((x) => x.id === id)!; return u.moved || u.acted || !u.alive; }, other), { timeout: 15_000 }).toBe(true);
      }

      // End the turn: the enemy plays, then it is round two.
      await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
      // Overwatch plays no film: the battle must take the next order at once (it used to sit on
      // "Wait" for good after one).
      const watcher = await page.evaluate(() => window.__arena!.arena()!.units.find((u) => u.side === 'blue' && u.alive && !u.carrier && !u.moved && !u.acted)?.id ?? null);
      if (watcher) {
        await page.getByTestId(`arena-unit-${watcher}`).tap();
        await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
        if (!(await page.getByTestId('arena-overwatch').isVisible())) await page.getByTestId('arena-more').tap();
        await page.getByTestId('arena-overwatch').tap();
        await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((u) => u.id === id)!.overwatch, watcher)).toBe(true);
        await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 15_000 });
        await expect(page.getByTestId('arena-end-turn')).toBeEnabled();
        await expect(page.getByTestId('arena-end-turn')).not.toContainText('Enemy Turn');
      }

      // Units still ready: End Turn asks first.
      await page.getByTestId('arena-end-turn').tap();
      await expect(page.getByTestId('arena-end-confirm')).toBeVisible();
      await audit(page, 'end turn');
      await page.getByTestId('arena-end-now').tap();
      await settle(page);
      await expect(page.getByTestId('arena-round')).toHaveText('2/16');

      // Fire: let the crews close in until a unit of ours has a target, then take its best shot.
      let shooter: string | null = null;
      for (let round = 0; round < 6 && !shooter; round++) {
        const order = await page.evaluate(() => {
          const b = window.__arena!.arena()!;
          const seen = b.units.filter((u) => u.side === 'red' && u.alive && b.intel.blue[u.id]?.now);
          const d = (u: { x: number; y: number }) => (seen.length ? Math.min(...seen.map((e) => Math.hypot(e.x - u.x, e.y - u.y))) : 99);
          return seen.length ? b.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier && !u.acted).sort((p, q) => d(p) - d(q)).slice(0, 4).map((u) => u.id) : [];
        });
        for (const id of order) {
          await page.getByTestId(`arena-unit-${id}`).tap();
          await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 90_000 });
          if ((await page.evaluate(() => window.__arena!.overlay()!.targets)) > 0) {
            shooter = id;
            break;
          }
        }
        if (shooter) break;
        await page.getByTestId('arena-pause').tap();
        await page.getByTestId('arena-auto').tap();
        await settle(page);
        if (await page.evaluate(() => !!window.__arena!.arena()!.ended)) break;
      }
      expect(shooter, 'a unit with a target within six rounds').not.toBeNull();
      const shots = await page.evaluate(() => window.__arena!.arena()!.stats.blue.shots);
      await page.getByTestId('arena-best').tap();
      await expect(page.getByTestId('shot-card')).toBeVisible();
      await audit(page, 'shot card');
      await page.getByTestId('arena-fire').tap();
      await expect.poll(() => page.evaluate(() => window.__arena!.arena()!.stats.blue.shots), { timeout: 30_000 }).toBeGreaterThan(shots);
      await settle(page);

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
