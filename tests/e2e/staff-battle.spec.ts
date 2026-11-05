import { expect, test, type Page } from '@playwright/test';

// A battle the staff drafts goes to the odds unless the player chooses to fight it: the order
// review lists the turn's battles, each with Fight It Yourself, and ENTER BATTLE stands over the
// turn controls whenever there is one. Backing out of the brief leaves the staff's orders as they
// were; nothing is forced. With the staff's plan up, End Turn (Execute) ends the turn in one click,
// so the review is opened with its own Review button.

/** The order review: its own button while Execute ends the turn in one click, else End Turn. */
async function review(page: Page): Promise<void> {
  const open = page.getByTestId('open-review');
  await (await open.isVisible().catch(() => false) ? open : page.getByTestId('end-turn')).click();
}

async function start(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByTestId('menu-new').click();
  await page.getByTestId('nation-china').click();
  await page.getByTestId('seed').fill('1');
  await page.getByTestId('crisis-none').click();
  await page.getByTestId('start-game').click();
  await page.getByTestId('how-to-close').click({ timeout: 60_000 }).catch(() => undefined);
  // An operation on Taipei: every turn the staff drafts the attacks toward it.
  await page.getByTestId('operations-open').click({ timeout: 30_000 });
  const sheet = page.getByTestId('operations');
  await sheet.getByTestId('operation').filter({ hasText: 'Take Taipei' }).first().getByTestId('operation-launch').click();
  await expect(page.getByTestId('staff-plan')).toBeVisible({ timeout: 30_000 });
}

test('desktop: a staff-drafted attack can be fought by hand from the order review, or left to the odds', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  let found = false;
  for (let turn = 1; turn <= 8 && !found; turn++) {
    await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 60_000 });
    await review(page);
    await expect(page.getByTestId('order-review')).toBeVisible();
    const fight = page.getByTestId('fight-planned');
    if ((await fight.count()) > 0) {
      found = true;
      // The same battles put ENTER BATTLE on the turn controls (it sits under the review).
      await expect(page.getByTestId('enter-battle')).toHaveAttribute('data-count', String(await fight.count()));
      // Optional, and it says so: left alone, the odds settle it.
      await expect(page.getByTestId('review-battles')).toContainText('settled by the odds unless you fight it');
      await fight.first().click();
      await expect(page.getByTestId('order-review')).toHaveCount(0);
      await expect(page.getByTestId('arena-brief')).toBeVisible({ timeout: 30_000 });
      // Optional: back out, and the staff's attack still stands, to be settled by the odds.
      await page.getByTestId('arena-back').click();
      await expect(page.getByTestId('arena-brief')).toHaveCount(0);
      await review(page);
      await expect(page.getByTestId('fight-planned').first()).toBeVisible();
      break;
    }
    await page.getByTestId('commit-turn').click();
    await expect(page.getByTestId('turn')).toContainText(`${turn + 1}/`, { timeout: 120_000 });
    await page.getByTestId('debrief-close').click({ timeout: 30_000 }).catch(() => undefined);
  }
  expect(found, 'the staff drafted an attack on an enemy within eight turns').toBe(true);
  expect(errors).toEqual([]);
});
