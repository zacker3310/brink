# Art credits

Every image in `public/art` comes from an open source, or is rendered here from one. Nothing
here is fetched at runtime. Tools that produced it are in `tools/art/`.

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

## Units and props: rendered top-down from these 3D models (`tools/art/render.js`)

| Use | Model | Author | License | Source |
|---|---|---|---|---|
| Armour | T-72 tank | Nekis5_3D | Free for personal and commercial use (itch.io) | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Aviation | Boeing AH-64D Apache Combat Helicopter (rotors separated) | Muhamad Mirza Arrafi | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Drones | Quadcopter drone | Annelida | CC BY 4.0 | sketchfab.com/3d-models/quadcopter-drone-ca8f0f70a1014e77a6777dc248e9bf5a, via github.com/adikleineiny/tiny-zoom |
| Infantry, crews, dismounts | Soldier characters and rifle aiming animation | Mixamo (Adobe) | Mixamo terms (royalty-free in projects) | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Recon, troop truck | Car Kit (suv, truck), repainted | Kenney | CC0 1.0 | kenney.nl, via github.com/ETdoFresh/kenney.nl |
| Depot | Hesco Barrier PBR | polbrainstorm | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Watch tower | _SeF_ | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Military Tent | dark-minaz | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Depot | Shipping containers | Sousinho, Sebastian Webster | CC BY 4.0 | via github.com/Hejun-Coderlife/iron-man-mk85 |
| Artillery | Towed 155 mm howitzer | Brink (built from primitives) | Project license | `tools/art/render.js` |

The renders modify the models (scaled, posed, repainted, lit and viewed from above). No endorsement
by any author is implied.

## Effects

| Use | Asset | Author | License |
|---|---|---|---|
| Explosions, smoke | Smoke Particles (explosion, black smoke) | Kenney | CC0 1.0 |
