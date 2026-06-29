#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["pillow", "numpy"]
# ///
"""Bake the two raster basemap layers for map.html — hillshade relief + aerial orthophoto —
cropped to the exact bbox in map-data.json's meta, so they register pixel-for-pixel with the
vector layer. Run after build-map.py (it reads that bbox back):  uv run scripts/build-terrain.py

  map-relief.jpg  — shaded relief from the free global Terrarium DEM (AWS Open Data; SRTM/etc.)
  map-aerial.jpg  — 30 cm orthophoto from basemap.at (Austria, CC BY 4.0)

Both providers must be credited; map.html shows the per-layer attribution. Network-tolerant:
on failure it leaves the existing JPEGs in place. Heavy-ish (a few dozen tiles) but one-shot —
town terrain is static, so rerun only when the bbox changes.
"""
import io, json, math, sys, urllib.request
import numpy as np
from PIL import Image, ImageFilter

ROOT = __file__.rsplit("/", 2)[0]
META = json.load(open(ROOT + "/map-data.json"))["meta"]
S, W, N, E = META["bbox"]
ASPECT = META["w"] / META["h"]
DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ORTHO = "https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg"

def tilef(lat, lon, z):                                      # fractional slippy-tile coords
    n = 2 ** z
    return ((lon + 180) / 360 * n,
            (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "akm-map-build"})
    return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read()))

def mosaic(z, url, margin=0):
    xnw, ynw = tilef(N, W, z); xse, yse = tilef(S, E, z)     # NW, SE corners
    tx0, ty0 = int(xnw) - margin, int(ynw) - margin
    tx1, ty1 = int(xse) + margin, int(yse) + margin
    im = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            try: im.paste(fetch(url.format(z=z, x=tx, y=ty)), ((tx - tx0) * 256, (ty - ty0) * 256))
            except Exception as ex: print(f"  miss {z}/{tx}/{ty}: {ex}", file=sys.stderr)
    box = ((xnw - tx0) * 256, (ynw - ty0) * 256, (xse - tx0) * 256, (yse - ty0) * 256)
    return im, box

def to_width(im, w):                                         # resize to width w, height from the vector aspect
    return im.resize((w, round(w / ASPECT)), Image.LANCZOS)

def relief(z=15, width=1500):
    im, box = mosaic(z, DEM, margin=2)
    a = np.asarray(im).astype(float)
    elev = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    res = 156543.03 * math.cos(math.radians((S + N) / 2)) / 2 ** z   # metres per px at this zoom
    gy, gx = np.gradient(elev * 1.3, res)                    # 1.3 = gentle vertical exaggeration
    slope = math.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    hs = np.clip(np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect), 0, 1)
    img = Image.fromarray((hs * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.6))
    print(f"relief: elev {elev.min():.0f}..{elev.max():.0f} m, {res:.2f} m/px")
    return to_width(img.crop([round(v) for v in box]), width)

def aerial(z=16, width=1700):
    im, box = mosaic(z, ORTHO)
    return to_width(im.crop([round(v) for v in box]), width)

def main():
    try:
        relief().save(ROOT + "/map-relief.jpg", quality=85)
        print("wrote map-relief.jpg")
        aerial().save(ROOT + "/map-aerial.jpg", quality=80)
        print("wrote map-aerial.jpg")
    except Exception as ex:
        print(f"fetch/build failed ({ex}); keeping existing rasters", file=sys.stderr)

if __name__ == "__main__":
    main()
