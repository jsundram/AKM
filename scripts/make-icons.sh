#!/usr/bin/env bash
# Rasterize icon.svg → the PWA/home-screen PNGs. Run after editing icon.svg.
set -euo pipefail
cd "$(dirname "$0")/.."
for s in 180 192 512; do
  rsvg-convert -w "$s" -h "$s" icon.svg -o "icon-$s.png"
done
echo "wrote icon-180.png icon-192.png icon-512.png"
