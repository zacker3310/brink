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
- Design system (`docs/design-system.md`): NATO APP-6 unit symbols via milsymbol, IBM Plex and
  Barlow Condensed (self-hosted), tokenized palette with APP-6 affiliation colours, grain panels.
- Multiplayer: host a room (WebRTC via PeerJS, five-letter code, invite links), join, lobby with seats,
  callsigns and chat, host-authoritative turns where each guest only receives its own view, seat
  status, force-resolve, rejoin by name; hotseat on one device behind a curtain. Engine: multi-human
  `GameSession` and saves.
- Balance pass (ruleset 1.1.0): AI masses combined assaults with artillery and air support, spends
  idle cash on research and recruits faster, makes peace to close a second front, stabs a weak
  partner, and abandons a war stalled for 8 turns; strikes cost 25 entrenchment; victory at 40% of
  VP. Engine fix: war declared between co-located nations pushes the trespasser off. Soak went from
  25 to 58 decisive endings in 100.
- Threat overlay (V, or the map button): where every seen enemy could strike next turn, darker
  where more could; hovering an enemy outlines that unit's own reach; the hover card counts threats.
  `threatZones` in the simulation package, built from the viewer's NationView.
- Real art: Copernicus Sentinel-2 ground (Poltava farmland, Polesia forest, Codri hills, Caucasus
  ridges, Dnipro city blocks, Black Sea); units rendered top-down from open 3D models (T-72, AH-64D,
  quadcopter, Mixamo infantry, Kenney vehicles, howitzer); depot compound; Kenney explosions and smoke
  in the replay. Credits in the Field Manual and `apps/web/public/art/CREDITS.md`; pipeline in `tools/art`.
- Ruleset 1.4.0: drone companies (cheap, fragile, vision 5, strike range 3, hit armour hardest,
  fly from sites like aviation); Air Support is now Attack Helicopters. Every nation starts with one
  drone company. Soak: 45 decisive endings of 100, 0 rejected AI orders.
- ISR look: flat C2 HUD (Archivo wide caps, Martian Mono data, sensor-lime accent, own icon set,
  no grain, brackets, scanlines or emoji); satellite-style terrain and top-down unit models on the map and in the replay, model
  portraits in the unit panel and build list.
- Guided first match ("Boot camp"): first on the title for a new player. A coach rides a real
  campaign as the Commonwealth and teaches eleven steps (move, orders for all, build, end turn, replay,
  summary, threat overlay, attack, diplomacy); each finishes when the player does it, with a "show me"
  shortcut and Later on the ones that may not apply yet. Finishing or ending it is remembered.
- World events (ruleset 1.3.0): about one nation in five per turn draws a two-way decision (oil
  strike, harvest failure, general strike, defector, arms dealer, war bonds, volunteers, scandal).
  The card sits above the turn controls; no answer takes the first option. The AI weighs resources,
  research, stability (dearer when low) and morale.
- Diplomacy with teeth (ruleset 1.2.0): perfidy costs 10 stability for breaking a peace, 20 for an
  alliance, shown on the button before you commit; betrayal notifications; private chat channels to
  one player, routed by the host so nobody else (the host included) receives them.
- Resume a room: a host's save remembers who sat where. Loading it reopens the lobby with each seat
  held for its callsign; strangers are turned away, returning players keep their history, Resume
  plays on. Hotseat saves resume behind the curtain.
- Multiplayer cadence: planning timer chosen in the lobby (auto-locks every draft at zero), host hands
  an offline seat to the AI, the player reclaims it by rejoining.
- Turn summary history: ‹ › (or arrow keys) through every past report. Save menu exports the
  campaign to a JSON file, which the archive's import loads back.
- Replay controls: pause (Space), 0.5x/1x/2x, click a phase or use the arrow keys to jump, restart,
  progress bar; rewatch the last turn from the turn controls or the summary without touching
  the orders being drafted.
- Turn replay: before the report, the map replays the resolved turn on the pre-turn board: all
  movement at once, then strike tracers, battle flashes and floating losses, then retreats,
  destroyed formations and site captures. Built only from events the player could see. Skip with
  Esc/Space; toggle in the top bar (remembered; off by default under reduced motion).

- iPhone (Add to Home Screen): web app manifest, apple meta tags and icons, standalone full-screen
  with safe areas, and a service worker that keeps the game playable offline after the first visit.
  Phones get their own game screen (`PhoneGame.tsx`): edge-to-edge map, a status strip (turn, VP race,
  resources, threat toggle, menu) and a thumb dock (Command sheet, Auto, Next, End Turn). Tap a unit,
  tap a blue hex to move; tap an enemy to lock on and read the odds, tap again or Confirm to attack.
  Pinch to zoom, drag to pan; the camera opens on your capital at a thumb-sized scale. After each turn
  a debrief card lists the top results. Auto has the staff (the AI planner) draft orders for every
  unit still waiting, plus research and recruits within half the bank. City production is a bottom
  sheet; the coach has touch wording. Quick (20 turns, default) or Full (30) campaigns. Synthesised
  sound (WebAudio: orders, lock-on, end turn, strikes, battles, win/lose), mutable from the menu.
  Solo campaigns autosave after every turn; Continue picks it up.

- Design system v2, "Command Table" (`docs/design-system.md`), after "too hard, not intuitive":
  - Units are wargame counters: a pictogram drawn for the game (rifleman, IFV, tank, howitzer,
    armoured car, attack helicopter, quadcopter) and a strength from 1 to 10. Yours are solid in your
    colour, theirs dark with a red war tab; one counter per hex with a stack count. APP-6 chips and
    the milsymbol dependency (860 KB) are gone.
  - Consequences before commitment: with a stack selected, every enemy it can hit is tagged WIN,
    EVEN or RISKY on the map (`odds.ts`); locking on shows who attacks, the odds in words and the
    expected losses.
  - Stacks move as one on touch: tap a hex to select everyone there (led by the slowest ground
    unit), toggle units in the card, tap a blue hex to move all, tap a target to attack together.
  - Always an answer to "what now?": an amber goal ring and a "Take X +VP" chip name the best place
    to take next (`objective.ts`).
  - Phone HUD down to turn, victory bar, funds (with shortages named) and the goal. Barlow and
    Barlow Condensed type, warm slate surfaces, command-amber accent, larger type; the ground
    imagery is graded down and borders are bolder.
  - Fixed: the silent autosave reported "Could not save" after every turn.

- Easier to play, easier to look at:
  - Difficulty (Easy default): one front, at war with the nearest rival only, the AI never declares
    war on you and accepts any peace you offer, half again the starting stockpile. Normal is all at
    war; Hard gives the AI the bonus. Stored on the world, so saves keep it; tested in `session`.
  - Clean map (default): flat board-game terrain with a small mark per terrain (trees, hills, peaks,
    blocks, waves); satellite imagery is a menu option.
  - Every power starts with the political map: land and borders known from turn 0 (scenario intel);
    enemy units still need to be seen. World button: the whole theatre with nation names across
    their land, a ranked list with war/peace for each, and a jump to Diplomacy.
  - Research in plain words ("Faster factories: your cities build units 20% faster"), a
    Recommended pick that starts by itself if you never choose, honest turn estimates from turn 1,
    and a Low / Normal / High funding choice instead of a budget slider.
  - Diplomacy: one card per nation, WAR or PEACE in a pill, what it means, one big button (Offer
    peace, Accept peace, Declare war with its stability cost).
  - "How to win" in three steps at the start of every campaign and from the menu.
  - Fixed: the AI could send the same diplomatic order twice and have all of them refused.

## Outstanding

- iPhone: tested in Chromium with iPhone 14 Pro emulation (touch, viewport, DPR), not yet in real
  Safari/WebKit; verify on a device (audio unlock, safe areas, standalone launch).

- Balance: 55 of 100 soak matches end by victory points, 45 at the turn limit (median turn 29).
  Next levers if games should end sooner: stall threshold in `ai`, strike entrenchment, victory share.
- Multiplayer: no TURN relay for strict NATs, a loaded multi-human save resumes single-player (other
  seats hold), guests cannot save.
- PostgreSQL, Drizzle, Docker Compose, shadcn/ui: not needed for M1, not added.

## Blockers

None.

## Next recommended tasks

1. Online reliability: TURN relay, lobby connection diagnostics, guest auto-retry; verify a real
   two-network match.
2. Async turns on `apps/api` (resolve when all are in or at a deadline; notify on turn).
3. More maps. 5. Shareable end-of-game recap. 6. Haptics and a landscape layout on phones.
