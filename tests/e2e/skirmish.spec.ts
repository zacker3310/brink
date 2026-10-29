import { expect, test } from '@playwright/test';

// Skirmish from the title screen on a desktop: a turn-based battle. Pick a unit, move it, end the
// turn and watch the enemy move, then win and bank the stars.
test('a skirmish plays in turns and banks its stars', async ({ page }) => {
  test.setTimeout(420_000);
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
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120000 });
  await expect(page.getByTestId('arena-round')).toHaveText('1/16');

  // A turn starts with a ready unit selected; clicking a tank's tile selects it.
  const unit = await page.evaluate(() => {
    const u = window.__arena!.arena()!.units.find((x) => x.side === 'blue' && x.type === 'm1a2' && !x.carrier)!;
    return { id: u.id, x: u.x, y: u.y };
  });
  await page.getByTestId(`arena-unit-${unit.id}`).click();
  await expect(page.getByTestId('arena-unit')).toBeVisible();
  // Selecting glides the camera to the unit: aim once it has arrived.
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 30000 });

  // Clicking a free lit cell three ahead drives it there.
  const cell = await page.evaluate((u) => {
    const b = window.__arena!.arena()!;
    for (const dx of [0, 1, -1, 2, -2]) {
      const x = u.x + dx;
      const y = u.y - 3;
      if (!b.units.some((v) => v.alive && !v.carrier && v.x === x && v.y === y)) return { x, y, at: window.__arena!.toScreen(x, y) };
    }
    return null;
  }, unit);
  await page.mouse.click(cell!.at.x, cell!.at.y);
  await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((x) => x.id === id)!.y, unit.id)).toBe(cell!.y);
  await expect.poll(() => page.evaluate((id) => window.__arena!.arena()!.units.find((x) => x.id === id)!.moved, unit.id)).toBe(true);

  // End the turn: the enemy moves, then it is round two.
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120000 });
  await page.getByTestId('arena-end-turn').click();
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 180000 });
  await expect(page.getByTestId('arena-round')).toHaveText('2/16');

  await page.evaluate(() => window.__arena!.win());
  await expect(page.getByTestId('arena-stars')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('arena-continue').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  expect(Number(await page.getByTestId('career-stars').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
