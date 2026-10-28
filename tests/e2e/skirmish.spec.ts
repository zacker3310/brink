import { expect, test } from '@playwright/test';

// Skirmish from the title screen on a desktop: a turn-based battle. Pick a unit, move it, end the
// turn and watch the enemy move, then win and bank the stars.
test('a skirmish plays in turns and banks its stars', async ({ page }) => {
  test.setTimeout(240_000);
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
  await expect(page.getByTestId('arena-canvas')).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 45000 });
  await expect(page.getByTestId('arena-round')).toHaveText('1/12');

  // A turn starts with a ready unit selected; clicking a unit selects it.
  const unit = await page.evaluate(() => {
    const u = window.__arena!.arena()!.units.find((x) => x.side === 'blue')!;
    return { id: u.id, y: u.y, at: window.__arena!.toScreen(u.x, u.y) };
  });
  await page.mouse.click(unit.at.x, unit.at.y);
  await expect(page.getByTestId('arena-unit')).toBeVisible();

  // Clicking a lit cell three ahead drives it there.
  const cell = await page.evaluate((id) => {
    const u = window.__arena!.arena()!.units.find((x) => x.id === id)!;
    return window.__arena!.toScreen(u.x, u.y - 3);
  }, unit.id);
  await page.mouse.click(cell.x, cell.y);
  await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((x) => x.id === id)!.y, unit.id)).toBe(unit.y - 3);
  await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((x) => x.id === id)!.moved, unit.id)).toBe(true);

  // End the turn: the enemy moves, then it is round two.
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 45000 });
  await page.getByTestId('arena-end-turn').click();
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 60000 });
  await expect(page.getByTestId('arena-round')).toHaveText('2/12');

  await page.evaluate(() => window.__arena!.win());
  await expect(page.getByTestId('arena-stars')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('arena-continue').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  expect(Number(await page.getByTestId('career-stars').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
