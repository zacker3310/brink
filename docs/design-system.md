# Brink design system

Brink looks like the war as it is fought and watched now: an ISR picture. Satellite-style ground,
top-down models of real vehicles, and a flat command-and-control HUD over it (the way Ukraine's
DELTA puts drone and satellite feeds on one map, and the way WARNO and Regiments show models up close
with NATO markers far out). Instrument-black glass, one sensor-lime accent, wide heavy caps for
headings. No bevels, grain, corner brackets, scanlines or emoji.

| Layer | Standard | Where |
|---|---|---|
| Unit symbols | NATO APP-6 / MIL-STD-2525 via [milsymbol](https://github.com/spatialillusions/milsymbol) (MIT) | `apps/web/src/design/symbols.ts` |
| Affiliation colour | APP-6 affiliation colours (friend blue, hostile red, neutral green, unknown yellow) | `index.css` `@theme`, `design/tokens.ts` |
| Body and display type | Archivo variable, width axis 100-125% (OFL) | `main.tsx` via `@fontsource-variable/archivo` |
| Data type | Martian Mono (OFL) | `main.tsx` via `@fontsource/martian-mono` |

Fonts are self-hosted from npm: no third-party requests, works offline and under test.

## Tokens

CSS tokens live in the `@theme` block of `apps/web/src/index.css` and become Tailwind utilities
(`bg-ink-900`, `text-signal`, `font-display`). Pixi cannot read CSS, so `design/tokens.ts` mirrors
the values it needs. Change both together.

### Colour

| Token | Value | Use |
|---|---|---|
| `ink-950` … `ink-600` | `#070909` … `#2a3134` | Surfaces, darkest (page) to lightest (raised control) |
| `line` | `#252c2e` | Hairlines and panel borders |
| `text` / `muted` / `faint` | `#eef1ee` / `#9fa8a6` / `#6a7472` | Primary, secondary and tertiary text |
| `signal` | `#d2f249` | The only accent, sensor-overlay lime: calls to action, planning, focus, idle warnings |
| `good` | `#57d3a0` | Positive outcomes: gains, income, health |
| `hostile` | `#ff4d42` | Enemies, attacks, losses, errors |
| `friend` | `#49b8ff` | You: selection, movement range, planned moves |
| `neutral` / `unknown` | `#8fd694` / `#ffe14d` | Nations at peace / unidentified |

Rules: one lime thing per region asks for action. Red always means enemy or loss, blue always
means you. Nation colours identify *who*; they never replace affiliation colour for *friend or foe*.

### Type

| Role | Face | Class | Use |
|---|---|---|---|
| Display | Archivo 700–900 at 112% width (125% for screen titles), uppercase | `ds-display` / `font-display` | Wordmark, headings, unit and city names, big numbers, buttons |
| Label | Archivo 650 at 108% width, 10px, +0.08em, uppercase, `faint` | `ds-label` | Section labels |
| UI | Archivo 400–600 | default | Body copy, descriptions, tooltips |
| Data | Martian Mono 400–500, tabular | `font-mono` | Every number that changes |

Scale (px): 9, 10, 11, 12, 13, 15, 18, 22, 28, 40, 64+. Numerals are tabular everywhere.

### Space, shape, depth, motion

- 4px grid. Panels pad 12–16px; dense lists 6–8px.
- Hard edges: radius 0–2px. Round shapes are reserved for actions (unit orders) and notifications.
- Surfaces: `ds-panel` is flat glass: translucent ink, hairline border, blur, a soft drop shadow.
- Icons: `icons.tsx`, 16 px grid, square caps. Never emoji.
- Motion: 120ms for hover, 220ms for panels, 380–620ms for screen entry, easing
  `cubic-bezier(0.2, 0.7, 0.2, 1)`. Everything respects `prefers-reduced-motion`.
- `ds-hazard` warning tape is for blocking states only.

## Units and ground

The map is an ISR picture made of real imagery (`apps/web/public/art`, credits in `art/CREDITS.md`,
pipeline in `tools/art`). Ground is Copernicus Sentinel-2: one real 10 km scene per terrain, stretched
once across the theatre so it never repeats; city hexes always sample dense blocks of a real city.
Units are top-down renders of open-licensed 3D models (T-72, AH-64D with its rotor turning on the real
hub, a quadcopter team, posed infantry, a howitzer battery, troop truck and patrol vehicle) lit from the
north-west with cast shadows, each with a recognition panel in the nation colour. Depots are a compound
of containers, Hesco walls, a tent and a watch tower. The replay fires explosion and smoke frames on
strikes, battles and kills. If the art cannot load, the procedural fallback below draws instead:
satellite-style ground (`design/terrain.ts`) under top-down models of every formation (`design/models.ts`): tanks with
turret and gun, an IFV with dismounts, a rifle section in a wedge, a self-propelled gun, a wheeled
recon vehicle, an attack helicopter whose rotor turns over its ground shadow, and a drone team
circling its hex. Vehicles wear their nation's camouflage (woodland, Eastern green, desert, urban
grey) and carry the nation colour only as recognition markings. Units in one hex deploy in
formation; aircraft fly over the ground units. The APP-6 chip and health bar ride above each
model at a constant size on screen, so far out you read symbols and up close you see vehicles.

## Symbology

Every formation is drawn as an APP-6 unit symbol (`design/symbols.ts`).

- **Frame shape = affiliation**: rectangle for yours and allies, diamond for nations at war with
  you, square for nations at peace.
- **Fill = owning nation's colour**, so four players stay distinguishable.
- **Icon = class**: infantry ✕, mechanized ✕ with oval, armor oval, artillery dot, recon slash,
  air (aviation) bow-tie.
- **Echelon**: all formations are brigades (X above the frame on the map).
- **Dashed frame** (status *anticipated*): a planned destination ghost, or a last-known contact.
- On the map each symbol carries a health bar (green, then amber, then red), an amber dot when it
  has no orders, and a stack badge when several share a hex.

In React use `<UnitGlyph unitClass color affiliation planned />`; in Pixi use `addCounter` from
`counters.ts`. Never draw a unit any other way.

## Components

| Component | File | Notes |
|---|---|---|
| `Frame`, `Label`, `Kbd`, `ScreenHeader` | `chrome.tsx` | Shared chrome for menus and panels |
| `UnitGlyph`, `Emblem` | `glyphs.tsx` | APP-6 symbol; national emblem |
| `Button`, `Meter`, `Stat`, `Swatch` | `ui.tsx` | Small controls |
| Unit panel, turn controls | `UnitPanel.tsx` | Bottom-left / bottom-right HUD |
| City banners, city panel | `Cities.tsx` | Over-map banners, production picker |
| Combat card, hover card, minimap | `MapOverlays.tsx` | Map overlays |
| Notifications | `Notifications.tsx` | Right-edge turn results |
| Coach | `Coach.tsx`, steps in `coach.ts` | Guided first match; bottom centre, a strip beneath the turn summary; on a phone under the status strip, with touch wording |
| Phone game screen | `PhoneGame.tsx`, `phone.ts` | Under 760 px wide (or a short touch screen): status strip, thumb dock (44 px minimum targets), sheets for Command and Menu, debrief card, target-lock card |
| Sound | `sfx.ts` | WebAudio synthesis, no files; unlocked on the first touch |

## Map overlays

Blue (`friend`) fill and a bright border mark the selected unit's movement range; red (`hostile`)
rings mark enemies it can hit. Hover draws a dashed path in the colour of the order it would give.
Locked orders draw solid, white once submitted. Borders between nations are 4px in nation colour.
The threat overlay fills hexes in `hostile` with alpha rising per enemy that could strike there, with a
bright edge on its boundary; hovering an enemy draws the same for that unit alone.
