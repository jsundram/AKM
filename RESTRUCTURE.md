# Repo restructure — plan (not yet executed)

Goal: de-clutter the root by grouping each sub-app and its assets into folders. Chosen layout
is **feature folders**. `index.html`, `app.js`, `sw.js`, `manifest.json` stay at root (entry
point + service-worker scope must be at root). This doc is the turnkey checklist; delete it once
done.

## Target layout

```
AKM/
  index.html  app.js  sw.js  manifest.json
  icons/    icon.svg  icon-180.png  icon-192.png  icon-512.png
  data/     composer-bank.json
  map/      index.html  map.js  data.json  relief.jpg  aerial.jpg
  roster/   index.html
  scripts/  archive/  README.md  CLAUDE.md  .gitignore  .githooks/
```

URLs become `/AKM/map/` and `/AKM/roster/`; footer links become `./map/` and `./roster/`.

## File moves

Tracked files → `git mv` (preserves history). The two JPEGs are still untracked → plain `mv`.

```
mkdir icons data map roster
git mv icon.svg icon-180.png icon-192.png icon-512.png icons/
git mv composer-bank.json data/
git mv map.html   map/index.html
git mv map.js     map/map.js
git mv map-data.json map/data.json
git mv roster.html roster/index.html
mv map-relief.jpg map/relief.jpg      # untracked
mv map-aerial.jpg map/aerial.jpg      # untracked
```

## Reference updates (every one — restructure is only safe if all are done)

**`index.html`** (root)
- `./icon.svg` → `./icons/icon.svg`; `./icon-192.png` → `./icons/icon-192.png`; `./icon-180.png` → `./icons/icon-180.png`
- footer: `./map.html` → `./map/`; `./roster.html` → `./roster/`
- (`./app.js`, `./manifest.json` unchanged)

**`manifest.json`** (root)
- icons `./icon-192.png` → `./icons/icon-192.png`; `./icon-512.png` → `./icons/icon-512.png` (both entries)
- `start_url` / `scope` stay `./`

**`app.js`** (root)
- `fetch("./composer-bank.json")` → `fetch("./data/composer-bank.json")` (line ~306)

**`sw.js`** (root) — bump `V`, rewrite `SHELL`:
```
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json",
               "./data/composer-bank.json",
               "./roster/", "./roster/index.html",
               "./map/", "./map/index.html", "./map/map.js", "./map/data.json",
               "./map/relief.jpg", "./map/aerial.jpg",
               "./icons/icon.svg", "./icons/icon-180.png",
               "./icons/icon-192.png", "./icons/icon-512.png"];
```
(Cache both `./map/` and `./map/index.html` so the `/AKM/map/` navigation request and a direct
`index.html` hit both resolve offline; same for roster.)

**`map/index.html`** (was map.html)
- `./icon.svg` → `../icons/icon.svg`; `./icon-180.png` → `../icons/icon-180.png`
- back links `./index.html` → `../` (two places: header + footer)
- `<script src="./map.js">` unchanged (same folder)

**`map/map.js`** (was map.js)
- `fetch("./map-data.json")` → `fetch("./data.json")`
- raster spec strings: `map-relief.jpg` → `relief.jpg`, `map-aerial.jpg` → `aerial.jpg`

**`roster/index.html`** (was roster.html)
- `./icon.svg` → `../icons/icon.svg`; `./icon-180.png` → `../icons/icon-180.png`
- back links `./index.html` → `../` (two places)

**`scripts/make-icons.sh`**
- read `icons/icon.svg`, write `-o "icons/icon-$s.png"`

**`scripts/build-map.py`**
- `OUT = __file__.rsplit("/", 2)[0] + "/map/data.json"`

**`scripts/build-terrain.py`**
- read `ROOT + "/map/data.json"`; write `ROOT + "/map/relief.jpg"` and `ROOT + "/map/aerial.jpg"`

**`CLAUDE.md`**
- update the Architecture bullets + *map data* section to the new paths/filenames
  (`map/index.html`, `map/map.js`, `map/data.json`, `map/relief.jpg`, `map/aerial.jpg`,
  `data/composer-bank.json`, `icons/…`).

## Verify after executing

1. `python3 scripts/build-map.py && uv run scripts/build-terrain.py` → writes into `map/`.
2. `python3 -m http.server 8000` → open `/`, `/map/`, `/roster/`: all render; footer links + back
   links work; icons/favicon load; map layers (Map/Relief/Aerial) + pins/labels work.
3. DevTools → Offline → reload each route: still works (SW precache paths correct).
4. Confirm `git status` shows renames (not delete+add) for the tracked moves.
