import { devices, expect, test, type Page } from '@playwright/test';

// The Americas on a phone (docs/americas.md): the setup screen lists the theatre, its six powers
// and no Pacific crisis; a campaign as Brazil starts on the theatre's own map, and two turns are
// played with the staff's plan. THEATRE_SHOTS=<dir> keeps a screenshot of each step.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.THEATRE_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('a campaign in the Americas starts on its own map and plays two turns on a phone', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('americas')) return;
    sessionStorage.setItem('americas', '1');
    localStorage.clear();
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();

  // The theatre picker lists the Americas, open from the start.
  const americas = page.getByTestId('theatre-americas');
  await americas.scrollIntoViewIfNeeded();
  await expect(americas).toBeEnabled();
  await americas.tap();
  await expect(americas).toHaveAttribute('aria-checked', 'true');
  // Its powers replace the Pacific's; the Opening Crises are the Pacific's, so none is dealt here.
  for (const id of ['usa', 'canada', 'mexico', 'colombia', 'brazil', 'argentina']) await expect(page.getByTestId(`nation-${id}`)).toBeVisible();
  await expect(page.getByTestId('nation-russia')).toHaveCount(0);
  await expect(page.getByTestId('crisis-card')).toHaveAttribute('data-crisis', 'classic');
  await expect(page.getByTestId('crisis-deal')).toHaveCount(0);

  await page.getByTestId('nation-brazil').tap();
  await expect(page.getByTestId('dossier-blurb')).toContainText('Amazon');
  await page.getByTestId('seed').fill('3');
  await page.getByTestId('difficulty-normal').tap();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '01-setup');
  await page.getByTestId('start-game').tap();

  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/');
  await shot(page, '02-turn-1');
  // The theatre: Brazil's rivals are the Americas' powers, with the minor states listed after them.
  await page.getByTestId('world').tap();
  const world = page.getByTestId('world-card');
  for (const name of ['Argentina', 'Colombia', 'Mexico', 'Canada']) await expect(world).toContainText(name);
  await expect(world).toContainText('Panama');
  await expect(world).not.toContainText('Russia');
  await shot(page, '03-theatre');
  await page.getByTestId('world-close').tap();

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
      await page.waitForTimeout(1200);
      if (turn === 1) await shot(page, '04-replay');
      await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
    }
    const debrief = page.getByTestId('debrief');
    await expect(debrief).toBeVisible({ timeout: 120_000 });
    await expect(debrief).toContainText(`Turn ${turn} debrief`);
    await shot(page, `0${4 + turn}-debrief-${turn}`);
    if (await page.getByTestId('victory').isVisible().catch(() => false)) break;
    await page.getByTestId('debrief-close').tap();
    await expect(page.getByTestId('turn')).toContainText(`${turn + 1}/`);
  }
  await shot(page, '07-turn-3');
  expect(errors).toEqual([]);
});
