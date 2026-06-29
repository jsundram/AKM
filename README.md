# AKM — today

A pure-pull briefing for the AKM Chamber Music Festival. Open it and it shows **today**: your rehearsals (room + coach), an hourly weather curve, and a grace note — plus a participant **roster**, an offline village **map**, and a co-performance **network** graph. It fetches the live schedule and forecast itself, in the browser — no server, no scheduled job — and **caches the whole festival week on every online load**, so once you've opened it on wifi in the morning you can browse any day offline all afternoon. Hosted on GitHub Pages, installed to the iPhone home screen.

## What's in it

- **Today** (`index.html` + `app.js`) — your rehearsals (warm brass cards), the hourly temperature curve with sunrise/sunset and a showers band, meals, the evening practice block, and a sourced grace-note quote. Day chips up top browse any cached day; a "source sheet ↗" footer link opens that day's actual sheet tab.
- **Roster** (`roster.html`) — everyone, grouped/tinted by hotel, with instrument, role (Type), and lodging. Tap a row to see their hometown / pieces / notes; tap any column header to sort. A WhatsApp glyph on people you have a number for opens a pre-filled chat. Linked from the footer.
- **Map** (`map.html`) — a custom offline map of Liesing/Klebas with the festival's lodgings, venues, and food, plus Relief and Aerial layers and a live "you are here" dot. Linked from the footer.
- **Network** (`network.html`) — a co-performance graph: who shares a piece with whom, as an instrument-coloured chord diagram or an ego-centric "rings" view radiating out from you. Linked from the footer.

## How it works

- **Schedule**: the live Google Sheet via its gviz endpoint, loaded as JSONP (works for the view-only public sheet without CORS trouble).
- **Weather**: Open-Meteo for the festival dates (CORS-friendly `fetch`), sourced from **GeoSphere Austria's high-resolution alpine model** (AROME, blended with ECMWF for the longer range) and falling back to Open-Meteo's best-match blend if needed; the active source is cited on the card. The summary distinguishes thunderstorms, showers, drizzle, and the sky (clear → overcast).
- **Roster**: a *separate* view-only Google Sheet, pulled the same way — so participant data lives in the sheet, not the repo. The page is `noindex`.
- **Map**: a baked vector basemap (no tiles, no map library) plus two baked raster layers, all precached — it works with no network at all.
- **Type & fonts**: Fraunces / IBM Plex Mono / Inter from Google Fonts (cached by the service worker, since they aren't iOS system fonts).
- **Offline**: a service worker caches the app shell; `app.js` caches each day's parsed schedule + weather in `localStorage`. On open it paints instantly from cache, shows an **as-of** stamp and an online/offline dot, then refreshes if online.

Note (iOS): there's no background refresh — it updates when you open it. Because the home-screen card can *resume* rather than reload, it also re-pulls when brought to the foreground, and you can **pull down to refresh**.

## Deploy

GitHub Pages, **`main` / root**. Relative paths throughout, so it works at `https://<you>.github.io/AKM/`. Push to `main` and Pages redeploys. After deploy, open the URL **online once** so it caches, then **Share → Add to Home Screen**. The one thing only verifiable live is the in-browser gviz fetch — if your rehearsals render at the Pages URL, everything downstream is proven.

> Bump `V` in `sw.js` whenever a shell file changes, so installed devices re-cache.

The deployed site is plain static files. A couple of **optional** scripts regenerate baked data (not required to deploy):
- `scripts/update-gids.py` — keeps the day→tab deep links fresh; runs automatically via the pre-commit hook (`git config core.hooksPath .githooks` once per clone).
- `scripts/build-map.py` + `scripts/build-terrain.py` — regenerate the map geometry and relief/aerial layers (run by hand; town geometry is static).

## Tweaking

- **Your pieces** — the `MINE` map at the top of `app.js`. Edit if assignments change.
- **Festival dates** — `FEST` in `app.js` (`["2026-06-29","2026-07-12"]`) drives the day chips and the weather range.
- **Roster sheet** — `ROSTER_SID` / `ROSTER_GID` in `roster.html`. Edit the sheet to update the roster; the page re-pulls.
- **Look** — all the CSS lives in each page; the render functions emit matching classes. Light/dark both handled.
- **Quotes/facts** — `composer-bank.json`. The coda rotates by festival day, sourced entries first.

## If it ever shows nothing

Open the Pages URL in a normal browser tab while online. If the schedule (or roster) is blank there too, the sheet's sharing may have changed — it must stay **"anyone with the link can view"** — or that day's tab isn't posted yet, in which case the app says so rather than erroring.
