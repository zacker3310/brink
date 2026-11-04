import { devices, expect, test } from '@playwright/test';
import { PACIFIC_ID } from '@brink/scenarios';
import { GameSession, serializeSave } from '@brink/session';
import { hashState, perkOffer } from '@brink/simulation';

// Generals on a phone: a promotion deals two perk cards, the roster lists every general, and a
// formation's card shows who leads it and posts a new one.
const { viewport, isMobile, hasTouch, userAgent } = devices['iPhone 14 Pro'];
// One device pixel per point: screenshots read as the layout, not the panel.
test.use({ viewport, deviceScaleFactor: 1, isMobile, hasTouch, userAgent });

const SHOTS = process.env.GENERALS_SHOTS;

/** A turn-2 campaign as the United States: one general leads an infantry formation and has a promotion waiting. */
function campaign(): { text: string; led: string } {
  const s = GameSession.create(PACIFIC_ID, 7, 'usa', [], { maxTurns: 20, difficulty: 'easy' });
  s.advance();
  const save = s.toSave('Slot 1', '2026-11-04T12:00:00Z');
  const w = save.world;
  const led = Object.keys(w.formations)
    .sort()
    .find((id) => w.formations[id]!.owner === 'usa' && w.formations[id]!.unitClass === 'infantry')!;
  const g = w.commanders!['usa-gen-1']!;
  Object.assign(g, { formation: led, xp: 8, level: 2, battles: 2, offer: { options: perkOffer(w.seed, w.turn - 1, g), turn: w.turn - 1, level: 2 } });
  save.hash = hashState(w);
  return { text: serializeSave(save), led };
}

test('a promotion, the roster and a formation’s general, by touch', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { text } = campaign();
  await page.addInitScript((save) => {
    if (localStorage.getItem('brink.save.v1.Slot 1')) return;
    localStorage.setItem('brink.prefs.v1', JSON.stringify({ staffPlan: false, animate: false }));
    localStorage.setItem('brink.save.v1.Slot 1', save);
    localStorage.setItem('brink.slots.v1', JSON.stringify([{ slot: 'Slot 1', label: 'Slot 1', turn: 2, nation: 'usa', savedAt: '2026-11-04T12:00:00Z' }]));
  }, text);
  await page.goto('./');
  await page.getByTestId('menu-continue').tap();

  // The promotion comes up on its own: two cards, the first picked until you choose.
  const promo = page.getByTestId('promotion');
  await expect(promo).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('perk-card-0')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('perk-card-1').tap();
  await expect(page.getByTestId('perk-card-1')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['perk-card-0', 'perk-card-1', 'confirm-perk', 'later-perk']) await expect(page.getByTestId(id)).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/promotion.png` });
  await page.getByTestId('confirm-perk').tap();
  await expect(promo).toHaveCount(0);

  // The roster: three generals, the promoted one marked as chosen.
  await page.getByTestId('open-command').tap();
  await page.getByTestId('tab-generals').tap();
  await expect(page.getByTestId('generals-roster')).toBeVisible();
  await expect(page.locator('[data-testid^="general-usa-gen-"]')).toHaveCount(3);
  await expect(page.getByTestId('promote-usa-gen-1')).toContainText('Perk chosen');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/roster.png` });

  // Show the general's formation: its card carries the commander row.
  await page.getByTestId('general-usa-gen-1').getByRole('button', { name: 'Show' }).tap();
  const card = page.getByTestId('commander-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Major General');
  await expect(page.getByTestId('relieve-general')).toContainText('Relieve');
  await expect(card).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/commander-card.png` });

  // Another formation: post a general from the reserve; it takes command as the turn resolves.
  await page.getByTestId('next-idle').tap();
  await expect(page.getByTestId('assign-general')).toBeVisible();
  await page.getByTestId('assign-general').tap();
  await page.getByTestId('general-option-usa-gen-2').tap();
  await expect(page.getByTestId('commander-card')).toContainText('Takes command');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assign.png` });
  // The engine accepts the plan: nothing is flagged in the order review.
  await page.getByTestId('end-turn').tap();
  await page.getByTestId('commit-turn').tap();
  await expect(page.getByTestId('turn')).toContainText('3/20', { timeout: 30_000 });
  await expect(page.getByTestId('debrief')).toBeVisible();
  expect(errors).toEqual([]);
});
