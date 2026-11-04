import { devices, expect, test } from '@playwright/test';

// Operations: the staff proposes campaigns against a prize; launching one has the staff draft that
// operation's orders every turn, and the strip over the map follows it phase by phase.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

test('launch an operation, and the staff runs it turn after turn', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-china').tap();
  await page.getByTestId('crisis-pacific-pact').tap();
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap({ timeout: 60_000 });
  await expect(page.getByTestId('turn')).toContainText('1/');

  await page.getByTestId('operations-open').tap({ timeout: 30_000 });
  const sheet = page.getByTestId('operations');
  await expect(sheet.getByTestId('operation').first()).toBeVisible();
  if (process.env.OPS_SHOTS) await page.screenshot({ path: `${process.env.OPS_SHOTS}/ops-sheet.png` });
  const card = sheet.getByTestId('operation').filter({ hasText: 'Amphibious landing' }).first();
  await expect(card).toBeVisible();
  const name = (await card.locator('h3').textContent())!;
  await card.getByTestId('operation-launch').tap();
  await expect(sheet).toBeHidden();
  const strip = page.getByTestId('operation-strip');
  await expect(strip).toContainText(name);
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  if (process.env.OPS_SHOTS) await page.screenshot({ path: `${process.env.OPS_SHOTS}/ops-strip.png` });

  await page.getByTestId('end-turn').tap();
  const commit = page.getByTestId('commit-turn');
  if (await commit.isVisible({ timeout: 3000 }).catch(() => false)) await commit.tap();
  await expect(page.getByTestId('turn')).toContainText('2/', { timeout: 90_000 });
  await page.getByTestId('debrief-close').tap({ timeout: 30_000 }).catch(() => undefined);
  // The next turn opens with the operation still running and its orders drafted.
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  const fell = await page.getByText(/complete:/).isVisible().catch(() => false);
  if (!fell) await expect(strip).toContainText(name);
  expect(errors).toEqual([]);
});
