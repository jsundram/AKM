#!/usr/bin/env bash
# Rasterize a share-card SVG → PNG (1200×630). Default og.svg → og.png; pass a repo-relative
# path for the others: scripts/make-og.sh usage/og.svg. Run after editing the SVG.
# The wordmark is live text — Fraunces + IBM Plex Mono must be installed locally
# (rsvg/Chromium can't fetch webfonts from a file: render) or it falls back to a stock serif.
set -euo pipefail
cd "$(dirname "$0")/.."
svg="${1:-og.svg}"
png="${svg%.svg}.png"
fc-list 2>/dev/null | grep -qi fraunces || echo "WARN: Fraunces not installed — wordmark will render in a fallback serif" >&2
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 1200 -h 630 "$svg" -o "$png"
else
  # headless_shell keeps the full window as viewport; `--headless=new` reserves ~76px of UI
  for c in headless_shell chromium "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || continue
    "$c" --headless --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
         --window-size=1200,630 --screenshot="$png" "file://$PWD/$svg" 2>/dev/null
    break
  done
fi
echo "wrote $png ($(wc -c < "$png" | tr -d ' ') bytes)"
