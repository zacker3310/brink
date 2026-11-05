import { expect, test } from '@playwright/test';

// The core journey: title screen, campaign setup, pick a nation, select a formation, order it, end the turn, read the
// report, save, and resume from the save.
test('start, order, resolve, report, save and resume', async ({ page }) => {
  // The whole campaign loop in one test: longer than the default budget. It takes about 110 s on
  // its own, so 120 s failed whenever other specs ran beside it.
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // These walk-throughs give every order by hand: the staff plan (the default) is switched off.
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem('brink.prefs.v1') ?? '{}');
    if (prefs.staffPlan === undefined) localStorage.setItem('brink.prefs.v1', JSON.stringify({ ...prefs, staffPlan: false }));
  });
  await page.goto('./');
  await expect(page).toHaveTitle('Brink');
  await expect(page.getByTestId('wordmark')).toHaveText('Brink');
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);
  await page.getByTestId('menu-new').click();
  await page.getByTestId('nation-russia').click();
  await expect(page.getByTestId('dossier-name')).toHaveText('Russia');
  await page.getByTestId('seed').fill('1234');
  // The classic opening, not a dealt crisis: this journey is about the core loop on known ground.
  await page.getByTestId('crisis-none').click();
  // Normal: every rival at war from turn 1, so the first turn has fighting to replay.
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();

  // Building the world takes a few seconds (about 2.6 here, more with other tests running).
  await expect(page.getByTestId('top-bar')).toContainText('BRINK', { timeout: 30_000 });
  await expect(page.getByTestId('top-bar')).toContainText('Russia');
  await expect(page.getByTestId('turn')).toContainText('1 / 20');
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Select a formation from the Military panel.
  await page.getByTestId('tab-military').click();
  // The first infantry that can move this turn: one can be boxed in by mountains and a hostile border.
  const infantry = page.locator('[data-testid^="formation-f"]').filter({ hasText: 'Infantry' });
  let first = infantry.first();
  let target: string | undefined;
  for (let i = 0; i < (await infantry.count()) && !target; i++) {
    first = infantry.nth(i);
    await first.click();
    // A free hex it can reach that is on the map, not under the side panel.
    target = await page.evaluate(() => {
      const b = window.__brink!;
      const canvas = document.querySelector('[data-testid="map-canvas"] canvas') ?? document.querySelector('[data-testid="map-canvas"]');
      return b
        .reachable()
        .filter((k) => !b.formations().some((f) => f.key === k))
        .find((k) => {
          const p = b.hexToClient(k);
          const el = document.elementFromPoint(p.x, p.y);
          return !!el && !!canvas && (el === canvas || canvas.contains(el));
        });
    });
  }
  const name = (await first.locator('span').first().textContent())!;
  await expect(page.getByTestId('planned-order')).toContainText('Hold (default)');

  // Hovering a reachable hex previews the move; clicking it orders it. The next unit that needs
  // orders then comes up on its own, so check the order on the formation list.
  expect(target).toBeTruthy();
  const at = await page.evaluate((k) => window.__brink!.hexToClient(k), target!);
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('hover-card')).toContainText('Move');
  await page.mouse.click(at.x, at.y);
  await expect(first).toContainText(/Move \d+ hex/);
  await expect(page.locator('[data-testid="rejections"]')).toHaveCount(0);

  // Also order a defend, through the toolbar.
  const armored = page.locator('[data-testid^="formation-f"]').filter({ hasText: 'Armored' }).first();
  await armored.click();
  await page.getByTestId('order-defend').click();
  await expect(armored).toContainText('Defend');

  // Jump to the next formation without orders.
  // Two of Russia's opening army have orders now (the move and the defend); the rest still wait.
  const total = await page.evaluate(() => window.__brink!.formations().length);
  await expect(page.getByTestId('next-idle')).toContainText(`${total - 2} of ${total} units need orders`);
  await page.getByTestId('next-idle').click();
  await expect(page.getByTestId('planned-order')).toContainText('Hold (default)');

  // Choose production in the capital from its city banner.
  await page.keyboard.press('Escape');
  await page.getByTestId('city-russia-capital').click();
  await page.getByTestId('build-infantry').click();
  await expect(page.getByTestId('build-infantry')).toHaveAttribute('class', /border-signal/);
  await page.getByTestId('close-city').click();

  // End the turn: the review lists what commits, then it replays on the map, results arrive as
  // notifications, and the summary is a click away.
  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('order-review')).toBeVisible();
  await expect(page.getByTestId('review-orders')).toBeVisible();
  // The infantry chosen in the capital is listed with its cost, and the treasury shows what is left.
  await expect(page.getByTestId('order-review')).toContainText('Infantry at Moscow');
  await expect(page.getByTestId('review-treasury')).toBeVisible();
  // Back keeps the orders; End Turn again and Commit sends them.
  await page.getByTestId('review-back').click();
  await expect(page.getByTestId('order-review')).toHaveCount(0);
  await page.getByTestId('end-turn').click();
  await page.getByTestId('commit-turn').click();
  await expect(page.getByTestId('replay')).toBeVisible();
  // The replay can be paused and resumed.
  await page.keyboard.press(' ');
  await expect(page.getByTestId('replay-pause')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(' ');
  // Unpaused: it plays on (or, on a quiet turn, has already finished). Read in one go: the replay
  // can end, and its button go, between a count and a read.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="replay-pause"]');
        return !el || el.getAttribute('aria-pressed') === 'false';
      }),
    )
    .toBe(true);
  // Results arrive when the replay is over: it ends on its own (a stalled frame slows it rather than
  // skipping, so a slow machine plays it longer), and then the notifications are up.
  await expect(page.getByTestId('replay')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('notifications')).toBeVisible();
  await page.getByTestId('open-report').click();
  const report = page.getByTestId('report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Turn 1 resolved');
  await expect(report).toContainText('Economy');
  await expect(report).toContainText(`${name} moved`);
  await page.getByTestId('close-report').click();
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Rewatch the turn; leaving it keeps the current turn.
  await page.getByTestId('rewatch').click();
  await expect(page.getByTestId('replay')).toContainText('rewatch');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('replay')).toHaveCount(0);
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Threat overlay: V toggles it; hovering a seen enemy names the threat.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.getByTestId('toggle-threat')).toHaveAttribute('aria-pressed', 'true');
  const enemy = await page.evaluate(() => window.__brink!.enemies()[0]);
  if (enemy) {
    const e = await page.evaluate((k) => window.__brink!.hexToClient(k), enemy);
    await page.mouse.move(e.x, e.y);
    await expect(page.getByTestId('hover-card')).toBeVisible();
  }
  await page.keyboard.press('v');

  // Save, reload the page, and resume from the slot.
  await page.getByTestId('save-menu').click();
  await page.getByTestId('save-slot-2').click();
  await expect(page.getByText('Saved to Slot 2')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('menu-continue')).toContainText('Russia · turn 2');
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-slot-2').click();
  // Loading rebuilds the world behind the deploy screen ("Resuming… Establishing command link"),
  // about 4 s on a quiet machine: wait for the game, not the 5 s default.
  await expect(page.getByTestId('top-bar')).toContainText('Russia', { timeout: 30_000 });
  await expect(page.getByTestId('turn')).toContainText('2 / 20');
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report')).toContainText('Turn 1 resolved');
  await page.getByTestId('close-report').click();

  // Export a save file and load it back from the archive.
  await page.getByTestId('save-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('save-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('brink-russia-turn-2.json');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-file').setInputFiles((await file.path())!);
  await expect(page.getByTestId('top-bar')).toContainText('Russia', { timeout: 30_000 });
  await expect(page.getByTestId('turn')).toContainText('2 / 20');

  // Play another turn, then browse back through the report history.
  await page.getByTestId('end-turn').click();
  await page.getByTestId('commit-turn').click();
  await expect(page.getByTestId('turn')).toContainText('3 / 20', { timeout: 15000 });
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report')).toContainText('Turn 2 resolved');
  await page.getByTestId('report-prev').click();
  await expect(page.getByTestId('report')).toContainText('Turn 1 resolved');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('report')).toContainText('Turn 2 resolved');

  expect(errors).toEqual([]);
});
