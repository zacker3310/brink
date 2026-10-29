# Art credits

Every image and model in `public/art` comes from an open source, or is rendered here from one.
Everything is served from this site; nothing is fetched from a third party at runtime. Tools that
produced it are in `tools/art/`.

## Ground: Copernicus Sentinel-2 imagery

Contains modified Copernicus Sentinel data 2023 (ESA). Sentinel-2 L2A true-colour (TCI) scenes from
the AWS Open Data registry (`sentinel-cogs`), cropped and colour-graded by `tools/art/satellite.py`.
Scene IDs and coordinates: `terrain/scenes.json`.

| Terrain | Place | Scene |
|---|---|---|
| Plains | Farmland near Poltava, Ukraine | S2B_36UWA_20230819 |
| Forest | Polesia forest, Ukraine | S2A_35UNS_20230806 |
| Hills | Codri hills, Moldova | S2B_35TNN_20230828 |
| Mountains | Greater Caucasus | S2A_38TMN_20230713 |
| Urban | Dnipro, Ukraine | S2B_36UXU_20230928 |
| Water | Black Sea off Odesa | S2B_36TUS_20230805 |

Relief on hills and mountains: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and
© Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA
(GLO-30, AWS open data `copernicus-dem-30m`), as a hillshade blended in by `tools/art/satellite_refine.py`.

## Sites: 50 cm imagery (`sites/`)

City districts, the refinery, the fuel farm and the industrial yard are cut from the SpaceNet 6
Rotterdam pan-sharpened RGB mosaic (WorldView-2, 2019; SpaceNet on AWS, `spacenet-dataset`), licensed
CC BY-SA 4.0. The cut, graded tiles in `sites/` are shared under the same CC BY-SA 4.0 license.

The home-screen and browser icons (`public/icons/`) are a darkened crop of the capital tile with the
Brink hex mark over it, so they are a derivative of the same imagery and also CC BY-SA 4.0.

## Units and props: rendered top-down from these 3D models (`tools/art/render.js`)

| Use | Model | Author | License | Source |
|---|---|---|---|---|
| Armour | T-72 tank | Nekis5_3D | Free for personal and commercial use (itch.io) | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Aviation | Boeing AH-64D Apache Combat Helicopter (rotors separated) | Muhamad Mirza Arrafi | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Drones | Quadcopter drone | Annelida | CC BY 4.0 | sketchfab.com/3d-models/quadcopter-drone-ca8f0f70a1014e77a6777dc248e9bf5a, via github.com/adikleineiny/tiny-zoom |
| Infantry, crews, dismounts | Soldier characters and rifle aiming animation | Mixamo (Adobe) | Mixamo terms (royalty-free in projects) | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Hesco Barrier PBR | polbrainstorm | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Watch tower | _SeF_ | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Military Tent | dark-minaz | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Shipping containers | Sousinho, Sebastian Webster | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Self-propelled gun, heavy IFV | T-72 chassis (as above) with turrets, guns and stowage built in `tools/art/render.js` | Nekis5_3D; Brink | As above | `tools/art/render.js` |
| Scout car | BRDM-style armoured car built from primitives | Brink | Project license | `tools/art/render.js` |

The renders modify the models (scaled, posed, repainted, lit and viewed from above). No endorsement
by any author is implied.

## Battle models and sky (`models/`, `env/`)

The tactical battles load these 3D models directly: the same T-72, AH-64D, quadcopter drone, Mixamo
soldiers with the rifle-aiming animation, Hesco barrier, shipping container (rust) and watch tower as
above, under the same licenses. Each was re-encoded with gltf-transform (meshopt geometry, WebP
textures at 512 to 1024 px; `tools/art/README.md`), and in the game they are scaled, tinted, posed,
partly rebuilt (the IFV and the self-propelled howitzer on the T-72 chassis) and lit; no endorsement
by any author is implied.

| Use | Asset | Author | License |
|---|---|---|---|
| Sky light and reflections (`env/park.exr`) | Rooitou Park HDRI, 512 px EXR | Greg Zaal, Poly Haven, packaged in `@pmndrs/assets` | CC0 1.0 |

## Battlefield skies (`env/`)

Image-based light for the Arena v2 battlefield by time of day: Poly Haven HDRIs, 512 x 256 EXR (DWAB),
as packaged in `@pmndrs/assets` 1.7.0 (`hdri/*.exr.js`, decoded from their base64 data to `.exr`
files unchanged). In the game they are desaturated and turned to match the sun, then used for light
only; the visible sky is a graded dome drawn in code.

| Use | File | HDRI | Author | License |
|---|---|---|---|---|
| Day | `env/park.exr` (above) | Rooitou Park | Greg Zaal, Poly Haven | CC0 1.0 |
| Dawn | `env/dawn.exr` (182 KB) | Kiara 1 Dawn | Greg Zaal, Poly Haven | CC0 1.0 |
| Dusk | `env/dusk.exr` (148 KB) | Venice Sunset | Greg Zaal, Poly Haven | CC0 1.0 |
| Night | `env/night.exr` (154 KB) | Dikhololo Night | Greg Zaal, Poly Haven | CC0 1.0 |

The battlefield itself (ground, grass, trees, rocks, buildings, water) is generated in code.

## Effects

| Use | Asset | Author | License |
|---|---|---|---|
| Explosions, smoke | Smoke Particles (explosion, black smoke) | Kenney | CC0 1.0 |
