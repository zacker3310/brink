# Brink design system: Command Table (v2) and Console (v3)

v3 adds two things to the Command Table below: a **painted map** that reads like a fantasy world
map (a MOBA or MMO overworld) with battles that play out live along every front, and **Console**,
a developer-console look for every text screen. Both are described in their own sections at the end.

Brink is a war game you should be able to play in a waiting room. v1 ("ISR picture") looked like a
real drone feed and played like one: three tiny vehicles and a NATO chip per hex, four resources in
the top bar, and odds you only saw after committing to a target. v2 keeps the real ground and the
real war, and borrows its clarity from the strategy games that are easiest to pick up:

| Borrowed from | What |
|---|---|
| Into the Breach | Show the outcome before the player commits: every enemy you can hit is tagged WIN, EVEN or RISKY on the map. |
| Advance Wars, Polytopia | One counter per unit with one number on it; tap to select, tap to act; blue = where you can go, red = what you can hit. |
| Board wargames | Units are counters: a tile with a pictogram and a strength. A stack is one counter with a count. |
| Polytopia | One headline resource on screen (funds); the rest only when they run short. |

## Principles

1. **Consequences before commitment.** Reach, targets and odds are on the map the moment a stack is
   selected. Nothing important is behind a hover or a second screen.
2. **One number per thing.** Units: strength 1 to 10. Nations: victory points. You: funds.
3. **Always an answer to "what now?".** The amber goal ring (and the goal chip on a phone) names
   the most valuable place you do not hold that you can reach; Next walks the stacks still waiting;
   Plan has the staff draft the rest.
4. **Thumb first.** Every target is at least 44 px; everything you do is in the bottom third.
5. **Calm map, loud decisions.** Ground imagery is graded down; only territory, units and the
   current choice are saturated.

## Tokens

CSS tokens are in the `@theme` block of `apps/web/src/index.css` (Tailwind utilities such as
`bg-ink-900`, `text-signal`); `design/tokens.ts` mirrors what the Pixi map needs. Change both.

### Colour

| Token | Value | Means |
|---|---|---|
| `ink-950` … `ink-600` | `#0d1114` … `#36424a` | Surfaces: warm slate, never pure black |
| `line` | `#33404a` | Borders |
| `text` / `muted` / `faint` | `#f3f5f6` / `#b4bfc6` / `#8794a0` | All pass WCAG AA on `ink-900` |
| `signal` (command amber) | `#ffc23d` | The one accent: whatever is waiting on you, End Turn, the goal |
| `friend` | `#4fb3ff` | You: selection, reach, your planned moves |
| `hostile` | `#ff5a4e` | Enemies, attacks, losses, RISKY |
| `good` | `#4fd18b` | Gains, WIN |
| Nation colours | scenario data | *Who* owns something: territory, counters, banners |

Rules: blue is always you, red always the enemy or a loss, amber always "your move". Nation colour
says who; it never replaces friend/foe.

### Type

| Role | Face | Use |
|---|---|---|
| Display (map HUD) | Barlow Condensed 700–800, uppercase for labels | The tactical HUD over the map: counters, banners, the dock, the turn button |
| UI | Geist (variable) | Everything else; Console screens use it for headings too |
| Mono | Geist Mono (variable) | Small uppercase labels, data, keyboard hints |
| Region names | Cinzel 700 | Nation names across their land on the painted map, only |

Tabular figures everywhere (set on `body`). Minimum size on a phone: 11 px for labels, 13 px for
sentences. Self-hosted from npm (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`,
`@fontsource/barlow-condensed`, `@fontsource/cinzel`), latin subset.

### Shape and motion

- Radius: 6–12 px on interactive surfaces (cards, buttons, chips), full for pills and round buttons.
- Panels are flat: `ds-panel` (layered, so a panel's own position utilities win).
- Motion: 120 ms feedback, 240 ms sheets, `cubic-bezier(0.2, 0.7, 0.2, 1)`; reduced motion respected.

## Units: counters

`counters.ts` draws every unit on the map, live and in the replay. `design/pictograms.ts` holds the
pictograms, drawn for this game on a 32 x 24 grid: side profiles of a rifleman, an IFV, a tank, a
self-propelled howitzer, an armoured car and an attack helicopter, and a quadcopter from above. The
interface uses the same shapes (`<UnitGlyph>`), so a unit looks the same everywhere.

- **Yours:** a tile in your nation colour, white edge, dark pictogram.
- **Theirs:** a dark tile edged and drawn in their colour; a red tab on top when you are at war.
- **Strength:** the number in the corner, 1–10 (strength rounded up to tenths).
- **Stack:** one counter per hex per side, tiles peeking out behind and a white count badge. The
  counter on top is the selected unit, else one still waiting, else the strongest.
- **Waiting for orders:** an amber dot top left.
- **Selected:** a blue ring. Aircraft float over a ground shadow. Planned destinations show a ghost.
- Counters grow on screen when the map is zoomed far out, up to the size of a hex.

The 3D renders in `public/art/units` stay as portraits in the city build list and the desktop unit
panel.

## Map

- Ground, painted style (default) and paper style (menu): see "Painted map" below.
- Ground, clean style (menu): flat terrain colours (`ATLAS` in `MapView.tsx`) with one small mark
  per terrain: three trees, two hill arcs, a snow-capped peak, city blocks, waves. Plains are bare.
- Ground, satellite style (menu): Sentinel-2 imagery (credits in `public/art/CREDITS.md`), graded down by a dark wash.
- Zoomed out (names fade in below 1.0), the map turns political: nation names in their colour across their land,
  city banners hidden on a phone.
- Territory: nation colour at 20 % (12 % where only remembered), 3.5 px borders on a dark keyline.
- Reach: blue fill with a bright outer edge. Targets: red ring, plus an odds tag under the hex
  (green WIN, amber EVEN, red RISKY) for the selected stack's attackers (`odds.ts`).
- Goal: two amber rings on the suggested objective (`objective.ts`).
- Cities: banners with population, name and VP; on a phone they sit under the counter, inside
  their own hex, and give way to an odds tag when the city is a target.

## Interaction (touch)

Tap your counter: the whole stack is selected, led by its slowest ground unit (its reach is where
everyone can go). The stack row in the card turns units in or out. Tap a blue hex: everyone who can
reach it moves. Tap a tagged enemy: the card shows who attacks, the odds in words and the expected
losses; tap again or Attack to commit. Desktop keeps the mouse model (select, right-click to order,
hover combat card) and gets the same map.

## Components

| Component | File | Notes |
|---|---|---|
| Phone game screen | `PhoneGame.tsx`, `phone.ts` | Status strip (turn, victory bar, funds, hand, goal), dock (Nation, Plan, Next, End Turn), and over the dock exactly one card at a time: the command card (operation row, one line of advice, a row of 44 px chips for a decision, idle cities, last turn), the unit card, the hex card (only for a hex you tapped), the aim banner or the debrief; sheets |
| Map pointers | `opspot.ts`, `MapView.tsx` | The running operation's current place (port or beach) in a dashed amber ring with a tag; every hex an armed card can take in friend blue |
| Counters, pictograms | `counters.ts`, `design/pictograms.ts`, `glyphs.tsx` | The only way to draw a unit |
| Odds, goal | `odds.ts`, `objective.ts` | Shared by map and cards |
| World card, How to win | `PhoneGame.tsx` | The whole theatre with war/peace per nation; the three-step brief |
| Research, Diplomacy | `Panels.tsx` | Plain-word cards, one decision each; research funding Low / Normal / High |
| Desktop HUD | `Game.tsx`, `UnitPanel.tsx`, `MapOverlays.tsx` | Mouse and keyboard |
| City banners, production | `Cities.tsx` | Production is a bottom sheet on a phone |
| Coach | `Coach.tsx`, `coach.ts` | Guided first match, touch wording on phones |
| Sound | `sfx.ts` | WebAudio, no files |

## Painted map (v3)

`apps/web/src/paint/ground.ts` paints the whole theatre procedurally into one canvas, baked into a
single mipmapped texture (repainted only when land is explored or a town grows or builds). The map
paints it in steps (`paintSteps`, about 12 ms a frame), keeps the old ground until the new one is
done and fades it in, so a paint never holds the page still; the menu backdrop paints it in one go
(`paintTheatre`). Marks of one colour (tufts, flecks) go down as one path. No canvas blur filters,
which Safari lacks: soft edges come from stamped radial gradients, and every stroke is seeded per
hex so the land never changes between paints. In order:

1. **Coastline**: every edge between land and anything else is traced into closed loops, roughened
   (three seeded points per edge, fixed at the corners) and smoothed twice by corner cutting, so the
   shore wanders a few pixels either side of the hex edge instead of following the grid. Land at the
   theatre's rim runs on three hexes past it and sinks into shadow, so the map never ends in a ruled
   coast.
2. **Sea**: deeper the further from land (a breadth-first distance per water hex), broad patches of
   lighter and darker swell, ripples; a shelf of shallows stepping out from the shore in twelve
   low-contrast bands, then a ring of surf.
3. **Ground**, painted on a sheet of its own and cut out along the coastline in one operation
   (clipping each of thousands of strokes to the coast is many times slower): a base colour per
   hex, a soft disc of it spilling past each edge, jittered blobs, paler lowland toward the beach,
   light and shade across many hexes, then **hillshade**: every hex lit by how its ground slopes
   toward the light in the north-west (heights: water −1, plains 0, forest 0.4, hills 1.3,
   mountains 2.8), and high ground with a lit shoulder and a dark flank of its own.
4. **Brushwork, roads, rivers**: tufts, flecks, cobbles; dirt roads between developed hexes; rivers
   in four strokes. A sand beach along the whole shore.
5. **Props**, back to front, only where the spot is land (read from a half-resolution mask of the
   coast): trees, rock peaks with snow, hills, houses, standing stones, depot yards. **Towns grow
   with their people** (one size step per 300 thousand, as on the banner): a wider wall, more
   towers, streets from the gates to the square, suburbs spilling past the wall; a capital has a
   keep with a pennant. **What is built shows**: smoking works (factory), a cooling tower (power
   plant), strip fields (farm), a pithead (mine), a domed laboratory, a star fort (fortress); a port
   has quays and boats on its seaward side. The middle of every hex stays a clearing for the counter.
6. **Light**: warm from the top left; unexplored land dark under soft cloud; a vignette and margins
   that fade to exactly the colour beyond the canvas; the faint grain of paper over everything.

**Paper** (map style menu): the same map printed in sepia inks on parchment, the sea in a cool wash
of ink so land and water still part, laid on a dark table (`TABLE`) instead of the open sea.

Over it, in Pixi: each nation's land under a 10 % wash of its colour (exact hex polygons in one path
per nation, so no seams and no doubled edges), borders that glow (11 px at 18 %, 5.5 px at 45 %, a
2.2 px core lifted toward white), and ground only remembered under a cool 30 % haze. **Level of
detail**: the hex grid fades in from zoom 0.8 to 1.7; nation names in Cinzel fade in below zoom 1.0;
counters grow when zoomed far out (`counters.ts`). **Frame rate**: full rate while the player
touches the map, the camera moves, the board changes or a turn replays; after two still seconds only
the ambient life moves, drawn at 24 frames a second.

`apps/web/src/paint/life.ts` keeps it alive (decoration only, never game state):

| Layer | What |
|---|---|
| Fog | Banks of cloud over unexplored hexes: a dark body, lighter billows lit from the north-west, wisps reaching over known ground at the edge, gently heaving. Fog and mist are baked at quarter resolution into four textures (rebuilt only when what is seen changes), so each frame draws four sprites, not thousands of puffs |
| Mist | A pale veil over ground seen but not seen now, in two banks that breathe out of step |
| Cloud shadows | Six soft shadows drifting west to east |
| Water | Glints that twinkle on the sea and rivers |
| Fronts | Wherever your stack stands next to an enemy at war: an ember glow on the contested edge, and both sides firing (muzzle flash, tracer, shell burst, smoke), up to 16 fronts |
| Fires | Smoke rising where last turn's battles and strikes landed |

With reduced motion only the fog and mist stay (still). The turn replay (`replay.ts`) draws a wake
behind every moving formation, missiles on smoke trails with a ground shadow and a closing aim ring,
shell bursts and shock rings over battles, and a banner in the new owner's colour over every
captured town (its name, and who took it).

## Console (v3): text screens

The home screen and the campaign briefing are the exceptions: they are game screens, not console
pages (see "Home" and "Campaign briefing" below). Every other text screen wears `.vercel` on its
root: archive, manual, skirmish, the
command sheet and side panels, the report, the order review, the city panel, the battle brief and
verdict. The class re-points the tokens, so every utility inside follows, and resets display type to
Geist in sentence case. Menus also wear `.vercel-mono`, where the accent is white; in-game sheets
keep command amber as the colour of the next action.

| Token (inside `.vercel`) | Value |
|---|---|
| ink-950 / 900 / 850 / 800 / 700 | #000 / #0a0a0a / #111 / #1a1a1a / #2e2e2e |
| line | #262626 |
| text / muted / faint | #ededed / #a1a1a1 / #737373 |
| friend / good / hostile | #3b9eff / #3ecf8e / #ff5f56 |

Components (`index.css`, `chrome.tsx`):

- **Top bar** (`ScreenHeader`): the Brink mark, a breadcrumb (Brink / section / screen), Esc.
- **Buttons**: `v-btn v-btn-primary` (white on black, the one main action) and `v-btn-secondary`
  (black with a hairline). 40 px tall, 6 px radius, Geist 500.
- **Cards**: `v-card` (#0a0a0a, 1 px #262626, 12 px radius), `v-card-link` brightens the border on hover.
- **Labels**: `ds-label` and `v-kicker` are the only capitals: Geist Mono 12 px, muted.
- **Backdrop**: `v-backdrop`, a 64 px engineering grid fading down from a soft top glow.
- **Headlines**: `v-gradient-text`, white to grey, tight tracking (-0.045em).

The CSS is deliberately outside Tailwind's layers so it wins over utilities on the same element. The
same is true of the `safe-*` padding classes: never put `safe-x` and `px-*` on one element.

## Campaign briefing (v3)

New campaign (`menu/Setup.tsx`, `.wr-*` in `index.css`) is a war-room briefing in the home screen's
language. It sits inside the menus' `.vercel` scope but sets its own type, so display faces survive.

- **Two accents**: engraved metal for command (the operation codename, the deploy button, selected
  parameters, victory figures); the chosen nation's colour (`--nation`) for who you are (roster,
  dossier, order of battle, map focus). Green and red stay gains and losses. Command metal is gold
  (`--cmd-*` tokens on `.wr`), except for a nation whose own colour is in the gold-olive band
  (`nearGold()`, China today): then it is platinum (`data-command="platinum"`), so who you are and
  what you command never read as one colour. The domination line is always white.
- **Hero**: the theatre map full bleed on a phone, a framed card on a desk, with gold registration
  corners. The codename sits below the map, never over it, in Barlow Condensed 800 with a TOP
  SECRET stamp; the legend sits beside it from 768 px.
- **No overlaps**: no text or control sits on another. Both bars (top, phone dock) are opaque, so
  content scrolls under them without showing through. Figures count up when the nation changes
  (still under reduced motion).
- **Dossier**: the nation name in display caps, doctrine as a pull quote, VP held on a bar against the
  domination line, posture stats on hairlines, income as bars, order of battle as counter tiles.
- **Deploy**: a metal button with a hazard edge. On a phone it is docked over the thumb on an
  opaque bar, portalled to `<body>` because the menus' entrance animation transforms an ancestor and
  would trap a fixed element inside the scroller.
- **Layout**: phone is one column (hero, roster, dossier, parameters); a desk is roster | theatre and
  parameters | sticky dossier.

## Home (v3)

The home screen is a game title screen (`menu/Title.tsx`, `menu/TitleScene.tsx`, `.home*` in
`index.css`):

- **Backdrop**: the painted Pacific theatre, full screen, at war. Fronts burn along the realm
  borders and the no-man's land between them (`MapLife.addFront`, `addFire`), clouds pass, and the
  camera drifts and breathes over it. In portrait the war is framed in the top third, above the menu.
- **Title**: BRINK in Cinzel 900 with a gold-on-bronze gradient and a dark keyline, the scenario name
  in tracked gold caps above it.
- **Menu**: big condensed caps, the first item larger in gold; the selected item gets a glowing gold
  bar and a gold wash. Arrow keys, number keys, Enter; 52 px touch rows.
- **Corners**: your record (stars, battles won, wars won) and the version and a sound toggle.
- A shade keeps the menu legible over the map: from the left on wide screens, from the bottom on
  phones.
