# Brink Master Plan

The north star: **Civ 5 on top, Call of Duty in the arena, on a phone.**

- **The war table.** Hexes, nations, turns planned in secret and resolved at once. You run a war
  across a theatre, then the whole world.
- **The arena.** When a fight matters, you drop into it. You are the commander, not a soldier. You
  say "three Apaches in on the ridge, deploy a squad and a tank at the bridge, send the kamikaze
  drones at the SAM site". The engine resolves it turn by turn. The camera films it like a
  blockbuster.
- **It scales.** It starts in the Pacific, then Europe, Asia and the rest of the globe. Then the
  Black Files: Antarctica, Area 51, and whatever is under the ice.

What stays fixed through every phase:

- One deterministic engine.
- Integer state.
- Fog-safe views: the UI and the AI see only `NationView`.
- 0 rejected AI orders in the soak.
- Mobile first, and fully playable on desktop.

---

## How it is built

**Lanes.** Each phase runs as waves of parallel agents. Each agent works in its own worktree and
owns a disjoint set of files. A new feature lands as new modules. Shared screens
(`PhoneGame.tsx`, `Game.tsx`, `store.ts`, `packages/ai/src/index.ts`) get mounting lines only.

**Merge protocol.** The integrator merges one lane at a time into the integration branch. After
each merge it reruns the full gate:

- typecheck, lint and unit tests;
- soak (0 rejected), matrix (0 genuine failures);
- the end-to-end specs the lane touched, plus both playthroughs.

It pushes only when the gate is green.

**Rules versioning.** Any rule or data change bumps `RULESET_VERSION`. The integrator settles the
final number at merge. Save migrations key on whether a field is present, never on the version
string, so they are idempotent. Every migration has a test that loads an older save.

**Proof of play.** Every phase ends with:

- a scripted phone playthrough, with screenshots looked at, not just passed;
- a desktop playthrough;
- a soak with the numbers written into `PROGRESS.md`.

**Out of scope for good:**

- First-person or real-time direct control.
- Real heads of state by name or likeness. Leaders are invented.
- Copyrighted art or audio. Everything is drawn or synthesised in code.

---

## Phase 1: Foundations overhaul (in flight)

**Goal:** the current game, made deep and handsome. Eight lanes are running now.

| Lane | Owns | Delivers |
|---|---|---|
| Staff AI | `packages/ai` | A staff that keeps winning after an operation; island powers that play the sea; 55–70% decisive wars |
| Arena pacing | `packages/arena`, arena camera, desktop layout | Battles won, not timed out; "Fight it yourself" for staff attacks |
| Research and cities | new `simulation`/`game-data` modules | A tech tree in 5 branches; city districts and build queues |
| Leaders and diplomacy | treaties, `Diplomacy.tsx` | Invented leaders with agendas, grudges, itemised moods, deals and ultimatums |
| War map visuals | `MapView`, `paint/` | Coastlines, relief, growing cities, glowing borders, animated resolution, real fog, detail levels |
| Front door | `App`, `menu/`, coach | Cinematic title, nation pick, Quick Battle, a 3-minute tutorial, PWA, `?demo=1` |
| Arena art | `models3d/`, `world/` | Kitted soldiers, distinct tanks, weathering, craters, Pacific biomes |
| Audio | `audio/` | Adaptive score, battle music, weapon sound design, stingers |

**Exit criteria:**

- All eight lanes are merged and the gate is green.
- `pnpm test:difficulty` lands near Easy 85–90%, Normal 55–60%, Hard ~30%.
- The new player's phone playthrough reaches a decisive outcome by turn 30.

---

## Phase 2: Command the battle

**Goal:** the arena becomes the place where you *spend* what you prepared on the war table. You
command combined arms in groups, not one unit at a time.

### Group orders

- **Select by gesture.** Lasso on a phone, drag-box on desktop, or "all helicopters" chips. The
  selection becomes a **group**.
- **One order for the whole group:** move, assault, overwatch, screen, hold.
- **Formations:** column, line, wedge, and a helicopter "stack" with spacing kept.
- **Group plans resolve unit by unit in the engine.** The rules don't change; the input does.

### Deployment phase

Before round 1, you place your force on the deployment zones the war map earned you:

- the attack direction;
- landing zones for helicopters;
- the beach for an amphibious assault;
- a drop zone if you hold air superiority.

Prep work shows up here. A good operation gives you more zones, earlier turns and better ground.

### Reserves and reinforcement waves

- The rest of the war-map stack is held off the field as **reserves**.
- You call reserves in at the edge or a landing zone. Each call costs **Command Points**: a new
  per-battle resource, fed by your general's level, doctrine cards and tech.
- **Waves:** "UH-60s bring a squad onto the roof", "a tank platoon at the south road".

### The Call-in bar

Support earned on the war table, plus support earned in the battle by kills and objectives, fills
a bar of call-ins. It works like killstreaks, minus the twitch:

- **Drone swarm:** FPV or Lancet/Switchblade, the kamikazes. Pick a target, and they arrive next
  turn as a swarm the enemy's air defence must split its fire over.
- **Cruise missile salvo, JDAM run, gunship orbit** (an AC-130-style orbit for 2 rounds), **naval
  gunfire, HIMARS, thermobaric rockets, EMP drone** (blinds an area's drones and radios for a
  round).
- **Smoke wall, decoys, UAV sweep** (reveals the fog for a round), **airborne drop**.
- Every call-in has a real counter: SPAA, MANPADS, jamming, dispersal. The engine's seeded stream
  rolls interceptions, so a call-in is never an "I win" button.

### What else changes

- **Simultaneous execution option.** Both sides plan, then the round plays out in one cinematic
  pass. The engine resolves it the way the war map does: one snapshot, then commit. This is the
  biggest rules change in the arena; it runs beside the XCOM-style alternating mode until it
  proves itself.
- **Battle sizes by stakes.** A skirmish has about 10 units a side, a city assault 16–24, and a
  capital or D-Day landing 30+ (in waves). Larger battles use instanced models and the
  render-on-demand budget.
- **Back to the war table.** Battle results flow back: losses, captured equipment, general XP,
  morale. A crushing arena win grants a breakthrough: one extra move for the stack.

**Lanes:**
1. Engine (`packages/arena/v2`): groups, deployment, reserves, Command Points, call-in rules,
   simultaneous mode.
2. Arena AI: deploys, holds reserves, uses call-ins, and counters swarms.
3. Arena input UX: lasso, chips, group cards, call-in bar, deploy screen, on phone and desktop.
4. War-map bridge: operations and doctrine cards set zones and call-ins; results flow back.
5. Arena e2e and balance: a matrix covering every call-in and every counter.

**Exit criteria:**
- On a phone, a player can move three helicopters as one group, deploy a squad and a tank, and
  swarm a target with kamikaze drones within the first two rounds, using fewer than 10 taps.
- The matrix covers every call-in against every counter, with 0 genuine failures.
- Timeouts are under 25% of battles.

---

## Phase 3: The Call of Duty look

**Goal:** every turn plays out like a trailer. The input stays calm; the output is loud.

### The Director

A camera system that picks shots from the round's events:

- establishing aerials;
- low tracking shots behind advancing armour;
- over-the-shoulder shots on infantry;
- kill-cams on big hits, with a little slow motion on the killing blow;
- a helicopter door-gunner angle on air assaults;
- a missile-nose camera on cruise strikes.

It is skippable, it has a speed setting, and the "Motion" setting tames it.

### Feeds

When a call-in fires, short framed cutaways play: an FPV kamikaze feed (grainy, with a heads-up
display and signal noise), a thermal gunship view in white-hot/black-hot, a drone overwatch view.
You watch them; you don't fly them.

### Rendering

- **Post-processing by quality tier.** Bloom, colour grading per theatre (Pacific teal/amber,
  Europe grey/green, Antarctica blue-white), depth of field on kill-cams, film grain, vignette,
  heat haze, and dust and debris particles.
- **Destruction.** Buildings collapse in stages. Trees fall. Craters stay. Burning wrecks smoke for
  the rest of the battle. Bridges drop.
- **Weather and time of day.** Dawn, dusk, night (with a night-vision view mode), rain and fog,
  sandstorm, snow. Each one changes sight in the rules, not just the look.

### Interface and feel

- **A HUD with a military look.** A minimap with sweep, a compass ribbon, a call-in bar with
  ready-state glow, unit cards styled as dog-tag panels, a hit marker and a "+XP" pop on kills,
  and a round banner that slams in.
- **Sound with presence.** Phase 1's audio, extended: radio chatter beeps on orders, a
  call-in voice line (synthesised radio squelch and tones, no recorded voices), close and far
  mixes, and the score ramping with intensity.
- **Haptics on iOS and Android** for impacts, call-ins and kills.

**Lanes:** Director and camera · post-processing and quality tiers · destruction and weather (with
the rule hooks in the engine lane) · HUD and feeds · effects and particles · performance probes.

**Exit criteria:**
- The High tier holds 60 fps on a recent iPhone.
- The Low tier holds 30 fps on a 4-year-old Android, measured on real devices.
- Every call-in has a cinematic and a feed.
- Investor demo reel: a 90-second capture straight from `?demo=1`.

---

## Phase 4: The world engine

**Goal:** the map tech can hold any theatre and the whole planet. This is the precondition for
every later map.

- **Authored map format.** Replace the inline character grid with data files: terrain layers,
  nations, sites, straits, sea zones, resources and biomes. Add a CLI to validate them and a
  generator that turns real coastlines (public-domain Natural Earth vectors, baked offline) into
  hexes at a chosen scale.
- **A map editor dev tool.** Paint terrain, place cities and borders, and test-play in place.
- **Scale.** Maps up to about 160×80 hexes:
  - rendering in chunks;
  - level of detail by zoom (continent, theatre, front);
  - hierarchical pathfinding;
  - fog and supply computed incrementally;
  - a turn resolves in under 2 s on a phone, run in a worker.
- **N powers.** Generalise from 4 fixed powers to 2–12. Add alliances as blocs (NATO-style, a
  Shanghai bloc, non-aligned states). Teams share vision when the treaty says so.
- **Global systems:**
  - sea zones and chokepoints (Malacca, Suez, Hormuz, Gibraltar, Panama, Bosphorus, Taiwan
    Strait, GIUK);
  - trade routes and convoys that can be raided;
  - strategic resources: oil, rare earths, chips, food;
  - stability under blockade.
- **Theatre links.** A world campaign is made of theatres. A war can run on several fronts.
  Forces move between theatres by sea and air lift, which takes turns and can be intercepted.

**Lanes:** map format and generator · editor · renderer at scale · engine N-powers and blocs · trade
and chokepoints · performance.

**Exit criteria:**
- The Pacific is re-authored in the new format with an identical soak.
- A 12-power, 160×80 test map soaks with 0 rejected orders.
- Its turn resolves in under 2 s on a phone.

---

## Phase 5: The European theatre

**Goal:** the second full theatre, with its own feel.

- **Map:** from the Atlantic to the Urals, and from the Arctic (Kola and Svalbard) to North Africa
  and the Levant. It includes the Baltic, the Black Sea, the Mediterranean, the GIUK gap and the
  Suwałki corridor.
- **Powers** (playable; all leaders invented): the United States (expeditionary), the United
  Kingdom, France, Germany, Poland, Russia and Turkey. Minor states include the Baltics, the
  Nordics, Ukraine, Belarus, the Balkans, Italy, Spain, Iran and Israel. The scenario setup picks
  which ones are present.
- **Rosters and doctrines:**
  - Leopard 2A7, Challenger 3, Leclerc, K2 (Poland), T-90M;
  - Typhoon, Rafale and Gripen as support sorties;
  - Storm Shadow / SCALP, Iskander, Kinzhal;
  - one national doctrine deck per power.
- **Theatre mechanics:**
  - **Winter:** mud season slows tracks and snow cuts sight.
  - **Rail logistics:** gauge breaks at the Polish border.
  - **Nuclear umbrella pressure** (see Phase 7).
  - **Alliance cohesion:** NATO-style Article 5 triggers that can fracture.
- **Arena biomes:** Central European towns, birch forest, steppe, Baltic coast, snow, mud.
- **Scenarios:** *Suwałki Gap*, *Baltic Gambit*, *Black Sea Fleet*, *Bosphorus Crisis*.

**Lanes:** map and data · nations and doctrines · AI for land-heavy theatres · arena biomes and
rosters · scenarios and e2e.

---

## Phase 6: Asia, the Indian Ocean and the southern hemisphere

**Goal:** fill in the rest of the map, one theatre at a time.

**Theatres:**
- **South Asia:** India and Pakistan, the Himalayan line with altitude rules and hidden
  helicopter ceilings in the arena.
- **Southeast Asia:** Vietnam, the Philippines, Indonesia and Malaysia. The South China Sea islands
  can be built up as fortified reefs.
- **Oceania:** Australia (with AUKUS-style submarines) and New Zealand.
- **Middle East:** the Gulf, Hormuz and oil shocks.
- **The Americas:** a north–south theatre and the Panama Canal.
- **Africa:** the Horn, the Sahel, and Suez from the south.

**New systems:**
- Submarine warfare as a hidden layer on the war map: sonar, ASW cards.
- Carrier strike groups as named, stacked fleets with air wings that fly arena sorties.
- Island-hopping operations: chained amphibious ops built automatically by the operations planner.

**Exit criteria:** every theatre has a soak passing on its own, a 4–6 power scenario and a
phone playthrough.

---

## Phase 7: World war and the brink

**Goal:** the full planet as one campaign, and the mechanic the game is named for.

- **The world map.** All theatres joined: 8–12 major powers and dozens of minor states, with
  theatre fronts that matter to each other. Losing Suez starves the Mediterranean. Cutting
  Malacca chokes East Asia.
- **The escalation ladder (the Brink).**
  - A global tension track runs from Peace through Crisis, Conventional War and Limited Nuclear
    Use to Strategic Exchange.
  - Every power has red lines, invented by its leader's personality. Crossing one moves the ladder.
  - Nuclear weapons exist as deterrence cards, alert levels and second-strike posture:
    - tactical use is possible, at catastrophic diplomatic and stability cost;
    - a strategic exchange ends the game for everyone: a "nobody wins" screen with a score.
  - De-escalation tools: hotlines, summits, back channels, sanctions relief.
  - The AI reasons about the ladder as hard as about the front line.
- **Space and cyber.**
  - Satellites give vision and GPS.
  - Anti-satellite strikes blind a rival's war-map vision and degrade precision call-ins in the
    arena (GPS-guided munitions miss more).
  - Cyber cards hit grids, logistics and command (cuts to Command Points).
- **Intelligence.** Spies, double agents, false flags, leaked plans (you see a rival's next
  operation), counter-intel.
- **Victory types:** domination, supremacy, an alliance win, a diplomatic win (a world treaty) and
  a deterrence win (surviving to the end at the top without crossing the line).

**Lanes:** world assembly · escalation engine · AI deterrence reasoning · space and cyber ·
intelligence · balance across 12 powers.

---

## Phase 8: The Black Files

**Goal:** the secret campaign layer. It goes wild, but it plays by the same rules and the same
engine.

**How it starts.** An optional *Black Files* toggle at setup, or one found by accident: a world
event in the mid-game has a satellite pass over Antarctica return an impossible thermal signature.

**The race:**
- **Antarctica** becomes a theatre. Treaty-neutral at first, then contested, with ice-shelf hexes,
  whiteout weather and supply lines measured in fuel.
- **Excavation sites** are a new site type. Holding one for N turns yields **artefacts**.
- **Area 51** and other black sites (a Siberian Tunguska site, a Gobi site, a Bermuda deep site)
  are special facilities. Artefacts studied there unlock a **reverse-engineered** branch of the
  research tree:
  - railguns, directed-energy point defence, cloaked drones, anti-gravity lift (helicopter-class
    lift for tanks), quantum radar that sees through the fog.
- **Secrecy.** Black-site research is hidden from rivals until leaked. Spies can steal artefacts.
  A raid on Area 51 is a capital-grade battle with a black-site arena map: hangars, a dry lake
  bed, desert range.

**The arrival.** Past a threshold of excavations, *they* wake up. That's the Visitors, a fully
fictional faction with its own design language:
- crystalline walkers, swarm drones that split and re-form;
- shield emitters that make a hex impassable;
- terraforming that converts terrain.

The world map gets **incursion zones** that spread. Human powers can keep fighting each other, or
sign the **Accord**: a diplomatic win condition, with alliance mechanics under pressure. Betraying
the Accord near the end is a legal, dramatic, very Civ play.

**In the arena:**
- alien units with new rules: shields absorbing the first hits, phase-shift moves, energy weapons
  that ignore armour facing but are blocked by smoke;
- alien maps: Antarctic dig site, the ice cavern, the crashed ship interior, Area 51.

**Modes:**
- *Black Files* inside any world campaign.
- A standalone *First Contact* scenario: all humans against the incursion, co-op-ready for
  Phase 9.

**Lanes:** Antarctica theatre · black sites and artefacts · reverse-engineered tech · the Visitors
faction (data, AI, war-map behaviour) · alien arena units and art · alien maps and art direction ·
narrative events.

**Exit criteria:**
- Soak a Black Files world campaign with 0 rejected orders.
- The Visitors win sometimes (about 15–25% on Normal), so the threat is real.

---

## Phase 9: A living campaign, replay value and multiplayer

**Goal:** reasons to come back every day, and to bring friends.

- **Scenario library.**
  - Curated what-ifs: *Taiwan Strait*, *Suwałki Gap*, *Hormuz Closed*, *Kuril Gambit*, *Arctic
    Thaw*, *Black Files: First Contact*.
  - Each one has bespoke opening events, objectives and star ratings.
- **Generals' careers across games.** A roster of generals that persists between campaigns: level,
  perks and scars. A Hall of Fame records the fallen.
- **Daily and weekly challenges.** A seeded scenario with modifiers, a global leaderboard (scores
  are verified by replaying the deterministic log on the server), and medals and ribbons.
- **Achievements**, with a codex and encyclopedia of units, nations and techs, written in the
  game's own voice.
- **Multiplayer.** The deterministic engine makes it cheap:
  - hot-seat on one device;
  - **async play-by-turn** (orders go to `apps/api`, the server resolves, a push notification says
    the turn is in);
  - private leagues;
  - mixed human and AI seats.
- **Replays and sharing.** Any battle or war can be exported as a replay link, and the Director
  can render a highlight reel for social clips.
- **Modding hooks.** Scenarios and maps in the Phase 4 format, loadable from a file. A community
  scenario browser comes later.

**Lanes:** scenario library · persistent careers · challenges and leaderboard service · async
multiplayer (with `apps/api`, auth and push) · replay sharing · codex and achievements.

---

## Phase 10: Ship it

**Goal:** an app people can install, that runs well, and that makes money without making anyone
angry.

- **Native shells.** Capacitor wrappers for the iOS App Store and Google Play, with native haptics,
  push, Game Center / Play Games achievements, iCloud and Drive save sync. The PWA stays for the
  web.
- **Real-device performance programme.**
  - A matrix of 6 or more devices.
  - A frame-time budget per quality tier, thermal throttling tests, a memory ceiling, battery
    drain per hour.
  - Automatic quality picking.
- **Accessibility.** Colour-blind palettes (the APP-6 shapes already carry meaning), text
  scaling, a one-hand mode, VoiceOver labels on the war table, motion reduction, subtitles for
  stingers and cues.
- **Localisation.** Strings extracted. English, Japanese, Korean, Chinese (Traditional and
  Simplified), German, French, Polish, Spanish, Portuguese.
- **Telemetry for balance.** Opt-in and anonymous: win rates by nation, call-in usage, where players
  quit. These feed the difficulty and balance scripts. Crash reporting.
- **Business model** (an investor-facing call, not a design driver):
  - premium base game with the Pacific and Europe;
  - theatre expansions (Asia, World War, the Black Files);
  - cosmetic camo and insignia packs;
  - no pay-to-win, no energy timers.
- **Launch kit.**
  - A trailer cut by the Director.
  - Store screenshots from the playthrough specs.
  - A press kit.
  - A closed beta through TestFlight and Play Internal with a feedback form in the game.

**Exit criteria:**
- Store builds approved.
- The 60 fps / 30 fps targets met on the device matrix.
- Crash-free sessions at 99.5% or better in beta.

---

## Order and dependencies

```
Phase 1 ──► Phase 2 ──► Phase 3
   │            │
   └──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7 ──► Phase 8
                                               │
Phase 9 (from Phase 4 onward, multiplayer after 7) ─► Phase 10 (device work starts in Phase 3)
```

- Phases 2–3 (the arena) and Phase 4 (world engine) run **in parallel**. They share no files.
- Phase 8 needs Phase 7's escalation and space systems, and Phase 4's theatre links.
- The real-device performance work in Phase 10 starts in Phase 3. It is not saved for the end.

## Scale of the work

Each phase is about 2–4 waves of 4–8 lanes. One wave is a build-loop night: agents in parallel,
then merges and the gate. Phases 1–3 are a believable first demo-able vertical slice. Phases 4–8
are the content engine. Phases 9–10 make it a product.
