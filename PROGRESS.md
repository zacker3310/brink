# PROGRESS

Updated 2026-10-25. Milestone 1 (first playable).

## Definition of done

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Starts locally | done | `pnpm dev`; e2e serves the build |
| 2 | New scenario | done | Menu: pick nation and seed |
| 3 | Four nations on a rendered hex map | done | PixiJS map, 234 hexes |
| 4 | Inspect territory and formations | done | Right inspector; Military panel |
| 5 | Valid move and attack orders | done | Map click planner reuses engine rules; e2e |
| 6 | Three AIs generate orders | done | `packages/ai`; legality test over 4 full matches |
| 7 | Simultaneous resolution | done | `resolveTurn`; movement conflict tests |
| 8 | Combat changes formation state | done | combat tests |
| 9 | Territory changes hands | done | combat and victory tests; soak |
| 10 | Resources and production advance | done | economy tests (ledger balances exactly) |
| 11 | Fog of war | done | fog tests; views only |
| 12 | Victory | done | VP, last standing, turn limit tests; soak |
| 13 | Save and resume | done | session tests; e2e reload and load |
| 14 | Deterministic | done | determinism and permutation tests |
| 15 | Automated tests pass | done | 68 unit, 100-match soak, 1 e2e journey |
| 16 | Playable without editing source | done | |

## Completed

- Engine: 12-phase resolver, discrete-event simultaneous movement, combat with class counters, terrain,
  entrenchment, river crossings, recon, air and artillery support, combined arms; logistics with
  interdiction and priorities; economy with budget, research, shortages and stability; diplomacy (war,
  mutual peace, alliance); fog with last-known contacts; combat previews as ranges.
- Content: The Meridian Crisis, four governments with distinct modifiers, six unit classes, six techs.
- AI: threat assessment, objective choice, recruitment from observed enemy mix, odds-checked assaults,
  withdrawal of spent formations, air rebasing, research and budget choices.
- Client: menu, top bar, five-tab left panel, Pixi map (pan, zoom, hover, selection, reachable hexes, path
  previews, fog, borders, sites, markers), inspector, order bar with previews, after-action report with
  jump-to-map, three save slots plus load-from-file, victory banner.
- API: health, scenarios, headless simulation.
- Front end (menu overhaul): title screen over the live theatre map (radar sweep, news ticker, keyboard
  nav, Continue from the latest save); campaign setup with nation roster, per-seed map preview, an
  intelligence dossier computed from the real starting world (traits, territory, VP share, income,
  order of battle, contested borders) and a seed codename; operations archive with progress per slot;
  field manual whose tables read straight from `game-data`; menu toasts; favicon.

## Outstanding

- Balance: in the soak, 75 of 100 matches end at the turn limit and 25 by victory points. Matches
  complete, but more should end decisively. Levers: AI aggression threshold (`mid < 520` in `ai`),
  defender lethality, victory share.
- No save-file export button in the UI yet (load from file exists).
- Report has no per-turn history browser; past reports are kept in the save.
- Map: no minimap, no animation of resolved movement.
- Multiplayer: not started (see architecture.md).
- PostgreSQL, Drizzle, Docker Compose, shadcn/ui: not needed for M1, not added.

## Blockers

None.

## Next recommended tasks

1. Balance pass driven by the soak's ending distribution.
2. Animate resolved movement and engagements before showing the report.
3. Export save to file; report history.
4. Multiplayer seam: Fastify session host with a planning deadline and per-nation WebSocket views.
