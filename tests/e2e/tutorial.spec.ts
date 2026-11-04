import { expect, test } from '@playwright/test';

// The guided first match: a first-time player is offered it first, and it teaches the first turn
// by doing in five steps (move, let the staff plan the rest, end the turn, watch it, what next),
// each finishing when they actually do the thing, then hands over a real campaign.
test('a first-time player is coached through a real turn', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const coach = page.getByTestId('coach');
  const at = (id: string, timeout = 15_000) => expect(coach).toHaveAttribute('data-step', id, { timeout });

  await page.goto('./');
  await expect(page.locator('[data-testid^="menu-"]').first()).toHaveAttribute('data-testid', 'menu-tutorial');
  // The number keys pick from the menu, as its key hints say.
  await page.keyboard.press('1');
  await expect(page.getByTestId('top-bar')).toContainText('United States', { timeout: 30_000 });

  // 1. Move: the brief and the first order in one step. Right-click a reachable hex.
  await at('move');
  await expect(coach).toContainText('United States');
  await expect(page.getByTestId('coach-action')).toContainText('blue hex');
  const target = await page.evaluate(() => window.__brink!.reachable().at(-1)!);
  const p = await page.evaluate((k) => window.__brink!.hexToClient(k), target);
  await page.mouse.click(p.x, p.y, { button: 'right' });

  // 2. The staff drafts orders for everyone still waiting (it never does while the coach is on
  // unless asked): P, as the coach says.
  await at('plan');
  await expect(coach).toContainText('wait for orders');
  await expect(page.getByTestId('coach-show')).toHaveText('Let the staff plan');
  await page.keyboard.press('p');

  // 3. End the turn with the keys the coach shows: Ctrl+Enter opens the review, Enter commits.
  await at('end');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('commit-turn')).toBeVisible();
  await page.keyboard.press('Enter');

  // 4. The replay plays; 5. the coach names what comes next and hands over.
  await at('watch');
  await at('done', 45_000);
  await expect(coach).toContainText('whole loop');
  await expect(page.getByTestId('coach-next')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Done once: next time the autosaved campaign comes first, a new one next, and the guide sits below.
  await page.reload();
  await expect(page.locator('[data-testid^="menu-"]').first()).toHaveAttribute('data-testid', 'menu-continue');
  await expect(page.getByTestId('menu-continue')).toContainText('turn 2');
  await expect(page.locator('[data-testid^="menu-"]').nth(1)).toHaveAttribute('data-testid', 'menu-new');
  await expect(page.getByTestId('menu-tutorial')).toBeVisible();
  expect(errors).toEqual([]);
});
