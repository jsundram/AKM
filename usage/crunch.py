#!/usr/bin/env python3
"""Usage crunch — pings CSV + roster → the uid-keyed DATA blob for usage/index.html.

Reads the *published-to-web* CSV of the analytics sheet's pings tab (the sheet itself
stays private; unpublishing that tab breaks this) and the public roster gviz. Names
never land in the output: people are keyed by their ping uid (first 8 hex of
SHA-256(name)) and the page joins names back at runtime from the roster. Run:

    python3 usage/crunch.py out.json
"""
import csv, hashlib, io, json, re, sys, urllib.request
from datetime import datetime, timedelta

CSV = ("https://docs.google.com/spreadsheets/d/e/2PACX-1vRXFSKEV0IjMxBH-hSWAvirawzMmSBm4rEtj0W7vTM8OsH3yDZdK_Z4bjpgDXY6PBw8DvdPoM5E3lUo"
       "/pub?gid=0&single=true&output=csv")
SID, GID = "1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo", "800090339"   # keep in sync with roster-data.js
LAUNCH = datetime(2026, 7, 6, 19, 30)   # shared over dinner; earlier rows = testing
JASON = "70f71792"                       # uid("Jason Sundram") — shown, not ranked
QUEUED = timedelta(seconds=90)           # received this far after opened = was offline

uid = lambda name: hashlib.sha256(name.encode()).hexdigest()[:8]
fetch = lambda url: urllib.request.urlopen(url, timeout=30).read().decode()

def roster_uids():
    """uid set of everyone on the roster (gviz header quirk: labels or row 0)."""
    raw = fetch(f"https://docs.google.com/spreadsheets/d/{SID}/gviz/tq?gid={GID}&tqx=out:json")
    t = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])["table"]
    rows = [[(c or {}).get("v") or "" for c in r["c"]] for r in t["rows"]]
    labels = [(c.get("label") or "").lower() for c in t["cols"]]
    if not any("name" in l for l in labels):
        labels, rows = [str(x).lower() for x in rows[0]], rows[1:]
    ni = next(i for i, l in enumerate(labels) if "name" in l)
    names = [str(r[ni]).strip() for r in rows if str(r[ni]).strip().lower() not in ("", "name")]
    return {uid(n) for n in names}

def T(s):
    m = re.match(r"(\d+)/(\d+)/(\d+) (\d+):(\d+):(\d+)", s or "")
    return datetime(int(m[3]), int(m[1]), int(m[2]), int(m[4]), int(m[5]), int(m[6])) if m else None

def crunch(csv_text=None, roster=None):
    if roster is None: roster = roster_uids()          # inject both to test offline (also the JS-parity oracle)
    if csv_text is None: csv_text = fetch(CSV)
    rows = []
    for r in csv.DictReader(io.StringIO(csv_text)):
        rec, opened = T(r.get("received")), T(r.get("opened")) or T(r.get("received"))
        page, who = (r.get("page") or "").strip(), (r.get("who") or "").strip()
        if rec and page and page != "page":
            rows.append((opened, rec, page, who))
    rows.sort()
    raw = len(rows)
    seen, dd = set(), []
    for x in rows:                                   # a flush interrupted mid-save re-sends
        k = (x[0], x[2], x[3])
        if k not in seen: seen.add(k); dd.append(x)
    pre = sum(1 for x in dd if x[0] < LAUNCH)
    dd = [x for x in dd if x[0] >= LAUNCH]

    day = lambda d: f"{d.month}/{d.day}"
    launch_day = day(LAUNCH)                 # the launch evening's burst skews the hour-of-day rhythm
    users, pages, by_day, anon_day = {}, {}, {}, {}
    by_hour = [0] * 24
    buckets, first = {}, {}
    anon = queued = 0
    for opened, rec, page, who in dd:
        d, h = day(opened), opened.hour
        by_day[d] = by_day.get(d, 0) + 1
        if d != launch_day: by_hour[h] += 1     # rhythm of day leaves out launch night's 19:30 spike
        buckets[(d, h)] = buckets.get((d, h), 0) + 1
        pg = pages.setdefault(page, {"opens": 0, "users": set()})
        pg["opens"] += 1
        if rec - opened > QUEUED: queued += 1
        if not who:
            anon += 1; anon_day[d] = anon_day.get(d, 0) + 1; continue
        pg["users"].add(who)
        u = users.setdefault(who, {"uid": who, "opens": 0, "pages": {}, "days": set()})
        u["opens"] += 1
        u["pages"][page] = u["pages"].get(page, 0) + 1
        u["days"].add(d)
        if who != JASON: first.setdefault(who, opened)

    series, adopt = [], []
    t, end = LAUNCH.replace(minute=0), max(x[0] for x in dd)
    firsts = sorted(first.values())
    while t <= end:
        series.append({"t": f"{day(t)} {t.hour:02d}", "n": buckets.get((day(t), t.hour), 0)})
        adopt.append({"t": series[-1]["t"], "n": sum(1 for f in firsts if f < t + timedelta(hours=1))})
        t += timedelta(hours=1)

    ulist = sorted(users.values(), key=lambda u: -u["opens"])
    return {
        "generated": datetime.now().strftime("%-m/%-d %H:%M"),
        "raw": raw, "deduped": raw - len(dd) - pre, "pre": pre, "total": len(dd),
        "anon": anon, "queued": queued,
        "rosterSize": len(roster),
        "identified": len(ulist),
        "unknown": sum(1 for u in ulist if u["uid"] not in roster),
        "users": [{"uid": u["uid"], "opens": u["opens"], "pages": u["pages"],
                   "days": len(u["days"]), "known": u["uid"] in roster} for u in ulist],
        "pages": sorted([{"page": p, "opens": v["opens"], "users": len(v["users"])}
                         for p, v in pages.items()], key=lambda p: -p["opens"]),
        "byDay": by_day, "anonByDay": anon_day, "byHour": by_hour,
        "series": series, "adopt": adopt,
    }

if __name__ == "__main__":
    try:
        data = crunch()
    except OSError as e:
        sys.exit(f"fetch failed (offline? unpublished?): {e}")
    out = json.dumps(data, separators=(",", ":"))
    (open(sys.argv[1], "w") if len(sys.argv) > 1 else sys.stdout).write(out)
