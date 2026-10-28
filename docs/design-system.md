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

- Ground, painted style (default): see "Painted map" below.
- Ground, clean style (menu): flat terrain colours (`ATLAS` in `MapView.tsx`) with one small mark
  per terrain: three trees, two hill arcs, a snow-capped peak, city blocks, waves. Plains are bare.
- Ground, satellite style (menu): Sentinel-2 imagery (credits in `public/art/CREDITS.md`), graded down by a dark wash.
- Zoomed out (below 0.95), the map turns political: nation names in their colour across their land,
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
| Phone game screen | `PhoneGame.tsx`, `phone.ts` | Status strip (turn, victory bar, funds, goal), unit card with stack row and attack card, dock (Nation, Plan, Next, End Turn), debrief, sheets |
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
single texture (about 90 ms; repainted only when land is explored). No canvas blur filters, which
Safari lacks: soft edges come from stamped radial gradients, and every stroke is seeded per hex so
the land never changes between paints. In order:

1. **Sea** all round the land, deep at the margins, with shallows and surf along the coast.
2. **Ground**: a base colour per hex, a soft disc of it spilling past each edge so neighbours blend,
   jittered blobs for variation, then light and shade across many hexes (sunlit downs, dark valleys).
3. **Brushwork**: grass tufts, rock flecks, cobbles, ripples.
4. **Coasts, roads, rivers**: sand and surf where land meets water; dirt roads between developed
   hexes; rivers in four strokes (bank, deep, shallow, glint).
5. **Props**, back to front: round-canopied trees, rock peaks with snow, rounded hills, houses, walled
   towns and castles, depot yards, standing stones on objectives. They keep to the rim of each hex:
   the middle is a clearing for the army counter.
6. **Light**: warm from the top left, a vignette, unexplored land kept dark.

Over it, in Pixi: each nation's land under a 10 % wash of its colour (one path per nation, so no
seams), and borders that glow (11 px at 18 %, 5.5 px at 45 %, a 2.2 px core lifted toward white).
Zoomed out, nation names in Cinzel, cream with a dark keyline and a glow in the nation's colour.

`apps/web/src/paint/life.ts` keeps it alive (decoration only, never game state):

| Layer | What |
|---|---|
| Fog | Banks of cloud over unexplored hexes, gently heaving |
| Cloud shadows | Six soft shadows drifting west to east |
| Water | Glints that twinkle on the sea and rivers |
| Fronts | Wherever your stack stands next to an enemy at war: an ember glow on the contested edge, and both sides firing (muzzle flash, tracer, shell burst, smoke), up to 16 fronts |
| Fires | Smoke rising where last turn's battles and strikes landed |

With reduced motion only the fog stays (still). Measured in Chromium: no frame-rate cost against the
clean style, which draws thousands of vector shapes instead of one texture.

## Console (v3): text screens

Every text screen wears `.vercel` on its root: the title, setup, archive, manual, skirmish, the
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
