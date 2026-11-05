import { devices, expect, test, type Page } from '@playwright/test';

// The Indo-Pacific South on a phone: pick the theatre, pick one of its five powers, start the classic
// war (the Pacific's crises are not dealt here) and play two turns with the staff's plan.
// INDOPAC_SHOTS=<dir> keeps a screenshot of each step.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.INDOPAC_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/phone-${name}.png` });
}

test('a campaign in the Indo-Pacific South starts on a phone and plays two turns', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('indopac')) return;
    sessionStorage.setItem('indopac', '1');
    localStorage.clear();
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();

  // The theatre picker lists it; picking it puts its five powers on the roster.
  const theatre = page.getByTestId('theatre-indopac');
  await theatre.scrollIntoViewIfNeeded();
  await expect(theatre).toContainText('Indo-Pacific South');
  await theatre.tap();
  await expect(theatre).toHaveAttribute('aria-checked', 'true');
  for (const n of ['india', 'pakistan', 'china', 'indonesia', 'australia']) await expect(page.getByTestId(`nation-${n}`)).toHaveCount(1);
  await expect(page.getByTestId('nation-usa')).toHaveCount(0);
  // No Pacific crisis: the classic war, and no deck to deal from.
  await expect(page.getByTestId('crisis-card')).toHaveAttribute('data-crisis', 'classic');
  await expect(page.getByTestId('crisis-pacific-pact')).toHaveCount(0);

  await page.getByTestId('nation-indonesia').tap();
  await expect(page.getByTestId('dossier-blurb')).toContainText('archipelago');
  await page.getByTestId('seed').fill('3');
  await page.getByTestId('difficulty-normal').tap();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'setup');
  await page.getByTestId('start-game').tap();

  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/');
  // The world card lists the theatre's nations.
  await page.getByTestId('world').tap();
  await expect(page.getByTestId('world-card')).toContainText('Australia');
  await shot(page, 'world');
  await page.getByTestId('world-close').tap();
  await shot(page, 'turn-1');

  for (let turn = 1; turn <= 2; turn++) {
    if (await page.getByTestId('promotion').isVisible().catch(() => false)) await page.getByTestId('confirm-perk').tap();
    if (await page.getByTestId('event-open').isVisible().catch(() => false)) {
      await page.getByTestId('event-open').tap();
      await page.getByTestId('event-option-1').tap();
      await page.getByTestId('decision-done').tap();
    }
    await expect(page.getByTestId('end-turn')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('end-turn').tap();
    // With the staff's plan running the turn ends in one tap (int-staff's one-tap turn); otherwise the
    // order review opens and Commit ends it: wait for the review a moment and commit if it came.
    const commit = page.getByTestId('commit-turn');
    if (await commit.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) await commit.tap();
    if (await page.getByTestId('replay').isVisible({ timeout: 15_000 }).catch(() => false)) {
      await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
    }
    const debrief = page.getByTestId('debrief');
    await expect(debrief).toBeVisible({ timeout: 90_000 });
    await expect(debrief).toContainText(`Turn ${turn} debrief`);
    await shot(page, `debrief-${turn}`);
    await page.getByTestId('debrief-close').tap();
    await expect(page.getByTestId('turn')).toContainText(`${turn + 1}/`);
  }
  await shot(page, 'turn-3');
  expect(errors).toEqual([]);
});
