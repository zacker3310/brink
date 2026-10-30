import { expect, test, type Page } from '@playwright/test';

// The battle's resilience on an emulated phone: it draws nothing while nothing moves, survives a
// lost GPU context, comes back after a reload at the last committed order with nothing replayed or
// committed twice, offers nothing for a damaged save, and leaks nothing across rebuilds. WebGL runs
// in software here, so this checks behaviour, never a phone's performance (docs/device-testing.md).
// The long leak run (ten quality switches, ten battles) runs on request: ARENA_STABILITY=1.

test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const POINTER = 'brink.arena.snapshot.v1.skirmish';

async function setUp(page: Page) {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false, difficulty: 'easy', fastEnemy: true })));
  await page.reload();
}

async function ready(page: Page) {
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 600_000, polling: 250 });
}

async function openFirstBlood(page: Page) {
  await page.getByTestId('menu-skirmish').click();
  await page.getByTestId('skirmish-first-blood').click();
  await page.getByTestId('arena-fight').click();
  await ready(page);
}

/** The authoritative battle, as a string to compare (the event log aside: a save trims it). */
const battleKey = (page: Page) =>
  page.evaluate(() => {
    const b = window.__arena!.arena()!;
    return JSON.stringify({ units: b.units, stream: b.stream, round: b.round, turn: b.turn, turnIndex: b.turnIndex, stats: b.stats, intel: b.intel });
  });

const canvases = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-testid="arena-canvas"]').length);

/** Reload, then Resume Battle from the Skirmish menu: straight back into the fight. */
async function reloadAndResume(page: Page) {
  await page.reload();
  await page.getByTestId('menu-skirmish').click();
  await expect(page.getByTestId('skirmish-saved')).toBeVisible();
  await page.getByTestId('skirmish-resume').click();
  await ready(page);
  await expect(page.getByTestId('arena-brief')).toHaveCount(0);
}

test('a still battle draws nothing, and a lost GPU context brings it back intact', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setUp(page);
  await openFirstBlood(page);

  // Nothing moving: no frames at all.
  await page.waitForFunction(() => window.__arena!.perf()!.state === 'idle', null, { timeout: 120_000, polling: 250 });
  const still = (await page.evaluate(() => window.__arena!.perf()!.draws))!;
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__arena!.perf()!.draws)).toBe(still);

  // An order, then the context goes.
  await page.getByTestId('arena-do-it').click();
  await ready(page);
  const before = await battleKey(page);
  await page.evaluate(() => {
    const c = document.querySelector('[data-testid="arena-canvas"]') as HTMLCanvasElement;
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl'))!;
    (window as unknown as { lose: WEBGL_lose_context }).lose = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { lose: WEBGL_lose_context }).lose.loseContext();
  });
  await expect(page.getByTestId('arena-gpu')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__arena!.perf()!.state)).toBe('lost');
  const lostDraws = await page.evaluate(() => window.__arena!.perf()!.draws);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__arena!.perf()!.draws)).toBe(lostDraws);
  // The battle went on being the battle, and was saved as it stood.
  expect(await battleKey(page)).toBe(before);
  expect(await page.evaluate((k) => localStorage.getItem(k), POINTER)).not.toBeNull();

  // Given back: a new stage from the battle as it stands.
  await page.evaluate(() => (window as unknown as { lose: WEBGL_lose_context }).lose.restoreContext());
  await expect(page.getByTestId('arena-gpu')).toBeHidden({ timeout: 60_000 });
  await ready(page);
  expect(await battleKey(page)).toBe(before);
  expect(await canvases(page)).toBe(1);
  expect((await page.evaluate(() => window.__arena!.film()))!.steps).toBe(0);

  // Lost and never given back (some iOS): a new context after a moment.
  await page.evaluate(() => {
    const c = document.querySelector('[data-testid="arena-canvas"]') as HTMLCanvasElement;
    (c.getContext('webgl2') ?? c.getContext('webgl'))!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.getByTestId('arena-gpu')).toBeVisible();
  await expect(page.getByTestId('arena-gpu')).toBeHidden({ timeout: 120_000 });
  await ready(page);
  expect(await battleKey(page)).toBe(before);
  expect(await canvases(page)).toBe(1);

  // And it plays on.
  await page.getByTestId('arena-end-turn').click();
  await page.getByTestId('arena-end-now').click();
  await ready(page);
  await expect(page.getByTestId('arena-round')).toHaveText('2/16');
  expect(errors).toEqual([]);
});

test('a reload picks the battle up at the last order: in planning, after an order, during the enemy turn', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setUp(page);
  await openFirstBlood(page);

  // Planning: nothing ordered yet.
  let want = await battleKey(page);
  await reloadAndResume(page);
  expect(await battleKey(page)).toBe(want);

  // Straight after an order, its film still playing: it is in the save once, and not done again.
  await page.getByTestId('arena-do-it').click();
  want = await battleKey(page);
  await reloadAndResume(page);
  expect(await battleKey(page)).toBe(want);
  expect((await page.evaluate(() => window.__arena!.film()))!.steps).toBe(0);
  await page.waitForTimeout(2000);
  expect(await battleKey(page)).toBe(want);

  // During the enemy turn's film: the resolved turn, not replayed.
  await page.getByTestId('arena-end-turn').click();
  await page.getByTestId('arena-end-now').click();
  want = await battleKey(page);
  await reloadAndResume(page);
  expect(await battleKey(page)).toBe(want);
  await expect(page.getByTestId('arena-round')).toHaveText('2/16');
  expect((await page.evaluate(() => window.__arena!.film()))!.steps).toBe(0);
  await page.waitForTimeout(2000);
  expect(await battleKey(page)).toBe(want);

  // The battle ends: the save goes, and so does the GPU's memory.
  await page.evaluate(() => window.__arena!.win());
  await expect(page.getByTestId('arena-verdict')).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), POINTER)).toBeNull();
  expect(await canvases(page)).toBe(0);
  await page.getByTestId('arena-continue').click();
  await expect(page.getByTestId('skirmish')).toBeVisible();
  await expect(page.getByTestId('skirmish-saved')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a damaged, unknown or half-written save offers nothing and breaks nothing', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setUp(page);
  await openFirstBlood(page);
  await page.reload();
  const slot = (await page.evaluate((k) => localStorage.getItem(k), POINTER))!;
  const good = (await page.evaluate((s) => localStorage.getItem(s), slot))!;
  const other = slot.endsWith('.a') ? `${POINTER}.b` : `${POINTER}.a`;
  const offered = async () => {
    await page.reload();
    await page.getByTestId('menu-skirmish').click();
    await expect(page.getByTestId('skirmish')).toBeVisible();
    return page.getByTestId('skirmish-saved').count();
  };
  const put = (k: string, v: string) => page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [k, v]);

  // A save cut off half way into the other slot, before the pointer moved: the last good one stands.
  await put(other, good.slice(0, good.length >> 1));
  expect(await offered()).toBe(1);
  // One character changed in the body.
  const at = good.indexOf('"round":') + 8;
  await put(slot, `${good.slice(0, at)}7${good.slice(at + 1)}`);
  expect(await offered()).toBe(0);
  // Not a snapshot at all.
  await put(slot, '{"battle":');
  expect(await offered()).toBe(0);
  // A version from the future.
  await put(slot, good.replace(/^brink-arena-snapshot 1 /, 'brink-arena-snapshot 99 '));
  expect(await offered()).toBe(0);
  // A pointer at something else.
  await put(slot, good);
  expect(await offered()).toBe(1);
  await put(POINTER, 'brink.save.v1.Autosave');
  expect(await offered()).toBe(0);
  // The menu still starts a battle.
  await page.getByTestId('skirmish-first-blood').click();
  await expect(page.getByTestId('arena-brief')).toBeVisible();
  expect(errors).toEqual([]);
});

/** Uploaded geometries and textures, DOM nodes and canvases, for the leak checks. */
const counts = (page: Page) =>
  page.evaluate(() => {
    const p = window.__arena?.perf();
    return { geometries: p?.geometries ?? -1, textures: p?.textures ?? -1, nodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('canvas').length };
  });

async function switchQuality(page: Page, q: 'low' | 'balanced') {
  await page.getByTestId(`quality-${q}`).click();
  await page.waitForFunction((q) => window.__arena?.perf()?.quality === q && window.__arena.perf()!.state === 'idle', q, { timeout: 600_000, polling: 250 });
}

test('rebuilding the stage leaks nothing: quality switches come back to the same counts', async ({ page }) => {
  test.setTimeout(1_200_000);
  const runs = process.env.ARENA_STABILITY ? 10 : 4;
  await setUp(page);
  await openFirstBlood(page);
  await page.getByTestId('arena-pause').click();
  const seen: Record<string, Awaited<ReturnType<typeof counts>>> = {};
  for (let i = 0; i < runs; i++) {
    const q = i % 2 ? 'low' : 'balanced';
    await switchQuality(page, q);
    const c = await counts(page);
    if (seen[q]) expect(c, `switch ${i + 1} to ${q}`).toEqual(seen[q]);
    else seen[q] = c;
    expect(c.canvases).toBe(1);
  }
});

test('ten battles in one session leak nothing', async ({ page, context }) => {
  test.skip(!process.env.ARENA_STABILITY, 'set ARENA_STABILITY=1 for the long leak run');
  test.setTimeout(3_600_000);
  const cdp = await context.newCDPSession(page);
  const listeners = async (expr: string) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    const r = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
    return r.listeners.length;
  };
  await setUp(page);
  // Every skirmish open already, so the stars each win earns do not change the menu.
  await page.evaluate(() => localStorage.setItem('brink.career.v1', JSON.stringify({ battles: 0, wins: 0, stars: 99, best: {}, warsWon: [] })));
  await page.reload();
  await page.getByTestId('menu-skirmish').click();
  let base: { nodes: number; canvases: number; win: number; doc: number } | null = null;
  for (let i = 0; i < 10; i++) {
    await page.getByTestId('skirmish-first-blood').click();
    await page.getByTestId('arena-fight').click();
    await ready(page);
    await page.evaluate(() => window.__arena!.win());
    await page.getByTestId('arena-continue').click({ timeout: 120_000 });
    await expect(page.getByTestId('skirmish')).toBeVisible();
    const c = await counts(page);
    const now = { nodes: c.nodes, canvases: c.canvases, win: await listeners('window'), doc: await listeners('document') };
    if (base) expect(now, `after battle ${i + 1}`).toEqual(base);
    else base = now;
    expect(now.canvases).toBe(0);
  }
});
