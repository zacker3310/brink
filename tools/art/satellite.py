import json, sys, urllib.request, re
import numpy as np, rasterio
from rasterio.windows import Window
from rasterio.warp import transform
from PIL import Image, ImageFilter

B = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com'
# terrain: (tile path, lat, lon, [variant offsets in metres])
import mgrs
_m = mgrs.MGRS()
def tile_of(lat, lon):
  t = _m.toMGRS(lat, lon, MGRSPrecision=0)
  return f'{int(t[:2])}/{t[2]}/{t[3:5]}'
SITES = {
  'plains':    (49.70, 34.30),
  'forest':    (51.30, 28.00),
  'hills':     (47.10, 28.30),
  'mountains': (42.70, 44.60),
  'urban':     (48.47, 35.03),
  'water':     (46.40, 31.40),
}
GAIN = {'forest': 1.75, 'water': 1.4, 'mountains': 1.05}
ONLY = sys.argv[1:]
SIZE = 1024          # pixels per crop (10 m each: 6.4 km)
VARIANTS = [(0, 0)]

def scenes(tile):
  out = []
  for m in (7, 8, 6, 9):
    xml = urllib.request.urlopen(f'{B}/?list-type=2&prefix=sentinel-s2-l2a-cogs/{tile}/2023/{m}/&delimiter=/', timeout=60).read().decode()
    out += [p for p in re.findall(r'<Prefix>([^<]+)</Prefix>', xml) if p.count('/') > 6]
  return out

def cloud(prefix):
  sid = prefix.rstrip('/').split('/')[-1]
  try:
    j = json.load(urllib.request.urlopen(f'{B}/{prefix}{sid}.json', timeout=60))
    return j['properties'].get('eo:cloud_cover', 100)
  except Exception:
    return 100

def seamless(a):
  """Four-way cross-fade with the image shifted by half in x, in y and in both: every copy's
  seams fall where its weight is zero, so the result tiles with no visible join."""
  h, w, _ = a.shape
  sx = np.roll(a, w // 2, 1)
  sy = np.roll(a, h // 2, 0)
  sxy = np.roll(sx, h // 2, 0)
  cx = (np.cos(np.linspace(-1, 1, w) * np.pi / 2) ** 2)[None, :, None]
  cy = (np.cos(np.linspace(-1, 1, h) * np.pi / 2) ** 2)[:, None, None]
  return a * cx * cy + sx * (1 - cx) * cy + sy * cx * (1 - cy) + sxy * (1 - cx) * (1 - cy)

def grade(a, gain=1.25):
  a = a.astype(np.float32) / 255
  a = np.clip(a * gain, 0, 1) ** 0.85       # lift L2A's dark true colour
  g = a.mean(axis=2, keepdims=True)
  a = g + (a - g) * 0.82                    # ease the saturation
  return (np.clip(a, 0, 1) * 255).astype(np.uint8)

import os
meta = json.load(open('/tmp/assets/sat/scenes.json')) if os.path.exists('/tmp/assets/sat/scenes.json') else {}
for name, (lat, lon) in SITES.items():
  if ONLY and name not in ONLY:
    continue
  tile = tile_of(lat, lon)
  cands = sorted(((cloud(p), p) for p in scenes(tile)), key=lambda c: c[0])[:8]
  for cc, prefix in cands:
    url = f'{B}/{prefix}TCI.tif'
    with rasterio.open(url) as src:
      xs, ys = transform('EPSG:4326', src.crs, [lon], [lat])
      crops = []
      for dx, dy in VARIANTS:
        r, c = src.index(xs[0] + dx, ys[0] + dy)
        win = Window(c - SIZE // 2, r - SIZE // 2, SIZE, SIZE)
        a = src.read(window=win, boundless=True, fill_value=0).transpose(1, 2, 0)
        crops.append(a)
    blank = max(((a == 0).all(axis=2).mean() for a in crops))
    bright = max((a.mean(axis=2) > 200).mean() for a in crops)   # clouds
    print(name, prefix.split('/')[-2], 'cloud', round(cc, 1), 'blank', round(blank, 3), 'bright', round(bright, 3), flush=True)
    if blank < 0.01 and bright < (0.12 if name == 'mountains' else 0.02):
      break
  for i, a in enumerate(crops):
    img = Image.fromarray(grade(a, GAIN.get(name, 1.25)))
    img.save(f'/tmp/assets/sat/{name}.jpg', quality=86)
  meta[name] = {'scene': prefix.split('/')[-2], 'lat': lat, 'lon': lon, 'cloud': cc}
json.dump(meta, open('/tmp/assets/sat/scenes.json', 'w'), indent=1)
