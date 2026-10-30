import { devices, expect, test, type Page } from '@playwright/test';
import { auditScreen } from './a11y';
import { about, fingers, frames, type Pt } from './touch';

// The battle's touch gestures at the three iPhone sizes that matter (375 x 667, 393 x 852,
// 440 x 956): the two-finger solve, measured (two cells stay under two fingers through a twist, a
// pinch and a drag); the dead zones and locks (a small turn or spread moves nothing, two fingers
// side by side tilt, a second finger or a drag is never a tap); the north chip and the soft snap
// to a quarter turn; the long-press (a ring, then what the selected unit could see from a cell,
// your unit's full card, a seen enemy's card), and a hold is never a tap; taps on small cells
// snapping to the nearest cell the unit can move to, with a pin above the thumb; and the thumb
// layout (the footer's height, Fire, Move and Undo sizes, End Turn clear of Fire, the left hand).
// Every new screen is audited: 44-point targets, 4.5:1 text. Multi-touch is CDP synthetic input
// (touch.ts): it proves how the page reads a touch stream, not behaviour on iOS glass.

const SIZES = [
  { name: 'iPhone SE (375 x 667)', width: 375, height: 667 },
  { name: 'iPhone 15 (393 x 852)', width: 393, height: 852 },
  { name: 'iPhone 16 Pro Max (440 x 956)', width: 440, height: 956 },
];
const { userAgent } = devices['iPhone 14 Pro'];
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

async function audit(page: Page, where: string) {
  const r = await auditScreen(page);
  expect(r.small, `${where}: targets under 44 pt`).toEqual([]);
  expect(r.low, `${where}: text under 4.5:1`).toEqual([]);
}

const ready = (page: Page) => page.waitForFunction(() => window.__arena?.ready(), null, { timeout: 120_000 });
/**
 * Ready, then `n` more frames: `ready` allows the camera a hair of travel still (0.02 units, 0.1
 * degree), which is nothing to most checks but shows in a measurement to hundredths of a pixel.
 */
async function rest(page: Page, n = 2) {
  await ready(page);
  await frames(page, n);
}
/** Focus x y z, its target x y z, distance and target, tilt and target, heading and target. */
const camera = (page: Page) => page.evaluate(() => window.__arena!.film()!.camera);

/** The battle film run to its end with Skip, until it is your turn again (or it is over). */
async function settle(page: Page) {
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(() => !!window.__arena?.ready() || !!window.__arena?.arena()?.ended)) return;
    const skip = page.getByTestId('arena-skip');
    if (await skip.isVisible().catch(() => false)) await skip.tap({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  throw new Error('the battle did not come back to your turn');
}

/** Put away any long-press card or sheet. */
async function clear(page: Page) {
  for (let i = 0; i < 3 && (await page.getByTestId('peek-close').count()); i++) await page.getByTestId('peek-close').first().tap();
  await expect(page.locator('[data-testid="sight-card"], [data-testid="enemy-card"], [data-testid="unit-sheet"]')).toHaveCount(0);
}

/** How many points a cell spans at the selected unit, the smaller way. */
const cellSize = (page: Page) =>
  page.evaluate(() => {
    const a = window.__arena!;
    const u = a.arena()!.units.find((x) => x.id === a.overlay()!.selected)!;
    const p = a.toScreen(u.x, u.y);
    const q = a.toScreen(u.x + 1, u.y);
    const r = a.toScreen(u.x, u.y - 1);
    return Math.min(Math.hypot(q.x - p.x, q.y - p.y), Math.hypot(r.x - p.x, r.y - p.y));
  });

/** A cell the selected unit can move to, on the open field, clear of units, badges and buttons. */
const movableOnScreen = (page: Page) =>
  page.evaluate(() => {
    const a = window.__arena!;
    const b = a.arena()!;
    const w = b.map.w;
    const top = document.querySelector('[data-testid="arena-header"]')!.getBoundingClientRect().bottom + 30;
    const bottom = document.querySelector('[data-testid="arena-footer"]')!.getBoundingClientRect().top - 30;
    const sel = b.units.find((x) => x.id === a.overlay()!.selected)!;
    const units = b.units.filter((u) => u.alive && !u.carrier && (u.side === 'blue' || b.intel.blue[u.id]?.now)).map((u) => a.toScreen(u.x, u.y));
    const cells = a
      .reach()
      .map((i) => ({ x: i % w, y: Math.floor(i / w) }))
      .sort((p, q) => Math.hypot(p.x - sel.x, p.y - sel.y) - Math.hypot(q.x - sel.x, q.y - sel.y));
    for (const c of cells) {
      const s = a.toScreen(c.x, c.y);
      if (s.y < top || s.y > bottom || s.x < 30 || s.x > innerWidth - 30) continue;
      if (document.elementFromPoint(s.x, s.y)?.closest('button')) continue;
      // Clear of every unit's model and the badge over it, which take taps near them.
      if (units.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 50 || Math.hypot(p.x - s.x, p.y - 45 - s.y) < 55)) continue;
      return { x: c.x, y: c.y, s };
    }
    return null;
  });

/** The gap in points between two boxes (0 when they touch or overlap). */
function gap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });

    test('two-finger solve, dead zones and tilt, north chip, long-press, tap precision, thumb layout', async ({ page }) => {
      test.setTimeout(2_400_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('./');
      // Low quality and no action cams: the test machine renders WebGL in software.
      await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false, difficulty: 'easy', fastEnemy: true, leftHanded: false })));
      await page.getByTestId('menu-skirmish').tap();
      await page.getByTestId('skirmish-first-blood').tap();
      await page.getByTestId('arena-fight').tap();
      await rest(page, 25);
      const f = await fingers(page);
      const note = (type: string, description: string) => {
        test.info().annotations.push({ type, description: `${size.name}: ${description}` });
        console.log(`${size.name} ${type}: ${description}`);
      };

      await test.step('#22 the bottom card stays low', async () => {
        const footer = (await page.getByTestId('arena-footer').boundingBox())!;
        note('footer', `${Math.round(footer.height)} pt with the unit card, ${Math.round((footer.height / size.height) * 100)}% of the screen`);
        if (size.height === 852) expect(footer.height).toBeLessThanOrEqual(size.height * 0.3);
      });

      await test.step('#1 two cells stay under two fingers through a twist, a pinch and a drag', async () => {
        const pair = await page.evaluate(() => {
          const a = window.__arena!;
          const u = a.arena()!.units.find((x) => x.id === a.overlay()!.selected)!;
          const top = document.querySelector('[data-testid="arena-header"]')!.getBoundingClientRect().bottom + 40;
          const bottom = document.querySelector('[data-testid="arena-footer"]')!.getBoundingClientRect().top - 40;
          const ok = (p: { x: number; y: number }) => p.y > top && p.y < bottom && p.x > 40 && p.x < innerWidth - 80;
          for (let dy = -4; dy <= 2; dy++)
            for (let d = 1; d <= 4; d++) {
              const A = { x: u.x - d, y: u.y + dy };
              const B = { x: u.x + d, y: u.y + dy - 1 };
              const sa = a.toScreen(A.x, A.y);
              const sb = a.toScreen(B.x, B.y);
              if (ok(sa) && ok(sb) && Math.hypot(sa.x - sb.x, sa.y - sb.y) > 110) return { A, B, sa, sb };
            }
          return null;
        });
        expect(pair, 'two cells on the open field').not.toBeNull();
        const { A, B, sa, sb } = pair!;
        const steps = 30;
        const turn = rad(50);
        const errs: number[] = [];
        let lag = 0;
        await f.down(sa, sb);
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const [pa, pb] = about(sa, sb, turn * t, Math.pow(1.5, t), { x: 30 * t, y: -20 * t });
          await f.move(pa, pb);
          await frames(page, 2);
          const [qa, qb] = await page.evaluate(({ A, B }) => [window.__arena!.toScreen(A.x, A.y), window.__arena!.toScreen(B.x, B.y)], { A, B });
          const err = Math.max(Math.hypot(qa!.x - pa.x, qa!.y - pa.y), Math.hypot(qb!.x - pb.x, qb!.y - pb.y));
          // Past twice the dead zones (24 degrees, 10% apart) the map has caught up with the fingers.
          if (deg(turn * t) >= 24.5 && Math.pow(1.5, t) >= 1.105) errs.push(err);
          else lag = Math.max(lag, err);
        }
        const held = deg((await camera(page))[10]!);
        await f.up();
        const sorted = [...errs].sort((x, y) => x - y);
        const max = sorted.at(-1)!;
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
        note('anchoring', `max ${max.toFixed(2)} px, p95 ${p95.toFixed(2)} px over ${errs.length} steps after the catch-up (most lag inside the dead zones ${lag.toFixed(1)} px)`);
        expect(errs.length).toBeGreaterThan(10);
        expect(max).toBeLessThanOrEqual(4);
        // Fingers turned clockwise turn the map clockwise.
        expect(held).toBeGreaterThan(30);

        // #3 Let go within 10 degrees of a quarter turn and the view settles on it.
        await rest(page);
        const now = deg((await camera(page))[10]!);
        const quarter = Math.round(held / 90) * 90;
        if (Math.abs(held - quarter) <= 10) expect(Math.abs(now - quarter)).toBeLessThan(0.5);
        else expect(Math.abs(now - held)).toBeLessThan(0.5);
        note('snap', `released at ${held.toFixed(1)} deg, settled at ${now.toFixed(1)} deg`);
      });

      await test.step('#3 the north chip shows while the view is turned and brings north back up', async () => {
        await expect(page.getByTestId('cam-north')).toBeVisible();
        await audit(page, 'north chip');
        await page.getByTestId('cam-north').tap();
        await rest(page);
        expect(Math.abs(deg((await camera(page))[10]!))).toBeLessThan(0.5);
        await expect(page.getByTestId('cam-north')).toHaveCount(0);
        // Back out from the pinch to about the playing distance.
        await page.getByTestId('cam-unit').tap();
        await rest(page);
        for (let i = 0; i < 3 && (await cellSize(page)) > 110; i++) {
          await page.getByTestId('cam-out').tap();
          await rest(page);
        }
      });

      await test.step('#2 dead zones: a small turn and spread move nothing; side by side up and down tilts', async () => {
        const box = (await page.getByTestId('arena-canvas').boundingBox())!;
        const head = (await page.getByTestId('arena-header').boundingBox())!;
        const foot = (await page.getByTestId('arena-footer').boundingBox())!;
        const c: Pt = { x: box.width / 2, y: (head.y + head.height + foot.y) / 2 };
        const a: Pt = { x: c.x - 80, y: c.y };
        const b: Pt = { x: c.x + 80, y: c.y };
        const c0 = await camera(page);
        // A pinch of 3% with a 6 degree turn, then a twist of 8 degrees alone.
        await f.down(a, b);
        for (let k = 1; k <= 6; k++) await f.move(...about(a, b, rad(6) * (k / 6), Math.pow(1.03, k / 6)));
        await f.up();
        await f.down(a, b);
        for (let k = 1; k <= 6; k++) await f.move(...about(a, b, rad(-8) * (k / 6), 1));
        await f.up();
        await rest(page);
        const c1 = await camera(page);
        note('dead zones', `heading moved ${deg(c1[10]! - c0[10]!).toFixed(2)} deg, distance ${(((c1[6]! - c0[6]!) / c0[6]!) * 100).toFixed(2)}%`);
        expect(Math.abs(deg(c1[10]! - c0[10]!))).toBeLessThan(1.5);
        expect(Math.abs(c1[6]! / c0[6]! - 1)).toBeLessThan(0.03);
        // Two fingers side by side sliding up together tilt toward the horizon, and back down.
        await f.down(a, b);
        for (let k = 1; k <= 8; k++) await f.move({ x: a.x, y: a.y - 7 * k }, { x: b.x, y: b.y - 7 * k });
        await f.up();
        await rest(page);
        const c2 = await camera(page);
        expect(deg(c2[8]!)).toBeLessThan(deg(c1[8]!) - 5);
        expect(Math.abs(deg(c2[10]! - c1[10]!))).toBeLessThan(1);
        await f.down(a, b);
        for (let k = 1; k <= 8; k++) await f.move({ x: a.x, y: a.y + 7 * k }, { x: b.x, y: b.y + 7 * k });
        await f.up();
        await rest(page);
        expect(Math.abs(deg((await camera(page))[8]!) - deg(c1[8]!))).toBeLessThan(1);
      });

      await test.step('#2 a second finger, or a drag past 10 points, is never a tap', async () => {
        await page.getByTestId('cam-unit').tap();
        await rest(page);
        const R = await movableOnScreen(page);
        expect(R, 'a cell the unit can move to, on screen').not.toBeNull();
        await f.down(R!.s);
        await f.down(R!.s, { x: R!.s.x + 110, y: R!.s.y });
        await f.up();
        await frames(page, 4);
        await expect(page.getByTestId('move-card')).toHaveCount(0);
        // A slow frame can let the first finger rest long enough for a long-press: no order either way.
        await clear(page);
        await rest(page);
        const S = await movableOnScreen(page);
        await f.down(S!.s);
        await f.move({ x: S!.s.x + 14, y: S!.s.y });
        await f.move(S!.s);
        await f.up();
        await frames(page, 4);
        await expect(page.getByTestId('move-card')).toHaveCount(0);
        await clear(page);
      });

      await test.step('#21 on small cells a tap just off a cell the unit can move to takes that cell, and a pin marks it', async () => {
        await page.getByTestId('cam-unit').tap();
        await rest(page);
        for (let i = 0; i < 6 && (await cellSize(page)) > 30; i++) {
          await page.getByTestId('cam-out').tap();
          await rest(page);
        }
        const cell = await cellSize(page);
        note('small cells', `${cell.toFixed(1)} pt a cell`);
        expect(cell).toBeLessThan(44);
        const plan = await page.evaluate(() => {
          const a = window.__arena!;
          const b = a.arena()!;
          const w = b.map.w;
          const legal = a.reach();
          const has = new Set(legal);
          const top = document.querySelector('[data-testid="arena-header"]')!.getBoundingClientRect().bottom + 30;
          const bottom = document.querySelector('[data-testid="arena-footer"]')!.getBoundingClientRect().top - 30;
          const units = b.units.filter((u) => u.alive && !u.carrier).map((u) => a.toScreen(u.x, u.y));
          const at = (i: number) => a.toScreen(i % w, Math.floor(i / w));
          for (const i of legal) {
            const R = { x: i % w, y: Math.floor(i / w) };
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const N = { x: R.x + dx, y: R.y + dy };
              if (N.x < 0 || N.y < 0 || N.x >= w || N.y >= b.map.h || has.has(N.y * w + N.x)) continue;
              const sr = a.toScreen(R.x, R.y);
              const sn = a.toScreen(N.x, N.y);
              const span = Math.hypot(sn.x - sr.x, sn.y - sr.y);
              if (span > 32 || span < 12) continue;
              // Most of the way into the cell it cannot go to, still within 22 points of the one it can.
              const tap = { x: sr.x + (sn.x - sr.x) * 0.62, y: sr.y + (sn.y - sr.y) * 0.62 };
              const d = Math.hypot(sr.x - tap.x, sr.y - tap.y);
              if (d > 20 || tap.y < top || tap.y > bottom || tap.x < 30 || tap.x > innerWidth - 30) continue;
              if (document.elementFromPoint(tap.x, tap.y)?.closest('button')) continue;
              if (units.some((p) => Math.hypot(p.x - tap.x, p.y - tap.y) < 50)) continue;
              if (legal.some((j) => j !== i && Math.hypot(at(j).x - tap.x, at(j).y - tap.y) <= d)) continue;
              return { R, N, tap, d };
            }
          }
          return null;
        });
        expect(plan, 'a cell at the edge of the move area, on screen').not.toBeNull();
        await page.touchscreen.tap(plan!.tap.x, plan!.tap.y);
        await expect(page.getByTestId('move-card')).toBeVisible();
        await expect(page.getByTestId('move-pin')).toHaveAttribute('data-at', `${plan!.R.x},${plan!.R.y}`);
        note('snap', `tap ${plan!.d.toFixed(1)} pt from cell ${plan!.R.x},${plan!.R.y}, inside ${plan!.N.x},${plan!.N.y}: the move card is for ${plan!.R.x},${plan!.R.y}`);
        // The pin's head stands clear above the thumb.
        await frames(page, 2);
        const pin = (await page.getByTestId('move-pin').boundingBox())!;
        expect(pin.height).toBeGreaterThanOrEqual(60);
        expect(pin.y).toBeLessThan(plan!.tap.y - 50);
        // #22 Move takes 48 to 56 points.
        const move = (await page.getByTestId('arena-move').boundingBox())!;
        expect(move.height).toBeGreaterThanOrEqual(48);
        expect(move.height).toBeLessThanOrEqual(56);
        if (size.height === 852) expect((await page.getByTestId('arena-footer').boundingBox())!.height).toBeLessThanOrEqual(size.height * 0.3);
        await audit(page, 'move card');
        await page.getByTestId('move-cancel').tap();
        await page.getByTestId('cam-unit').tap();
        await rest(page);
      });

      await test.step('#4 a long-press on a cell shows what the unit could see from it, and is never a tap', async () => {
        const R = await movableOnScreen(page);
        expect(R).not.toBeNull();
        await page.evaluate(() => {
          delete document.body.dataset.ring;
          new MutationObserver(() => {
            if (document.querySelector('[data-testid="arena-hold"]')) document.body.dataset.ring = '1';
          }).observe(document.querySelector('[data-testid="arena"]')!, { childList: true });
        });
        await f.down(R!.s);
        await expect(page.getByTestId('sight-card')).toBeVisible({ timeout: 30_000 });
        await f.up();
        expect(await page.evaluate(() => document.body.dataset.ring), 'the ring filled first').toBe('1');
        await expect(page.getByTestId('move-card')).toHaveCount(0);
        await expect(page.getByTestId('sight-summary')).toBeVisible();
        await audit(page, 'sight card');
        await page.getByTestId('peek-close').tap();
        await rest(page);
      });

      await test.step('#4 a long-press on a unit of yours opens its full card', async () => {
        const me = await page.evaluate(() => {
          const a = window.__arena!;
          const u = a.arena()!.units.find((x) => x.id === a.overlay()!.selected)!;
          return a.toScreen(u.x, u.y);
        });
        await f.down({ x: me.x, y: me.y - 8 });
        await expect(page.getByTestId('unit-sheet')).toBeVisible({ timeout: 30_000 });
        await f.up();
        await expect(page.getByTestId('unit-sheet')).toContainText('Range');
        await expect(page.getByTestId('unit-sheet')).toContainText('Turret front');
        await audit(page, 'unit sheet');
        await page.getByTestId('peek-close').tap();
        await clear(page);
      });

      await test.step('#22 Undo takes 48 to 56 points', async () => {
        await rest(page);
        const R = await movableOnScreen(page);
        const id = await page.evaluate(() => window.__arena!.overlay()!.selected!);
        await page.touchscreen.tap(R!.s.x, R!.s.y);
        await expect(page.getByTestId('move-card')).toBeVisible();
        await page.getByTestId('arena-move').tap();
        await expect.poll(() => page.evaluate((uid) => window.__arena!.arena()!.units.find((u) => u.id === uid)!.moved, id), { timeout: 30_000 }).toBe(true);
        await rest(page);
        const undo = (await page.getByTestId('arena-undo').boundingBox())!;
        expect(undo.height).toBeGreaterThanOrEqual(48);
        expect(undo.height).toBeLessThanOrEqual(56);
        expect(undo.width).toBeGreaterThanOrEqual(48);
        await page.getByTestId('arena-undo').tap();
        await rest(page);
      });

      await test.step('#22 Left-Handed puts the camera buttons and End Turn on the left', async () => {
        await page.getByTestId('arena-pause').tap();
        await page.getByTestId('setting-leftHanded').tap();
        await expect(page.getByTestId('setting-leftHanded')).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('button', { name: 'Resume' }).tap();
        await rest(page);
        expect((await page.getByTestId('cam-in').boundingBox())!.x).toBeLessThan(size.width / 2);
        expect((await page.getByTestId('arena-end-turn').boundingBox())!.x).toBeLessThan((await page.getByTestId('arena-units').boundingBox())!.x);
        await audit(page, 'left-handed');
      });

      await test.step('#4 a long-press on a seen enemy shows its card; #22 Fire stands clear of End Turn', async () => {
        // Let the crews close in until the enemy is seen.
        let enemy: string | null = null;
        for (let round = 0; round < 6 && !enemy; round++) {
          enemy = await page.evaluate(() => {
            const b = window.__arena!.arena()!;
            return b.units.find((u) => u.side === 'red' && u.alive && !u.carrier && b.intel.blue[u.id]?.now)?.id ?? null;
          });
          if (enemy) break;
          await page.getByTestId('arena-pause').tap();
          await page.getByTestId('arena-auto').tap();
          await settle(page);
          if (await page.evaluate(() => !!window.__arena!.arena()!.ended)) break;
        }
        expect(enemy, 'an enemy seen within six rounds').not.toBeNull();
        await rest(page);
        if (await page.getByTestId(`pointer-${enemy}`).isVisible().catch(() => false)) {
          await page.getByTestId(`pointer-${enemy}`).tap();
          await rest(page);
        }
        const at = await page.evaluate((id) => {
          const u = window.__arena!.arena()!.units.find((x) => x.id === id)!;
          return window.__arena!.toScreen(u.x, u.y);
        }, enemy!);
        await f.down({ x: at.x, y: at.y - 8 });
        await expect(page.getByTestId('enemy-card')).toBeVisible({ timeout: 30_000 });
        await f.up();
        await expect(page.getByTestId('enemy-card')).toContainText('as seen');
        await audit(page, 'enemy card');
        await page.getByTestId('peek-close').tap();
        await clear(page);

        // A shot to aim: a unit of ours with a target, then its best shot.
        let shooter = false;
        const order = await page.evaluate(() => window.__arena!.arena()!.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier && !u.acted).map((u) => u.id));
        for (const id of order.slice(0, 6)) {
          await page.getByTestId(`arena-unit-${id}`).tap();
          await ready(page);
          if ((await page.evaluate(() => window.__arena!.overlay()!.targets)) > 0) {
            shooter = true;
            break;
          }
        }
        if (!shooter) {
          note('fire', 'no unit had a target this round: Fire not measured');
          return;
        }
        await page.getByTestId('arena-best').tap();
        await expect(page.getByTestId('shot-card')).toBeVisible();
        const fire = (await page.getByTestId('arena-fire').boundingBox())!;
        const end = (await page.getByTestId('arena-end-turn').boundingBox())!;
        expect(fire.height).toBeGreaterThanOrEqual(48);
        expect(fire.height).toBeLessThanOrEqual(56);
        note('fire', `Fire ${Math.round(fire.height)} pt tall, ${gap(fire, end).toFixed(1)} pt from End Turn`);
        expect(gap(fire, end)).toBeGreaterThanOrEqual(24);
        await audit(page, 'shot card, left-handed');
      });

      expect(errors).toEqual([]);
    });
  });
}
