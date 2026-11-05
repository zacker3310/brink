import { devices, expect, test, type Page } from '@playwright/test';

// Plans up front and the Enter Battle button, on a phone. The first turn opens on the plan picker:
// the staff's best few plans, ranked, each one tap. Taking one runs the operation, and the command
// card says its next step in plain words. With the staff's plan up, Execute ends the turn in one
// tap. Whenever an attack this turn meets enemies, ENTER BATTLE goes straight to the best fight;
// with no attack in the orders it is not there. PLANS_SHOTS=<dir> keeps screenshots.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.PLANS_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('the first turn opens on the plan picker; one tap launches a plan, one ends the turn, one enters the battle', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  // The setup recommends Easy for a first game, and says what each level means in a line.
  await expect(page.getByTestId('difficulty-recommended')).toBeVisible();
  await expect(page.getByTestId('difficulty-easy')).toContainText('First game');
  for (const d of ['easy', 'normal', 'hard']) await expect(page.getByTestId(`difficulty-means-${d}`)).not.toBeEmpty();
  await page.getByTestId('difficulty-easy').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '01-difficulty');
  await page.getByTestId('nation-china').tap();
  await page.getByTestId('seed').fill('1');
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('difficulty-normal').tap();
  await page.getByTestId('start-game').tap();

  // The plan picker, ranked, each with its cost and chance in a line and one button.
  const picker = page.getByTestId('how-to-win');
  await expect(picker).toBeVisible({ timeout: 60_000 });
  const plans = picker.getByTestId('plan');
  await expect(plans.first()).toBeVisible({ timeout: 30_000 });
  expect(await plans.count()).toBeGreaterThanOrEqual(2);
  expect(await plans.count()).toBeLessThanOrEqual(5);
  const taipei = plans.filter({ hasText: 'Take Taipei' }).first();
  await expect(taipei).toContainText(/turn/);
  await expect(taipei).toContainText(/likely win|even fight|likely loss|garrison unseen/);
  await shot(page, '02-plan-picker');
  await taipei.getByTestId('plan-adopt').tap();
  await expect(picker).toBeHidden();

  // The plan runs: the command card names it and its next step in plain words.
  const card = page.getByTestId('command-card');
  await expect(card.getByTestId('operation-strip')).toContainText('Taipei');
  await expect(card.getByTestId('operation-now')).toContainText('Next:');
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  await expect(page.getByTestId('end-turn')).toHaveAttribute('data-one-tap', 'true');
  // The other plans are a chip away.
  await expect(card.getByTestId('plans-open')).toBeVisible();
  await shot(page, '03-plan-running');

  // No attack in the orders, no button: the staff's plan taken back leaves nothing to fight.
  await page.getByTestId('clear-plan').tap();
  await expect(page.getByTestId('enter-battle')).toHaveCount(0);
  await page.getByTestId('auto-command').tap();
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });

  let entered = false;
  for (let turn = 1; turn <= 10 && !entered; turn++) {
    if (await page.getByTestId('debrief-close').isVisible().catch(() => false)) await page.getByTestId('debrief-close').tap();
    if (await page.getByTestId('promotion').isVisible().catch(() => false)) await page.getByTestId('confirm-perk').tap();
    await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
    const battle = page.getByTestId('enter-battle');
    if (await battle.isVisible().catch(() => false)) {
      // Signal amber, thumb-sized, the place and the odds on it, and the count when there are more.
      const box = (await battle.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(52);
      expect(box.width).toBeGreaterThan(viewport.width * 0.8);
      await expect(page.getByTestId('enter-battle-target')).toContainText(/Likely win|Even fight|Likely loss/);
      const n = Number(await battle.getAttribute('data-count'));
      expect(n).toBeGreaterThanOrEqual(1);
      if (n > 1) await expect(page.getByTestId('enter-battle-count')).toHaveText(String(n));
      await shot(page, '05-enter-battle');
      await battle.tap();
      await expect(page.getByTestId('arena-brief')).toBeVisible({ timeout: 30_000 });
      await shot(page, '06-arena-brief');
      // Backing out leaves the attack to the odds, and the button where it was.
      await page.getByTestId('arena-back').tap();
      await expect(page.getByTestId('arena-brief')).toHaveCount(0);
      await expect(page.getByTestId('enter-battle')).toBeVisible();
      entered = true;
      break;
    }
    // One tap ends the turn: no review in between.
    await page.getByTestId('end-turn').tap();
    await expect(page.getByTestId('order-review')).toHaveCount(0);
    await page.getByTestId('skip-replay').tap({ timeout: 15_000 }).catch(() => undefined);
    const debrief = page.getByTestId('debrief');
    await expect(debrief).toBeVisible({ timeout: 90_000 });
    // The debrief's first line is what the turn did for the plan.
    await expect(debrief.getByTestId('debrief-plan')).not.toBeEmpty();
    if (turn === 1) await shot(page, '04-debrief');
    if (await page.getByTestId('victory').isVisible().catch(() => false)) break;
  }
  expect(entered, 'an attack with enemies to fight came up within ten turns').toBe(true);
  expect(errors).toEqual([]);
});
