#!/usr/bin/env bash
# Rasterize icon.svg -> the PWA / home-screen PNGs. icon.svg is the SINGLE SOURCE OF TRUTH:
# edit the SVG, rerun this, never hand-edit the PNGs. Needs rsvg-convert (librsvg) or swap in
# `inkscape -w $s icon.svg -o icon-$s.png` / an ImageMagick `convert`.
#   180 = apple-touch-icon   192/512 = manifest icons (512 also does maskable)
set -euo pipefail
cd "$(dirname "$0")"
for s in 180 192 512; do
  rsvg-convert -w "$s" -h "$s" icon.svg -o "icon-$s.png"
done
echo "wrote icon-180.png icon-192.png icon-512.png"
