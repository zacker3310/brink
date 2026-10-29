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

The battlefield itself (ground, grass, trees, rocks, buildings, water) is generated in code.

## Effects

| Use | Asset | Author | License |
|---|---|---|---|
| Explosions, smoke | Smoke Particles (explosion, black smoke) | Kenney | CC0 1.0 |

## Radio calls (`radio/`)

Radio calls: generated with Kokoro-82M (hexgrad, Apache-2.0) via kokoro-onnx (MIT), radio-filtered by
tools/art/radio.py.

| Part | Source | License |
|---|---|---|
| Speech model and voices (`am_michael`, `am_adam`, `am_eric`, `am_onyx`, `am_fenrir`) | Kokoro-82M v1.0, hexgrad (github.com/hexgrad/kokoro) | Apache-2.0 (the model's weights; no separate license is stated for the voices, which ship with the model) |
| ONNX runtime wrapper and the `kokoro-v1.0.onnx` and `voices-v1.0.bin` files | kokoro-onnx, thewh1teagle (github.com/thewh1teagle/kokoro-onnx, release `model-files-v1.0`) | MIT |

Each clip is synthetic speech, band-passed to 300 to 3,400 Hz, compressed, saturated, laid over static
with a squelch click and tail, and encoded as mono MP3 (`radio/manifest.json` lists the line and voice
of every clip). The rest of the battle audio (weapon reports, impacts, engines, rotors, drones,
weather) is synthesised in code in `src/arena/audio/`; there are no recordings.
