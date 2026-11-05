import { devices, expect, test, type Page } from '@playwright/test';

// The Middle East and Africa on a phone: the theatre picked at setup, its six powers on the roster,
// Egypt's dossier, the classic war (no Pacific crises here), a campaign started and two turns played
// with the staff's plan. MEA_SHOTS=<dir> keeps a screenshot of every step (deviceScaleFactor 1).
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.MEA_SHOTS;
let step = 0;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  step += 1;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png` });
}

const POWERS = ['turkey', 'iran', 'saudi-arabia', 'egypt', 'nigeria', 'south-africa'];

test('a campaign in the Middle East and Africa starts on a phone and plays two turns', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mideast')) return;
    sessionStorage.setItem('mideast', '1');
    localStorage.clear();
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();

  // The theatre picker lists the new theatre beside the Pacific; picking it swaps the roster.
  const theatre = page.getByTestId('theatre-mideast');
  await theatre.scrollIntoViewIfNeeded();
  await theatre.tap();
  await expect(theatre).toHaveAttribute('aria-checked', 'true');
  for (const id of POWERS) await expect(page.getByTestId(`nation-${id}`)).toBeVisible();
  await expect(page.getByTestId('nation-china')).toHaveCount(0);
  await page.getByTestId('nation-egypt').tap();
  await expect(page.getByTestId('dossier-name')).toHaveText('Egypt');
  await expect(page.getByTestId('dossier-blurb')).toContainText('canal');
  // The Opening Crises are the Pacific's: here the war opens classic, and the deck is not offered.
  await expect(page.getByTestId('crisis-card')).toHaveAttribute('data-crisis', 'classic');
  await expect(page.getByTestId('crisis-random')).toHaveCount(0);
  await page.getByTestId('seed').fill('3');
  await page.getByTestId('difficulty-normal').tap();
  await shot(page, 'setup');
  // The whole theatre, as the briefing previews it.
  await page.getByTestId('operation').scrollIntoViewIfNeeded();
  if (SHOTS) await page.locator('.wr-hero-map').screenshot({ path: `${SHOTS}/00-theatre-map.png` });
  await page.getByTestId('start-game').tap();

  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 90_000 });
  await shot(page, 'how-to-win');
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/');
  await shot(page, 'map');

  for (let turn = 1; turn <= 2; turn++) {
    if (await page.getByTestId('promotion').isVisible().catch(() => false)) await page.getByTestId('confirm-perk').tap();
    if (await page.getByTestId('event-open').isVisible().catch(() => false)) {
      await page.getByTestId('event-open').tap();
      await page.getByTestId('event-option-1').tap();
      await page.getByTestId('decision-done').tap();
    }
    // The staff has drafted every unit's orders: Execute plays them.
    await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
    await page.getByTestId('end-turn').tap();
    // With the staff's plan running the turn ends in one tap (int-staff's one-tap turn); otherwise the
    // order review opens and Commit ends it: wait for the review a moment and commit if it came.
    const commit = page.getByTestId('commit-turn');
    if (await commit.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) await commit.tap();
    if (await page.getByTestId('replay').isVisible({ timeout: 15_000 }).catch(() => false)) {
      await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
    }
    const debrief = page.getByTestId('debrief');
    await expect(debrief).toBeVisible({ timeout: 120_000 });
    await shot(page, `t${turn}-debrief`);
    if (await page.getByTestId('victory').isVisible().catch(() => false)) break;
    await page.getByTestId('debrief-close').tap();
    await expect(page.getByTestId('turn')).toContainText(`${turn + 1}/`);
    await shot(page, `t${turn + 1}-map`);
  }
  // Two turns in: still Egypt, still in the theatre, and nothing broke.
  const self = await page.evaluate(() => window.__brink?.formations().length ?? 0);
  expect(self).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
