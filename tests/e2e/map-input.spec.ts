import { devices, expect, test } from '@playwright/test';

// The war map's touch handling after a finger the map never heard lift. A sheet opening under a
// finger, an alert or the app going to the background can swallow a lift; the map used to keep that
// "ghost" finger forever, so every later touch became the second finger of a pinch: drags zoomed
// wildly and taps never registered. A new first touch must clear it.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

test('a finger the map never heard lift does not lock it into a pinch', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap({ timeout: 60_000 });
  await expect(page.getByTestId('turn')).toContainText('1/');

  const scale = () => page.evaluate(() => window.__brink!.scale());
  const before = await scale();

  // A ghost: a touch goes down on the map and its lift never arrives.
  await page.evaluate(() => {
    const c = document.querySelector('[data-testid="map-canvas"]')!;
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9001, pointerType: 'touch', isPrimary: true, clientX: r.left + 40, clientY: r.top + 300, bubbles: true }));
  });

  // A one-finger drag pans; it does not zoom.
  const mid = { x: viewport.width / 2, y: viewport.height / 2 - 60 };
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', mid.x, mid.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', mid.x + i * 12, mid.y + i * 6);
  await touch('touchEnd', mid.x + 96, mid.y + 48);
  expect(await scale()).toBeCloseTo(before, 5);

  // And a tap on one of your units selects it.
  const unit = await page.evaluate(() => {
    const b = window.__brink!;
    const f = b.formations().find((x) => x.cls === 'infantry')!;
    return b.hexToClient(f.key);
  });
  await page.touchscreen.tap(unit.x, unit.y);
  await expect(page.getByTestId('unit-panel')).toBeVisible();
});

test('city banners stay on their cities when the screen changes size under the map', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('nation-japan').tap();
  await page.getByTestId('crisis-none').tap();
  await page.getByTestId('start-game').tap();
  await page.getByTestId('how-to-close').tap({ timeout: 60_000 });
  // Nothing selected (a staff plan opens that way); deselect if a unit is up.
  if (await page.getByTestId('deselect').isVisible()) await page.getByTestId('deselect').tap();
  // Where Tokyo's banner sits relative to Tokyo's hex on the map canvas.
  const offset = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="city-japan-capital"]')!.getBoundingClientRect();
      return { x: el.left + el.width / 2, y: el.top };
    });
  const tokyo = () => page.evaluate(() => window.__brink!.siteToClient('japan-capital'));
  const before = await offset();
  const hexBefore = await tokyo();
  // The phone's toolbar slides away: the page grows under the map.
  await page.setViewportSize({ width: viewport.width, height: viewport.height + 80 });
  await page.waitForTimeout(400);
  const after = await offset();
  const hexAfter = await tokyo();
  expect(after.x - hexAfter.x).toBeCloseTo(before.x - hexBefore.x, 0);
  expect(after.y - hexAfter.y).toBeCloseTo(before.y - hexBefore.y, 0);
});
