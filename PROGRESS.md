# PROGRESS

Updated 2026-11-05 (balance after research, leaders and the staff AI, ruleset 2.9.0). Milestone 1 (first playable).
Updated 2026-11-05 (airborne warfare and right of passage, ruleset 2.9.0). Milestone 1 (first playable).

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

- Balance after research, leaders and the staff AI (ruleset 2.9.0). Measured on 2.8.0: of 40 soak
  matches 15 decisive (China 12, Russia 3), median turn 30; after the first ten turns the wars
  were fought by nobody. Root causes and fixes, all in `packages/ai` unless named:
  - Prey across an ocean: after the minors fell, every power declared on the weakest by VP (Japan)
    and none could land. War is now made on the power easiest to get at (`approach`: site to site,
    a crossing wider than a strait costs 12 hexes more), weighed against its VP.
  - Armies outgrew their economies: upkeep ran 70 energy against 46-56 income, so by turn 8 every
    power ran at half industry with dry tanks. Recruitment now keeps a formation's upkeep within
    what the stockpile carries for 6 turns (`balanceOf`, simulation `economy.ts`, shares the
    engine's upkeep reckoning `upkeepOf`); a deficit is mended first (power plant, farm or mine,
    whatever the pace) and the treasury saves toward it (`buildSaving`).
  - Piecemeal storms: two formations at a city's gates stormed whatever was in it and seven storms in
    ten failed. A city is now stormed when the strength at its gates is 2.8 times the garrison
    believed inside (falling as the war stalls); the rest dig in while the army comes up. A city in
    sight is not a city seen into: the target choice assumes a guard round an unseen great power's
    city (2000-3000) and a minor's militia. Rules: entrenchment gives +1% defence per 4 points (per 2
    before; `RULES.entrenchmentPerDefense`).
  - Landings that never landed: ships steered into hexes held by powers at peace (a halt, every
    turn); transports sailed with one regiment; an operation built no lift, and what it built it
    built on the wrong sea (Houston). Paths now avoid peace-held hexes, transports fill in port, an
    operation across the sea keeps lift for eight formations, and ships are built and gathered only
    on the fleet's own sea. A US landing on Hokkaido takes Sapporo again (operations test).
  - Pacts shielded the leader: everyone signed non-aggression with the strongest power. No pact now
    with a power 3-4 points of standing ahead (`LEADER_TUNING.ai.pactGap`); the balance of power
    turns on a leader 6 points ahead (8). Welfare is raised from stability 52 (45).
  - Data: the Union's units 8% cheaper (15%); Easy and Normal command edges re-measured.
  Result, 40 matches: 25 decisive (62%), median turn 29; decisive wins USA 14, China 10, Russia 1;
  on score USA 9, Japan 4, China 2. Difficulty (32 a level): see Outstanding.
- Airborne warfare and right of passage (ruleset 2.9.0; the player: "I want to invade Mongolia as the
  United States but I can't get there"): Ulaanbaatar is five hexes from the sea and fourteen from the
  nearest US site, so before this the only way in was across Russia or China.
  - Airlift (`simulation/src/airborne.ts`, data `game-data/src/airborne.ts`): infantry and recon fly
    from an own Airbase (12 hexes, two a turn), an own capital-class site (10, one: a captured
    Ulaanbaatar is a base) or a carrier's deck (7, two per carrier, troops aboard an amphibious group
    lying with it); mechanized infantry only air-lands at an airfield. Onto an own or allied site it
    air-lands in good order; elsewhere it drops (-25 organization, -20 readiness, stays put, out of
    supply off its lines); onto a held hex it comes down beside it and storms it at once at -40%.
    20 credits reserved after deals, 4 energy of fuel burned as there is. Interception: a roll per
    formation against the aircraft, drones, ships and missile batteries near the flight (at most 45%,
    a hit costs 250 strength). Phase 7a, one snapshot; contested landings turn both back.
  - Right of passage (`simulation/src/passage.ts`): a treaty between powers at peace, both ways, 8
    turns: move through and share hexes, supply across, rebase aircraft and air-land at the other's
    sites; it takes no ground and ends at war. Leaders (`ai/src/passage.ts`) refuse it toward an ally or
    a power they like, never grant it to the power they march on, want more warmth as hawks and when
    it names no target; a power asks for it when a neutral's land lies across its way. The Diplomacy
    screen's deal builder offers it, with "toward" whom.
  - Operations: an `airborne` kind (stage, drop, hold, assault), offered to the United States for
    Ulaanbaatar on turn 1; the staff (`ai/src/airborne.ts`) sails the carrier group and the loaded
    amphibious groups to the least exposed sea hex in the deck's reach, flies two a turn into the
    quietest drop zone, holds it while more come, then storms; it makes no peace with the power at the
    prize's gates while it runs, and pays for the fuel by dropping recruits, never by a refused order.
  - Client: Airlift on the unit card (phone and desktop, L), every landing hex tinted by its
    interception risk (blue clear, amber, red; a bold edge air-lands), the phone card shrinking to the
    lift's panel and the camera on the prize; the planned lift drawn as an arc with a canopy; the
    replay flies transport aircraft (helicopters from a deck) and brings canopies down, a hit flaring
    and trailing smoke; the debrief and the report tell of drops and losses; the map's operation spot
    says STAGE and DROP ZONE.
  - Tests: `simulation/src/airborne.test.ts` (range, origins, classes, capacity, cost, own site against
    drop, assault drop and its penalty, supply, interception sums and determinism, contested landings,
    aircraft into a new site, passage signed, marched through, supplied across, ended by war, public),
    `ai/src/airborne.test.ts`, `session/src/airborne.test.ts` (the Ulaanbaatar proofs, the 2.8.0 save),
    `tests/e2e/airborne.spec.ts` (phone: launch, aim a lift, the drop in the replay and the debrief).
  - The Ulaanbaatar proof, measured: China takes Ulaanbaatar from Beijing, next door, on turn 1 of every
    campaign (12 seeds of 12; seven of the crises tried, all the same). On Normal, seed 7, the staff drops four marines beside
    it on turns 4 and 5 with every order accepted; they do not take it from China's garrison. With
    Mongolia left to the United States (China and Russia at peace with it) and its militia broken, on
    Easy, seed 2, Ulaanbaatar falls on turn 7, 0 rejected orders. A full militia in a city holds against
    any four light formations the combat rules know, dropped or not.

- Civ-style progression (ruleset 2.6.0): a research tree of 24 technologies in five branches
  (Logistics & Economy, Armour, Air & Missiles, Naval, Cyber & Intel; `game-data/src/research.ts`)
  whose effects reach movement (armour, ships), combat (armour attack, ship attack and defense),
  supply, income, research, doctrine (a fourth card, an extra Command Point), facility costs, city
  growth and the arena's off-map support. City development (`game-data/src/cities.ts`,
  `simulation/src/progression.ts`, a development phase after the economy): capitals and cities grow
  to level 5, each level adding yields and levels 3 and 5 a facility slot. Three new facilities:
  naval yard (ports), airbase and missile battery (support over nearby battles, defenders +15%).
  The AI's research and build choices live in `ai/src/research.ts`. Phone: the Research screen
  (`Research.tsx`, branch chips and tree cards) and the city build panel (`CityBuild.tsx`, level,
  growth, slots, build queue); e2e `progression.spec.ts`. Older saves gain development 0 on load.
- Leaders and diplomacy (ruleset 2.6.0), the "living rivals" pass: each power is run by an invented
  leader (Caleb Wainwright, Gao Yiran, Haruka Tsujimoto, Oleg Severin; a generic one per government)
  with a temperament, an agenda and lines that react to events. Leaders remember betrayals, wars,
  cities taken, peace, deals, tribute and defiance; their mood toward you is itemised Civ-style.
  New deals on the treaty system: ceasefire (binding truce), resource exchange, tribute demands
  (ultimatums that lapse into defiance; hawks go to war over it), alliance against a common enemy,
  joint operations (both AIs march on the prize). The AI's leader layer is `packages/ai/src/diplomacy-ai.ts`;
  a leader answers on the spot (`GameSession.negotiate`) exactly as at resolution. UI: a Leaders
  screen (`apps/web/src/Diplomacy.tsx`) replaces the old Diplomacy panel on phone and desktop, and
  leader quotes join the debrief and the report. Old saves gain empty memories.

- Doctrine cards (ruleset 2.3.0): every power holds a hand of three national cards drawn from a deck
  (by government now; `game-data/src/nations/<id>.ts` plus one map entry adds a nation's own), paid
  for in Command Points (1 a turn, +1 per capital, +1 per four cities, cap 8), at most two a turn.
  Thirteen generic cards: Air Superiority, Naval Bombardment, Missile Barrage, Forced March, Dig In,
  Rally, Requisition, Propaganda, Sabotage, Recon Flight, Amphibious Doctrine, Kamikaze Swarm,
  Disinformation. A new doctrine phase after diplomacy; lasting cards reach movement, strikes,
  logistics, vision, landings and the arena's off-map support (`battleFor`). Plays are public in the
  turn report and debrief. The AI plays by utility from its view, checked by the engine's own
  `checkPlays`. Phone: a "Hand 3 · CP 5" chip opens a fanned hand; a targeted card is armed and the
  next hex tap aims it; stamps on the order review. Desktop: the hand peeks up from the map's bottom
  edge. Old saves are dealt a doctrine on load.

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
  - Tested: 221 arena and 63 web unit tests; both soaks (Easy 85%, Normal 60%, Hard 38%; rejected
    AI actions 0); the matrix (0 genuine failures); the full e2e suite, 23 passed (13 specs, gestures,
    touch and navigation at 375, 393 and 440 pt), the frame-time probes and the long leak run opt-in.
  - Not measured: anything on a real iPhone (GPU frame time, touch feel on glass, haptics, Safari
    memory pressure). The checklist is `docs/device-testing.md`.

- Operations, the staff as a planner (after "I can't figure out how to just do it"):
  - The staff proposes named operations from the player's own picture (`packages/ai/src/operations.ts`,
    `proposeOperations`): Take X, overland or amphibious, with phases (get a lift, assemble, embark, sail,
    soften up, land, assault; or march, soften up, assault), where each stands this turn, turns to the
    assault, odds from the engine's own preview, the force it uses, and what stands in the way (no
    transports, too few berths, an enemy fleet off the beach, no warships for fire support).
  - Launch makes the prize the staff's objective: `planOrders(view, memory, seed, { target })`, the
    same planner the rivals use, so it marches to the port, boards, sails, lands and storms, and every
    order is one the validator accepts. A missing amphibious group goes on order at the nearest port.
    Every turn opens with the operation's orders drafted (Staff plan off or on); the player changes any.
    The goal ring and chip follow the operation; it ends itself when the prize falls or is out of reach.
  - Fixed in the planner (operations only): a landing that took the ground round its prize sat every
    unit down to "defend" against the prize's own garrison. With an operation running, threats within
    three hexes of the prize are answered by the assault. Seed 1: China takes Taipei on turn 4, the USA
    Tokyo on turn 8 (never before), 0 rejected orders.
  - UI: an Operations sheet (phone and desktop) and an operation strip over the map with the phase
    track. Tests: `packages/ai/src/operations.test.ts`, `tests/e2e/operations*.spec.ts`.
- Commanders (ruleset 2.3.0): three named generals per power (generic roster by government; a
  per-country roster is one file plus one registry entry), assigned to formations by order, earning
  experience in battle, strikes and captures, levels 1 to 5 with a choice of two perk cards per
  level (11 perks, 9 signature traits), wounded or killed when their formation falls. Effects feed
  combat, strikes, sight, supply, morale, readiness and entrenchment; +1 arena rank. Fog shows
  enemy generals by name and level only. AI posts its generals to its strongest assault formations
  and picks perks by utility. UI: commander row on the unit card (phone and desktop), Assign picker,
  promotion modal, Command > Generals roster. Saves before 2.3 gain generals on load.

- The film of war-map fire support (arena v2.4, docs/arena-v2.md section 14.1): code-built F-35A and
  Su-34 jets that run in, bomb (GBU-31 / KAB-500 falling onto the blasts' cells) and pull away on
  afterburner with contrails and a sonic crack, or take a SAM or tracers and fall burning off the field;
  Tomahawk (booster) and Kalibr skimming in and popping up to dive; an Arleigh Burke or Slava on the
  horizon walking its shells over the area; a kamikaze swarm (LUCAS / Geran-2) as one beat, weaving in
  with a two-stroke buzz, each drone shot down or diving on its own. Interceptors drawn only when blue
  sees them; action cams for a blue jet or missile run that kills a vehicle and a cut to the ship.
  FPV and loitering drones now draw their airframes (they were never added to the scene). New Fire
  Support skirmish (7 stars); the e2e `arena-support.spec.ts` calls each mission and shoots it mid-flight
  (`__arena.pauseFilm`). Gate: typecheck, lint, unit (web 73), matrix 0 genuine failures, arena e2e 20
  passed / 5 skipped. Not done: HIMARS and Tornado-G still fly as plain rockets.

- Playtest pass (phone, China, "Take Taipei", 8 turns; `tests/e2e/playthrough*.spec.ts`):
  - One command card over the phone dock replaces the stack of operation strip, advisor, chip row and
    decision card; a world event waits behind a chip and opens in a sheet; a hex the camera moved to
    (Next, turn start) no longer raises a hex card over it.
  - The debrief leads with cities won or lost and our own news, rivals' cards last; it says where the
    operation stands, and a promotion waits until it is read. Commander events (promotion, perk,
    wound, death, recovery, escape) are worded in the debrief and the report.
  - The map rings the operation's port or beach (`opspot.ts`) and shows every hex an armed card can
    take; the hand shows the tapped card in full below the fan, with the operation's advice on when to
    play it. The roster posts a reserve general to the operation's strongest formation in one tap.
  - The setup dossier shows each power's blurb (`NATION_BLURB`); the first-turn brief points at
    Operations.
- Arena pacing (docs/arena-v2.md section 15, arena rules 2): the matrix's blue seat was a random
  walk (advice for 3% of its orders), so 17 of 24 battles ran out the clock; it now plays the advice
  two orders in five, keeping random and illegal orders for the rest. Rules: the defender withdraws
  under 40% (was 35%), an attacker alone in the circle when round 16 closes takes it, and the AI's
  bar for off-map missions falls with the rounds. Matrix endings: lost time 17 -> 6, wins 5 -> 14
  of 24, 0 genuine failures. Soak (AI attacker, 60 battles): time 12 -> 10, wins 70% -> 73%.
- Fight it yourself: the order review lists the turn's battles (staff, operation or your own on
  the odds), each with Fight It Yourself; the staff-plan banner and the phone's Execute key count
  them (`plannedBattles` in `arena/battle.ts`, `staff-battle.spec.ts`).
- Arena film: strikes filmed wide are framed 3 cells beyond the target (past the field's edge for
  the back row: the film only, `FILM_SLACK`); the jet kill cam looks back up the run so the jet is
  in it; rockets are larger with a nozzle glare; the ship has a long wake, a churn and white water
  that shows from the low cut.
- Desktop: notifications and turn controls share one right rail (the column shows what fits above
  the stack, "+N more" for the rest); the theatre fits beside the rail; the VP race shows from
  1400 px so the top bar fits at 1280.
- Arena film polish and tabletop cards (docs/arena-v2.md sections 14.1 and 14.2): the strike jet read
  as a flat grey slab because it flew at 2.2x scale through the camera; it now flies at 1.25x (two
  cells long) at 2.4 cells, its slant and break chosen against the camera that will watch it (in
  frame as long as possible, never nearer than 6 cells), with motion-blur ghosts and speed streaks
  (not on Low). F-35A and Su-34 rebuilt with panel seams, coated edges, intakes, framed canopies, the
  Su-34's two-tone scheme and red stars. Air strikes are filmed wide (17 cells back) and the zoom
  comes back once all is down. An intercepted jet now crashes in a fireball instead of flying on
  toward the camera. HIMARS (a GMLRS pair, terminal dive) and Tornado-G (a ripple of 15 to 20 122 mm
  rockets) launch from beyond the edge, blue's with a cut to the launch. The ship sits in a darker sea
  patch with a bow wave and wake, its waterline under the haze floor. Kamikaze drones fly tighter and
  the cruise missile pops up closer, both so a portrait frame holds them. The brief is a mission card
  (counters, support chits with mission pips, star rules) and the verdict an after-action card with
  the same rules marked earned. New `support` test hook and `arena-sorties.spec.ts`: red's Su-34,
  Kalibr and Geran-2 brought down by the Gepard and Stinger, getting through, the Tornado-G, blue's
  HIMARS, and the F-35A and Tomahawk kill cams on The Crossing, all looked at in screenshots.
- Front door and the first ten minutes: the guided first turn is five steps that teach by doing
  (move, let the staff plan the rest, end the turn, watch, what next), each with one highlighted
  action; its e2e fits 120 s on a loaded machine (about 100 s at load 30, was over 140 s). The title
  has a cold open (letterbox, logo resolve, light sweep), missiles arcing between rival cities, a
  LIVE wire of the theatre's crises, Quick Battle (the open skirmish with the fewest stars, straight
  to its brief) and Settings (sound, radio, battle quality, motion, colours, map, haptics, hand,
  staff plan, replay, guided turn, install). The campaign briefing names a fictional commander per
  power; a deploy screen covers the world build and the game fades up from it. PWA: launch
  shortcuts (?quick=1, ?continue=1), an HTML boot splash. `?demo=1` plays an investor film through
  the real game (title, operation, turn, battle, air strike, end card). `menu.spec.ts` covers it.

## Outstanding

- Airborne (2.9.0): the rival powers jump only for an objective far by land with no beach near it; in 4
  AI-only campaigns none did (passage was asked for and signed in Cold Peace). On Normal, Japan's strikes
  off Tokyo on turn 1 bleed or sink the US convoy on most seeds (2 to 5 and 8 drop nobody in 6 turns), so
  the staff's airborne operation reaches Ulaanbaatar on some seeds only. Next: a staff that waits out of
  range until the convoy is safe, a second wave from the US ports, airbases in the AI's builds near its
  fronts. A passage that expires leaves troops on the other's land, where they stop at every border hex.

- iPhone: tested in Chromium with iPhone 14 Pro emulation (touch, viewport, DPR), not yet in real
  Safari/WebKit; verify on a device (audio unlock, safe areas, standalone launch).

- Balance (ruleset 2.9.0): 40 soak matches, 25 decisive, median turn 29; decisive wins USA 14,
  China 10, Russia 1, Japan 0 (Japan wins 4 on score). Human win rates (`pnpm test:difficulty`, 32
  a level): Easy 88%, Normal 59%, Hard 28% (2.8.0: 88, 47, 25); as the human seat Japan wins 4 of 8
  on Easy and on Normal, Russia 8 and 1.
  Russia and Japan still rarely win outright: Russia fights China on land and loses ground and
  stability; Japan climbs to 26-28% standing and seldom past 29%. The median sits near 30 because a
  third of matches still reach the limit; supremacy at 28% gives 80% decisive and median 25.
- The staff after an operation (ruleset 2.6.0; playtest: China took Taipei on turn 4, then sat on
  53 VP from turn 5 to turn 9): the staff planned every turn from an empty memory, so it chased a
  different prize each turn (Tokyo, Busan, Seoul, Tokyo...), and the store dropped its diplomacy,
  so the player stayed at war with all three powers and the army stood on its borders. Now the
  session keeps a staff memory per human seat (`GameSession.staffMemory`, saved as
  `SaveFile.staffMemory`; a 2.5.0 save starts it afresh), the store applies the staff's peace, pacts
  and trade (never a declaration of war), and when an operation is won the staff carries on toward
  its own next objective, names the best next operation in the notice, and the command card's
  "Plan an operation" row says which. Test: `packages/session/src/staff.test.ts`.
- AI at sea (2.6.0): a landing no longer walks into an enemy city whose garrison it cannot see (it
  lands beside it or storms it); troops across the water are no threat to a coast, an enemy
  amphibious group off it is; fleets hunt convoys within 6 hexes and guns and planes sink them
  first; an expedition under way holds its prize; a prize two hexes from an own port is as good as
  a walk; seen garrisons weigh more and a great power's unseen city is assumed held; a reserve is
  kept only of what an item costs, so a power out of energy still raises infantry and builds power
  plants (Japan raised nothing after turn 6). Data: parity now pays the small powers the land
  income they lack (Japan 113 credits a turn against China's 148 before); supremacy at 29% (31%);
  Normal's command edge halved; `HARD_AI_STOCKPILE` 105 (120).
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
  rotor wash and the biggest fireballs are the weakest effects. The AI never splits squads; a lone
  weak formation (guns only, drones only, one platoon) still often runs to the round limit. New nations per theatre not done.
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
