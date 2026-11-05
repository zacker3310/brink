import { expect, test, type Page } from '@playwright/test';

// The same first steps as the phone playthrough on a 1440 x 900 desk: the dossier, Operations,
// the hand, the generals and two turns with their reports. PLAYTEST_SHOTS=<dir> keeps a screenshot
// of every step.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const SHOTS = process.env.PLAYTEST_SHOTS;
let step = 0;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  step += 1;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/desk-${String(step).padStart(2, '0')}-${name}.png` });
}

test('desktop: a new player plays China for two turns', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByTestId('menu-new').click();
  await page.getByTestId('nation-china').click();
  await expect(page.getByTestId('dossier-blurb')).toContainText('rockets to reach across the strait');
  await page.getByTestId('seed').fill('1');
  await page.getByTestId('crisis-none').click();
  await page.getByTestId('difficulty-normal').click();
  await shot(page, 'setup');
  await page.getByTestId('start-game').click();
  await page.getByTestId('how-to-close').click({ timeout: 60_000 }).catch(() => undefined);
  await expect(page.getByTestId('turn')).toContainText('1 / 20', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await shot(page, 'turn1');

  // The plans for the turn stand over the turn controls from the first turn, each one click.
  await expect(page.getByTestId('desk-plans').getByTestId('plan').first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('operations-open').click();
  const sheet = page.getByTestId('operations');
  await expect(sheet.getByTestId('operation').first()).toBeVisible();
  await shot(page, 'operations');
  await sheet.getByTestId('operation').filter({ hasText: 'Take Taipei' }).first().getByTestId('operation-launch').click();
  await expect(page.getByTestId('operation-strip')).toContainText('Taipei');
  await page.waitForTimeout(1200);
  await shot(page, 'operation-launched');

  await page.getByTestId('hand-tab').click();
  await page.getByTestId('card-joint_island_landing').click();
  await expect(page.getByTestId('card-detail')).toContainText('Joint Island Landing');
  await shot(page, 'hand');
  await page.getByTestId('hand-tab').click();

  await page.getByTestId('tab-generals').click();
  await expect(page.getByTestId('generals-roster')).toBeVisible();
  await page.locator('[data-testid^="post-china-gen-"]').first().click();
  await expect(page.getByTestId('generals-roster')).toContainText('Takes command of');
  await shot(page, 'generals');
  await page.getByTestId('tab-generals').click();

  for (let turn = 1; turn <= 2; turn++) {
    // With the operation's plan up, Execute ends the turn in one click; otherwise the review comes first.
    const oneTap = (await page.getByTestId('end-turn').getAttribute('data-one-tap')) === 'true';
    await page.getByTestId('end-turn').click();
    if (!oneTap) await page.getByTestId('commit-turn').click();
    await page.getByTestId('skip-replay').click({ timeout: 15_000 }).catch(() => undefined);
    await expect(page.getByTestId('turn')).toContainText(`${turn + 1} / 20`, { timeout: 90_000 });
    await page.waitForTimeout(800);
    await shot(page, `turn${turn + 1}`);
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('report')).toBeVisible();
    await shot(page, `report${turn}`);
    await page.getByTestId('close-report').click();
  }
  expect(errors).toEqual([]);
});
