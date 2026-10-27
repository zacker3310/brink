# Brink design system: Command Table (v2)

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
| Display | Barlow Condensed 700–800, uppercase for labels | Headings, names, numbers that matter, buttons, counters |
| UI | Barlow 400–600 | Everything else |

One family, tabular figures everywhere (set on `body`); `font-mono` maps to Barlow so numbers line
up without a code font. Minimum size on a phone: 11 px for labels, 13 px for sentences.
Self-hosted from npm (`@fontsource/barlow`, `@fontsource/barlow-condensed`), latin subset.

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

- Ground: Sentinel-2 imagery (credits in `public/art/CREDITS.md`), graded down by a dark wash.
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
| Desktop HUD | `Game.tsx`, `UnitPanel.tsx`, `MapOverlays.tsx` | Mouse and keyboard |
| City banners, production | `Cities.tsx` | Production is a bottom sheet on a phone |
| Coach | `Coach.tsx`, `coach.ts` | Guided first match, touch wording on phones |
| Sound | `sfx.ts` | WebAudio, no files |
