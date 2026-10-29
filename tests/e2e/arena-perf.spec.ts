import { devices, expect, test } from '@playwright/test';

// Frame time on an emulated iPhone 13 (390 x 844 at DPR 3, CPU slowed 4x), at each quality, with
// the camera moving over a full company battle. WebGL here runs in software, so this measures our
// own JavaScript per frame (film, models, effects, draw submission), not the phone's GPU.
// Several minutes a quality, so it runs only on request: ARENA_PERF=1 pnpm test:e2e arena-perf.

const { userAgent } = devices['iPhone 13'];
test.skip(!process.env.ARENA_PERF, 'set ARENA_PERF=1 to measure frame time');
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

for (const quality of ['low', 'balanced', 'high'] as const) {
  test(`frame time on an emulated iPhone 13, ${quality}`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.goto('./');
    await page.evaluate((q) => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: q, actionCams: true, radio: true })), quality);
    await page.getByTestId('menu-skirmish').tap();
    await page.getByTestId('skirmish-first-blood').tap();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.getByTestId('arena-fight').tap();
    await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 600_000 });
    const load = Date.now() - t0;
    // Measure play, not the load: let it settle, then sample while the camera pans across the field.
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__arena!.perf(true));
    const box = (await page.getByTestId('arena-canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + (i % 2 ? 100 : -100), cy - 120, { steps: 10 });
      await page.mouse.up();
    }
    await page.waitForTimeout(4000);
    const perf = (await page.evaluate(() => window.__arena!.perf()))!;
    console.log(`frame time ${quality}: load ${load} ms, ${JSON.stringify(perf)}`);
    expect(perf.quality).toBe(quality);
    expect(perf.frames).toBeGreaterThan(5);
  });
}
