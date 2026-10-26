# Brink design system

Brink looks like a field headquarters, not a web app: dark gunmetal surfaces, one tactical-amber
accent, condensed stencil-like headings, and real military symbology on the map. The system is
built on existing standards rather than invented ones.

| Layer | Standard | Where |
|---|---|---|
| Unit symbols | NATO APP-6 / MIL-STD-2525 via [milsymbol](https://github.com/spatialillusions/milsymbol) (MIT) | `apps/web/src/design/symbols.ts` |
| Affiliation colour | APP-6 affiliation colours (friend blue, hostile red, neutral green, unknown yellow) | `index.css` `@theme`, `design/tokens.ts` |
| Body and data type | IBM Plex Sans and IBM Plex Mono (IBM Carbon's type family, OFL) | `main.tsx` via `@fontsource` |
| Display type | Barlow Condensed (OFL) | `main.tsx` via `@fontsource` |

Fonts are self-hosted from npm: no third-party requests, works offline and under test.

## Tokens

CSS tokens live in the `@theme` block of `apps/web/src/index.css` and become Tailwind utilities
(`bg-ink-900`, `text-signal`, `font-display`). Pixi cannot read CSS, so `design/tokens.ts` mirrors
the values it needs. Change both together.

### Colour

| Token | Value | Use |
|---|---|---|
| `ink-950` … `ink-600` | `#0a0c0b` … `#2e3730` | Surfaces, darkest (page) to lightest (raised control) |
| `line` | `#343e37` | Hairlines and panel borders |
| `text` / `muted` / `faint` | `#ebe7da` / `#a7ab9e` / `#737a6f` | Primary, secondary and tertiary text |
| `signal` | `#f2a93b` | The only accent: calls to action, planning, focus, idle warnings |
| `good` | `#6fcf7f` | Positive outcomes: gains, income, health |
| `hostile` | `#ff5a4e` | Enemies, attacks, losses, errors |
| `friend` | `#4cc3ff` | You: selection, movement range, planned moves |
| `neutral` / `unknown` | `#8fd694` / `#ffe14d` | Nations at peace / unidentified |

Rules: one amber thing per region asks for action. Red always means enemy or loss, blue always
means you. Nation colours identify *who*; they never replace affiliation colour for *friend or foe*.

### Type

| Role | Face | Class | Use |
|---|---|---|---|
| Display | Barlow Condensed 600–800, uppercase, +0.04em | `ds-display` / `font-display` | Wordmark, headings, unit and city names, big numbers, buttons |
| Label | Barlow Condensed 600, 11px, +0.22em, uppercase, `faint` | `ds-label` | Section labels |
| UI | IBM Plex Sans 400–600 | default | Body copy, descriptions, tooltips |
| Data | IBM Plex Mono 400–500, tabular | `font-mono` | Every number that changes |

Scale (px): 9, 10, 11, 12, 13, 15, 18, 22, 28, 40, 64+. Numerals are tabular everywhere.

### Space, shape, depth, motion

- 4px grid. Panels pad 12–16px; dense lists 6–8px.
- Hard edges: radius 0–2px. Round shapes are reserved for actions (unit orders) and notifications.
- Surfaces: `ds-panel` gives the background, hairline border, inner top highlight, drop shadow and film
  grain. Framed panels (`Frame`) add amber corner brackets.
- Motion: 120ms for hover, 220ms for panels, 380–620ms for screen entry, easing
  `cubic-bezier(0.2, 0.7, 0.2, 1)`. Everything respects `prefers-reduced-motion`.
- `ds-hazard` warning tape is for blocking states only.

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
| Coach | `Coach.tsx`, steps in `coach.ts` | Guided first match; bottom centre, a strip beneath the turn summary |

## Map overlays

Blue (`friend`) fill and a bright border mark the selected unit's movement range; red (`hostile`)
rings mark enemies it can hit. Hover draws a dashed path in the colour of the order it would give.
Locked orders draw solid, white once submitted. Borders between nations are 4px in nation colour.
The threat overlay fills hexes in `hostile` with alpha rising per enemy that could strike there, with a
bright edge on its boundary; hovering an enemy draws the same for that unit alone.
