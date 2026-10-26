import { expect, test } from '@playwright/test';

// The guided first match: a first-time player is offered it first, and every step finishes
// when they actually do the thing, then it hands over a real campaign.
test('a first-time player is coached through a real turn', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const coach = page.getByTestId('coach');
  const at = (id: string) => expect(coach).toHaveAttribute('data-step', id, { timeout: 15000 });

  await page.goto('./');
  await expect(page.locator('[data-testid^="menu-"]').first()).toHaveAttribute('data-testid', 'menu-tutorial');
  await page.getByTestId('menu-tutorial').click();
  await expect(page.getByTestId('top-bar')).toContainText('Aster Commonwealth');

  await at('brief');
  await expect(coach).toContainText('Aster Commonwealth');
  await page.getByTestId('coach-next').click();

  // Move: right-click a reachable hex.
  await at('move');
  const target = await page.evaluate(() => window.__brink!.reachable().at(-1)!);
  const p = await page.evaluate((k) => window.__brink!.hexToClient(k), target);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await at('all');
  await expect(coach).toContainText('wait for orders');
  await page.getByTestId('coach-skip').click();

  // Build: the coach opens the capital; picking a unit finishes the step.
  await at('build');
  await page.getByTestId('coach-show').click();
  await page.getByTestId('build-infantry').click();
  await page.getByTestId('close-city').click();

  await at('end');
  await page.getByTestId('end-turn').click();
  await at('watch');
  await at('report');
  await page.getByTestId('coach-show').click();
  await expect(page.getByTestId('report')).toBeVisible();
  await page.getByTestId('close-report').click();

  await at('threat');
  await page.keyboard.press('v');
  await at('attack');
  await page.getByTestId('coach-skip').click();
  await at('diplomacy');
  await page.keyboard.press('5');
  await at('done');
  await page.getByTestId('coach-next').click();
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId('turn')).toContainText('2 / 30');

  // Done once: next time the campaign comes first and the guide sits below it.
  await page.reload();
  await expect(page.locator('[data-testid^="menu-"]').first()).toHaveAttribute('data-testid', 'menu-new');
  await expect(page.getByTestId('menu-tutorial')).toBeVisible();
  expect(errors).toEqual([]);
});
