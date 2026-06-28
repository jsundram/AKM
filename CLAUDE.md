# CLAUDE.md — AKM briefing

Context for working on this project in Claude Code. Read this first.

## What this is

A pure-pull **PWA** that shows the day at the AKM Chamber Music Festival: Jason's
rehearsals (room + coach), an hourly weather curve, and a grace-note quote. It fetches the
live schedule and forecast **client-side** — no backend, no scheduled job — and caches the
whole festival week so it works offline once loaded. Hosted on **GitHub Pages**, installed to
the iPhone home screen. Opening it *is* the refresh.

## Architecture

Static files only. Nothing server-side.

- `index.html` — app shell + all CSS (the design system). Mount point `#app`, a day-chip row, and an online/as-of status line.
- `app.js` — the brain: fetch → parse → render → cache. Ported 1:1 from the earlier Python runner.
- `sw.js` — service worker; precaches the shell for offline, passes cross-origin data calls through to network.
- `manifest.json` + `icon-*.png` — installable/standalone.
- `composer-bank.json` — vetted quotes + facts, provenance-tiered.

Data sources:
- **Schedule** — the public, view-only Google Sheet via its **gviz endpoint as JSONP** (`tqx=out:json;responseHandler:cb`). JSONP is deliberate: a plain `fetch` hits CORS, and we only have *view* access so we can't "Publish to web." Don't switch it to `fetch`.
- **Weather** — Open-Meteo hourly (`temperature_2m`, `precipitation`, `weathercode`, daily max/min/sun). CORS-friendly, normal `fetch`.
- **Offline** — `app.js` stores each day's parsed schedule + weather in `localStorage` (key `akm-cache`), renders instantly from it on open (stale-while-revalidate), then refreshes if online. Every successful online load re-caches the **whole week**, so a morning open on wifi covers the afternoon offline. Day chips browse cached days.

## Constants (top of app.js)

- `SID` — sheet id. Tab naming convention is **`Ddd M/D`**, no leading zeros (e.g. `Mon 6/29`). Confirmed against the live sheet.
- `FEST = ["2026-06-29","2026-07-12"]` — drives day chips + the weather range. Day 1 = 6/29.
- `LAT/LON = 46.70/12.85`, `TZ = Europe/Vienna`. The laptop is in the Alps, so local = festival time (no timezone math anywhere).
- `MINE` — Jason's pieces → composer key: Dvořák Quartet→dvorak, Bruch Octet→bruch, Brahms Piano Quartet→brahms, Fauré Piano Quartet→faure. A rehearsal is "his" only on an exact phrase match (so "Dvořák Piano Quintet" and "Brahms String Quartet" correctly do **not** match).

## Conventions

Jason writes terse, DRY, idiomatic JS — short names, minimal comments (comments explain *why*, not *what*), Bostock-flavored but modern and readable. Match that. Same for any Python in `archive/` (uv + PEP 723 inline metadata, short names).

## Design system (don't drift)

Alpine palette; Fraunces (display) / IBM Plex Mono (data) / Inter (body). **Warm brass cards are reserved exclusively for Jason's own rehearsals** — never repurpose the warm accent for other UI. The temperature curve (cool→warm gradient, H/L dots, shaded SHOWERS band) is the signature element and the app icon. Full light + dark via `prefers-color-scheme`, contrasts verified WCAG AA+. Edit CSS in `index.html`; render functions in `app.js` emit matching classes.

## Test

The parser has a Node harness (pure functions are exported when `app.js` is required outside a browser):

```
node archive/parser-test.js   # if you keep one; the original passed 8/8 on the real Tuesday grid
```

`app.js` exports `{parse, rowsFrom, mins, norm, despace}` under Node and only calls `boot()` in a browser, so it's safe to `require`. Build a gviz-JSON fixture (`{table:{rows:[{c:[{v},…]}]}}`) and assert on `parse(rowsFrom(fixture))`. Verified behaviors to preserve: chronological sort by clock time (not string — "9:00" must precede "14:30"); meal venue spacing intact ("Mascha Wirt"); `despace` collapses only letter-spaced runs ("L U N C H"→"LUNCH"); evening faculty readings flagged, string quartets and Jason's own pieces specially tagged.

## Deploy (browser or laptop)

GitHub Pages, `main` / root. Relative paths throughout, so it works as a project page (`<you>.github.io/AKM/`). After deploy, open the URL **online once** so it caches, then Add to Home Screen. The one thing only verifiable live is the in-browser gviz fetch — if rehearsals render at the Pages URL, everything downstream is proven.

## Gotchas

- **gviz JSONP, not fetch** (CORS + view-only). If it ever returns blank: sheet sharing changed (must stay link-viewable) or that day's tab isn't posted — the app shows "not posted yet" rather than erroring.
- **iOS** has no background refresh; it updates on open. We chose **pure-pull on purpose** — push would re-add a scheduled sender, and home-screen web push is also DMA-restricted on EU-region devices.
- **Coda rotation** is deterministic by festival day (sourced tier first), so no state file is needed.
- **Bank integrity** — entries are tiered `sourced` / `attributed` / `standard`; never render a quote as more certain than its tier. Quotes are page-cited (Dvořák → Šourek; Bruch → Fifield). One landmine: the line *"I should be glad if something occurred to me…"* is **Brahms about Dvořák** (Šourek p. 15), not a Dvořák self-quote — it lives in the Brahms entry. Don't "fix" it back. When expanding the bank, prefer omitting a doubtful entry over including a spurious one.

## Open / nice-to-have

- iOS "Add to Home Screen" hint banner (only when on iOS Safari and not yet installed) — Apple leaves this step un-prompted.
- Optional share/render-to-image.
- `archive/` holds the **superseded** laptop-cron approach (`briefing.py` runner + `com.akm.briefing.plist` launchd job + `preflight.py` + `SETUP.md`) and `daily-briefing.html` (the original finished design, handy as a visual reference). Not part of the deployed site; keep for reference or if the pull model ever needs a server-side companion.
