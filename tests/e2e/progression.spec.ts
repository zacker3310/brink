import { devices, expect, test, type Page } from '@playwright/test';

// Civ-style progression on a phone: pick a breakthrough from the research tree, start a building
// in a city, end the turn, and see the research under way and the building in the city's queue.
// PROGRESSION_SHOTS=<dir> keeps a screenshot of each step.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.PROGRESSION_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Open a city's panel: a tap on its banner if it is on screen, else the banner's own click (it sits under the HUD or off screen). */
async function openCity(page: Page, siteId: string) {
  const p = await page.evaluate((id) => window.__brink!.siteToClient(id), siteId);
  const banner = page.getByTestId(`city-${siteId}`);
  await expect(banner).toHaveCount(1);
  if (p.x > 20 && p.x < viewport.width - 20 && p.y > 160 && p.y < viewport.height - 300) await banner.tap();
  else await banner.dispatchEvent('click');
  await expect(page.getByTestId('city-panel')).toBeVisible();
}

test('research a technology and build in a city, on a phone', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Every order by hand: the staff would otherwise fill the cities' production.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('progression')) return;
    sessionStorage.setItem('progression', '1');
    localStorage.clear();
    localStorage.setItem('brink.prefs.v1', JSON.stringify({ staffPlan: false }));
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-china').tap();
  await page.getByTestId('seed').fill('3');
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('difficulty-easy').tap();
  await page.getByTestId('start-game').tap();
  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/');

  // The research tree: five branches, nothing done yet, a branch at a time.
  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-research').tap();
  const screen = page.getByTestId('research-screen');
  await expect(screen).toBeVisible();
  for (const b of ['economy', 'armour', 'air', 'naval', 'cyber']) await expect(page.getByTestId(`research-tree-${b}`)).toBeVisible();
  await expect(page.getByTestId('research-output')).toContainText('0/24 done');
  await shot(page, '01-research-tree');
  // A locked technology says what it needs and cannot be picked.
  const locked = page.getByTestId('research-blue_water_navy');
  await expect(locked).toHaveAttribute('data-status', 'locked');
  await expect(locked).toBeDisabled();
  await page.getByTestId('research-branch-naval').tap();
  await expect(page.getByTestId('research-tree-economy')).toHaveCount(0);
  await expect(page.getByTestId('research-tree-naval')).toBeVisible();
  // Every card is a full thumb target.
  for (const id of ['research-branch-naval', 'research-naval_engineering', 'research-funding-high']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.height, id).toBeGreaterThanOrEqual(44);
  }
  await page.getByTestId('research-naval_engineering').tap();
  await expect(page.getByTestId('research-current')).toContainText('Naval Engineering');
  await expect(page.getByTestId('research-naval_engineering')).toHaveAttribute('data-status', 'current');
  await shot(page, '02-research-picked');
  await page.getByTestId('close-sheet').tap();

  // The capital: its level and growth, its slots, and a building started.
  await openCity(page, 'china-capital');
  const panel = page.getByTestId('city-panel');
  await expect(panel.getByTestId('city-growth')).toContainText('Level 1');
  await expect(panel.getByTestId('city-slots')).toContainText('0/4 slots');
  // Buildings research has not unlocked say so.
  await expect(panel.getByTestId('facility-airbase')).toBeDisabled();
  await expect(panel.getByTestId('facility-airbase')).toContainText('Research Air Mobility first');
  const farm = panel.getByTestId('facility-farm');
  await farm.scrollIntoViewIfNeeded();
  await farm.tap();
  await expect(farm).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('city-slots')).toContainText('1/4 slots');
  await shot(page, '03-city-build');
  await page.getByTestId('close-city').tap();

  // End the turn: the research runs, the farm goes into the build queue, the city grows.
  await page.getByTestId('end-turn').tap();
  await page.getByTestId('commit-turn').tap();
  await expect(page.getByTestId('replay')).toBeVisible({ timeout: 30_000 });
  await page
    .getByTestId('skip-replay')
    .tap({ timeout: 3000 })
    .catch(() => undefined);
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('debrief-close').tap();
  await expect(page.getByTestId('turn')).toContainText('2/');

  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-research').tap();
  await expect(page.getByTestId('research-current')).toContainText('Naval Engineering');
  await expect(page.getByTestId('research-current')).not.toContainText('0/140');
  await page.getByTestId('close-sheet').tap();

  await openCity(page, 'china-capital');
  const after = page.getByTestId('city-panel');
  // Built in a turn, or still in the queue: either way it is the capital's.
  await expect(after.getByTestId('build-queue').or(after.getByTestId('facility-built-farm'))).toBeVisible();
  await expect(after.getByTestId('city-growth')).toContainText(/Level 1/);
  await expect(after.getByTestId('city-level')).not.toContainText('0/24');
  await after.getByTestId('city-growth').scrollIntoViewIfNeeded();
  await shot(page, '04-city-after');
  expect(errors).toEqual([]);
});
