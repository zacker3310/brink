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
   `node_modules/three`) on :8765 and run `node run.mjs <out>`. `inspect.py` lists a GLB's nodes and bounds.
3. Trim, the manifest (`units/manifest.json`: sprite size in world px, rotor hub) and the effect frames
   are produced by the small script in the commit that added this folder.
