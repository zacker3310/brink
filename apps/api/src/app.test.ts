import { describe, expect, it } from 'vitest';
import { MERIDIAN_ID } from '@brink/scenarios';
import { buildApp } from './app';

describe('api', () => {
  const app = buildApp();

  it('reports health and scenarios', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/api/scenarios' })).json().scenarios[0].id).toBe(MERIDIAN_ID);
  });

  it('runs a deterministic simulation and returns no world state', async () => {
    const run = () => app.inject({ method: 'POST', url: '/api/simulations', payload: { scenarioId: MERIDIAN_ID, seed: 3 } });
    const a = (await run()).json();
    const b = (await run()).json();
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.victory.winner).toBeTruthy();
    expect(a.world).toBeUndefined();
  });

  it('validates input', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/simulations', payload: { seed: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/simulations', payload: { scenarioId: 'nope', seed: 1 } })).statusCode).toBe(404);
  });
});
