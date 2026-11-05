# Maps: the authored format and the generator

Phase 4 (`docs/MASTER-PLAN.md`), first wave. A theatre is a data file, not code. This note covers
the file format, the checker, how the Pacific became a file, the theatre builder, and the generator
that will bake real coastlines into hexes.

## The map file

`*.map.json`, one per theatre, in `packages/scenarios/src/maps/`. The schema and validator are
`packages/map/src/mapfile.ts` (`MapFile`, `validateMap`, `parseMap`). Version 1:

| Field | What it holds |
|---|---|
| `format`, `version` | `"brink-map"`, `1`. A build refuses a version it does not read, and says so. |
| `id`, `name`, `source` | The map's id and name. `source` says where it came from, including the data's licence. |
| `cols`, `rows`, `layout` | The size, up to 400 x 200. `"odd-r"` means odd rows sit half a hex east (`offsetToAxial`). |
| `layers.owner` | One character per hex. The legend maps each character to a nation id, or to `null` for sea and unowned land. |
| `layers.terrain` | One character per hex. The legend maps each character to a terrain or to `"seeded"`. Seeded ground is rolled from the seed, as the Pacific always was. |
| `layers.seaZone` | Optional. Every sea hex belongs to one zone (the legend maps to zone ids); land maps to `null`. |
| `layers.biome` | Optional. A hint for the arena and the renderer: sea, ice, tundra, boreal, temperate, steppe, desert, subtropical, tropical or highland. |
| `nations` | `id`, `name`, `short`, `color`, `government`, `role` (`power` or `minor`) and `capital` (a site id). `terrainBias` is optional and is added to the seeded roughness. A map has 2 to 12 powers. |
| `sites` | `id`, `kind` (capital, city, depot, objective), `name`, `at: [col, row]` and `owner`. `victoryPoints` is optional and overrides the kind's points. `profile: "outpost"` makes an island depot. `anomaly` (Black Files) marks an objective as an `excavation` or a nation's `blacksite`. |
| `seaZones` | `id` and `name` for each zone the zone layer uses. |
| `straits` | `id`, `name`, `kind` (strait, canal or land-bridge), `hexes`, and optionally `joins` (the zones it links). |
| `resources` | `kind` (oil, rare-earths, chips, food), `at` and an optional `name`. |

Each layer is a list of strings, one string per row, so a diff of the file reads like a diff of the
map. Each layer has its own legend, so one layer can change without touching the others. Coordinates
are `[col, row]`, the way an author reads the grid. The engine converts them with `cellKey`.

The validator never throws. It reports every problem with a path and a precise message, for example
`layers.owner.rows[3]: col 12: "Q" is not in the legend`,
`sites[7].at: Wrong at [0, 1] stands on alpha ground, not beta`, or
`straits[2].joins[0]: "north" does not touch the strait`. It checks that:

- the layers agree with each other: sea is never owned, every sea hex is in a zone, no land is in a zone, and sea has the sea biome;
- every site stands on its owner's dry ground, with one site to a hex;
- each nation holds exactly one capital, which it names;
- strait hexes are sea, and land-bridge hexes are land;
- each zone a strait joins touches it;
- resources lie ashore;
- there are no unknown fields.

**`pnpm map:check`** (`packages/mapgen/src/cli/map-check.ts`) validates every map file the game ships
and prints `ok` with a summary, or `FAIL` with each problem. It exits 1 if any file fails. To check
other files, pass their paths:
`pnpm --filter @brink/mapgen exec tsx src/cli/map-check.ts <paths>`.

What a map file is not: it holds no orders of battle, no turn limits, and no crisis scripts. Those
belong to the scenario. `ScenarioSetup` in `packages/scenarios/src/build.ts` holds navies, militia
and `maxTurns`. Victory-point prizes and outposts are facts about places, so they live on the sites.

## The builder

`buildScenario(map, seed, setup)` (`packages/scenarios/src/build.ts`) makes the turn-1 `WorldState`
of any valid map. It counts nothing and sizes nothing in advance:

- the tiles come from the layers;
- the seeded texture's blob count scales with the map's area (28 per 800 hexes);
- the powers are the map's `role: power` nations, and parity runs over all of them;
- objectives are the minor states' capitals (taken from the map, not from id patterns);
- every pair of nations starts at war, except two minor states, which start at peace.

Each power needs two cities and a depot for its opening army, and the builder says so if a map lacks
them.

**The Pacific** is `PACIFIC_MAP` plus its setup in `pacific.ts`. A one-off converter
(`gridToMap` plus `convert-pacific.ts`, which can be found in history at commit "World engine: an
authored map format...") wrote the file from the inline grid. The owner layer is that grid,
character for character. The turn-1 world is identical for every seed: `pacific-map.test.ts` pins the
hashes for seeds 1 to 20. The AI-against-AI soak is also identical, line for line, and the commit
message records both runs.

**Antarctica** (`maps/antarctica.map.json`, Black Files: First Contact) is drawn by
`packages/mapgen/src/antarctica.ts` from a polar projection, not baked from coastline data:
`pnpm --filter @brink/mapgen map:antarctica` writes it, and a test checks the committed file
byte for byte. Ice shelves are plains, the Transantarctic Mountains mountains, the biome layer ice
(tundra on Tierra del Fuego).

**The testbed** (`testbed.ts`, `TESTBED_ID = 'testbed-six'`) has six powers and four minor states on
64 x 32 hexes. `createScenario` builds it, but it is listed in neither `SCENARIOS` nor `THEATRES`, so
no player sees it. `packages/session/src/world-engine.test.ts` plays ten AI-against-AI turns of it and
requires that no order is rejected. Six seeds played to turn 30 also had 0 rejected orders.

Measured in a 4-core container (not a phone):

| Map | `GameSession.advance` per turn (AI and resolve) | `resolveTurn` alone |
|---|---|---|
| Testbed, 64 x 32, at turn 11 | about 635 ms | about 208 ms |
| Pacific, turn 1 | not measured | about 163 ms |

## The generator: coastlines to hexes

`packages/mapgen` holds node-side tools. They are never bundled into the game.

1. **Coastline data.** Natural Earth's land and admin-0 country polygons are public domain
   (naturalearthdata.com, "free vector and raster map data", no permission needed). Use 1:50m for
   theatres and 1:110m for the whole planet. They are downloaded once, by hand, as GeoJSON into a
   scratch folder outside the repo and are never fetched by the build. `polygonsOf` reads a
   FeatureCollection of Polygon and MultiPolygon geometries.
2. **Projection.** A theatre is a longitude and latitude box. `hexCentre` places hex centres
   equirectangularly over the box: odd rows sit half a hex east, and the box spans `cols + 0.5` hex
   widths. Equirectangular is enough for a theatre. A planet map should use an equal-area or Miller
   projection, so that Russia and Canada do not swallow the north. The projection is one function to
   swap.
3. **Baking.** `bakeLand` samples seven points in each hex: the centre and six points a third of a
   hex out. A hex is land when four or more of them fall inside a polygon (even-odd, so lakes stay
   water). An island too small to win any hex still gets the hex under its middle, so Guam and the
   Kurils survive at any scale. This runs offline, so floating point is fine: the output is characters.
4. **Politics.** `generateTheatre` places the capitals far apart on the larger landmasses (farthest
   point first: powers, then minor states). Borders grow over land from the capitals, one ring at a
   time. Land that no capital can walk to goes to the nearest capital. Cities and depots are spread
   inside each nation, never next to another site, and a power's first city is on the coast where it
   has one, to serve its navy. For real theatres, admin-0 polygons replace the Voronoi borders with
   the same point-in-polygon test, and capitals and cities come from a hand-kept table or from
   Natural Earth's populated places.
5. **Sea zones, straits, biomes, resources.** Sea zones are square blocks of sea, and a real theatre
   names its own. Straits are sea hexes with land on two opposite sides, found in short runs; a real
   theatre keeps the named ones (Malacca, Hormuz and the rest) and drops the noise. Biomes come from
   latitude, with dryness inland. Resources are spread over open ground; a real theatre places them.
6. **Hand-finishing.** The output is an ordinary map file. An author fixes it in the file, or later
   in the map editor, and runs `pnpm map:check`.

The prototype runs without network access on a synthetic coastline: `syntheticCoastline` makes
seeded, wobbly continents. Tests cover the point test, the baking (a half-land box and a kept islet),
GeoJSON reading, and valid maps from 2 powers on 32 x 16 to 12 powers on 96 x 48.
`pnpm --filter @brink/mapgen map:testbed` regenerates the testbed, and a test checks that the
committed file matches the generator byte for byte.

## Still open

- **Theatre baking from real data.** This needs a `bake` CLI that reads a GeoJSON path, a box and a
  scale, plus admin-0 borders and a capitals table. The functions exist; the CLI and the data run do
  not.
- **Engine use of the new layers.** Sea zones, straits, resources and biomes are in the files and
  checked, but the simulation does not read them yet. That is the trade-and-chokepoints lane.
- **Scale.** At 160 x 80 the per-hex loops in the builder and in fog and supply need the incremental
  work the master plan lists. The testbed's numbers above are the baseline.
- **Pacific-only data still in code:** the crises (by site name and Pacific cells) and the Black
  Files' sites. `packages/scenarios/src/theatres.ts` is the one table of theatres: each one's powers,
  minor states, crises (none outside the Pacific: the classic war only), Easy's natural allies in
  pairs, whether the Black Files toggle can seed it, and how its world is built.
- **Europe** (`europe.map.json`, 56 x 32, 46 nations) is the second theatre: a Natural Earth bake
  finished by hand, its grid in `packages/mapgen/src/europe.ts`.
- **Every theatre's map has its generator in `packages/mapgen`** and a test that the committed file is
  its output byte for byte: `europe.ts`, `mideast.ts`, `indopac.ts`, `americas.ts`, `antarctica.ts`,
  `testbed.ts` (`pnpm --filter @brink/mapgen map:<id>` rewrites one). The Indo-Pacific South was traced
  by a script outside the repository; `indopac.ts` is that script ported, and writes the same file.
