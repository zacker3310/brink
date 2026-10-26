import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Two humans in one room over the local transport (BroadcastChannel between two tabs), then a
// hotseat round on one device. Online play uses the same room code over WebRTC.

function watchErrors(page: Page, into: string[]) {
  page.on('pageerror', (e) => into.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') into.push(m.text());
  });
}

test('host and guest play a turn together', async ({ context }) => {
  const errors: string[] = [];
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.goto('./?net=local');
  await host.getByTestId('menu-multiplayer').click();
  await host.getByTestId('mp-name').fill('Alpha');
  await host.getByTestId('mp-host').click();
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // The invite link opens the join form with the code filled in.
  const guest = await context.newPage();
  watchErrors(guest, errors);
  await guest.goto(`./?net=local&join=${code}`);
  await expect(guest.getByTestId('mp-code')).toHaveValue(code);
  await guest.getByTestId('mp-name').fill('Bravo');
  await guest.getByTestId('mp-join').click();
  await guest.getByTestId('claim-korva').click();
  await expect(host.getByTestId('seats')).toContainText('Bravo');
  await expect(guest.getByTestId('seats')).toContainText('Alpha');

  await host.getByTestId('mp-start').click();
  await expect(host.getByTestId('top-bar')).toContainText('Aster Commonwealth');
  await expect(guest.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(guest.getByTestId('room-chip')).toContainText(code);

  // Comms: the guest's line reaches the host.
  await guest.getByTestId('open-chat').click();
  await guest.getByTestId('chat-input').fill('see you at Vessa');
  await guest.getByTestId('chat-input').press('Enter');
  await host.getByTestId('open-chat').click();
  await expect(host.getByTestId('chat')).toContainText('see you at Vessa');
  await host.getByTestId('chat-input').press('Escape');

  // The guest locks first; the host sees it, then locks, and the turn resolves for both.
  await guest.getByTestId('end-turn').click();
  await expect(host.getByTestId('seat-board')).toContainText('1/2 locked');
  await host.getByTestId('end-turn').click();
  await expect(host.getByTestId('turn')).toContainText('2 / 30', { timeout: 15000 });
  await expect(guest.getByTestId('turn')).toContainText('2 / 30', { timeout: 15000 });
  await expect(guest.getByTestId('top-bar')).toContainText('Korva Directorate');

  // The guest's turn summary is its own: its report, from its own seat.
  await guest.getByTestId('open-report').click();
  await expect(guest.getByTestId('report')).toContainText('Turn 1 resolved');

  expect(errors).toEqual([]);
});

test('hotseat passes the device between players behind a curtain', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.goto('./');
  await page.getByTestId('menu-multiplayer').click();
  await page.getByTestId('mp-hotseat').click();

  await expect(page.getByTestId('curtain')).toContainText('Aster Commonwealth');
  await page.getByTestId('reveal').click();
  await expect(page.getByTestId('top-bar')).toContainText('Aster Commonwealth');
  await page.getByTestId('end-turn').click();

  await expect(page.getByTestId('curtain')).toContainText('Korva Directorate');
  await page.getByTestId('reveal').click();
  await expect(page.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(page.getByTestId('turn')).toContainText('1 / 30');
  await page.getByTestId('end-turn').click();

  // Back to the first seat with the turn resolved.
  await expect(page.getByTestId('curtain')).toContainText('Aster Commonwealth');
  await expect(page.getByTestId('reveal')).toBeEnabled();
  await page.getByTestId('reveal').click();
  await expect(page.getByTestId('top-bar')).toContainText('Aster Commonwealth');
  await expect(page.getByTestId('turn')).toContainText('2 / 30', { timeout: 15000 });

  expect(errors).toEqual([]);
});

async function room(context: BrowserContext, errors: string[], setup?: (host: Page) => Promise<void>) {
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.goto('./?net=local');
  await host.getByTestId('menu-multiplayer').click();
  await host.getByTestId('mp-name').fill('Alpha');
  await host.getByTestId('mp-host').click();
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  const guest = await context.newPage();
  watchErrors(guest, errors);
  await guest.goto(`./?net=local&join=${code}`);
  await guest.getByTestId('mp-name').fill('Bravo');
  await guest.getByTestId('mp-join').click();
  await guest.getByTestId('claim-korva').click();
  await expect(host.getByTestId('seats')).toContainText('Bravo');
  if (setup) await setup(host);
  await host.getByTestId('mp-start').click();
  await expect(guest.getByTestId('top-bar')).toContainText('Korva Directorate', { timeout: 15000 });
  return { host, guest, code };
}

test('the planning timer locks every draft and moves the world when it runs out', async ({ context }) => {
  const errors: string[] = [];
  await context.clock.install();
  const { host, guest } = await room(context, errors, async (h) => {
    await h.getByTestId('timer-60').click();
  });
  await expect(guest.getByTestId('turn-clock')).toContainText(/0:5\d|1:00/);
  await context.clock.fastForward('01:05');
  await expect(host.getByTestId('turn')).toContainText('2 / 30', { timeout: 15000 });
  await expect(guest.getByTestId('turn')).toContainText('2 / 30', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('a dropped seat goes to the AI and back to its player', async ({ context }) => {
  const errors: string[] = [];
  const { host, guest, code } = await room(context, errors);
  await guest.close({ runBeforeUnload: true });
  await expect(host.getByTestId('seat-board')).toContainText('offline');
  await host.getByTestId('hand-to-ai-korva').click();
  await expect(host.getByTestId('seat-board')).toContainText('AI holds');
  // With the seat in AI hands, the host's lock alone moves the world.
  await host.getByTestId('end-turn').click();
  await expect(host.getByTestId('turn')).toContainText('2 / 30', { timeout: 15000 });

  const back = await context.newPage();
  watchErrors(back, errors);
  await back.goto(`./?net=local&join=${code}`);
  await back.getByTestId('mp-name').fill('Bravo');
  await back.getByTestId('mp-join').click();
  await expect(back.getByTestId('top-bar')).toContainText('Korva Directorate');
  await expect(back.getByTestId('turn')).toContainText('2 / 30');
  await expect(host.getByTestId('seat-board')).toContainText('planning');
  expect(errors).toEqual([]);
});

test('private channels: a whisper reaches its target and nobody else, even the host', async ({ context }) => {
  const errors: string[] = [];
  const host = await context.newPage();
  watchErrors(host, errors);
  await host.goto('./?net=local');
  await host.getByTestId('menu-multiplayer').click();
  await host.getByTestId('mp-name').fill('Alpha');
  await host.getByTestId('mp-host').click();
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  const join = async (name: string, nation: string) => {
    const p = await context.newPage();
    watchErrors(p, errors);
    await p.goto(`./?net=local&join=${code}`);
    await p.getByTestId('mp-name').fill(name);
    await p.getByTestId('mp-join').click();
    await p.getByTestId(`claim-${nation}`).click();
    await expect(host.getByTestId('seats')).toContainText(name);
    return p;
  };
  const bravo = await join('Bravo', 'korva');
  const charlie = await join('Charlie', 'selmar');
  await expect(bravo.getByTestId('seats')).toContainText('Charlie');

  await bravo.getByTestId('chat-channel').selectOption('selmar');
  await bravo.getByTestId('chat-input').fill('north is yours if you leave Vessa to me');
  await bravo.getByTestId('chat-input').press('Enter');
  await expect(charlie.getByTestId('chat')).toContainText('north is yours');
  await expect(charlie.locator('[data-private="true"]')).toContainText('private');
  await expect(bravo.getByTestId('chat')).toContainText('north is yours');
  // A room-wide line still reaches the host, so the host's silence above is privacy, not lag.
  await charlie.getByTestId('chat-input').fill('deal');
  await charlie.getByTestId('chat-input').press('Enter');
  await expect(host.getByTestId('chat')).toContainText('deal');
  await expect(host.getByTestId('chat')).not.toContainText('north is yours');
  expect(errors).toEqual([]);
});
