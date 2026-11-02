import { devices, expect, test } from '@playwright/test';

// Staff plan mode, the default: every turn opens with the staff's plan drafted for every unit. The
// player changes what they like and executes; Clear hands every unit back.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

test('the staff plans every turn: change any of it, then execute', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-japan').tap();
  await page.getByTestId('crisis-pacific-pact').tap();
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap({ timeout: 60_000 });
  await expect(page.getByTestId('turn')).toContainText('1/');

  // The plan is up: nobody waits, the advisor says so, and End turn reads Execute.
  await expect(page.getByTestId('advisor')).toContainText('Staff has prepared a plan', { timeout: 30_000 });
  await expect(page.getByTestId('end-turn')).toContainText('Execute');
  await expect(page.getByTestId('next-idle')).toContainText('Ready');

  // Clear hands every unit back; Plan drafts it again.
  await page.getByTestId('clear-plan').tap();
  await expect(page.getByTestId('end-turn')).toContainText('End turn');
  await expect(page.getByTestId('next-idle')).toContainText('Next');
  await page.getByTestId('auto-command').tap();
  await expect(page.getByTestId('end-turn')).toContainText('Execute');

  // Execute: the turn resolves and the next one opens with a fresh plan.
  await page.getByTestId('end-turn').tap();
  const commit = page.getByTestId('commit-turn');
  if (await commit.isVisible({ timeout: 3000 }).catch(() => false)) await commit.tap();
  await expect(page.getByTestId('turn')).toContainText('2/', { timeout: 90_000 });
  await page.getByTestId('debrief-close').tap({ timeout: 30_000 }).catch(() => undefined);
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  expect(errors).toEqual([]);
});
