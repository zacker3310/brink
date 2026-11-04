import { expect as expectNow, devices, test, type Page } from '@playwright/test';

// The rest of the off-map film (docs/arena-v2.md, section 14.1), each case flown on purpose through
// the `support` test hook (it searches the seeded stream for the roll it wants): the enemy's Su-34,
// Kalibr and Geran-2 swarm brought down by your Gepard or Stinger, the Su-34 and the Kalibr getting
// through, the Tornado-G ripple on your company, your HIMARS pair diving onto a vehicle, and your
// F-35A and Tomahawk knocking one out under the action cam. Each is caught mid-flight (`__arena.pauseFilm`) for a
// look; the film never faults and the field comes back to you each time.
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
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

type Id = 'himars' | 'tornado' | 'naval_gun' | 'cruise_missile' | 'strike_jet' | 'kamikaze';

/** Fly one mission for `side` at a cell, the film held at `stops` seconds after it is launched. */
async function fly(page: Page, name: string, side: 'blue' | 'red', id: Id, at: { x: number; y: number }, want: 'intercept' | 'land' | 'kill' | undefined, stops: number[]): Promise<boolean> {
  // `SORTIES=red-su34-down,blue-himars` flies only those (a quicker look while working on one).
  const only = process.env.SORTIES?.split(',');
  if (only && !only.includes(name)) return true;
  await ready(page);
  const flights = await page.evaluate(() => window.__arena!.film()!.flights);
  // Hold the film before it starts, so the stops count from the launch.
  await page.evaluate(() => window.__arena!.pauseFilm(0));
  const ok = await page.evaluate(({ side, id, at, want }) => window.__arena!.support(side, id, at.x, at.y, want), { side, id, at, want });
  if (!ok) {
    await page.evaluate(() => window.__arena!.pauseFilm(null));
    console.log(name, 'no roll found');
    return false;
  }
  for (let i = 0; i < 200 && (await page.evaluate(() => window.__arena!.film()!.flights)) === flights; i++) await holdAt(page, 0.1);
  let gone = 0.05;
  for (const [i, s] of stops.entries()) {
    await holdAt(page, s - gone);
    gone = s;
    console.log(name, s, JSON.stringify(await page.evaluate((at) => { const f = window.__arena!.film()!; return { steps: f.steps, beats: f.beats, cam: f.cam, clock: f.clock, focus: f.camera.slice(0, 6), aim: window.__arena!.toScreen(at.x, at.y) }; }, at)));
    await shot(page, `${name}-${i + 1}`);
  }
  await page.evaluate(() => window.__arena!.pauseFilm(null));
  await ready(page);
  expect(await page.evaluate(() => window.__arena!.film()!.faults), `${name}: film faults`).toBe(0);
  return true;
}

/** Where a unit of a type stands (the first alive one), or null. */
function where(page: Page, side: 'blue' | 'red', re: string) {
  return page.evaluate(({ side, re }) => {
    const u = window.__arena!.arena()!.units.find((v) => v.side === side && v.alive && !v.carrier && new RegExp(re).test(v.type));
    return u ? { x: u.x, y: u.y } : null;
  }, { side, re });
}

test('the enemy flies its Su-34, Kalibr, Geran-2 and Tornado-G at you; your HIMARS and F-35A answer', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate((quality) => {
    localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality, actionCams: true, motion: 'full', radio: false, difficulty: 'easy', fastEnemy: true, tips: false }));
    localStorage.setItem('brink.career.v1', JSON.stringify({ battles: 0, wins: 0, stars: 30, best: {}, warsWon: [] }));
  }, process.env.ARENA_QUALITY ?? 'balanced');
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-fire-support').tap();
  await page.getByTestId('arena-fight').tap();
  await ready(page);

  const gepard = (await where(page, 'blue', '^gepard$'))!;
  const stinger = (await where(page, 'blue', '^stinger$'))!;
  const tank = (await where(page, 'blue', '^m1a2$'))!;
  expect(gepard && stinger && tank).toBeTruthy();

  // Brought down by your air defence: the gun (or the Stinger) is yours, so it is drawn firing.
  expect(await fly(page, 'red-su34-down', 'red', 'strike_jet', gepard, 'intercept', [0.8, 1.45, 1.75, 2.3])).toBe(true);
  expect(await fly(page, 'red-kalibr-down', 'red', 'cruise_missile', gepard, 'intercept', [1.0, 1.6, 1.95])).toBe(true);
  expect(await fly(page, 'red-geran-down', 'red', 'kamikaze', stinger, 'intercept', [2.2, 2.6, 2.9])).toBe(true);
  // Getting through.
  expect(await fly(page, 'red-su34-bombs', 'red', 'strike_jet', tank, 'land', [0.9, 1.45, 1.95, 2.6])).toBe(true);
  expect(await fly(page, 'red-kalibr-hits', 'red', 'cruise_missile', tank, 'land', [1.2, 1.75])).toBe(true);
  expect(await fly(page, 'red-tornado', 'red', 'tornado', tank, undefined, [0.9, 1.45, 1.75])).toBe(true);

  // Yours on theirs: the HIMARS pair (a cut to the launch, then the dive onto the cell).
  const red = (await where(page, 'red', 't90|bmp|tunguska|msta'))!;
  expect(await fly(page, 'blue-himars', 'blue', 'himars', red, undefined, [0.6, 1.5, 1.85])).toBe(true);
  expect(errors).toEqual([]);
});

test('an F-35A run and a Tomahawk that knock out a T-90M you can see play under the action cam', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate((quality) => {
    localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality, actionCams: true, motion: 'full', radio: false, difficulty: 'easy', fastEnemy: true, tips: false }));
    localStorage.setItem('brink.career.v1', JSON.stringify({ battles: 0, wins: 0, stars: 30, best: {}, warsWon: [] }));
  }, process.env.ARENA_QUALITY ?? 'balanced');
  // The Crossing: two T-90Ms are in sight from the start.
  await page.getByTestId('menu-skirmish').tap();
  await page.getByTestId('skirmish-crossing').tap();
  await page.getByTestId('arena-fight').tap();
  await ready(page);
  const seen = () =>
    page.evaluate(() => {
      const b = window.__arena!.arena()!;
      const u = b.units.find((v) => v.side === 'red' && v.alive && !v.carrier && /t90|t72|t80|bmp/.test(v.type) && b.intel.blue[v.id]?.now);
      return u ? { x: u.x, y: u.y } : null;
    });
  const first = await seen();
  expect(first, 'a vehicle in sight').toBeTruthy();
  expect(await fly(page, 'blue-f35-kill', 'blue', 'strike_jet', first!, 'kill', [0.9, 1.5, 2.1, 2.7])).toBe(true);
  const next = await seen();
  if (next) expect(await fly(page, 'blue-tomahawk-kill', 'blue', 'cruise_missile', next, 'kill', [0.8, 1.5, 1.85])).toBe(true);
  expect(errors).toEqual([]);
});
