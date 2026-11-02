import { devices, expect, test } from '@playwright/test';

// Getting off an island, by touch, the way a new player would: the advisor points at the loaded
// transport, Show me selects it with its marines listed aboard, and a tap on the sea sails it.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

test('as Japan, the advisor walks you onto the sea', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-japan').tap();
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap({ timeout: 60_000 });

  // The advisor knows the troops are already aboard and where they should go.
  await expect(page.getByTestId('advisor')).toContainText('aboard');
  await page.getByTestId('advisor-go').tap();
  await expect(page.getByTestId('cargo')).toContainText('Aboard 2/2');
  await expect(page.getByTestId('planned-order')).toContainText('Tap a blue sea hex to sail');

  // Tap the sea: the transport sails (its order shows), its marines ride along.
  const sea = await page.evaluate(([top, bottom]) => {
    const b = window.__brink!;
    // Open sea: a hex with your own units in it (the port) selects them instead.
    const taken = new Set(b.formations().map((f) => f.key));
    return b
      .reachable()
      .filter((k) => !taken.has(k))
      .map((k) => b.hexToClient(k))
      .find((p) => p.y > top && p.y < bottom && p.x > 20 && p.x < innerWidth - 20);
  }, [170, viewport.height - 450] as const);
  expect(sea).toBeTruthy();
  const waiting = await page.getByTestId('next-idle').textContent();
  await page.touchscreen.tap(sea!.x, sea!.y);
  // Ordered: one fewer unit waits, and the next one comes up on its own.
  await expect(page.getByTestId('next-idle')).not.toHaveText(waiting!);
  expect(errors).toEqual([]);
});
