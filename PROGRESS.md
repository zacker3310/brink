# PROGRESS

Updated 2026-10-30 (arena v2.3). Milestone 1 (first playable).

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

- Battles you fight (the arena), replacing multiplayer:
  - Every attack on a hex with enemies opens a brief: fight it by hand, quick-resolve on the odds,
    or back out. Top-down 3D in three.js, Tank Hero style: drag to drive, tap to fire; WASD and mouse
    on desktop. Seven classes play differently (bouncing tank shells, IFV bursts, infantry rockets that
    hide in trees, artillery lobs, helicopter rocket pairs, one-shot dive drones).
  - Arena maps are built from the hex: streets for cities, woods, ridges, sandbags, a river with two
    bridges; capture battles for cities and objectives, destroy battles elsewhere.
  - The result replaces the dice at end of turn when the hex still holds what you fought; otherwise
    the dice decide and the debrief says why. `docs/arena.md`.
  - Progression: veteran ranks from experience (shown on unit cards), research unlocks battle
    abilities (shown in Research), stars per battle, a Skirmish menu of eight battles unlocked by
    stars, and two new theatres (Highland Front, Varn Delta) unlocked by winning wars.
  - Enemy skill ramps with difficulty, war progress and numbers. Synth SFX and a battle music loop.
  - Multiplayer (PeerJS rooms, hotseat, chat) removed; old multi-human saves load with the AI in the
    other seats.
  - Fixed: the arena canvas had no CSS size, so 2x screens showed a quarter of the field; the safe-area
    classes beat Tailwind padding (they sit outside its layers).

- Overhaul pass 1 (`docs/OVERHAUL_PLAN.md`, `docs/GAME_DESIGN.md`, `docs/IMPLEMENTATION_LOG.md`):
  - Saves migrate forward across rulesets and save versions instead of being refused.
  - Treaties: binding non-aggression pacts, trade agreements, embargoes, all timed and public.
  - Victory: Coalition and Supremacy join Domination; the turn limit is a Score victory on standing.
    Quick, Standard and Epic campaigns (20, 30, 45 turns).
  - Facilities: farm, mine, power plant, factory, research lab, fortress; three unlocked by research.
  - Order review before every commit, phone and desktop.

- Easier campaigns and turn-based battles (ruleset `1.6.0`):
  - Difficulty measured with the AI's own planner in the human seat (32 campaigns a level): Easy
    won 34%, barely above Normal. Human seats now get a command edge per level (`DIFFICULTY_EDGE`):
    Easy wins 88% (66% playing only defensively), Normal 56%, Hard 25%.
  - The real-time arena is replaced by a turn-based tactical battle (`packages/arena/src/tactics.ts`):
    move then act, hit chances with their reasons shown before you fire, cover and flanking,
    overwatch, dig in, mines, air strikes; the enemy AI scores every reachable cell. Deterministic,
    an event log played back by the renderer.
  - Realistic rendering: real GLB models (T-72, AH-64, drone, Mixamo riflemen, Hesco, containers), a
    Poly Haven sky for image-based light, soft shadows, a generated battlefield with grass, scrub,
    trees, boulders, buildings and water, and a film of muzzle flashes, tracers, rockets, explosions,
    debris and burning wrecks. Pan, pinch and follow camera. The battle is its own lazy chunk.
  - Fixed: the first frame after building a battle stepped time backwards (a stalled scene glowed).

- Arena v2, combined-arms battles (`docs/arena-v2.md`, `docs/arena.md`), replacing the 1.6.0 battle:
  - A 30 x 45 field (150 m a cell) built from the hex in five biomes (temperate, steppe, desert,
    winter, dense urban), dawn, day, dusk or night, clear, overcast, rain, fog or snow. XCOM-style side
    turns, 16 rounds, capture by holding the zone two rounds, defenders withdraw under 35% of their
    strength, a broken attack ends under 25%.
  - Companies of 10 to 16 from your formations and arsenal (US, European, Russian, legacy): 50 unit
    types with public specifications (M1A2 SEPv3, Leopard 2A7, Challenger 3, T-72B3, T-90M, T-80BVM,
    Bradley, BMP-3, CV90, Stryker, M10 Booker, AH-64E, Ka-52, Mi-24, AH-6, UH-60, Mi-8, Javelin,
    Kornet, Stinger, snipers, mortars, engineers, FPV, Switchblade, Paladin, 2S19, HIMARS, Gepard,
    Tunguska, recovery vehicles, medics and more).
  - Rules: armour by facing against penetration, component hits (mobility, firepower, crew,
    catastrophic) by stowage, APS, soldiers who fall one at a time and take firepower with them,
    suppression that lowers aim and breaks units, hull-down on reverse slopes, smoke that blocks sight
    for a turn, embark and dismount, carriers that burn with their squad inside, squads that split
    into fireteams, medics and recovery, engineers who breach, mine and smoke, called fire that is
    only as good as its observer, drones that can be shot down.
  - AI from its own side's picture only, never the dice: suppresses then flanks, smokes before open
    ground, pulls damaged units back, hunts helicopters with air defence, calls fire on what it sees.
  - Look: every vehicle, helicopter, drone and soldier built in code from real dimensions (the
    Apache GLB aside), biome-true ground, buildings that crumble, craters and wrecks that stay, lit
    smoke, tracers, burning wrecks, rotor wash, thermal at night and in fog, orbit camera and action
    cams; calibre-true sound and radio calls. Low, Balanced and High quality, remembered.
  - Saves, career stars and the war-map contract (`ArenaBattle`) are unchanged; the eight skirmish
    ids keep their stars and four new skirmishes join them.
  - Measured, 120 AI-against-AI battles (`ARENA_SOAK`): the attacker wins 44%, 66 end in a
    withdrawal, 16 by capture, 38 at the round limit; median 9 rounds (p90 16); 0 rejected AI
    actions; about 1.6 s a battle. Attackers win 21% with 10 or 11 units, 69% with 14 to 16.
  - Frame time on an emulated iPhone 13 (CPU 4x slower, software WebGL, so our JavaScript only; First Blood, 20
    units):
    Low p50 9.1 ms, p95 17.4 ms, 46 draw calls, 118k triangles; Balanced 12.1 / 30.4 ms, 54 calls,
    202k; High 13.5 / 61.4 ms, 54 calls, 297k. Battle opens in 7.5, 11.2 and 15.8 s on that
    throttled CPU. The largest battle (Last Stand, 32 units, fog) on Balanced: 18.3 / 54.2 ms, 86
    calls, 268k; unthrottled 4.7 / 13.1 ms, almost all of it native WebGL in the software
    rasteriser. Battle art 1.5 MB, battle code 1.0 MB.

- Arena v2.1 and v2.2, a battle you can play on a phone (`docs/arena-v2.md` sections 11 and 12):
  - Fixed: the battle often sat on "Wait" for good after an order. Overwatch and hunker log no
    events, so the screen's hand-set busy flag was never cleared; busy now follows the film. Film
    steps that throw are skipped, the frame loop cannot be stopped, and an overlong step is ended.
    Found and checked with a browser soak that plays every skirmish through the real UI.
  - Your own turn never blocks; moves preview first (route, cover, what you could hit from there,
    who could hit you there); advice with Do It; Undo for a step that showed nothing; the unit card
    shows its three most useful actions; End Turn with units ready offers to let the crews act;
    fast enemy turns (on by default) and Skip.
  - Units drawn 1.4x (vehicles) and 2.2x (soldiers); a closer, lower camera that follows your
    selection; zoom, back-to-unit and whole-field buttons; pinch toward the fingers; badges over
    every unit; edge arrows to seen enemies off screen; words over targets as hits land; a kill
    feed; strength bars; a round report; action cams that never clip.
  - Difficulty: Easy (default for skirmishes), Normal, Hard; war battles follow the campaign.
    Measured with the AI in your seat over 60 setups: Easy 85%, Normal 58%, Hard 35%.
  - Tested: navigation and the full touch flow at 375 x 667, 393 x 852 and 440 x 956 with 44 pt and
    4.5:1 audits; 126 arena unit tests.
  - Frame time on the throttled, software-rendered probe rose (Balanced p50 12.1 to 16.6 ms); the
    profile puts it in native rendering of the closer view, not in the HUD. Measure on a phone.
  - Fixed on the way: the war-map replay undid a pause pressed as it started.

- Arena v2.3, the battle as a phone game (`docs/arena-v2.md` section 13; research in
  `reports/Mobile tactics battle design.md`, not committed):
  - Touch and camera: the ground stays under the fingers (a two-finger least-squares solve; 0.01 px
    worst error in Chromium at three iPhone sizes, gate 4 px), twist and pinch dead zones with no
    jump, tilt lock, a north chip, long-press cards (enemy, cell sight lines, your unit), tap
    snapping where cells draw under 44 pt, a move pin above the thumb, a Left-Handed layout.
  - Reading the field from blue's picture only: Danger Area, one enemy's reach, the facing glyph and
    flank warning, overwatch footprints, air-defence rings with the rules' chances, likely targets
    (Easy, Normal), fading ghosts and a scouted-area stipple, suppression in words.
  - Deciding: an outcome bar on the shot card (12,000 seeded shots, worst gap 1.05 points), a battle
    log of every roll you saw, Reset Turn (Easy unlimited, Normal once, Hard never), Next and Hold,
    an End Turn sheet, tips, an after-action grade.
  - The film: beats overlap and volleys merge, zip mode and hold-to-fast-forward, a severity ladder
    for hit stop and trauma shake, tuned words, action cams only for brew-ups, the last kill and
    captures, Motion and Shake settings, flashes held to three a second. Skipped, watched, zipped
    or shoved about, the battle ends on the same hash.
  - Look and sound: friend and foe by shape, a colour-blind palette, rim light, outlines, layered
    heavy reports, a haptic tick (not felt: no iPhone here), one composited HUD layer.
  - Performance and resilience: render on demand (0 frames drawn a second idle, hidden or with the
    context lost), shadows only when something moves, an adaptive pixel ratio, lost-context recovery,
    checked atomic snapshots with resume after a reload, a frame-time overlay; 10 quality switches
    and 10 battles leave the same uploads, DOM nodes, canvases and listeners.
  - Verification: every order goes through a command log (`submit`, `replay`, `hashBattle`); one
    visibility layer (`observe`); `pnpm test:matrix` plays 24 seeded battles to their end and excuses
    nothing. Found and fixed on the way: a stale AI sight cache, malformed orders accepted, refusals
    and engineer orders that told of hidden units, Undo greyed by a hidden spotter, the film showing
    hidden shooters (and blue's picture missing shooters the film showed), the enemy's skill in
    blue's picture, and a move that could end on a cell its own side held.
  - Tested: 221 arena and 62 web unit tests; both soaks (Easy 85%, Normal 60%, Hard 38%; rejected
    AI actions 0); the matrix (0 genuine failures); the full e2e suite (result below when run).
  - Not measured: anything on a real iPhone (GPU frame time, touch feel on glass, haptics, Safari
    memory pressure). The checklist is `docs/device-testing.md`.

## Outstanding

- iPhone: tested in Chromium with iPhone 14 Pro emulation (touch, viewport, DPR), not yet in real
  Safari/WebKit; verify on a device (audio unlock, safe areas, standalone launch).

- Balance: of 100 soak matches, 38 end by domination, 19 by supremacy, 43 on score at the turn
  limit (median turn 28). Next lever: AI deadlock-breaking (concentration, artillery before assaults).
- Arena v2.3 defects, by priority (detail in `docs/architecture.md`, Battles):
  1. Nothing measured on a real iPhone: GPU frame time, gestures on glass, haptics, memory pressure.
  2. Replay across JavaScript engines is unproven: facings are doubles from `Math.atan2`, and
     armour facing and range use `Math.sin`, `Math.cos` and `Math.hypot`; integer facings fix it.
  3. The move outline is reckoned on the truth, so a wreck blue cannot know of shows as a cell a
     vehicle cannot enter (a rule fix: a move stops short at an obstacle it meets).
  4. The field draws only the red wrecks of kills blue saw; blue's picture also knows a wreck next
     to its units, which the field does not draw.
  5. A rebuild (quality change, lost context) puts the camera back at the opening view.
  6. A war-map battle resumes only when the same attack is ordered again; the turn's other draft
     orders are not saved mid-turn.
  7. The JavaScript heap grows about 65 KB a battle (V8 code and Chrome's timeline entries by the
     heap diff, not the game's objects); watch it on a device.
  8. Stack cycling (air over ground) has unit tests only; no skirmish open at first has both.
- Arena: tested in Chromium (iPhone 13 and 14 Pro emulation, software WebGL, and desktop), not on a
  real iPhone GPU; GPU frame time is unmeasured. Weakest spots: soldiers read as mannequins close up,
  T-80BVM and T-72B3 look alike, close-up paint is too clean, trees and house fronts repeat close up,
  rotor wash and the biggest fireballs are the weakest effects. The AI never splits squads; all-fog,
  all-artillery and all-drone attacks often run to the round limit. New nations per theatre not done.
- PostgreSQL, Drizzle, Docker Compose, shadcn/ui: not needed for M1, not added.

## Blockers

None.

## Next recommended tasks

1. Play the arena on a real iPhone through `docs/device-testing.md`: frame time per quality, the
   ground under the fingers, haptics, audio unlock, memory pressure and resume.
2. Integer facings and distances in the arena state, then prove replay on Safari's engine too.
3. A move that meets an unseen obstacle stops short; then the move outline can use blue's picture.
4. The hex world map overhaul (next by the plan).
5. Arena art close up: soldier faces and gear, T-80 turret, paint wear; rotor wash and fireballs.
6. AI fireteam splits; break all-artillery and all-drone stalemates. 7. Landscape.
