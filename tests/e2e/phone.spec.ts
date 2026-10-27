import { devices, expect, test, type Page } from '@playwright/test';

// The game on an iPhone: everything is a tap. Select, tap a hex to move, let the staff draft the
// rest, end the turn, watch, read the report, and keep going.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

async function endTurn(page: Page, turn: number) {
  await page.getByTestId('end-turn').tap();
  await expect(page.getByTestId('replay')).toBeVisible({ timeout: 15000 });
  // A short replay may finish on its own before the tap lands.
  await page
    .getByTestId('skip-replay')
    .tap({ timeout: 3000 })
    .catch(() => undefined);
  // The debrief comes up first; the full report is one tap away.
  await expect(page.getByTestId('debrief')).toContainText(`Turn ${turn - 1} debrief`);
  await page.getByTestId('debrief-report').tap();
  await expect(page.getByTestId('report')).toBeVisible();
  await page.getByTestId('close-report').tap();
  await page.getByTestId('debrief-close').tap();
  await expect(page.getByTestId('unit-panel')).toBeVisible();
  await expect(page.getByTestId('turn')).toContainText(`${turn}/20`);
}

test('a campaign plays on a phone by touch alone: move a stack, attack, end turns', async ({ page }) => {
  test.setTimeout(330_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await expect(page.getByTestId('length-quick')).toHaveAttribute('aria-checked', 'true');
  // A fixed seed: the engine and the staff planner are deterministic, so this is the same war every run.
  await page.getByTestId('seed').fill('7');
  await page.getByTestId('start-game').tap();
  await expect(page.getByTestId('turn')).toContainText('1/20');
  // The whole command surface fits on the screen.
  for (const id of ['top-bar', 'end-turn', 'auto-command', 'next-idle', 'open-command']) await expect(page.getByTestId(id)).toBeInViewport();

  // A unit is up; tap a reachable hex that is not under the HUD.
  await expect(page.getByTestId('unit-panel')).toBeVisible();
  const h = viewport.height;
  const spot = await page.evaluate(
    ([top, bottom]) => {
      const b = window.__brink!;
      const occupied = new Set(b.formations().map((f) => f.key));
      // A hex with your own unit on it selects that unit instead.
      return b
        .reachable()
        .filter((k) => !occupied.has(k))
        .map((k) => b.hexToClient(k))
        .find((p) => p.y > top && p.y < bottom && p.x > 30 && p.x < window.innerWidth - 30);
    },
    [150, h - 300] as const,
  );
  expect(spot).toBeTruthy();
  await page.touchscreen.tap(spot!.x, spot!.y);
  await expect(page.getByTestId('planned-order')).not.toContainText('Tap a');

  // Staff work: the rest get orders in one tap.
  await page.getByTestId('deselect').tap();
  await page.getByTestId('auto-command').tap();
  await expect(page.getByTestId('next-idle')).toContainText('Ready');

  await endTurn(page, 2);

  // Command sheet and city build, by touch.
  await page.getByTestId('open-command').tap();
  await expect(page.getByTestId('panel-overview')).toBeVisible();
  await page.getByTestId('tab-diplomacy').tap();
  await expect(page.getByTestId('panel-diplomacy')).toBeVisible();
  await page.getByTestId('close-sheet').tap();

  // Attack by touch: find a stack with an enemy it can hit, tap the enemy (the odds come up), confirm.
  let attacked = false;
  for (let tries = 0; tries < 6 && !attacked; tries++) {
    const stacks = await page.evaluate(() => [...new Set(window.__brink!.formations().map((f) => f.key))]);
    for (const key of stacks) {
      const at = await page.evaluate((k) => window.__brink!.hexToClient(k), key);
      if (at.y < 170 || at.y > viewport.height - 330 || at.x < 20 || at.x > viewport.width - 20) continue;
      await page.touchscreen.tap(at.x, at.y);
      const target = await page.evaluate(
        ([top, bottom, w]) =>
          window
            .__brink!.targets()
            .map((k) => window.__brink!.hexToClient(k))
            .find((p) => p.y > top && p.y < bottom && p.x > 20 && p.x < w - 20),
        [170, viewport.height - 420, viewport.width] as const,
      );
      if (!target) continue;
      await page.touchscreen.tap(target.x, target.y);
      await expect(page.getByTestId('armed')).toBeVisible();
      await page.getByTestId('confirm-attack').tap();
      await expect(page.getByTestId('armed')).toHaveCount(0);
      attacked = true;
      break;
    }
    if (!attacked) {
      // Close in on the enemy a few hexes at a time.
      await page.getByTestId('auto-command').tap();
      await page.getByTestId('end-turn').tap();
      await expect(page.getByTestId('replay')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
      await page.getByTestId('debrief-close').tap();
    }
  }
  expect(attacked).toBe(true);

  await page.getByTestId('auto-command').tap();
  await page.getByTestId('end-turn').tap();
  await expect(page.getByTestId('replay')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
  await page.getByTestId('debrief-close').tap();
  await page.getByTestId('auto-command').tap();

  // Menu: sound and replay toggles, then quit.
  await page.getByTestId('phone-menu').tap();
  await page.getByTestId('toggle-sound').tap();
  await expect(page.getByTestId('toggle-sound')).toContainText('Off');
  await page.getByTestId('close-sheet').tap();
  expect(errors).toEqual([]);
});
