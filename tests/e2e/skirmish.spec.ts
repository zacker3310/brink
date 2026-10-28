import { expect, test } from '@playwright/test';

// Skirmish from the title screen on a desktop: drive with WASD, fire with the mouse, win, bank stars.
test('a skirmish plays with keys and mouse and banks its stars', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  await page.getByTestId('menu-skirmish').click();
  await expect(page.getByTestId('career-stars')).toHaveText('0');
  // Later battles wait for stars.
  await expect(page.getByTestId('skirmish-bank-shot')).toBeDisabled();
  await page.getByTestId('skirmish-first-blood').click();
  await expect(page.getByTestId('arena-quick')).toHaveCount(0);
  await page.getByTestId('arena-fight').click();
  const canvas = page.getByTestId('arena-canvas');
  await expect(canvas).toBeVisible();

  // WASD drives the tank.
  const start = await page.evaluate(() => window.__arena!.arena()!.units.find((u) => u.side === 'blue')!.y);
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  const moved = await page.evaluate(() => window.__arena!.arena()!.units.find((u) => u.side === 'blue')!.y);
  expect(moved).toBeLessThan(start);

  // A click fires where the mouse is.
  const enemy = await page.evaluate(() => {
    const e = window.__arena!.arena()!.units.find((u) => u.side === 'red')!;
    return window.__arena!.toScreen(e.x, e.y);
  });
  await page.mouse.click(enemy.x, enemy.y);
  await expect.poll(() => page.evaluate(() => window.__arena!.arena()!.shots.length + window.__arena!.arena()!.stats.shots)).toBeGreaterThan(0);

  await page.evaluate(() => window.__arena!.win());
  await expect(page.getByTestId('arena-stars')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('arena-continue').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  expect(Number(await page.getByTestId('career-stars').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
