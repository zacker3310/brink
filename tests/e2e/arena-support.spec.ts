import { expect as expectNow, devices, test, type Page } from '@playwright/test';

// Off-map support from the war map (docs/arena-v2.md, section 14), in the Fire Support skirmish on a
// 6.1-inch iPhone: naval gunfire, the cruise missile, a strike sortie and the kamikaze swarm, each
// called on the enemy and caught mid-flight (the film held still by its test hook) for a look. The
// film never faults, every mission is spent once, and the field comes back to you each time.
// `SUPPORT_SHOTS=<dir>` also writes the frames there.

const { userAgent } = devices['iPhone 14 Pro'];
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent });

const LONG = 600_000;
const expect = expectNow.configure({ timeout: 120_000 });

const ready = (page: Page) => page.waitForFunction(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended, null, { timeout: LONG });

/** Hold the film still `seconds` from now and wait until it stands (a frame can take seconds here). */
async function holdAt(page: Page, seconds: number) {
  await page.evaluate((s) => window.__arena!.pauseFilm(s), seconds);
  let last = -1;
  for (let i = 0; i < 400; i++) {
    const c = await page.evaluate(() => window.__arena!.film()!.clock);
    if (c === last) return;
    last = c;
    await page.waitForTimeout(400);
  }
}

async function shot(page: Page, name: string) {
  const dir = process.env.SUPPORT_SHOTS;
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Call one off-map mission on the strongest red vehicle (or anyone left), with the film held at `stops` seconds into it. */
async function call(page: Page, id: string, stops: number[]) {
  await ready(page);
  const target = await page.evaluate(() => {
    const b = window.__arena!.arena()!;
    const red = b.units.filter((u) => u.side === 'red' && u.alive && !u.carrier);
    const v = red.find((u) => /t90|bmp|tunguska|msta/.test(u.type)) ?? red[0]!;
    return { x: v.x, y: v.y };
  });
  await page.getByTestId(`support-${id}`).tap();
  // The target on screen between the bars, so its cell can be tapped (the whole field if need be).
  let at = { x: -1, y: -1 };
  let toggled = 0;
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(() => window.__arena!.film()!.settled, null, { timeout: LONG });
    at = await page.evaluate(({ x, y }) => window.__arena!.toScreen(x, y), target);
    if (at.x > 20 && at.x < 330 && at.y > 130 && at.y < 560) break;
    await page.getByTestId('cam-overview').tap();
    toggled++;
  }
  if (process.env.SUPPORT_DEBUG) await shot(page, `${id}-aim`);
  await page.touchscreen.tap(at.x, at.y);
  if (process.env.SUPPORT_DEBUG) await shot(page, `${id}-card`);
  // Back to the close view the film plays in.
  if (toggled % 2) await page.getByTestId('cam-overview').tap();
  const flights = await page.evaluate(() => window.__arena!.film()!.flights);
  await page.getByTestId('arena-fire').tap({ timeout: 60_000 });
  // Step the film on a tenth at a time until the mission is in the air: stops count from its launch.
  for (let i = 0; i < 200 && (await page.evaluate(() => window.__arena!.film()!.flights)) === flights; i++) await holdAt(page, 0.1);
  let gone = 0.05;
  for (const [i, s] of stops.entries()) {
    await holdAt(page, s - gone);
    gone = s;
    console.log(id, s, JSON.stringify(await page.evaluate(() => { const f = window.__arena!.film()!; return { steps: f.steps, beats: f.beats, cam: f.cam, clock: f.clock }; })));
    await shot(page, `${id}-${i + 1}`);
  }
  await page.evaluate(() => window.__arena!.pauseFilm(null));
  await ready(page);
  expect(await page.evaluate(() => window.__arena!.film()!.faults), `${id}: film faults`).toBe(0);
  const left = await page.evaluate((sid) => window.__arena!.arena()!.support.find((s) => s.side === 'blue' && s.id === sid)?.missions ?? -1, id);
  return left;
}

test('naval gunfire, a cruise missile, a strike sortie and a kamikaze swarm fly in from the war map', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') console.log(`[page] ${m.text()}`);
  });
  await page.goto('./');
  await page.evaluate((quality) => {
    localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality, actionCams: true, motion: 'full', radio: false, difficulty: 'easy', fastEnemy: true, tips: false }));
    localStorage.setItem('brink.career.v1', JSON.stringify({ battles: 0, wins: 0, stars: 30, best: {}, warsWon: [] }));
  }, process.env.ARENA_QUALITY ?? 'balanced');
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-fire-support').tap();
  await expect(page.getByTestId('brief-support-strike_jet')).toBeVisible();
  await page.getByTestId('arena-fight').tap();
  await ready(page);
  expect(await call(page, 'naval_gun', [0.9, 2.5])).toBe(1);
  expect(await call(page, 'cruise_missile', [0.9, 1.6])).toBe(0);
  expect(await call(page, 'strike_jet', [1.0, 1.55])).toBe(1);
  expect(await call(page, 'kamikaze', [1.5, 2.4])).toBe(0);
  expect(errors).toEqual([]);
});
