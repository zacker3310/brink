import { expect, test } from '@playwright/test';

// The core journey: title screen, campaign setup, pick a nation, select a formation, order it, end the turn, read the
// report, save, and resume from the save.
test('start, order, resolve, report, save and resume', async ({ page }) => {
  // The whole campaign loop in one test: longer than the default budget.
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  await expect(page).toHaveTitle('Brink');
  await expect(page.getByTestId('wordmark')).toHaveText('Brink');
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);
  await page.getByTestId('menu-new').click();
  await page.getByTestId('nation-korva').click();
  await expect(page.getByTestId('dossier-name')).toHaveText('Korva Directorate');
  await page.getByTestId('seed').fill('1234');
  // Normal: every rival at war from turn 1, so the first turn has fighting to replay.
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('top-bar')).toContainText('BRINK');
  await expect(page.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(page.getByTestId('turn')).toContainText('1 / 20');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Select a formation from the Military panel.
  await page.getByTestId('tab-military').click();
  const first = page.locator('[data-testid^="formation-f"]').filter({ hasText: 'Infantry' }).first();
  const name = (await first.locator('span').first().textContent())!;
  await first.click();
  await expect(page.getByTestId('planned-order')).toContainText('Hold (default)');

  // Hovering a reachable hex previews the move; clicking it orders it. The next unit that needs
  // orders then comes up on its own, so check the order on the formation list.
  const target = await page.evaluate(() => window.__brink!.reachable().at(-1)!);
  expect(target).toBeTruthy();
  const at = await page.evaluate((k) => window.__brink!.hexToClient(k), target);
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('hover-card')).toContainText('Move');
  await page.mouse.click(at.x, at.y);
  await expect(first).toContainText(/Move \d+ hex/);
  await expect(page.locator('[data-testid="rejections"]')).toHaveCount(0);

  // Also order a defend, through the toolbar.
  const armored = page.locator('[data-testid^="formation-f"]').filter({ hasText: 'Armored' }).first();
  await armored.click();
  await page.getByTestId('order-defend').click();
  await expect(armored).toContainText('Defend');

  // Jump to the next formation without orders.
  await expect(page.getByTestId('next-idle')).toContainText('8 of 10 units need orders');
  await page.getByTestId('next-idle').click();
  await expect(page.getByTestId('planned-order')).toContainText('Hold (default)');

  // Choose production in the capital from its city banner.
  await page.keyboard.press('Escape');
  await page.getByTestId('city-korva-capital').click();
  await page.getByTestId('build-infantry').click();
  await expect(page.getByTestId('build-infantry')).toHaveAttribute('class', /border-signal/);
  await page.getByTestId('close-city').click();

  // End the turn: the review lists what commits, then it replays on the map, results arrive as
  // notifications, and the summary is a click away.
  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('order-review')).toBeVisible();
  await expect(page.getByTestId('review-orders')).toBeVisible();
  // The infantry chosen in the capital is listed with its cost, and the treasury shows what is left.
  await expect(page.getByTestId('order-review')).toContainText('Infantry at Korvagrad');
  await expect(page.getByTestId('review-treasury')).toBeVisible();
  // Back keeps the orders; End Turn again and Commit sends them.
  await page.getByTestId('review-back').click();
  await expect(page.getByTestId('order-review')).toHaveCount(0);
  await page.getByTestId('end-turn').click();
  await page.getByTestId('commit-turn').click();
  await expect(page.getByTestId('replay')).toBeVisible();
  // The replay can be paused and resumed.
  await page.keyboard.press(' ');
  await expect(page.getByTestId('replay-pause')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(' ');
  // Unpaused: it plays on (or, on a quiet turn, has already finished).
  await expect
    .poll(async () => (await page.getByTestId('replay-pause').count()) === 0 || (await page.getByTestId('replay-pause').getAttribute('aria-pressed')) === 'false')
    .toBe(true);
  await expect(page.getByTestId('notifications')).toBeVisible();
  await page.getByTestId('open-report').click();
  const report = page.getByTestId('report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Turn 1 resolved');
  await expect(report).toContainText('Economy');
  await expect(report).toContainText(`${name} moved`);
  await page.getByTestId('close-report').click();
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Rewatch the turn; leaving it keeps the current turn.
  await page.getByTestId('rewatch').click();
  await expect(page.getByTestId('replay')).toContainText('rewatch');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('replay')).toHaveCount(0);
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Threat overlay: V toggles it; hovering a seen enemy names the threat.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.getByTestId('toggle-threat')).toHaveAttribute('aria-pressed', 'true');
  const enemy = await page.evaluate(() => window.__brink!.enemies()[0]);
  if (enemy) {
    const e = await page.evaluate((k) => window.__brink!.hexToClient(k), enemy);
    await page.mouse.move(e.x, e.y);
    await expect(page.getByTestId('hover-card')).toBeVisible();
  }
  await page.keyboard.press('v');

  // Save, reload the page, and resume from the slot.
  await page.getByTestId('save-menu').click();
  await page.getByTestId('save-slot-2').click();
  await expect(page.getByText('Saved to Slot 2')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('menu-continue')).toContainText('Korva Directorate · turn 2');
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-slot-2').click();
  await expect(page.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(page.getByTestId('turn')).toContainText('2 / 20');
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report')).toContainText('Turn 1 resolved');
  await page.getByTestId('close-report').click();

  // Export a save file and load it back from the archive.
  await page.getByTestId('save-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('save-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('brink-korva-turn-2.json');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-file').setInputFiles((await file.path())!);
  await expect(page.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Play another turn, then browse back through the report history.
  await page.getByTestId('end-turn').click();
  await page.getByTestId('commit-turn').click();
  await expect(page.getByTestId('turn')).toContainText('3 / 20', { timeout: 15000 });
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report')).toContainText('Turn 2 resolved');
  await page.getByTestId('report-prev').click();
  await expect(page.getByTestId('report')).toContainText('Turn 1 resolved');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('report')).toContainText('Turn 2 resolved');

  expect(errors).toEqual([]);
});
