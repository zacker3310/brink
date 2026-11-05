import { devices, expect, test, type Page } from '@playwright/test';

// Airborne warfare on a phone (ruleset 2.9.0): the United States launches "Take Ulaanbaatar", an
// airborne operation; the staff sails the carrier group and the loaded amphibious groups into the
// deck's reach; the unit card's Airlift action shows every landing hex by its interception risk; the
// replay flies the troops in; the debrief and the report tell of the drop. Easy, seed 2, no crisis:
// the marines come down beside Ulaanbaatar on turn 3. AIRBORNE_SHOTS=<dir> keeps the screenshots.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.AIRBORNE_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** End the turn with what is drafted, watch a moment of the replay, and return the debrief's text. */
async function endTurn(page: Page, turn: number, at = 700): Promise<string> {
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  await page.getByTestId('end-turn').tap();
  const commit = page.getByTestId('commit-turn');
  if (await commit.isVisible({ timeout: 3000 }).catch(() => false)) await commit.tap();
  const replay = await page
    .getByTestId('replay')
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (replay) {
    // Held at a moment of the film: the lift in the air, then the canopies coming down.
    if (at < 1000) {
      await page.evaluate((ms) => window.__brink!.holdReplay(ms), at);
      await page.waitForTimeout(400);
      await shot(page, `t${turn}-replay-flight`);
      await page.evaluate(() => window.__brink!.holdReplay(1120));
      await page.waitForTimeout(400);
    } else await page.waitForTimeout(at);
    await shot(page, `t${turn}-replay`);
    await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
  }
  const debrief = page.getByTestId('debrief');
  await expect(debrief).toBeVisible({ timeout: 90_000 });
  return (await debrief.textContent()) ?? '';
}

test('the United States flies its marines in to Ulaanbaatar', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('airborne')) return;
    sessionStorage.setItem('airborne', '1');
    localStorage.clear();
  });
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-usa').tap();
  await page.getByTestId('seed').fill('2');
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('difficulty-easy').tap();
  await page.getByTestId('start-game').tap();
  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('how-to-operations').tap();

  // The staff offers Ulaanbaatar as an airborne operation, phase by phase.
  const sheet = page.getByTestId('operations');
  const card = sheet.getByTestId('operation').filter({ hasText: 'Take Ulaanbaatar' }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Airborne assault');
  for (const phase of ['Stage', 'Drop', 'Hold', 'Assault']) await expect(card).toContainText(phase);
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'ops-sheet');
  await card.getByTestId('operation-launch').tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('operation-strip')).toContainText('Ulaanbaatar');
  // The map marks where the carrier group stages.
  await expect.poll(async () => (await page.evaluate(() => window.__brink!.opSpot()))?.label ?? null, { timeout: 30_000 }).toBe('STAGE');
  await shot(page, 't1-staged-spot');

  // Turns 1 and 2: the convoy sails into the deck's reach.
  for (const turn of [1, 2]) {
    await endTurn(page, turn);
    await page.getByTestId('debrief-close').tap({ timeout: 10_000 }).catch(() => undefined);
  }

  // Turn 3: staged. A marine aboard the amphibious group beside the carrier has its lift drafted;
  // the unit card's Airlift action shows where it can come down, by the risk of interception.
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  const ship = await page.evaluate(() => window.__brink!.formations().find((f) => f.cls === 'transport'));
  expect(ship).toBeTruthy();
  const marine = await page.evaluate((k) => window.__brink!.formations().find((f) => f.cls === 'infantry' && f.key === k)?.id ?? null, ship!.key);
  expect(marine).not.toBeNull();
  // Bring the ship's hex on screen and pick the marine aboard, as a tap on its cargo chip does.
  await page.evaluate((k) => window.__brink!.focus(k), ship!.key);
  await page.waitForTimeout(600);
  await page.evaluate((id) => window.__brink!.select(id), marine!);
  await expect(page.getByTestId('planned-order')).toContainText('Fly to');
  await page.getByTestId('order-airlift').tap();
  await expect(page.getByTestId('airlift-aim')).toBeVisible();
  const targets = await page.evaluate(() => window.__brink!.liftTargets());
  expect(targets.length).toBeGreaterThan(5);
  expect(targets.some((t) => t.chance > 0)).toBe(true);
  await shot(page, 't3-airlift-targets');
  // Put it back as the staff drafted it: Cancel leaves the order as it was.
  await page.getByTestId('cancel-airlift').tap();
  await expect(page.getByTestId('planned-order')).toContainText('Fly to');
  await page.getByTestId('deselect').tap();

  // The drop: watched over Ulaanbaatar, the aircraft come in and the canopies come down; the
  // debrief and the report tell of it.
  // Ulaanbaatar's hex on the authored Pacific map.
  await page.evaluate(() => window.__brink!.focus('8,7'));
  await page.waitForTimeout(600);
  const text = await endTurn(page, 3, 820);
  await shot(page, 't3-debrief');
  await page.getByTestId('debrief-report').tap();
  await expect(page.getByTestId('report')).toContainText(/dropped at|air-landed at|came down beside/, { timeout: 10_000 });
  await shot(page, 't3-report');
  await page.getByTestId('close-report').tap();
  expect(text.length).toBeGreaterThan(0);
  // Troops of ours now stand in Mongolia.
  const down = await page.evaluate(() => window.__brink!.formations().filter((f) => f.cls === 'infantry' && Math.abs(Number(f.key.split(',')[0]) - 8) <= 1 && Math.abs(Number(f.key.split(',')[1]) - 7) <= 1).length);
  expect(down).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
