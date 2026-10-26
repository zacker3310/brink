# Art pipeline

Produces everything in `apps/web/public/art` (credits: `apps/web/public/art/CREDITS.md`). Source models
are not committed; fetch them from the repositories named in the credits.

1. **Ground** (`satellite.py`): picks the clearest summer 2023 Sentinel-2 L2A scene over each place from
   the AWS open data bucket `sentinel-cogs`, reads a 1024 px window of the true-colour image, grades it,
   writes `terrain/<terrain>.jpg` and `scenes.json`. Needs `pip install rasterio mgrs`.
2. **Units and props** (`render.js`, `index.html`, `run.mjs`): loads the GLB models in headless Chromium
   with three.js, scales each to real size, poses the soldiers, lights from the north-west with cast
   shadows on a transparent ground, renders straight down, and writes one PNG per unit class plus the
   helicopter rotor and the depot compound. Serve the folder (with `assets/` holding the models and
   `node_modules/three`) on :8765 and run `node run.mjs <out>`. `glb_info.py` lists a GLB's nodes and bounds.
   `satellite_refine.py` re-cuts those scenes with a Copernicus GLO-30 hillshade on hills and mountains
   and a light unsharp mask.
3. **Sites**: 520 m windows (one hex) of the SpaceNet 6 Rotterdam 50 cm mosaic, graded and resized to
   768 px: four city districts, a refinery, a fuel farm and an industrial yard (`sites/`).
4. `package.py` trims the renders, bakes a soft halo under each unit, and writes `units/manifest.json`
   (sprite size in world px, rotor hub).
5. Effect frames are Kenney's explosion and black smoke sequences, downscaled to 160 px.
