import { devices, expect, test, type Page } from '@playwright/test';

// The Black Files on a phone: the standalone First Contact on the Antarctica map, started from the
// setup screen and played two turns; and the Black Files switched on for a Pacific campaign.
// BLACK_FILES_SHOTS=<dir> keeps a screenshot of each step.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.BLACK_FILES_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function fresh(page: Page, key: string) {
  await page.addInitScript((k) => {
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, '1');
    localStorage.clear();
  }, key);
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
}

/**
 * End the turn, skip its replay, read and close the debrief. With the staff's plan running the turn
 * ends in one tap (int-staff's one-tap turn); otherwise the order review opens and Commit ends it:
 * wait for the review a moment (`isVisible` does not wait) and commit if it came.
 */
async function endTurn(page: Page, name: string) {
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  await page.getByTestId('end-turn').tap();
  const commit = page.getByTestId('commit-turn');
  if (await commit.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) await commit.tap();
  if (await page.getByTestId('replay').isVisible({ timeout: 15_000 }).catch(() => false)) {
    await page.waitForTimeout(800);
    await shot(page, `${name}-replay`);
    await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
  }
  await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 90_000 });
  await shot(page, `${name}-debrief`);
  if (await page.getByTestId('debrief-close').isVisible().catch(() => false)) await page.getByTestId('debrief-close').tap();
}

test('Black Files: First Contact starts from the setup screen and plays two turns on a phone', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fresh(page, 'first-contact');
  await page.getByTestId('seed').fill('4');
  await page.getByTestId('difficulty-normal').tap();
  const card = page.getByTestId('first-contact');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText('Black Files: First Contact');
  await expect(card).toContainText('Antarctic ice');
  await shot(page, '01-setup-first-contact');
  await card.tap();

  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await shot(page, '02-how-to-win');
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/30');
  // The anomaly at a glance: nothing dug yet, three artefacts to the waking.
  const chip = page.getByTestId('black-files-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('0/3');
  await expect(chip).toHaveAttribute('data-awake', 'false');
  // The ice: five powers by treaty claim, the player one of them, at peace with every rival.
  const view = await page.evaluate(() => window.__brink!.view());
  expect(view.scenarioId).toBe('black-files-first-contact');
  expect(Object.values(view.nations).filter((n) => !n.minor).map((n) => n.id).sort()).toEqual(['australia', 'china', 'russia', 'uk', 'usa']);
  expect(Object.values(view.relations).every((r) => r === 'peace')).toBe(true);
  expect(Object.values(view.sites).filter((s) => s.anomaly === 'excavation')).toHaveLength(4);
  await shot(page, '03-first-contact-turn-1');

  // The reverse-engineered branch is in the tree, locked until an artefact reaches a black site.
  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-research').tap();
  await expect(page.getByTestId('research-tree-black')).toBeVisible();
  await expect(page.getByTestId('research-railguns')).toHaveAttribute('data-status', 'locked');
  await page.getByTestId('research-branch-black').tap();
  await shot(page, '04-reverse-engineered-branch');
  await page.getByTestId('close-sheet').tap();

  await endTurn(page, '05-turn-1');
  await expect(page.getByTestId('turn')).toContainText('2/30');
  await endTurn(page, '06-turn-2');
  await expect(page.getByTestId('turn')).toContainText('3/30');
  await shot(page, '07-first-contact-turn-3');
  expect(errors).toEqual([]);
});

test('the Black Files switched on for a Pacific campaign, on a phone', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fresh(page, 'black-files-pacific');
  await page.getByTestId('nation-usa').tap();
  await page.getByTestId('seed').fill('2');
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('difficulty-normal').tap();
  const toggle = page.getByTestId('black-files');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toContainText('On');
  await shot(page, '11-setup-toggle-on');
  await page.getByTestId('start-game').tap();

  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('black-files-chip')).toContainText('0/3');
  const view = await page.evaluate(() => window.__brink!.view());
  expect(view.scenarioId).toBe('pacific');
  // Area 51 and the Bermuda deep site are the player's own black sites; the Visitors sleep unseen.
  const black = Object.values(view.sites).filter((s) => s.anomaly === 'blacksite' && s.owner === 'usa').map((s) => s.name).sort();
  expect(black).toEqual(['Area 51', 'Bermuda Deep Site']);
  expect(view.nations.visitors).toBeUndefined();
  await shot(page, '12-pacific-black-files');
  await endTurn(page, '13-pacific-turn-1');
  await expect(page.getByTestId('turn')).toContainText('2/');
  // The toggle is remembered for the next campaign.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('brink.prefs.v1') ?? '{}').blackFiles)).toBe(true);
  expect(errors).toEqual([]);
});
