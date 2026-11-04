import { devices, expect, test } from '@playwright/test';

// Doctrine cards on a phone: the hand behind its chip, a card played at once, a card aimed at a hex,
// the stamps on the order review, and the card in the debrief.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
// One device pixel per CSS pixel: the screenshots are for looking at, not for retina sharpness.
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

test('a phone plays a doctrine card and aims another at a hex', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem('brink.prefs.v1') ?? '{}');
    localStorage.setItem('brink.prefs.v1', JSON.stringify({ ...prefs, staffPlan: false }));
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-usa').tap();
  // Seed 7 deals the United States Air Superiority, Dig In and Forced March, with 3 Command Points.
  await page.getByTestId('seed').fill('7');
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap();
  await expect(page.getByTestId('turn')).toContainText('1/20');

  // The hand is a chip until tapped.
  const chip = page.getByTestId('hand-chip');
  await expect(chip).toContainText('Hand 3');
  await expect(chip).toContainText('CP 3');
  await chip.tap();
  await expect(page.getByTestId('hand')).toBeVisible();
  for (const id of ['air_superiority', 'dig_in', 'forced_march']) await expect(page.getByTestId(`card-${id}`)).toBeVisible();
  await expect(page.getByTestId('card-forced_march')).toContainText('Ground units move 2 points further');
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('doctrine-hand.png') });

  // A card with no target plays at once, and wears its stamp.
  await page.getByTestId('card-forced_march').tap();
  await page.getByTestId('play-card').tap();
  await expect(page.getByTestId('stamp-forced_march')).toBeVisible();
  await expect(page.getByTestId('hand')).toContainText('1 of 3 Command Points left');
  // Air Superiority now costs more than is left.
  await page.getByTestId('card-air_superiority').tap();
  await expect(page.getByTestId('play-card')).toBeDisabled();

  // A targeted card is armed, and the next tap on the map aims it.
  await page.getByTestId('card-dig_in').tap();
  await page.getByTestId('play-card').tap();
  await expect(page.getByTestId('hand')).toBeHidden();
  await expect(page.getByTestId('aim-banner')).toContainText('Dig In');
  const spot = await page.evaluate((h) => {
    const b = window.__brink!;
    return b
      .formations()
      .map((f) => b.hexToClient(f.key))
      .find((p) => p.y > 170 && p.y < h - 260 && p.x > 30 && p.x < window.innerWidth - 30);
  }, viewport.height);
  expect(spot).toBeTruthy();
  await page.touchscreen.tap(spot!.x, spot!.y);
  await expect(page.getByTestId('aim-banner')).toBeHidden();
  await expect(chip).toContainText('2 played');
  await expect(chip).toContainText('CP 0');
  await chip.tap();
  await expect(page.getByTestId('stamp-dig_in')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('doctrine-played.png') });
  await page.getByTestId('hand-close').tap();

  // The review shows both cards stamped, and the engine refuses nothing.
  await page.getByTestId('end-turn').tap();
  await expect(page.getByTestId('review-cards')).toContainText('2 cards');
  await expect(page.getByTestId('review-warnings')).not.toContainText('Will be refused');
  await page.screenshot({ path: info.outputPath('doctrine-review.png') });
  await page.getByTestId('commit-turn').tap();
  await page
    .getByTestId('skip-replay')
    .tap({ timeout: 15000 })
    .catch(() => undefined);
  await expect(page.getByTestId('debrief')).toContainText('We played');
  await page.screenshot({ path: info.outputPath('doctrine-debrief.png') });
  await page.getByTestId('debrief-close').tap();
  // A new hand: three cards again, the played ones in the discard.
  await expect(chip).toContainText('Hand 3');
  expect(errors).toEqual([]);
});
