"""Trim rendered sprites, write units/manifest.json, and copy them into the app.

usage: python3 package.py <render output dir> <apps/web/public/art>
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

RES = 4  # texture px per world px, as in render.js
src, art = sys.argv[1], sys.argv[2]
dst = f'{art}/units'
os.makedirs(dst, exist_ok=True)
man = {}
for f in sorted(os.listdir(src)):
  if not f.endswith('.png'):
    continue
  k = f[:-4]
  im = Image.open(f'{src}/{f}').convert('RGBA')
  a = np.array(im)[..., 3]
  ys, xs = np.nonzero(a > 8)
  h, w = a.shape
  # Trim evenly about the centre so rotation pivots (and the rotor over its airframe) stay true.
  pad = int(max(w / 2 - xs.min(), xs.max() - w / 2, h / 2 - ys.min(), ys.max() - h / 2)) + 3
  c = w // 2
  im = im.crop((c - pad, c - pad, c + pad, c + pad))
  # A soft dark halo under the model (not the rotor or the depot) so units stay legible on busy
  # 50 cm city imagery, the way game engines outline units.
  if k not in ('air_rotor', 'depot'):
    alpha = im.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    halo = alpha.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(5)).point(lambda v: int(v * 0.5))
    under = Image.new('RGBA', im.size, (8, 10, 8, 0))
    under.putalpha(halo)
    im = Image.alpha_composite(under, im)
  im.save(f'{dst}/{k}.png', optimize=True)
  entry = {'size': im.size[0] / RES}
  if k == 'air_rotor':
    a = np.array(im)[..., 3]
    ys, xs = np.nonzero(a > 8)
    entry['hub'] = [round(float(xs.mean()) / im.size[0], 3), round(float(ys.mean()) / im.size[1], 3)]
  man[k] = entry
json.dump(man, open(f'{dst}/manifest.json', 'w'), indent=1)
print(json.dumps(man))
