import { devices, expect, test, type Page } from '@playwright/test';

// The front door: the title's menu and wire, Settings that stick, Quick Battle straight into the
// arena, the campaign briefing's leader and the deploy screen, the installable app's manifest, and
// the investor demo (?demo=1) playing through to its end card on its own.

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('the title offers the guided turn first, then the campaign, a quick battle and the rest', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const ids = await page.locator('[data-testid^="menu-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids).toEqual(['menu-tutorial', 'menu-new', 'menu-quick', 'menu-skirmish', 'menu-load', 'menu-manual', 'menu-settings']);
  await expect(page.getByTestId('home-wire')).toContainText('Live');
  await expect(page.getByTestId('wordmark')).toHaveText('Brink');
  // The installable app: a manifest with icons and launch shortcuts.
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(['./?quick=1', './?continue=1']);
  expect(errors).toEqual([]);
});

test('settings change sound, battle quality, motion and haptics, and they stick', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('set-sound-off').click();
  await page.getByTestId('set-quality-low').click();
  await page.getByTestId('set-motion-reduced').click();
  await page.getByTestId('set-haptics-off').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const stored = await page.evaluate(() => ({ arena: JSON.parse(localStorage.getItem('brink.arena.settings.v1')!), prefs: JSON.parse(localStorage.getItem('brink.prefs.v1')!) }));
  expect(stored.arena).toMatchObject({ quality: 'low', motion: 'reduced', haptics: false });
  expect(stored.prefs.muted).toBe(true);

  // A reload keeps them; Esc goes home.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.getByTestId('home-sound')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('set-quality-low')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('set-sound-off')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('set-motion-full').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'reduced');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('wordmark')).toBeVisible();
  expect(errors).toEqual([]);
});

test('quick battle goes straight from the title to the battle brief', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: false, radio: false })));
  await page.keyboard.press('3');
  await expect(page.getByTestId('arena-fight')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('body')).toContainText('First Blood');
  expect(errors).toEqual([]);
});

test('the campaign briefing names your commander, and a deploy screen covers the build', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('leader-name')).toHaveText('Adm. Grace Halloran');
  await page.getByTestId('nation-russia').click();
  await expect(page.getByTestId('leader-name')).toHaveText('Gen. Arkady Volkov');
  // The deploy screen may come and go faster than a poll: note it the moment it appears.
  await page.evaluate(() => {
    const w = window as unknown as { sawDeploy?: boolean };
    new MutationObserver((_, o) => {
      if (document.querySelector('[data-testid="deploying"]')) {
        w.sawDeploy = true;
        o.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('top-bar')).toContainText('Russia', { timeout: 30_000 });
  await expect(page.getByTestId('deploying')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { sawDeploy?: boolean }).sawDeploy)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test('the whole title menu fits the screen, every target a thumb wide', async ({ page }) => {
    await page.goto('./');
    for (const id of ['menu-tutorial', 'menu-new', 'menu-quick', 'menu-skirmish', 'menu-load', 'menu-manual', 'menu-settings']) {
      const el = page.getByTestId(id);
      await expect(el).toBeInViewport({ ratio: 1 });
      expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // The logo and the menu never overlap.
    const logo = (await page.getByTestId('wordmark').boundingBox())!;
    const first = (await page.getByTestId('menu-tutorial').boundingBox())!;
    expect(logo.y + logo.height).toBeLessThan(first.y);
  });

  test('the guided first turn by touch: tap a hex, PLAN, end the turn, watch, done', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    const coach = page.getByTestId('coach');
    const at = (id: string, timeout = 20_000) => expect(coach).toHaveAttribute('data-step', id, { timeout });
    await page.goto('./');
    await page.getByTestId('menu-tutorial').tap();
    await at('move', 30_000);
    await expect(page.getByTestId('coach-action')).toHaveText('Tap a blue hex to move there');
    // The coach sits clear of the dock: End Turn and Plan stay in reach.
    for (const id of ['end-turn', 'auto-command']) await expect(page.getByTestId(id)).toBeInViewport();
    // A blue hex the finger can reach: on the map, not under a card.
    const p = await page.evaluate(() => {
      const b = window.__brink!;
      // A hex with your own unit on it selects that unit instead.
      const occupied = new Set(b.formations().map((f) => f.key));
      return b
        .reachable()
        .filter((k) => !occupied.has(k))
        .map((k) => b.hexToClient(k))
        .find((q) => q.x > 24 && q.x < innerWidth - 24 && document.elementFromPoint(q.x, q.y)?.tagName === 'CANVAS')!;
    });
    expect(p).toBeTruthy();
    await page.touchscreen.tap(p.x, p.y);
    await at('plan');
    await expect(page.getByTestId('coach-action')).toHaveText('Tap PLAN');
    await page.getByTestId('auto-command').tap();
    await at('end');
    await expect(page.getByTestId('coach-action')).toHaveText('Tap EXECUTE, then COMMIT');
    await page.getByTestId('end-turn').tap();
    await page.getByTestId('commit-turn').tap();
    await at('watch');
    await page
      .getByTestId('skip-replay')
      .tap({ timeout: 5000 })
      .catch(() => undefined);
    await at('done', 60_000);
    await page.getByTestId('coach-next').tap();
    await expect(coach).toHaveCount(0);
    await expect(page.getByTestId('turn')).toContainText('2/20');
    expect(errors).toEqual([]);
  });
});

test('the investor demo plays the title, a turn and a strike on its own, then ends on a card', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('brink.arena.settings.v1', JSON.stringify({ quality: 'low', actionCams: true, radio: false, tips: false })));
  await page.goto('./?demo=1&fast=1');
  await expect(page.getByTestId('demo-caption')).toBeVisible();
  // The film runs on its own to the end card, which lists every step it showed, in order.
  await expect(page.getByTestId('demo-end')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('demo-end')).toHaveAttribute('data-seen', 'title campaign operation resolve battle strike end');
  await expect(page.getByTestId('top-bar')).toBeAttached();
  await page.getByTestId('demo-play').click();
  await expect(page.getByTestId('wordmark')).toBeVisible();
  await expect(page.getByTestId('demo-caption')).toHaveCount(0);
  expect(errors).toEqual([]);
});
