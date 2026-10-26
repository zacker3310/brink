"""Re-cut the Sentinel-2 ground with relief and sharpening.

Reads the scenes chosen by satellite.py (terrain/scenes.json), re-reads each 1024 px true-colour
window, reprojects the Copernicus GLO-30 elevation model onto the same grid, and multiplies a
north-west-lit hillshade into the hills and mountains so ridges and valleys read in 3D. Every tile
gets a light unsharp mask. Writes terrain/<terrain>.jpg.
"""
import json, math, sys
import numpy as np, rasterio
from rasterio.windows import Window
from rasterio.warp import transform, reproject, Resampling
from PIL import Image, ImageFilter

B = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs'
DEM = 'https://copernicus-dem-30m.s3.amazonaws.com'
OUT = sys.argv[1]
SIZE = 1024
GAIN = {'forest': 1.75, 'water': 1.4, 'mountains': 1.05}
RELIEF = {'mountains': 0.85, 'hills': 0.6}

def dem_url(lat, lon):
  ns = f"{'N' if lat >= 0 else 'S'}{abs(math.floor(lat)):02d}_00"
  ew = f"{'E' if lon >= 0 else 'W'}{abs(math.floor(lon)):03d}_00"
  name = f'Copernicus_DSM_COG_10_{ns}_{ew}_DEM'
  return f'{DEM}/{name}/{name}.tif'

def grade(a, gain):
  a = a.astype(np.float32) / 255
  a = np.clip(a * gain, 0, 1) ** 0.85
  g = a.mean(axis=2, keepdims=True)
  return np.clip(g + (a - g) * 0.82, 0, 1)

def hillshade(z, res, az=315, alt=40):
  gy, gx = np.gradient(z, res)
  slope = np.arctan(np.hypot(gx, gy) * 1.6)
  aspect = np.arctan2(-gx, gy)
  azr, altr = math.radians(360 - az + 90), math.radians(alt)
  return np.clip(np.sin(altr) * np.cos(slope) + np.cos(altr) * np.sin(slope) * np.cos(azr - aspect), 0, 1)

scenes = json.load(open(f'{OUT}/scenes.json'))
for name, m in scenes.items():
  sid = m['scene']
  tile = sid.split('_')[1]
  date = sid.split('_')[2]
  url = f"{B}/{int(tile[:2])}/{tile[2]}/{tile[3:5]}/{date[:4]}/{int(date[4:6])}/{sid}/TCI.tif"
  with rasterio.open(url) as src:
    xs, ys = transform('EPSG:4326', src.crs, [m['lon']], [m['lat']])
    r, c = src.index(xs[0], ys[0])
    win = Window(c - SIZE // 2, r - SIZE // 2, SIZE, SIZE)
    img = src.read(window=win, boundless=True).transpose(1, 2, 0)
    grid = src.window_transform(win)
    crs = src.crs
  a = grade(img, GAIN.get(name, 1.25))
  if name in RELIEF:
    z = np.zeros((SIZE, SIZE), np.float32)
    with rasterio.open(dem_url(m['lat'], m['lon'])) as d:
      reproject(rasterio.band(d, 1), z, dst_transform=grid, dst_crs=crs, resampling=Resampling.bilinear)
    hs = hillshade(z, 10.0)
    k = RELIEF[name]
    a = np.clip(a * ((1 - k) + k * (0.35 + 1.1 * hs))[..., None], 0, 1)
    print(name, 'relief', float(z.min()), float(z.max()))
  im = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
  im.save(f'{OUT}/{name}.jpg', quality=86)
  print(name, 'ok')
