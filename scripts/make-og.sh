#!/usr/bin/env bash
# Rasterize og.svg → og.png (the 1200×630 link-preview card). Run after editing og.svg.
# The wordmark is live text — Fraunces + IBM Plex Mono must be installed locally
# (rsvg/Chromium can't fetch webfonts from a file: render) or it falls back to a stock serif.
set -euo pipefail
cd "$(dirname "$0")/.."
fc-list 2>/dev/null | grep -qi fraunces || echo "WARN: Fraunces not installed — wordmark will render in a fallback serif" >&2
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 1200 -h 630 og.svg -o og.png
else
  # headless_shell keeps the full window as viewport; `--headless=new` reserves ~76px of UI
  for c in headless_shell chromium "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || continue
    "$c" --headless --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
         --window-size=1200,630 --screenshot=og.png "file://$PWD/og.svg" 2>/dev/null
    break
  done
fi
echo "wrote og.png ($(wc -c < og.png | tr -d ' ') bytes)"
