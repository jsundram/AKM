# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Refresh the tab→gid map in app.js from the live sheet's htmlview.

The footer's "source sheet" link deep-links to each day's tab by gid, but gids
can't be fetched cross-origin at runtime, so we bake them in. Run by the
pre-commit hook; also runnable by hand: `python3 scripts/update-gids.py`.
Exits non-zero (without touching app.js) on any network/parse failure, so the
hook can keep the existing map instead of blocking the commit."""
import re, sys, urllib.request, pathlib

APP = pathlib.Path(__file__).resolve().parent.parent / "app.js"
src = APP.read_text()
SID = re.search(r'const SID = "([^"]+)"', src).group(1)
url = f"https://docs.google.com/spreadsheets/d/{SID}/htmlview"

try:
    html = urllib.request.urlopen(url, timeout=15).read().decode("utf-8", "replace")
except Exception as e:
    sys.exit(f"update-gids: fetch failed ({e}); keeping existing map")

# htmlview embeds: items.push({name: "Mon 6\/29", pageUrl: "...gid=NNN..."})
pairs = [(n.replace("\\/", "/"), re.search(r"gid=(\d+)", u).group(1))
         for n, u in re.findall(r'items\.push\(\{name:\s*"([^"]+)",\s*pageUrl:\s*"([^"]+)"', html)]
if not pairs:
    sys.exit("update-gids: no tabs parsed; keeping existing map")

ent = [f'"{n}":"{g}"' for n, g in pairs]                 # 3 per line, matching the hand style
body = ",\n  ".join(",".join(ent[i:i+3]) for i in range(0, len(ent), 3))
new = re.sub(r"const GID = \{[^}]*\};", lambda _: f"const GID = {{{body}}};", src)
if new == src:
    print("update-gids: map unchanged")
else:
    APP.write_text(new)
    print(f"update-gids: {len(pairs)} tabs written")
