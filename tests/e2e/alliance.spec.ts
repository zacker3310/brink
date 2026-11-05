import { devices, expect, test, type Page } from '@playwright/test';

// Alliances and joint operations on a phone: the United States on Easy asks its ally Japan for an
// alliance against China and then a joint operation on a Chinese city; both are signed when the
// turn resolves. A deal that cannot be made says why on its button, and at war peace comes first.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function openLeader(page: Page, nation: string) {
  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-diplomacy').tap();
  await page.getByTestId('panel-diplomacy').getByTestId(`leader-card-${nation}`).tap();
  await expect(page.getByTestId('leader-detail')).toBeVisible();
}

async function endTurn(page: Page) {
  await page.getByTestId('close-sheet').tap();
  await page.getByTestId('end-turn').tap();
  await page.getByTestId('commit-turn').tap();
  if (await page.getByTestId('replay').isVisible({ timeout: 15_000 }).catch(() => false)) {
    await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
  }
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('debrief-close').tap();
}

test('a phone player signs an alliance against China and a joint operation on a Chinese city', async ({ page }) => {
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

  // China, the enemy: peace comes first, and the deals that need it say so instead of failing.
  await openLeader(page, 'china');
  await expect(page.getByTestId('peace-first')).toBeVisible();
  await expect(page.getByTestId('deal-alliance')).toBeDisabled();
  await expect(page.getByTestId('deal-why-alliance')).toHaveText('Make peace with China first');
  await expect(page.getByTestId('deal-peace')).toBeEnabled();
  await shot(page, '1-peace-first');
  await page.getByTestId('leader-back').tap();

  // Japan, the ally: an alliance against China.
  await page.getByTestId('panel-diplomacy').getByTestId('leader-card-japan').tap();
  await page.getByTestId('deal-alliance-against').tap();
  await expect(page.getByTestId('deal-builder')).toBeVisible();
  await page.getByTestId('against-china').tap();
  await page.getByTestId('deal-ask').tap();
  await expect(page.getByTestId('deal-agreed')).toBeVisible();
  await expect(page.getByTestId('planned-deal')).toContainText('offer an alliance to');
  await shot(page, '2-alliance-agreed');
  await endTurn(page);

  // Turn 2: a joint operation on a Chinese city with Japan.
  await openLeader(page, 'japan');
  await page.getByTestId('deal-joint-operation').tap();
  const prize = page.locator('[data-testid^="prize-china"]:enabled').first();
  await expect(prize).toBeVisible();
  const city = (await prize.locator('span').first().textContent())!.split(' · ')[0]!;
  await prize.tap();
  await expect(page.getByTestId('deal-builder')).toContainText(`a joint operation on ${city}`);
  await page.getByTestId('deal-ask').tap();
  await expect(page.getByTestId('deal-agreed')).toBeVisible();
  await shot(page, '3-joint-agreed');
  await endTurn(page);

  await openLeader(page, 'japan');
  await expect(page.getByTestId('treaties-japan')).toContainText(`joint operation on ${city}`);
  await expect(page.getByTestId('mood-reasons')).toContainText('Our joint operation');
  await shot(page, '4-signed');
  expect(errors).toEqual([]);
});
