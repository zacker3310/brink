import { expect as expectNow, devices, test, type Page } from '@playwright/test';
import { auditScreen } from './a11y';

// The battle's turn flow on a 6.1-inch iPhone (393 x 852), by touch: Next with its count, Hold,
// the End Turn sheet with each ready unit's best option, Reset Turn and its limits, the shot
// card's outcome bar, the battle log, a tip from the board, the after-action grade, and orders
// that commit once however fast they are tapped. Every new screen is audited.

const { userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent });

/** The test machine renders WebGL in software: every wait is on the battle, never a fixed sleep. */
const LONG = 600_000;
/** A frame can take seconds there, and the page answers between frames: assertions wait that long. */
const expect = expectNow.configure({ timeout: 120_000 });

async function start(page: Page, difficulty: 'easy' | 'normal' | 'hard', settings: Record<string, unknown> = {}) {
  await page.goto('./');
  await page.evaluate((s) => {
    localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false, difficulty: 'easy', fastEnemy: true, ...s }));
    localStorage.removeItem('brink.arena.tips.v1');
  }, settings);
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-first-blood').tap();
  await page.getByTestId(`difficulty-${difficulty}`).tap();
  await page.getByTestId('arena-fight').tap();
  await ready(page);
}

const ready = (page: Page) => page.waitForFunction(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended, null, { timeout: LONG });

/** The film run to its end with Skip, until it is your turn again (or it is over). */
async function settle(page: Page) {
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended)) return;
    const skip = page.getByTestId('arena-skip');
    if (await skip.isVisible().catch(() => false)) await skip.tap({ timeout: 60_000 }).catch(() => undefined);
    await page.waitForFunction(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended, null, { timeout: 2000 }).catch(() => undefined);
  }
  throw new Error('the battle did not come back to your turn');
}

async function audit(page: Page, where: string) {
  const r = await auditScreen(page);
  expect(r.small, `${where}: targets under 44 pt`).toEqual([]);
  expect(r.low, `${where}: text under 4.5:1`).toEqual([]);
}

const unitState = (page: Page, id: string) => page.evaluate((i) => window.__arena!.arena()!.units.find((u) => u.id === i)!, id);
const readyIds = (page: Page) => page.evaluate(() => window.__arena!.arena()!.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier && !u.acted).map((u) => u.id));

/** Hold the selected unit from its card (Hold sits under More). */
async function holdSelected(page: Page) {
  if (!(await page.getByTestId('arena-hold').isVisible())) await page.getByTestId('arena-more').tap();
  await page.getByTestId('arena-hold').tap();
}

/** Let the crews play turns until one of yours has a target; returns it, or null if the battle ends. */
async function closeIn(page: Page): Promise<string | null> {
  for (let round = 0; round < 7; round++) {
    const order = await page.evaluate(() => {
      const b = window.__arena!.arena()!;
      const seen = b.units.filter((u) => u.side === 'red' && u.alive && b.intel.blue[u.id]?.now);
      const d = (u: { x: number; y: number }) => (seen.length ? Math.min(...seen.map((e) => Math.hypot(e.x - u.x, e.y - u.y))) : 99);
      return seen.length ? b.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier && !u.acted).sort((p, q) => d(p) - d(q)).slice(0, 4).map((u) => u.id) : [];
    });
    for (const id of order) {
      await page.getByTestId(`arena-unit-${id}`).tap();
      await ready(page);
      if ((await page.evaluate(() => window.__arena!.overlay()!.targets)) > 0) return id;
    }
    await page.getByTestId('arena-pause').tap();
    await page.getByTestId('arena-auto').tap();
    await settle(page);
    if (await page.evaluate(() => !!window.__arena!.arena()!.ended)) return null;
  }
  return null;
}

test('Next, Hold, the End Turn sheet and Reset Turn on Easy; End Turn commits once', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page, 'easy');

  // Next: how many are left of how many, and it moves on to the next ready unit.
  const next = page.getByTestId('arena-next');
  await expect(next).toContainText(/\d+ of \d+ Left/);
  const [left, of] = (await next.innerText()).match(/(\d+) of (\d+)/)!.slice(1).map(Number);
  expect(left).toBe(of);
  await audit(page, 'field with Next');
  const first = await page.evaluate(() => window.__arena!.overlay()!.selected);
  await next.tap();
  await ready(page);
  const second = await page.evaluate(() => window.__arena!.overlay()!.selected);
  expect(second).not.toBe(first);
  expect(await readyIds(page)).toContain(second);

  // Hold marks it done without a roll; Undo takes it back.
  const stream = await page.evaluate(() => (window.__arena!.arena() as unknown as { stream: number }).stream);
  await holdSelected(page);
  await expect.poll(async () => (await unitState(page, second!)).acted).toBe(true);
  expect(await page.evaluate(() => (window.__arena!.arena() as unknown as { stream: number }).stream)).toBe(stream);
  await expect(next).toContainText(`${left! - 1} of ${of} Left`);
  await page.getByTestId('arena-undo').tap();
  await expect.poll(async () => (await unitState(page, second!)).acted).toBe(false);
  await ready(page);

  // End Turn with units ready: the sheet names each with its best option, Do It and Hold.
  await page.getByTestId('arena-end-turn').tap();
  await expect(page.getByTestId('arena-end-confirm')).toBeVisible();
  await expect(page.locator('[data-testid^="end-do-"]').first()).toBeVisible({ timeout: LONG });
  expect(await page.locator('[data-testid^="end-unit-"]').count()).toBe(left);
  await expect(page.getByTestId('arena-reset')).toBeDisabled();
  await expect(page.getByTestId('arena-reset-note')).toHaveText('Nothing to reset: no orders yet this turn.');
  await audit(page, 'end turn sheet');

  // Hold two from the sheet; Reset Turn takes both back.
  const [a, b] = (await readyIds(page)).slice(-2);
  await page.getByTestId(`end-hold-${a}`).tap();
  await expect.poll(async () => (await unitState(page, a!)).acted).toBe(true);
  await page.getByTestId(`end-hold-${b}`).tap();
  await expect.poll(async () => (await unitState(page, b!)).acted).toBe(true);
  await expect(page.getByTestId(`end-unit-${a}`)).toHaveCount(0);
  await expect(page.getByTestId('arena-reset-note')).toHaveText('Takes back the last 2 orders, which drew no dice and showed nothing.');
  await page.getByTestId('arena-reset').tap();
  await expect.poll(async () => [(await unitState(page, a!)).acted, (await unitState(page, b!)).acted]).toEqual([false, false]);
  await expect(page.getByTestId('arena-end-confirm')).toHaveCount(0);
  await ready(page);

  // Do It from the sheet plays that unit's advice.
  await page.getByTestId('arena-end-turn').tap();
  const doIt = page.locator('[data-testid^="end-do-"]').first();
  await expect(doIt).toBeVisible({ timeout: LONG });
  const doer = (await doIt.getAttribute('data-testid'))!.replace('end-do-', '');
  await doIt.tap();
  await expect.poll(async () => { const u = await unitState(page, doer); return u.moved || u.acted || !u.alive; }, { timeout: LONG }).toBe(true);

  // Two taps on End Turn Now in one go end one turn, not two.
  await ready(page);
  const sheet = page.getByTestId('arena-end-confirm');
  if (!(await sheet.isVisible())) await page.getByTestId('arena-end-turn').tap();
  await expect(page.getByTestId('arena-end-now')).toBeVisible();
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="arena-end-now"]')!;
    el.click();
    el.click();
  });
  await settle(page);
  await expect(page.getByTestId('arena-round')).toHaveText('2/16');
  expect(await page.evaluate(() => (window.__arena!.arena() as unknown as { turnIndex: number }).turnIndex)).toBe(2);
  expect(errors).toEqual([]);
});

test('Normal: one reset a battle, then greyed with the reason; with the sheet off End Turn ends at once', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page, 'normal', { endSheet: false });
  expect(await page.evaluate(() => window.__arena!.arena()!.difficulty)).toBe('normal');

  const id = (await page.evaluate(() => window.__arena!.overlay()!.selected))!;
  await holdSelected(page);
  await expect.poll(async () => (await unitState(page, id)).acted).toBe(true);
  await page.getByTestId('arena-pause').tap();
  await expect(page.getByTestId('menu-reset')).toBeEnabled();
  await expect(page.getByTestId('menu-reset-note')).toHaveText('Takes back the last order, which drew no dice and showed nothing (once a battle on Normal).');
  await page.getByTestId('menu-reset').tap();
  await expect.poll(async () => (await unitState(page, id)).acted).toBe(false);
  await ready(page);

  // Used: the next one is greyed, and says why.
  await page.getByTestId(`arena-unit-${id}`).tap();
  await ready(page);
  await holdSelected(page);
  await expect.poll(async () => (await unitState(page, id)).acted).toBe(true);
  await page.getByTestId('arena-pause').tap();
  await expect(page.getByTestId('menu-reset')).toBeDisabled();
  await expect(page.getByTestId('menu-reset-note')).toHaveText('Reset Turn is used: Normal allows one a battle.');
  await audit(page, 'menu with Reset Turn');
  await page.getByRole('button', { name: 'Resume' }).tap();
  await ready(page);

  // Units still ready, the sheet switched off: End Turn ends it there and then.
  expect((await readyIds(page)).length).toBeGreaterThan(0);
  await page.getByTestId('arena-end-turn').tap();
  await expect(page.getByTestId('arena-end-confirm')).toHaveCount(0);
  await settle(page);
  await expect(page.getByTestId('arena-round')).toHaveText('2/16');
  expect(errors).toEqual([]);
});

test('a tip from the board, the outcome bar, Fire once, the battle log and the after-action grade', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page, 'easy');

  // Call fire on a cell nobody of yours can see: the board raises the blind-fire tip, once.
  const mortar = await page.evaluate(() => window.__arena!.arena()!.units.find((u) => u.side === 'blue' && u.type === 'mortar_w' && !u.carrier)?.id ?? null);
  expect(mortar).not.toBeNull();
  await page.getByTestId(`arena-unit-${mortar}`).tap();
  await ready(page);
  await page.getByTestId('cam-overview').tap();
  await ready(page);
  await page.getByTestId('arena-strike').tap();
  // Far cells in woods or behind buildings first: the likeliest to be out of everyone's sight.
  const cells = await page.evaluate((id) => {
    const b = window.__arena!.arena()! as unknown as { units: { id: string; side: string; x: number; y: number; alive: boolean; carrier: string | null }[]; map: { w: number; h: number; cells: number[] } };
    const m = b.units.find((u) => u.id === id)!;
    const blue = b.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier);
    const top = document.querySelector('[data-testid="arena-header"]')!.getBoundingClientRect().bottom + 16;
    const bottom = document.querySelector('[data-testid="arena-footer"]')!.getBoundingClientRect().top - 16;
    const out: { x: number; y: number; at: { x: number; y: number }; score: number }[] = [];
    for (let y = 0; y < b.map.h; y++)
      for (let x = 0; x < b.map.w; x++) {
        const d = Math.hypot(x - m.x, y - m.y);
        if (d > 25 || d < 3) continue;
        const at = window.__arena!.toScreen(x, y);
        const over = document.elementFromPoint(at.x, at.y);
        if (at.y < top || at.y > bottom || at.x < 16 || at.x > innerWidth - 64 || over?.closest('button')) continue;
        if (b.units.some((u) => u.alive && Math.abs(u.x - x) <= 1 && Math.abs(u.y - y) <= 1)) continue;
        const near = Math.min(...blue.map((u) => Math.hypot(u.x - x, u.y - y)));
        out.push({ x, y, at, score: near + (b.map.cells[y * b.map.w + x] === 2 ? 8 : 0) });
      }
    return out.sort((p, q) => q.score - p.score).slice(0, 8);
  }, mortar);
  let blind: (typeof cells)[number] | null = null;
  for (const c of cells) {
    await page.touchscreen.tap(c.at.x, c.at.y);
    await expect(page.getByTestId('shot-card')).toBeVisible();
    if ((await page.getByTestId('shot-card').innerText()).includes('Nobody sees it')) {
      blind = c;
      break;
    }
  }
  expect(blind, 'a cell out of sight of every unit of yours, within mortar range').not.toBeNull();
  const tip = page.getByTestId('arena-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('data-kind', 'blind');
  await expect(tip).toContainText('Firing Blind');
  await audit(page, 'tip');
  await page.getByTestId('arena-tip-dismiss').tap();
  await expect(tip).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('brink.arena.tips.v1'))).toContain('blind');
  // Once ever: the same mistake again raises nothing.
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await page.touchscreen.tap(blind!.at.x, blind!.at.y);
  await expect(page.getByTestId('shot-card')).toBeVisible();
  await expect(page.getByTestId('arena-tip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await page.getByTestId('arena-strike').tap();
  await page.getByTestId('cam-overview').tap();

  // The shot card: an outcome bar that adds to 100 with a word for the gist, the exact numbers beside it.
  const shooter = await closeIn(page);
  expect(shooter, 'a unit with a target within seven rounds').not.toBeNull();
  await page.getByTestId('arena-best').tap();
  await expect(page.getByTestId('shot-card')).toBeVisible();
  await expect(page.getByTestId('shot-outcomes')).toBeVisible();
  const chance = Number((await page.getByTestId('shot-chance').innerText()).replace('%', ''));
  const legend = await page.getByTestId('shot-outcomes').locator('li').allInnerTexts();
  const shares = legend.map((t) => Number(t.match(/(\d+)%/)![1]));
  expect(shares.reduce((s, v) => s + v, 0)).toBe(100);
  const miss = legend.find((t) => t.startsWith('Miss'));
  if (!legend.some((t) => t.startsWith('Intercepted'))) expect(Number(miss?.match(/(\d+)%/)?.[1] ?? 0)).toBe(100 - chance);
  await expect(page.getByTestId('shot-band')).toHaveText(/^(Sure Kill|Likely Kill|Sure Hit|Likely Hit|Even Odds|Likely Bounce|Long Shot|Slim Chance)$/);
  await expect(page.getByTestId('shot-numbers')).toContainText(/hit|down/);
  await audit(page, 'shot card');

  // Two taps on Fire in one go fire one shot.
  const shots = await page.evaluate(() => window.__arena!.arena()!.stats.blue.shots);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="arena-fire"]')!;
    el.click();
    el.click();
  });
  await expect.poll(() => page.evaluate(() => window.__arena!.arena()!.stats.blue.shots)).toBe(shots + 1);
  await settle(page);
  expect(await page.evaluate(() => window.__arena!.arena()!.stats.blue.shots)).toBe(shots + 1);

  // The battle log: that shot at its chance, newest first, by round, and filters.
  await page.getByTestId('arena-pause').tap();
  await page.getByTestId('menu-log').tap();
  const log = page.getByTestId('arena-log');
  await expect(log).toBeVisible();
  await expect(page.getByTestId('log-line').first()).toContainText(`${chance}%`);
  const round = await page.evaluate(() => window.__arena!.arena()!.round);
  await expect(log.locator('h3').first()).toHaveText(`Round ${round}`);
  await audit(page, 'battle log');
  await page.getByTestId('log-filter-mine').tap();
  expect(await page.getByTestId('log-line').count()).toBeGreaterThan(0);
  expect(new Set(await page.getByTestId('log-line').evaluateAll((els) => els.map((e) => e.getAttribute('data-side'))))).toEqual(new Set(['blue']));
  await page.getByTestId('log-filter-theirs').tap();
  for (const side of await page.getByTestId('log-line').evaluateAll((els) => els.map((e) => e.getAttribute('data-side')))) expect(side).toBe('red');
  await page.getByTestId('arena-log-close').tap();
  await expect(log).toHaveCount(0);

  // The round report links to the log too.
  if (!(await page.evaluate(() => !!window.__arena!.arena()!.ended))) {
    // The report shows for a few seconds, and a tap through the software renderer can take longer:
    // its link is clicked the moment it shows.
    await expect(page.getByTestId('arena-report-log')).toHaveCount(0);
    await page.evaluate(() => {
      const watch = new MutationObserver(() => {
        const link = document.querySelector<HTMLElement>('[data-testid="arena-report-log"]');
        if (!link) return;
        watch.disconnect();
        link.click();
      });
      watch.observe(document.body, { childList: true, subtree: true });
    });
    const waiting = (await readyIds(page)).length;
    await page.getByTestId('arena-end-turn').tap();
    if (waiting) await page.getByTestId('arena-end-now').tap();
    await expect(log).toBeVisible({ timeout: LONG });
    await page.getByTestId('arena-log-close').tap();
    await settle(page);
  }

  // The verdict grades the battle and names the round that turned it.
  await page.evaluate(() => window.__arena!.win());
  await expect(page.getByTestId('arena-grades')).toBeVisible({ timeout: LONG });
  for (const k of ['speed', 'power', 'technique']) await expect(page.getByTestId(`grade-${k}`)).toContainText(/[SABC]/);
  await expect(page.getByTestId('arena-turning')).toHaveText(/^(Round \d+ (turned it|went against you)|No round turned it)/);
  await audit(page, 'verdict');
  expect(errors).toEqual([]);
});
