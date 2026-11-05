import { devices, expect, test, type Page } from '@playwright/test';

// A European campaign on a phone (docs/europe.md): pick the theatre, lead Germany, read the dossier,
// and play two turns with the staff's plan. EUROPE_SHOTS=<dir> keeps a screenshot of the setup and
// of the theatre's map, on the phone and on a desktop.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.EUROPE_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('a European campaign starts as Germany on a phone and plays two turns', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('europe')) return;
    sessionStorage.setItem('europe', '1');
    localStorage.clear();
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();

  // Two theatres now: the picker shows, and Europe lists its own six powers.
  await page.getByTestId('theatre-europe').tap();
  await expect(page.getByTestId('theatre-europe')).toHaveAttribute('aria-checked', 'true');
  for (const id of ['uk', 'france', 'germany', 'poland', 'russia', 'turkey']) await expect(page.getByTestId(`nation-${id}`)).toBeVisible();
  await expect(page.getByTestId('nation-usa')).toHaveCount(0);
  await page.getByTestId('nation-germany').tap();
  await expect(page.getByTestId('dossier-blurb')).toContainText('Leopards');
  // No Pacific crisis is dealt in Europe: the classic opening.
  await expect(page.getByTestId('crisis-card')).toHaveAttribute('data-crisis', 'classic');
  await page.getByTestId('seed').fill('1');
  await page.getByTestId('difficulty-normal').tap();
  await shot(page, 'phone-setup');
  await page.getByTestId('start-game').tap();

  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/20');
  await shot(page, 'phone-map');
  // The world card lists Europe's nations.
  await page.getByTestId('world').tap();
  await expect(page.getByTestId('world-card')).toContainText('France');
  await expect(page.getByTestId('world-card')).toContainText('Poland');
  await page.getByTestId('world-close').tap();

  for (let turn = 1; turn <= 2; turn++) {
    if (await page.getByTestId('promotion').isVisible().catch(() => false)) await page.getByTestId('confirm-perk').tap();
    if (await page.getByTestId('event-open').isVisible().catch(() => false)) {
      await page.getByTestId('event-open').tap();
      await page.getByTestId('event-option-1').tap();
      await page.getByTestId('decision-done').tap();
    }
    // The staff has drafted every order: Execute plays it.
    await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 60_000 });
    await page.getByTestId('end-turn').tap();
    await page.getByTestId('commit-turn').tap();
    if (await page.getByTestId('replay').isVisible({ timeout: 30_000 }).catch(() => false)) {
      await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
    }
    const debrief = page.getByTestId('debrief');
    await expect(debrief).toContainText(`Turn ${turn} debrief`, { timeout: 120_000 });
    if (await page.getByTestId('victory').isVisible().catch(() => false)) break;
    await page.getByTestId('debrief-close').tap();
    await expect(page.getByTestId('turn')).toContainText(`${turn + 1}/20`);
  }
  await shot(page, 'phone-turn3');

  if (SHOTS) {
    // The same theatre on a desktop screen.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1500);
    await shot(page, 'desktop-map');
  }
  expect(errors).toEqual([]);
});
