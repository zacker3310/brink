import { expect, test } from '@playwright/test';

// The core journey: title screen, campaign setup, pick a nation, select a formation, order it, end the turn, read the
// report, save, and resume from the save.
test('start, order, resolve, report, save and resume', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  await expect(page).toHaveTitle('Brink');
  await expect(page.getByTestId('wordmark')).toHaveText('BRINK');
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);
  await page.getByTestId('menu-new').click();
  await page.getByTestId('nation-korva').click();
  await expect(page.getByTestId('dossier-name')).toHaveText('Korva Directorate');
  await page.getByTestId('seed').fill('1234');
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('top-bar')).toContainText('BRINK');
  await expect(page.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(page.getByTestId('turn')).toContainText('1 / 30');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Select a formation from the Military panel.
  await page.getByTestId('tab-military').click();
  const first = page.locator('[data-testid^="formation-f"]').filter({ hasText: 'Infantry' }).first();
  const name = (await first.locator('span').first().textContent())!;
  await first.click();
  await expect(page.getByTestId('planned-order')).toContainText('Hold (default)');

  // Issue a move order by clicking a reachable hex on the map.
  const target = await page.evaluate(() => window.__brink!.reachable().at(-1)!);
  expect(target).toBeTruthy();
  const at = await page.evaluate((k) => window.__brink!.hexToClient(k), target);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('planned-order')).toContainText(/Move \d+ hex/);
  await expect(page.locator('[data-testid="rejections"]')).toHaveCount(0);

  // Also order a defend, through the toolbar.
  await page.locator('[data-testid^="formation-f"]').filter({ hasText: 'Armored' }).first().click();
  await page.getByTestId('order-defend').click();
  await expect(page.getByTestId('planned-order')).toContainText('Defend');

  // End the turn and read the after-action report.
  await page.getByTestId('end-turn').click();
  const report = page.getByTestId('report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Turn 1 resolved');
  await expect(report).toContainText('Economy');
  await expect(report).toContainText(`${name} moved`);
  await page.getByTestId('close-report').click();
  await expect(page.getByTestId('turn')).toContainText('2 / 30');

  // Save, reload the page, and resume from the slot.
  await page.getByTestId('save-menu').click();
  await page.getByTestId('save-slot-2').click();
  await expect(page.getByText('Saved to Slot 2')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('menu-continue')).toContainText('Korva Directorate, turn 2');
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-slot-2').click();
  await expect(page.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(page.getByTestId('turn')).toContainText('2 / 30');
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report')).toContainText('Turn 1 resolved');

  expect(errors).toEqual([]);
});
