# PWA-CLAUDE.md — a starter briefing for a static personal PWA

Drop this file (and `skeleton/`) into a new repo and read it first. It's the distilled memory of
four hand-built static web apps — [AKM](https://github.com/jsundram/akm),
[lobsters-and-lighthouses](https://github.com/jsundram/lobsters-and-lighthouses),
[haydn-info-card](https://github.com/jsundram/haydn-info-card),
[quartets.boccherini.org](https://github.com/jsundram/quartets.boccherini.org) — turned into a
checklist so the things that always get bolted on *late* (share cards, offline, cache-busting,
install polish, analytics) get done *early*, or at least don't get forgotten.

**Scope:** a small, static, single-author web app — one or a few HTML files, no backend, hosted
on GitHub Pages or Netlify, meant to be opened on a phone and maybe installed to the home screen.
Not a framework app. The whole philosophy is **pure-pull, self-contained output**: the published
files don't depend on the build pipeline, and opening the app *is* the refresh.

## How to use this

1. Copy `skeleton/` into the new repo as the starting file set. It's a working, installable,
   offline, themeable, shareable shell — search it for `EDIT` / `APP` / `USER` and fill in.
2. Run the checklist below as you build. Each item links to its section and its skeleton file.
3. Keep the "why" — these are all bugs that actually shipped once. The comments in the skeleton
   files carry the same reasoning inline.

---

## The pre-share checklist

Nothing here is hard; all of it is easy to *forget* until someone texts the link and gets a naked
grey box, or installs it and it won't open on the plane. Tick these before you share the URL.

**Share / link preview** (`skeleton/index.html` head, `make-og.sh`)
- [ ] `<title>` + `<meta name="description">` set (not the framework default)
- [ ] Open Graph tags: `og:title`, `og:description`, `og:url`, `og:image` (+ `:width`/`:height`/`:alt`)
- [ ] Twitter tags: `twitter:card=summary_large_image`, `twitter:title/description/image`
- [ ] **`og:image` is an ABSOLUTE https URL to a RASTER (PNG/JPG), 1200×630** — not relative, not SVG
- [ ] The share image actually exists and renders (open it directly; test by pasting the URL into a chat)

**Icons / install** (`manifest.json`, `make-icons.sh`, head)
- [ ] `icon.svg` source of truth → rasterized to 180 / 192 / 512 PNGs (don't hand-edit PNGs)
- [ ] `<link rel="icon">` (svg + png) and `<link rel="apple-touch-icon" href="…-180.png">`
- [ ] `manifest.json` present + linked: `name`, `short_name`, `start_url:"./"`, `display:"standalone"`, icons (incl. a `maskable`)
- [ ] `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` metas (iOS mostly ignores the manifest)
- [ ] `theme-color` metas — one per color scheme

**Offline / cache-busting** (`skeleton/sw.js`, `sw-lint.py`)
- [ ] Service worker registered and precaching the shell
- [ ] Every file the app needs offline is in the SW `SHELL` list (incl. self-hosted fonts / data)
- [ ] **A cache version constant (`V`) you bump on every shell change** — this is the #1 gotcha
- [ ] `sw-lint.py` wired into a pre-commit hook / CI so a forgotten bump gets caught
- [ ] Tested: load online once, kill the network, reopen — it still works

**Mobile** (head + CSS)
- [ ] `viewport-fit=cover` + `env(safe-area-inset-*)` padding (clear of notch / home indicator)
- [ ] `color-scheme: light dark` meta (no white flash before CSS loads)
- [ ] Touch targets ≥ ~44px; text legible without zoom; nothing overflows a 375px-wide screen
- [ ] `overscroll-behavior-y:none` if you don't want the rubber-band bounce in standalone

**Dark mode** (CSS)
- [ ] `@media (prefers-color-scheme: dark)` overrides (follows the OS automatically)
- [ ] Optional `.dark` class mirror for forced testing / a manual toggle / visual regression
- [ ] Contrast checked in *both* modes (WCAG AA)

**Analytics** (optional — `skeleton/ping.js`, `analytics.gs`, and §Analytics)
- [ ] If you want "is anyone using this?": the Google-Sheet ping pattern, ~10 lines of backend
- [ ] Loaded last, fire-and-forget, offline-queued, no PII in the log

**Deploy**
- [ ] Relative paths throughout (works at `user.github.io/repo/`, not just a root domain)
- [ ] Opened at the real URL **online once** so the SW caches, then Add to Home Screen
- [ ] `.gitignore` keeps any PII / large caches / generated previews out of the repo

---

## The maturity gradient (why this checklist exists)

The four repos land at different points on exactly these axes. The gaps are the lesson:

| Capability            | boccherini | haydn web | lobsters | AKM |
|-----------------------|:---------:|:---------:|:--------:|:---:|
| Dark mode             | ✅ (dual)  | ✅         | ✅        | ✅  |
| Responsive / mobile   | ✅ (clamp) | ✅         | ✅        | ✅  |
| Favicon / icons       | ❌         | ✅         | ✅ (SVG)  | ✅  |
| OG / share card       | ❌         | ✅         | ✅        | ✅  |
| `apple-*` / theme-color| ❌        | partial   | ✅        | ✅  |
| Web app manifest      | ❌         | ❌         | ✅ (runtime)| ✅ |
| Offline service worker| ❌         | ❌         | ✅ (inlined)| ✅ |
| Cache-bust discipline | —          | —         | —        | ✅ (`V` + lint) |
| Usage analytics       | ❌         | ❌         | ❌        | ✅  |

Boccherini is a *beautiful* page that forgot every share/install/offline nicety — the exact tax
this checklist is meant to stop paying. AKM is the far end (full SW, versioned cache, sheet
analytics, a live "you're on an old version, tap to update" tag). The skeleton is roughly
"lobsters+", and the sections below tell you how to climb to "AKM" when a project earns it.

Two different offline strategies worth knowing, both valid:
- **Inline everything** (lobsters): CSS, fonts, icons, data all embedded in one self-contained HTML.
  Offline for free, no SW needed for a single page. Best for a one-page handout.
- **Service worker precache** (AKM): multiple files + assets, cache-first, versioned. Needed once
  you have several pages / big assets / data you want cached. The skeleton ships this.

---

## Sections

### HTML head / meta
`skeleton/index.html` is a filled-in reference head. The load-bearing, easy-to-forget bits:
- **OG image must be absolute + raster.** iMessage/WhatsApp/Slack scrapers reject relative paths
  and won't render SVG. 1200×630. Every page's `<head>` should point at the absolute Pages URL.
- **`theme-color` is per-scheme** (`media="(prefers-color-scheme: …)"`) — it tints the browser UI.
- **`color-scheme: light dark`** up top kills the first-paint white flash in dark mode.
- iOS reads `apple-touch-icon` + the `apple-mobile-web-app-*` metas and *mostly ignores the
  manifest*; Android reads the manifest. Ship both or one platform's install looks broken.

### Icons & the share image
One SVG is the source of truth; rasterize from it — never hand-edit the PNGs (they drift).
- `make-icons.sh`: `icon.svg` → `icon-{180,192,512}.png` (apple-touch + manifest + maskable).
- `make-og.sh`: `og.svg` → `og.png` (1200×630). If the card has live `<text>`, the font must be
  installed locally or it silently falls back to a stock serif in the render.
- The SVG icon can double as the favicon (`<link rel="icon" type="image/svg+xml">`).
- Clever trick (lobsters): a single SVG **data-URI** used for `apple-touch-icon` *and* a
  **runtime-generated manifest** (a tiny script builds the manifest as a Blob URL from that one
  icon href) — keeps the icon in exactly one place, no separate PNG files at all. Nice for a
  single-page app; the skeleton uses real files since multi-page apps want them cached anyway.

### Offline & the service worker — **the cache-busting gotcha**
This is the one that bites hardest and latest. `skeleton/sw.js` + `skeleton/sw-lint.py`.
- The SW precaches a `SHELL` list and serves it cache-first (or network-first with cache fallback).
- **Bump the version constant `V` on every shell-file change.** A new `V` is what evicts the stale
  cache on `activate`. Forget it and your fix is in the repo but *never on anyone's phone* — iOS
  caches the service worker aggressively. This bit AKM's "v77" rewrite: three commits, no bump,
  users kept the old UI. `sw-lint.py` (warn-only pre-commit / hard-fail CI) catches a staged
  `SHELL` file with an unchanged `V`.
- **Make "am I stale?" visible + fixable in-app** (AKM's move, worth copying once a project is
  live): read the installed cache name back from `caches.keys()` and show it in a footer; fetch
  the deployed `sw.js` (`?_=`+`no-store` to dodge both caches) and compare — show a red "→ vNN"
  tag when the server is ahead, and make tapping it delete all caches + reload. Turns "my phone
  won't update" from a mystery into one tap.
- Let **cross-origin data** (your APIs) pass straight through to the network — don't cache it in
  the SW; use `localStorage` / stale-while-revalidate in the app for that.
- **Fonts survive offline only if the SW caches them.** Webfonts aren't iOS system fonts; without
  the cache an offline home-screen open falls back to Times/Courier. The skeleton caches Google
  Fonts cache-first.

### Manifest / installability
`skeleton/manifest.json`. `start_url:"./"` + relative `scope` so it works as a project page.
`display:"standalone"`. Include a `512×512` `maskable` icon or Android crops your square badly.
Note: an installed copy opens `start_url` many times — so the page you want opened daily should be
the root, and a "read once" invite/about page should be a *different* URL you send, not the root.

### Mobile friendliness
- `viewport-fit=cover` **and** `env(safe-area-inset-*)` padding on the body — one without the
  other either clips content under the notch or wastes the inset.
- Target **real touch devices** with `@media (hover:none) and (pointer:coarse) and (max-width:800px)`
  when you want phone-specific sizing — a bare `max-width` also catches a shrunk desktop window,
  which you usually *don't* want to restyle (boccherini splits responsive-`clamp()` for
  desktop/tablet from fixed sizes for touch this way).
- Fluid sizing with `clamp(min, vw, max)` on font sizes / dimensions scales cleanly across the
  desktop→tablet range without a pile of breakpoints.
- iOS home-screen apps **resume** rather than reload — re-pull data on `visibilitychange`, and
  don't assume a fresh load ever happens.

### Dark mode
Two entry points, both cheap (boccherini/haydn pattern):
- `@media (prefers-color-scheme: dark)` — what real users get, follows the OS.
- a `.dark` class that sets the same variables — lets you force it for screenshots, a manual
  toggle, or visual-regression baselines without changing the OS setting.
Drive it all off CSS custom properties (`--bg`, `--ink`, …) so a mode is a variable swap, not a
second stylesheet. Check contrast in **both** modes. Mind source order: a later `@media print` or
`prefers-color-scheme` block can override your `.dark` class — class specificity usually wins, but
`:root`-level media blocks don't.

### Analytics — cheap, private, no third party
Full writeup in AKM's [`ANALYTICS.md`](../ANALYTICS.md) (board-friendly + technical); the
generalized code is `skeleton/ping.js` + `skeleton/analytics.gs`. When the audience is small and
known, **a log you own beats a dashboard you rent.**
- A ~10-line Apps Script **bound to a private Google Sheet**, deployed as a web app
  (*Execute as: Me* / *Access: Anyone*) = an append-only mailbox: anyone can drop a row, only you
  can read the sheet. No server, no cost, no consent banner, no third party.
- `ping.js` **queues opens in `localStorage` and flushes when online** (fire-and-forget, loaded
  last, never blocks render) — so offline opens are recorded at open time, delivered later.
- Identify users by a **one-way hash** of a stable name (first 4 bytes of SHA-256), never the name
  itself — the log has no PII, and you reverse it against your own roster with a `=UID()` formula
  in the sheet. Empty uid = anonymous open (a useful "stranger found the URL" tripwire).
- **`URL_` empty = disabled but harmless**: pings queue silently, nothing sent, nothing errors —
  so you can ship the client before the backend exists and the backlog flushes when the URL lands.
- Gotchas that cost real debugging: a plain **Save doesn't redeploy** an Apps Script (Manage
  deployments → New version); all-digit hashes get **coerced to numbers** unless the column is
  Plain-text formatted; keep `doGet` tolerant of missing params forever (old queued pings).

### Deploy
- **GitHub Pages**, `main`/root, relative paths → served at `user.github.io/repo/`. After deploy,
  open the URL **online once** to prime the SW cache, then Add to Home Screen.
- **Netlify** (lobsters): point `publish` at the built output dir, push to deploy. Good when a
  build step produces the HTML.
- Only thing verifiable *live* is a real cross-origin fetch (a sheet/API pull) — if the data
  renders at the Pages URL, everything downstream is proven.
- `.gitignore` anything with PII (rosters, phone numbers), large binary caches, and generated
  preview images that bake in private data.

---

## Grab-bag of gotchas (each cost time once)

- **Forgot the share card** → the link previews as a blank grey box. Do OG + `make-og.sh` early.
- **Relative `og:image`** → no preview in iMessage/WhatsApp. Must be absolute + raster.
- **Forgot to bump the SW `V`** → fix ships to the repo, never to phones. `sw-lint.py` guards it.
- **Webfont not in the SW cache** → offline opens fall back to system serif. Cache it.
- **No `viewport-fit` / safe-area** → content under the notch or a fat unusable inset.
- **Manifest but no `apple-*` metas** → Android installs clean, iOS install looks broken.
- **iOS resumes, doesn't reload** → stale data unless you re-pull on `visibilitychange`.
- **Analytics: plain Save instead of redeploy** → you're editing a script nobody's calling.
- **Analytics: all-digit hash coerced to a number** → reverse lookup silently misses ~2% of users.
- **Named the root the "invite" page** → installed copies open it daily; keep root = the daily app.
- **PII in the repo** → a `noindex` page is still public to anyone with the URL; keep data in a
  separate view-only sheet, pulled at runtime, never committed.
