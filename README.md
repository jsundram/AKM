# Lesachtal — today

A pure-pull briefing for the Lesachtal Chamber Music Festival. Open it and it shows **today**: your rehearsals (room + coach), the hourly weather curve, and a grace note. It fetches the live schedule and forecast itself, in the browser — no server, no scheduled job — and **caches the whole festival week on every online load**, so once you've opened it on wifi in the morning you can browse any day offline all afternoon.

## Deploy — all from a browser, no laptop

You can do every step in GitHub's web UI (works on iPad/iPhone too).

1. **New repo** → github.com → **+** → *New repository*. Name it e.g. `lesachtal`, Public, no README. Create.
2. **Upload** → on the empty repo, *Add file → Upload files* → drag in **all the files in this folder** (`index.html`, `app.js`, `sw.js`, `manifest.json`, `composer-bank.json`, `icon-180.png`, `icon-192.png`, `icon-512.png`). Commit.
3. **Enable Pages** → *Settings → Pages* → Source: **Deploy from a branch**, Branch: **main**, folder **/(root)**. Save. After a minute it gives you a URL like `https://<you>.github.io/lesachtal/`.
4. **Open it on your phone (online, first time)** so it can fetch and cache. Confirm your rehearsals show.
5. **Add to Home Screen** → Safari **Share → Add to Home Screen**. Now it has an app icon and runs full-screen and offline.

That's it. No build step, no dependencies — it's static files.

## How it works

- **Schedule**: the live Google Sheet via its gviz endpoint, loaded as JSONP (works for the view-only public sheet without CORS trouble).
- **Weather**: Open-Meteo hourly for the festival dates (CORS-friendly `fetch`).
- **Offline**: a service worker caches the app itself; `app.js` caches each day's parsed schedule + weather in `localStorage`. On open it paints instantly from cache, shows an **as-of** stamp and an online/offline dot, then refreshes in the background if you're online. The day chips up top let you jump to any cached day.

Note (iOS): there's no background refresh — it updates when you open it. Opening it *is* the refresh, which is the whole point.

## Tweaking

- **Your pieces** — the `MINE` map at the top of `app.js` (Dvořák Quartet, Bruch Octet, Brahms Piano Quartet, Fauré Piano Quartet). Edit if assignments change.
- **Festival dates** — `FEST` in `app.js` (`["2026-06-29","2026-07-12"]`) drives the day chips and the weather range.
- **Look** — all the CSS lives in `index.html`; the render functions in `app.js` emit the same classes. Light/dark both handled.
- **Quotes/facts** — `composer-bank.json`. The coda rotates by festival day, sourced entries first.

## If it ever shows nothing

Open the Pages URL in a normal browser tab while online. If the schedule is blank there too, the sheet's sharing may have changed (it must stay link-viewable) or that day's tab isn't posted yet — the app says so rather than erroring.
