# pwa-starter

A reusable starting point for a small, static, single-author PWA — the distilled memory of four
hand-built web apps, so the share cards / offline / cache-busting / install polish / analytics
that always get bolted on *late* get done early (or at least don't get forgotten).

- **[`PWA-CLAUDE.md`](PWA-CLAUDE.md)** — read this first. A pre-share checklist, the reasoning
  behind each item, and a maturity gradient showing what each source repo did and forgot. Drop it
  into a new repo (rename to `CLAUDE.md` or keep it beside one) as the project's PWA briefing.
- **[`skeleton/`](skeleton/)** — a working, installable, offline, themeable, shareable file set.
  Copy it into a new repo and search for `EDIT` / `APP` / `USER`:
  - `index.html` — a filled-in reference head (OG, icons, apple metas, theme-color, safe-area,
    dark mode, SW registration) + a minimal shell.
  - `sw.js` — cache-busting service worker (bump `V` on every shell change).
  - `manifest.json` — installability.
  - `ping.js` + `analytics.gs` — the private-Google-Sheet usage-analytics pattern (optional).
  - `make-icons.sh` / `make-og.sh` — rasterize the SVG source → PNG icons + share card.
  - `sw-lint.py` — pre-commit / CI guard for a forgotten cache-version bump.
  - `icon.svg` / `og.svg` — placeholders; replace, then run the make-* scripts.

This lives inside the AKM repo as a keep-it-with-the-example convenience. To seed a new project,
copy the `pwa-starter/` directory out.
