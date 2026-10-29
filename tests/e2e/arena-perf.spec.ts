import { devices, expect, test } from '@playwright/test';

// Frame time on an emulated iPhone 13 (390 x 844 at DPR 3, CPU slowed 4x), at each quality, with
// the camera moving over a full company battle. WebGL here runs in software, so this measures our
// own JavaScript per frame (film, models, effects, draw submission), not the phone's GPU.

const { userAgent } = devices['iPhone 13'];
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

test('frame time on an emulated iPhone 13 at each quality', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('./');
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-first-blood').tap();
  await page.getByTestId('arena-fight').tap();
  await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const results: Record<string, unknown> = {};
  for (const q of ['low', 'balanced', 'high'] as const) {
    await page.getByTestId('arena-pause').tap();
    await page.getByTestId(`quality-${q}`).tap();
    await page.getByRole('button', { name: 'Resume' }).tap();
    await page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120_000 });
    // Sweep the camera across the field for a few seconds.
    const box = (await page.getByTestId('arena-canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + (i % 2 ? 120 : -120), cy - 160, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    results[q] = await page.evaluate(() => window.__arena!.perf());
  }
  console.log('frame time (ms of our work per frame, CPU 4x slower)', JSON.stringify(results));
  for (const r of Object.values(results) as { p95: number; frames: number }[]) expect(r.frames).toBeGreaterThan(30);
});
