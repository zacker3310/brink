import { devices, expect, test, type Page } from '@playwright/test';

// Diplomacy on a phone: meet the rival leaders, read how one feels about you and why, put a deal to
// them, hear the answer, and see it signed (and the leader's reaction) when the turn resolves.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

/** SHOTS_DIR=/some/dir saves a screenshot of each step there. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test('a phone player meets the rival leaders, reads a mood, and signs a deal', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem('brink.prefs.v1') ?? '{}');
    if (prefs.staffPlan === undefined) localStorage.setItem('brink.prefs.v1', JSON.stringify({ ...prefs, staffPlan: false }));
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('seed').fill('7');
  await page.getByTestId('crisis-none').tap();
  await expect(page.getByTestId('difficulty-easy')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/20');

  // The leaders: one card per rival power, each with a leader, a mood and where you stand.
  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-diplomacy').tap();
  const panel = page.getByTestId('panel-diplomacy');
  await expect(panel.getByTestId('diplomacy')).toBeVisible();
  const cards = panel.locator('[data-testid^="leader-card-"]');
  await expect(cards).toHaveCount(3);
  for (const id of await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!))) {
    await expect(page.getByTestId(id.replace('leader-card-', 'mood-'))).toHaveText(/^(Hostile|Wary|Neutral|Cordial|Friendly) [+-]?\d+$/);
    // Thumb-sized.
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, '1-leaders');

  // The power you are at peace with on Easy: meet its leader.
  const peaceful = panel.locator('[data-testid^="leader-card-"]', { hasText: 'At peace' }).first();
  const nation = (await peaceful.getAttribute('data-testid'))!.replace('leader-card-', '');
  await peaceful.tap();
  const detail = page.getByTestId('leader-detail');
  await expect(detail).toBeVisible();
  await expect(page.getByTestId('leader-line')).toHaveText(/^“.+”$/);
  // The mood and why, item by item, each with its weight.
  const mood = await page.getByTestId('leader-mood').textContent();
  expect(mood).toMatch(/^(Hostile|Wary|Neutral|Cordial|Friendly) [+-]?\d+$/);
  const reasons = page.getByTestId('mood-reasons').locator('li');
  expect(await reasons.count()).toBeGreaterThan(0);
  await expect(reasons.first()).toHaveText(/[+-]\d+$/);
  await shot(page, '2-leader');

  // Put a trade agreement to them: they answer at once.
  await page.getByTestId('deal-trade-agreement').tap();
  await expect(page.getByTestId('deal-builder')).toBeVisible();
  await page.getByTestId('deal-ask').tap();
  await expect(page.getByTestId('deal-agreed')).toBeVisible();
  await expect(page.getByTestId('planned-deal')).toContainText('offer trade to');
  await shot(page, '3-agreed');

  // A greedy exchange is turned down, in the leader's own words.
  await page.getByTestId('deal-exchange').tap();
  await page.getByTestId('give-resource').getByRole('radio', { name: 'Food' }).tap();
  await page.getByTestId('get-resource').getByRole('radio', { name: 'Credits' }).tap();
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'More Amount' }).nth(1).tap();
  await page.getByTestId('deal-ask').tap();
  await expect(page.getByTestId('deal-refused')).toBeVisible();
  // The agreed trade is still the move toward them.
  await expect(page.getByTestId('planned-deal')).toContainText('offer trade to');
  await shot(page, '4-refused');
  await page.getByTestId('close-sheet').tap();

  // End the turn: the deal is signed and the leader says so in the debrief.
  await page.getByTestId('auto-command').tap();
  await page.getByTestId('end-turn').tap();
  await page.getByTestId('commit-turn').tap();
  await expect(page.getByTestId('replay')).toBeVisible({ timeout: 15000 });
  await page
    .getByTestId('skip-replay')
    .tap({ timeout: 3000 })
    .catch(() => undefined);
  await expect(page.getByTestId('debrief')).toContainText('Turn 1 debrief');
  await expect(page.getByTestId('leader-quotes')).toBeVisible();
  await shot(page, '5-debrief');
  await page.getByTestId('debrief-close').tap();

  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-diplomacy').tap();
  await page.getByTestId(`leader-card-${nation}`).tap();
  await expect(page.getByTestId(`treaties-${nation}`)).toContainText('trade agreement');
  // Their mood counts the trade now.
  await expect(page.getByTestId('mood-reasons')).toContainText('Our trade agreement');
  await shot(page, '6-signed');
  expect(errors).toEqual([]);
});
