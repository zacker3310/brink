import { devices, expect, test, type Page } from '@playwright/test';

// A scripted playthrough as China on a phone, the way a new player meets the game: a new campaign,
// the staff's operation against Taipei, a doctrine card, a general, eight turns ended with the staff
// running the campaign, a battle opened when an attack comes up, and each debrief read.
// PLAYTEST_SHOTS=<dir> keeps a screenshot of every step.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.PLAYTEST_SHOTS;
let step = 0;
const t0 = Date.now();
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  step += 1;
  if (process.env.PLAYTEST_LOG) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png` });
}

/** Tap own counters on screen until one has an enemy it can hit; arm the attack on it. */
async function findAttack(page: Page): Promise<boolean> {
  const counters = await page.evaluate(
    ([top, bottom, w]) =>
      window
        .__brink!.formations()
        .map((f) => ({ key: f.key, ...window.__brink!.hexToClient(f.key) }))
        .filter((p) => p.y > top && p.y < bottom && p.x > 24 && p.x < w - 24),
    [170, viewport.height - 300, viewport.width] as const,
  );
  const seen = new Set<string>();
  for (const c of counters) {
    if (seen.has(c.key) || seen.size >= 8) continue;
    seen.add(c.key);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(300);
    const target = await page.evaluate(
      ([top, bottom, w]) =>
        window
          .__brink!.targets()
          .map((k) => window.__brink!.hexToClient(k))
          .find((p) => p.y > top && p.y < bottom && p.x > 20 && p.x < w - 20),
      [170, viewport.height - 380, viewport.width] as const,
    );
    if (!target) continue;
    await page.touchscreen.tap(target.x, target.y);
    if (await page.getByTestId('armed').isVisible({ timeout: 1500 }).catch(() => false)) return true;
  }
  if (await page.getByTestId('deselect').isVisible().catch(() => false)) await page.getByTestId('deselect').tap();
  return false;
}

test('a new player plays China for eight turns on a phone', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('playthrough')) return;
    sessionStorage.setItem('playthrough', '1');
    localStorage.clear();
  });
  await page.goto('./');
  await shot(page, 'title');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-china').tap();
  // The dossier says how the power plays, in its own words.
  await expect(page.getByTestId('dossier-blurb')).toContainText('rockets to reach across the strait');
  await page.getByTestId('dossier-blurb').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'dossier');
  await page.getByTestId('seed').fill('1');
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('difficulty-normal').tap();
  await shot(page, 'setup');
  await page.getByTestId('start-game').tap();

  // The first turn's brief points at Operations, and goes straight there.
  await expect(page.getByTestId('how-to-win')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('how-to-ops')).toContainText('Or let the staff run it');
  await page.getByTestId('how-to-ops').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'how-to-win');
  await page.getByTestId('how-to-operations').tap();
  const sheet = page.getByTestId('operations');
  await expect(sheet.getByTestId('operation').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('turn')).toContainText('1/');
  await shot(page, 'operations-sheet');
  const taipei = sheet.getByTestId('operation').filter({ hasText: 'Take Taipei' }).first();
  await expect(taipei).toBeVisible();
  await taipei.getByTestId('operation-launch').tap();
  await expect(sheet).toBeHidden();

  // One command card over the dock: the operation, what it does this turn, and what else waits.
  const card = page.getByTestId('command-card');
  await expect(card.getByTestId('operation-strip')).toContainText('Taipei');
  await expect(card.getByTestId('operation-now')).not.toBeEmpty();
  await expect(page.getByTestId('end-turn')).toContainText('Execute', { timeout: 30_000 });
  // The map marks where this phase happens (the port, or the beach) when it is not the prize itself.
  const spot = await page.evaluate(() => window.__brink!.opSpot());
  if (spot) expect(['ASSEMBLE', 'EMBARK', 'BUILD LIFT', 'LAND HERE']).toContain(spot.label);
  await page.getByTestId('operation-show').tap();
  await page.waitForTimeout(800);
  await shot(page, 'operation-launched');
  // Nothing else is stacked over the map: no separate advisor card, strip or chip row.
  for (const id of ['advisor', 'command-chips']) {
    const el = page.getByTestId(id);
    if (await el.count()) await expect(card.getByTestId(id)).toHaveCount(1);
  }

  // The hand: the landing card is one to save for the landing turn; a card aimed at the map shows
  // every hex it can take.
  await page.getByTestId('hand-chip').tap();
  await expect(page.getByTestId('hand')).toBeVisible();
  await page.getByTestId('card-joint_island_landing').tap();
  await expect(page.getByTestId('card-detail')).toContainText('Joint Island Landing');
  await shot(page, 'hand-landing-card');
  const hint = page.getByTestId('card-operation-hint');
  if (await hint.count()) await expect(hint).toContainText(/landing turn/);
  let played = false;
  for (const id of ['rocket_force_salvo', 'strait_blockade', 'yaogan_satellites', 'carrier_killer']) {
    if (played || !(await page.getByTestId(`card-${id}`).count())) continue;
    await page.getByTestId(`card-${id}`).tap();
    const play = page.getByTestId('play-card');
    if (!(await play.isEnabled())) continue;
    const aims = /Aim/.test((await play.textContent()) ?? '');
    await play.tap();
    if (!aims) {
      played = true;
      break;
    }
    await expect(page.getByTestId('aim-banner')).toBeVisible();
    const target = await page.evaluate(
      ([top, bottom]) => window.__brink!.cardTargets().map((k) => window.__brink!.hexToClient(k)).find((p) => p.y > top && p.y < bottom && p.x > 30 && p.x < window.innerWidth - 30),
      [170, viewport.height - 260] as const,
    );
    await shot(page, 'card-aiming');
    if (target) {
      await page.touchscreen.tap(target.x, target.y);
      await expect(page.getByTestId('aim-banner')).toBeHidden();
      played = true;
    } else {
      await page.getByTestId('aim-cancel').tap();
      await page.getByTestId('hand-chip').tap();
    }
  }
  if (!played) {
    // A card aimed at a rival power always has a target.
    await page.getByTestId('card-three_warfares').tap();
    await page.getByTestId('card-detail').getByRole('button', { name: 'Japan' }).tap();
  }
  if (await page.getByTestId('hand').isVisible().catch(() => false)) await page.getByTestId('hand-close').tap();
  await expect(page.getByTestId('hand-chip')).toContainText('1 played');
  await shot(page, 'card-played');

  // Generals: a general in reserve leads the operation's strongest formation in one tap.
  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-generals').tap();
  await expect(page.getByTestId('generals-roster')).toBeVisible();
  const post = page.locator('[data-testid^="post-china-gen-"]').first();
  await expect(post).toBeVisible();
  await post.tap();
  await expect(page.getByTestId('generals-roster')).toContainText('Takes command of');
  await shot(page, 'generals-roster');
  await page.getByTestId('close-sheet').tap();
  const own = await page.evaluate(
    ([top, bottom]) => window.__brink!.formations().filter((f) => f.cls === 'infantry' || f.cls === 'armor').map((f) => window.__brink!.hexToClient(f.key)).find((p) => p.y > top && p.y < bottom && p.x > 30 && p.x < window.innerWidth - 30),
    [170, viewport.height - 300] as const,
  );
  if (own) {
    await page.touchscreen.tap(own.x, own.y);
    await expect(page.getByTestId('unit-panel')).toBeVisible();
    await shot(page, 'unit-card');
    await page.getByTestId('deselect').tap();
  }

  let fought = false;
  const debriefs: string[] = [];
  for (let turn = 1; turn <= 8; turn++) {
    // A promotion may come up on its own.
    if (await page.getByTestId('promotion').isVisible().catch(() => false)) {
      await shot(page, `t${turn}-promotion`);
      await page.getByTestId('confirm-perk').tap();
    }
    // A world event waits behind its chip in the command card, not stacked over the map.
    if (await page.getByTestId('event-open').isVisible().catch(() => false)) {
      await page.getByTestId('event-open').tap();
      await expect(page.getByTestId('world-event')).toBeVisible();
      await shot(page, `t${turn}-decision`);
      await page.getByTestId('event-option-1').tap();
      await page.getByTestId('decision-done').tap();
    }
    if (!fought && (await findAttack(page))) {
      await shot(page, `t${turn}-attack-armed`);
      await page.getByTestId('confirm-attack').tap();
      const battle = await page.getByTestId('arena-brief').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      if (battle) {
        await shot(page, `t${turn}-battle-brief`);
        await page.getByTestId('arena-fight').tap();
        await expect(page.getByTestId('arena-canvas')).toBeVisible({ timeout: 20_000 });
        await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120_000 });
        await shot(page, `t${turn}-battle`);
        await page.evaluate(() => window.__arena!.win());
        await expect(page.getByTestId('arena-continue')).toBeVisible({ timeout: 30_000 });
        await shot(page, `t${turn}-battle-verdict`);
        await page.getByTestId('arena-continue').tap();
        await expect(page.getByTestId('arena')).toHaveCount(0);
        fought = true;
      }
    }
    await shot(page, `t${turn}-orders`);
    await page.getByTestId('end-turn').tap();
    const commit = page.getByTestId('commit-turn');
    await expect(commit).toBeVisible();
    await shot(page, `t${turn}-review`);
    await commit.tap();
    if (await page.getByTestId('replay').isVisible({ timeout: 15_000 }).catch(() => false)) {
      await page.waitForTimeout(1500);
      await shot(page, `t${turn}-replay`);
      await page.getByTestId('skip-replay').tap({ timeout: 3000 }).catch(() => undefined);
    }
    const debrief = page.getByTestId('debrief');
    await expect(debrief).toBeVisible({ timeout: 90_000 });
    // The debrief stands alone over the dock: no decision card or chips stacked on it.
    await expect(page.getByTestId('command-card')).toHaveCount(0);
    debriefs.push((await debrief.textContent()) ?? '');
    await shot(page, `t${turn}-debrief`);
    if (turn === 1 || turn === 4) {
      await page.getByTestId('debrief-report').tap();
      await page.waitForTimeout(400);
      await shot(page, `t${turn}-report`);
      await page.getByTestId('close-report').tap();
    }
    if (await page.getByTestId('debrief-close').isVisible().catch(() => false)) await page.getByTestId('debrief-close').tap();
    if (await page.getByTestId('victory').isVisible().catch(() => false)) break;
  }
  await shot(page, 'end');
  // The operation was followed in the debrief while it ran.
  expect(debriefs.some((d) => d.includes('STORM BRIDGE') || /Storm Bridge/i.test(d))).toBe(true);
  expect(fought).toBe(true);
  expect(errors).toEqual([]);
});
