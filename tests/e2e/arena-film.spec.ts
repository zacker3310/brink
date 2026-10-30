import { createHash } from 'node:crypto';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

// The battle film only plays the event log back: it decides nothing. The same seeded battle, each turn
// played by the crews' own advice, ends in the same state, byte for byte, whether every film is skipped,
// watched at normal speed with action cams, zipped and fast-forwarded with Skip held, or watched with
// reduced motion while the camera is moved about. And the film never stalls: no faults, and every turn
// comes back to you. Along the way: never more than four words on screen, and a skipped turn lands on a
// round report that waits for Done.

const { userAgent } = devices['iPhone 14 Pro'];
const ROUNDS = 2;

type How = 'skip' | 'watch' | 'zip' | 'camera';

const SETTINGS: Record<How, object> = {
  skip: { fastEnemy: true, actionCams: false, motion: 'full', shake: 100 },
  watch: { fastEnemy: false, actionCams: true, motion: 'full', shake: 100 },
  zip: { fastEnemy: true, actionCams: true, motion: 'full', shake: 100 },
  camera: { fastEnemy: false, actionCams: true, motion: 'reduced', shake: 40 },
};

async function backToYou(page: Page, how: How) {
  const skip = page.getByTestId('arena-skip');
  for (let i = 0; i < 1200; i++) {
    if (await page.evaluate(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended)) return;
    // Software WebGL draws a frame in seconds: tap without waiting for the button to hold still.
    if (how === 'skip' && (await skip.isVisible().catch(() => false))) await skip.tap({ timeout: 30_000, force: true }).catch(() => undefined);
    if (how === 'camera' && i % 4 === 0) {
      // Zoom, the whole field and back, and a drag across the field, while the film plays.
      for (const id of ['cam-in', 'cam-overview', 'cam-overview', 'cam-out']) await page.getByTestId(id).tap({ timeout: 30_000, force: true }).catch(() => undefined);
      await page.mouse.move(200, 420);
      await page.mouse.down();
      await page.mouse.move(150, 470, { steps: 4 });
      await page.mouse.up();
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${how}: the battle did not come back to your turn`);
}

async function play(browser: Browser, how: How): Promise<{ hash: string; words: number; faults: number }> {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate((s) => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', radio: false, difficulty: 'easy', ...s })), SETTINGS[how]);
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-first-blood').tap();
  await page.getByTestId('arena-fight').tap();
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 180_000 });
  // Count the words on screen every frame.
  await page.evaluate(() => {
    const w = window as unknown as { __words: number };
    w.__words = 0;
    const look = () => {
      const n = [...document.querySelectorAll<HTMLElement>('[data-testid="arena-callout"]')].filter((e) => e.style.display !== 'none').length;
      w.__words = Math.max(w.__words, n);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  for (let r = 0; r < ROUNDS; r++) {
    if (await page.evaluate(() => !!window.__arena!.arena()!.ended)) break;
    await page.getByTestId('arena-pause').tap({ timeout: 60_000 });
    await page.getByTestId('arena-auto').tap({ timeout: 60_000 });
    if (how === 'zip') {
      // Hold Skip down: the turn plays four times as fast while it is held, and letting go skips nothing.
      const skip = page.getByTestId('arena-skip');
      await skip.waitFor({ timeout: 30_000 });
      const box = (await skip.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(skip).toHaveText('Fast-Forward', { timeout: 10_000 });
      await page.waitForFunction(() => window.__arena!.ready() || !!window.__arena!.arena()!.ended || !document.querySelector('[data-testid="arena-skip"]'), null, { timeout: 600_000 });
      await page.mouse.up();
    }
    await backToYou(page, how);
    expect(await page.evaluate(() => window.__arena!.film()!.faults), `${how}: film faults`).toBe(0);
    if (how === 'skip' && !(await page.evaluate(() => !!window.__arena!.arena()!.ended))) {
      // A skipped turn lands on the round report, which waits for Done.
      const report = page.getByTestId('arena-report');
      await expect(report).toBeVisible();
      await expect(page.getByTestId('arena-report-summary')).not.toBeEmpty();
      await page.waitForTimeout(3000);
      await expect(report).toBeVisible();
      await page.getByTestId('arena-report-close').tap({ timeout: 30_000, force: true });
      await expect(report).toBeHidden();
    }
  }
  const json = await page.evaluate(() => JSON.stringify(window.__arena!.arena()));
  const words = await page.evaluate(() => (window as unknown as { __words: number }).__words);
  const faults = await page.evaluate(() => window.__arena!.film()!.faults);
  expect(errors, `${how}: page errors`).toEqual([]);
  await context.close();
  return { hash: createHash('sha256').update(json).digest('hex'), words, faults };
}

test('the film decides nothing: skipped, watched, zipped or moved about, the battle ends the same', async ({ browser }) => {
  test.setTimeout(3_600_000);
  const runs: Partial<Record<How, { hash: string; words: number; faults: number }>> = {};
  for (const how of ['skip', 'watch', 'zip', 'camera'] as const) {
    runs[how] = await play(browser, how);
    test.info().annotations.push({ type: how, description: `sha256 ${runs[how]!.hash}, most words on screen ${runs[how]!.words}, faults ${runs[how]!.faults}` });
    console.log(`arena film ${how}: sha256 ${runs[how]!.hash} words ${runs[how]!.words} faults ${runs[how]!.faults}`);
  }
  const hashes = new Set(Object.values(runs).map((r) => r.hash));
  expect(hashes.size, JSON.stringify(runs)).toBe(1);
  for (const r of Object.values(runs)) {
    expect(r.faults).toBe(0);
    expect(r.words).toBeLessThanOrEqual(4);
  }
});
