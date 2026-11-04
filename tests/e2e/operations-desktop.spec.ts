import { expect, test } from '@playwright/test';

// Operations on the desktop game screen: the strip sits over the map, the sheet opens from it.
test('desktop: the operations strip opens the sheet and launches an operation', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByTestId('menu-new').click();
  await page.getByTestId('nation-china').click();
  await page.getByTestId('crisis-pacific-pact').click();
  await page.getByTestId('start-game').click();
  await page.getByTestId('how-to-close').click({ timeout: 60_000 }).catch(() => undefined);
  await page.getByTestId('operations-open').click({ timeout: 30_000 });
  await expect(page.getByTestId('operation').first()).toBeVisible();
  if (process.env.OPS_SHOTS) await page.screenshot({ path: `${process.env.OPS_SHOTS}/desk-sheet.png` });
  await page.getByTestId('operation-launch').first().click();
  await expect(page.getByTestId('operation-strip')).toBeVisible();
  await page.waitForTimeout(1500);
  if (process.env.OPS_SHOTS) await page.screenshot({ path: `${process.env.OPS_SHOTS}/desk-strip.png` });
  expect(errors).toEqual([]);
});
