# CLAUDE.md

<!-- Institutional knowledge for this repo, read at the start of every session.
     Keep it short enough to be read. A CLAUDE.md nobody trims becomes a file the
     model skims, and then it is decoration.
     Update it whenever the agent repeats a mistake - a repeated mistake is a
     missing line here, not a character flaw. -->

## What this is

Brink (repo `brink`): a single-player, simultaneous-turn modern strategy game. One human and three
AIs plan in secret; a pure deterministic engine resolves all orders at once. Runs fully in the browser
(engine in a Web Worker); `apps/api` is optional. Design: `docs/architecture.md`. Shared agent rules:
`AGENTS.md`. Status: `PROGRESS.md`.

## Commands

Run these, do not guess them. Healthy output is shown so a wrong result is obvious.

| Job | Command | Healthy output |
|---|---|---|
| install | `pnpm install` | `Done in ...` |
| test | `pnpm test` | every package `Tests  N passed`, turbo `successful` |
| lint | `pnpm lint` | turbo `N successful, N total` |
| types | `pnpm typecheck` | turbo `N successful, N total` |
| soak | `pnpm test:soak` | `endings {...} rejected AI orders 0`, `rejected AI actions 0`, `2 passed` |
| matrix | `pnpm test:matrix` | `GENUINE FAILURES` all 0, `rejected AI actions 0`, `1 passed` |
| e2e | `pnpm test:e2e` | every spec `passed`; skipped: the 4 frame-time probes (`ARENA_PERF=1`) and the ten-battle leak run (`ARENA_STABILITY=1`) |
| build | `pnpm build` | `apps/web/dist/index.html` written |
| run | `pnpm dev` | Vite on http://localhost:5173 |

## Architecture

Design system: `docs/design-system.md` (APP-6 symbols, tokens, type).
Entry points: `packages/simulation/src/resolve.ts` (`resolveTurn`), `packages/session/src/session.ts`
(`GameSession`), `apps/web/src/engine.worker.ts`; the battle: `packages/arena/src/v2/engine.ts` (`act`,
`endTurn`), spec `docs/arena-v2.md`. State lives in one plain-JSON `WorldState`; the UI and
AI only ever see `NationView` from `fog.ts`. Balance numbers are authored in `packages/game-data`.

## Conventions

- Integers only in authoritative state; percentages via `pct()`.
- Iterate with `sortedKeys()`; randomness via `roll(seed, ...ids)`.
- Compute a phase from one snapshot, then commit.
- Test files sit next to source; fixtures in `simulation/src/fixture.test-util.ts`.

## Common mistakes

- A test fixture nation without a city is eliminated at the end of the turn - `makeWorld()` gives each one.
- Units on unowned ground are out of supply and lose 10 strength in logistics - account for it in asserts.
- Playwright reuses a running server on :4173 - kill stale `vite preview` before e2e after a rebuild.
- Playwright 1.64.1 wants its own Chromium; on a machine with another one set `PW_CHROMIUM=<path>`.
- The arena (`packages/arena`) is the one place with a seeded stream: its state rides in `Battle.stream`,
  drawn only through `draw()`. AI choices use hash noise, never the stream.

## Shipping contract

Trunk-based: commit and push to `main` when `pnpm check`, the soak and e2e are green. Every push to
`main` runs `.github/workflows/pages.yml`: `pnpm check`, build `apps/web`, deploy to
https://zacker3310.github.io/brink/.

## Method

Builds follow `~/.claude/BUILD-METHODOLOGY.md` and the loop in
`~/.claude/skills/build-loop/SKILL.md`. This file adds only project-specific deltas.
Where a rule here conflicts with the method, the stricter one wins.

---

## Completion canary

This file is only useful if it is read to the end. The line below is the proof.

**When you have read this file through to its final line, type that line verbatim once —
in your first substantive response of the session, on its own line.** It is a read-proof
and nothing more: it does not mean a task is done or a test passed. Never type it if you
have not actually reached this line.

Nothing may be appended below it — a sentinel that is not last proves nothing about what
follows. `check-canary.sh` enforces that.

This is the Way.
