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
- Game screen overhaul: HUD with per-turn resource deltas, stability meter, VP race and turn clock;
  icon rail with collapsible panel; map that auto-fits its container, NATO-style counters with
  strength strips and no-orders markers, visible fog, hover card that previews what a click will do,
  zoom controls and a clickable minimap; command bar with segmented orders, hotkeys, visual combat
  odds and next-idle-unit; compact inspector; situation report with headline KPIs, VP deltas, place
  names instead of coordinates and de-duplicated sightings; victory screen; keyboard map.
- Civ-style play (map is the interface): full-bleed map with drawers closed by default; unit panel
  bottom-left (portrait, health ring, MP, round action buttons); Next Turn, units-need-orders cycle
  and minimap bottom-right; select on the map, blue movement range with a bright border, red rings
  on attackable enemies, hover path preview, right-click to order, ghost counters at destinations,
  auto-advance to the next unit; instant combat-odds card on hovering an enemy (both sides,
  expected damage, likely result, modifiers) from the engine's own pure preview; city banners with
  population, VP and production that open a production picker; turn results as notification icons
  on the right edge, full summary on demand; terrain art (forests, hills, snow-capped mountains,
  towns, connected rivers, coasts) and Civ-thick borders.
- Turn replay: before the report, the map replays the resolved turn on the pre-turn board: all
  movement at once, then strike tracers, battle flashes and floating losses, then retreats,
  destroyed formations and site captures. Built only from events the player could see. Skip with
  Esc/Space; toggle in the top bar (remembered; off by default under reduced motion).

## Outstanding

- Balance: in the soak, 75 of 100 matches end at the turn limit and 25 by victory points. Matches
  complete, but more should end decisively. Levers: AI aggression threshold (`mid < 520` in `ai`),
  defender lethality, victory share.
- No save-file export button in the UI yet (load from file exists).
- Report has no per-turn history browser; past reports are kept in the save.
- Multiplayer: not started (see architecture.md).
- PostgreSQL, Drizzle, Docker Compose, shadcn/ui: not needed for M1, not added.

## Blockers

None.

## Next recommended tasks

1. Balance pass driven by the soak's ending distribution.
3. Export save to file; report history.
4. Multiplayer seam: Fastify session host with a planning deadline and per-nation WebSocket views.
