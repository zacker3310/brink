import { devices, expect, test, type Page } from '@playwright/test';
import { auditScreen } from './a11y';

// What the battle shows of the enemy, on a 393 x 852 iPhone by touch: the Danger Area, air-defence
// rings for a helicopter, the facing glyph on a move being looked at, and last known positions.
// All of it is worked out from the player's own picture (the engine's insight.ts, whose unit tests
// mutate hidden enemies and check nothing changes); here the screen is checked to draw it.

const { userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

const insight = (page: Page) => page.evaluate(() => window.__arena!.overlay()!.insight);
const ready = (page: Page) => page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 600_000, polling: 500 });

/** The battle film run to its end with Skip, until it is your turn again (or it is over). */
async function settle(page: Page) {
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended)) return;
    const skip = page.getByTestId('arena-skip');
    if (await skip.isVisible().catch(() => false)) await skip.tap({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  throw new Error('the battle did not come back to your turn');
}

test('danger area, air defence, the facing glyph and last known positions', async ({ page }) => {
  test.setTimeout(2_400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false, difficulty: 'easy', fastEnemy: true }));
    // Desert Raid (Apaches against air defence) opens at 3 stars.
    localStorage.setItem('brink.career.v1', JSON.stringify({ battles: 0, wins: 0, stars: 99, best: {}, warsWon: [] }));
  });
  await page.reload();
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-desert-raid').tap();
  await page.getByTestId('arena-fight').tap();
  await ready(page);

  // Before contact the expected area is shaded, and nothing of the enemy is drawn.
  const start = await insight(page);
  expect(start.expected).toBeGreaterThan(0);
  expect(start.threat).toBe(0);
  expect(start.air).toBe(0);

  // Let the crews play until they see someone.
  const seen = () => page.evaluate(() => Object.values(window.__arena!.arena()!.intel.blue).filter((g) => g.now).length);
  for (let t = 0; t < 6 && (await seen()) === 0; t++) {
    await page.getByTestId('arena-pause').tap();
    await page.getByTestId('arena-auto').tap();
    await settle(page);
  }
  expect(await seen()).toBeGreaterThan(0);

  // Last known positions: one ghost drawn for each, and never more.
  const ghosts = await page.evaluate(() => Object.values(window.__arena!.arena()!.intel.blue).filter((g) => !g.now).length);
  expect((await insight(page)).ghosts).toBe(Math.min(64, ghosts));

  // Danger Area: on, it shades where the enemies you see could fire, and says for a moment what the
  // shading means (watched for as it appears: a software renderer can take longer than the moment).
  await page.evaluate(() => {
    const w = window as unknown as { __dangerNote?: boolean };
    w.__dangerNote = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="arena-danger-note"]')) w.__dangerNote = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId('cam-danger').tap();
  await expect(page.getByTestId('cam-danger')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction(() => (window as unknown as { __dangerNote?: boolean }).__dangerNote === true, null, { timeout: 30_000 });
  await expect.poll(async () => (await insight(page)).threat, { timeout: 60_000 }).toBeGreaterThan(0);
  const r = await auditScreen(page);
  expect(r.small, 'Danger Area: targets under 44 pt').toEqual([]);
  expect(r.low, 'Danger Area: text under 4.5:1').toEqual([]);
  // Easy shows what they would likely shoot, labelled as a prediction.
  const likely = (await insight(page)).likely;
  if (likely) await expect(page.locator('[data-testid^="place-likely-"]').first()).toHaveText('Likely');
  await page.getByTestId('cam-danger').tap();
  await expect.poll(async () => (await insight(page)).threat, { timeout: 60_000 }).toBe(0);

  // A helicopter selected: a ring for each seen enemy that can shoot at it, with the rules' chance, and a
  // question mark where air defence was seen before.
  const heli = await page.evaluate(() => window.__arena!.arena()!.units.find((u) => u.side === 'blue' && u.alive && !u.carrier && !u.acted && (u.type === 'ah64e' || u.type === 'ah6'))?.id ?? null);
  if (heli) {
    await page.getByTestId(`arena-unit-${heli}`).tap();
    await ready(page);
    const air = await insight(page);
    const chips = page.locator('[data-testid^="place-air-"]');
    await expect(chips).toHaveCount(air.air + air.suspected);
    for (const text of await chips.allTextContents()) expect(text).toMatch(/^AA (\d{1,2}%|\?)$/);
    // On overwatch, its footprint is drawn in your colour.
    const before = (await insight(page)).watch;
    await page.getByTestId('arena-overwatch').tap();
    await expect.poll(async () => (await insight(page)).watch, { timeout: 60_000 }).toBe(before + 1);
    await ready(page);
  }

  // A move looked at: the glyph on the card and at the cell, and what can hit it there.
  const tank = await page.evaluate(() => window.__arena!.arena()!.units.find((u) => u.side === 'blue' && u.alive && !u.carrier && !u.acted && !u.moved && (u.type === 'm1134' || u.type === 'stryker'))?.id ?? null);
  expect(tank).not.toBeNull();
  await page.getByTestId(`arena-unit-${tank}`).tap();
  await ready(page);
  const cell = await page.evaluate((id) => {
    const b = window.__arena!.arena()!;
    const u = b.units.find((x) => x.id === id)!;
    const top = document.querySelector('[data-testid="arena-header"]')!.getBoundingClientRect().bottom + 30;
    const bottom = document.querySelector('[data-testid="arena-footer"]')!.getBoundingClientRect().top - 30;
    for (const [dx, dy] of [[0, -3], [1, -3], [-1, -3], [2, -2], [-2, -2], [0, -2], [3, -1], [-3, -1], [1, -1], [-1, -1]] as const) {
      const x = u.x + dx;
      const y = u.y + dy;
      if (x < 0 || y < 0 || x >= b.map.w || y >= b.map.h || b.units.some((o) => o.alive && !o.carrier && o.x === x && o.y === y)) continue;
      const at = window.__arena!.toScreen(x, y);
      if (at.y > top && at.y < bottom && at.x > 20 && at.x < innerWidth - 70 && !document.elementFromPoint(at.x, at.y)?.closest('button')) return at;
    }
    return null;
  }, tank!);
  expect(cell).not.toBeNull();
  await page.touchscreen.tap(cell!.x, cell!.y);
  await expect(page.getByTestId('move-card')).toBeVisible();
  await expect(page.getByTestId('move-glyph')).toHaveAttribute('data-kind', 'hull');
  await expect.poll(async () => (await insight(page)).glyph, { timeout: 60_000 }).toMatch(/^hull/);
  const flanked = (await page.getByTestId('move-glyph').getAttribute('data-flanked')) === 'true';
  await expect(page.getByTestId('move-flank')).toHaveCount(flanked ? 1 : 0);
  const m = await auditScreen(page);
  expect(m.small, 'move card: targets under 44 pt').toEqual([]);
  expect(m.low, 'move card: text under 4.5:1').toEqual([]);
  await page.getByTestId('move-cancel').tap();
  await expect.poll(async () => (await insight(page)).glyph, { timeout: 60_000 }).toBeNull();

  expect(errors).toEqual([]);
});
