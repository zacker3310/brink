# AGENTS.md

Shared instructions for any coding agent working on Brink (repo `brink`). Design: `docs/architecture.md`.
Status: `PROGRESS.md`.

## Commands

Run from the repo root. Node 22+, pnpm 10.

| Job | Command |
|---|---|
| install | `pnpm install` |
| play (dev) | `pnpm dev` then open http://localhost:5173 |
| api | `pnpm dev:api` (http://127.0.0.1:8787/api/health) |
| all checks | `pnpm check` (typecheck, lint, unit tests) |
| unit tests | `pnpm test` |
| soak | `pnpm test:soak` (100 AI matches, `SOAK_MATCHES=20` for a quick run; 120 AI battles, `ARENA_SOAK=20`) |
| e2e | `pnpm test:e2e` (builds the web app, serves it on :4173, runs Chromium) |
| build | `pnpm build` (web bundle in `apps/web/dist`) |

First e2e run on a machine: `pnpm --filter @brink/tests exec playwright install chromium`.
Arena frame time on an emulated iPhone 13: `ARENA_PERF=1 pnpm test:e2e arena-perf`.

## Architecture decisions

- The simulation is a pure function of `(world, orders)`. Seed, turn and ruleset version live in the world.
- Authoritative numbers are integers. Percentages go through `pct()` in `simulation/src/rules.ts`.
- Randomness is `roll(seed, turn, phase, ids...)`, never a stream. The arena battle is the exception: a seeded
  stream whose state is part of the plain-JSON `Battle` (`docs/arena-v2.md`), so a save replays exactly.
- Iterate records with `sortedKeys()`. Never let `Object.keys` order, array order or submission order decide
  an outcome between nations.
- Within a phase, compute every effect from one snapshot, then commit (`EffectBook` in `engagements.ts`).
- The UI and the AI see only `NationView`. Never pass `WorldState` across the worker boundary or an API.
- AI and human orders go through the same `lockOrders`. The AI must never produce a rejected order.
- Balance numbers live in `packages/game-data`. Changing one is a ruleset change: bump `RULESET_VERSION`.

## Testing requirements

- Every simulation mechanic has a test in `packages/simulation/src/*.test.ts`, written before the code
  changes it.
- Determinism and permutation tests must stay green; add a case when you add a phase.
- The soak tests must report 0 invalid states, 0 rejected AI orders and 0 rejected AI battle actions.
- Never weaken a test to make it pass. A test asserting the wrong thing gets fixed with a comment saying
  why the old assertion was wrong.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, no `any`.
- Packages export TypeScript source (`exports: ./src/index.ts`); Vite, Vitest and tsx consume it directly.
- Contracts are plain JSON: no classes, Maps or Sets in state.
- Terminology: a *formation* is a unit on the map; a *site* is a capital, city, depot or objective.
