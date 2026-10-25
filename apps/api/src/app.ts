import Fastify, { type FastifyInstance } from 'fastify';
import { RULESET_VERSION } from '@brink/game-data';
import { SCENARIOS } from '@brink/scenarios';
import { GameSession } from '@brink/session';

// The API is deliberately small: single-player runs entirely in the browser. It serves
// scenario metadata and runs headless AI-only simulations for balance work. It never returns
// a world state, so it cannot leak hidden information.

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({ ok: true, ruleset: RULESET_VERSION }));

  app.get('/api/scenarios', async () => ({ scenarios: SCENARIOS }));

  app.post<{ Body: { scenarioId?: string; seed?: number } }>(
    '/api/simulations',
    {
      schema: {
        body: {
          type: 'object',
          properties: { scenarioId: { type: 'string' }, seed: { type: 'integer', minimum: 0, maximum: 4294967295 } },
          required: ['scenarioId', 'seed'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { scenarioId, seed } = req.body as { scenarioId: string; seed: number };
      if (!SCENARIOS.some((s) => s.id === scenarioId)) return reply.code(404).send({ error: `unknown scenario ${scenarioId}` });
      const session = GameSession.create(scenarioId, seed, null);
      const hashes: string[] = [];
      while (!session.over) hashes.push(session.advance().hash);
      return { scenarioId, seed, ruleset: RULESET_VERSION, victory: session.snapshot().victory, turns: hashes.length, finalHash: hashes.at(-1) };
    },
  );

  return app;
}
