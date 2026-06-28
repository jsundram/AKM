# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Lesachtal daily briefing runner. Resolve today's tab, pull weather, pick from the
bank, render the template, deliver. Runs on the laptop (CEST) via launchd at 08:20.

  uv run briefing.py                       # today, live
  uv run briefing.py --date 2026-06-30     # a specific day
  uv run briefing.py --csv data.csv --offline --no-open   # offline test
"""
import sys, os, re, csv, io, json, html, hashlib, subprocess, datetime as dt
from zoneinfo import ZoneInfo
import urllib.parse as up, urllib.request as ur

SID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A"
LAT, LON, TZ = 46.70, 12.85, "Europe/Vienna"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "briefings")
ROOMS = {"A1", "A2", "AH", "KS", "BAND ROOM", "THEATRE", "CHAPEL", "WERNER"}
# his pieces -> composer key in the bank
MINE = {"dvorak quartet": "dvorak", "bruch octet": "bruch",
        "brahms piano quartet": "brahms", "faure piano quartet": "faure"}

def norm(s):
    s = s.lower().replace("ř", "r").replace("á", "a").replace("é", "e").replace("\u030c", "")
    return re.sub(r"\s+", " ", s).strip()

def despace(s):  # collapse only letter-spaced runs: "L U N C H"->"LUNCH", "1 3 : 0 0"->"13:00"
    return re.sub(r"(?<!\S)(\S(?: \S){2,})(?!\S)", lambda m: m.group(1).replace(" ", ""), s)

def mins(t):
    h, m = t.split(":"); return int(h) * 60 + int(m)

# ---------- fetch + parse ----------
def grid(date, csv_path=None):
    if csv_path:
        body = open(csv_path, encoding="utf-8").read()
    else:
        name = date.strftime("%a %-m/%-d")
        url = (f"https://docs.google.com/spreadsheets/d/{SID}/gviz/tq"
               f"?tqx=out:csv&sheet={up.quote(name, safe='')}")
        body = ur.urlopen(url, timeout=25).read().decode("utf-8", "replace")
    return [r for r in csv.reader(io.StringIO(body))]

def parse(rows):
    cols, day = {}, {"eyebrow": "", "mine": [], "meals": [], "allhands": [], "evening": []}
    for r in rows:
        cells = [c.strip() for c in r]
        if "WEEK" in despace(" ".join(cells)).upper() and "|" in " ".join(cells):
            m = re.search(r"WEEK\s+\w+", despace(" ".join(cells)).upper())
            if m: day["eyebrow"] = re.sub(r"\s+", " ", m.group(0)).title()
        hits = [i for i, c in enumerate(cells) if c in ROOMS]
        if len(hits) >= 3:
            cols = {i: cells[i] for i in hits}; continue
        lab = despace(cells[1]) if len(cells) > 1 else ""
        if not lab: continue
        tm = re.search(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", lab) or re.search(r"(\d{1,2}:\d{2})", lab)
        if not tm: continue
        start = tm.group(1); end = tm.group(2) if tm.lastindex == 2 else ""
        up_lab = lab.upper()
        if "LUNCH" in up_lab or "DINNER" in up_lab or "BREAKFAST" in up_lab:
            kind = "Lunch" if "LUNCH" in up_lab else "Dinner" if "DINNER" in up_lab else "Breakfast"
            venue = lab.split("@", 1)[1].strip() if "@" in lab else ""
            day["meals"].append((start, end, kind, venue)); continue
        evening = "PRACTICE BLOCK" in up_lab or "FREE READING" in up_lab
        for i, room in cols.items():
            cell = cells[i] if i < len(cells) else ""
            if not cell: continue
            lines = [x.strip() for x in cell.split("\n") if x.strip()]
            text = " ".join(lines)
            fac = text.lower().startswith("faculty")
            piece = re.sub(r"(?i)^faculty\s+(rehearsal|reading)\s*", "", text).strip()
            coach, tag = "", ""
            mt = re.search(r"^(.*?)\s*[-–]\s*([PC])\b", lines[-1]) if lines else None
            if mt and not fac:
                coach = mt.group(1).strip(); tag = mt.group(2)
                piece = " ".join(lines[:-1]).strip() or piece
            key = next((MINE[k] for k in MINE if k in norm(piece)), None)
            if any(w in text for w in ("Participant Tour", "Info Meeting", "Informational Meeting", "Festival Meeting", "Festival Informational")):
                day["allhands"].append((start, end, piece, room)); continue
            if fac or evening:
                day["evening"].append((start, end, piece, room, fac)); continue
            if key and not fac:
                day["mine"].append((start, end, piece, room, coach, tag, key))
    day["mine"].sort(key=lambda x: mins(x[0])); day["meals"].sort(key=lambda x: mins(x[0]))
    day["allhands"].sort(key=lambda x: mins(x[0]))
    return day

# ---------- weather ----------
def weather(date, offline=False):
    if offline:
        t = [67,66,65,64,62,61,62,65,69,73,77,80,82,81,78,74,73,74,72,70,68,66,64,63]
        return {"t": t, "hi": 82, "lo": 61, "rise": "05:15", "set": "21:05",
                "wet": "14–16h", "thunder": True, "shower": (13, 18), "ok": True, "note": "sample (offline)"}
    url = ("https://api.open-meteo.com/v1/forecast"
           f"?latitude={LAT}&longitude={LON}"
           "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weathercode"
           "&hourly=temperature_2m,precipitation,weathercode"
           f"&temperature_unit=fahrenheit&timezone={up.quote(TZ)}&start_date={date}&end_date={date}")
    try:
        j = json.load(ur.urlopen(url, timeout=25)); d, hr = j["daily"], j["hourly"]
        t = [round(x) for x in hr["temperature_2m"][:24]]
        pr = hr["precipitation"][:24]; wc = hr["weathercode"][:24]
        # wettest 3h window
        win = max(range(0, 22), key=lambda s: sum(pr[s:s+3]))
        wet = f"{win:02d}–{win+3:02d}h" if sum(pr) > 0 else ""
        rainy = [i for i, p in enumerate(pr) if p >= 0.2]
        shower = (min(rainy), max(rainy) + 1) if rainy else None
        return {"t": t, "hi": round(d["temperature_2m_max"][0]), "lo": round(d["temperature_2m_min"][0]),
                "rise": d["sunrise"][0][-5:], "set": d["sunset"][0][-5:], "wet": wet,
                "thunder": any(c in (95, 96, 99) for c in wc), "shower": shower, "ok": True, "note": ""}
    except Exception as e:
        return {"ok": False, "note": str(e)}

# ---------- bank / coda ----------
def coda(day, bank, state):
    keys = list(dict.fromkeys(e[6] for e in day["mine"]))  # today's composers, ordered
    if not keys: return ""
    used = set(state.get("used", []))
    def pick(kind, comp, avoid_used=True):
        items = bank.get(comp, {}).get(kind, [])
        order = sorted(items, key=lambda x: (0 if x.get("tier") == "sourced" else 1))
        for it in order:
            uid = comp + ":" + hashlib.md5(it["text"].encode()).hexdigest()[:8]
            if avoid_used and uid in used and not all(
                comp + ":" + hashlib.md5(i["text"].encode()).hexdigest()[:8] in used for i in order):
                continue
            used.add(uid); return it
        return order[0] if order else None
    qc = keys[0]
    q = pick("quotes", qc)
    facts = [pick("facts", c) for c in (keys[1:] or keys)]
    state["used"] = list(used)
    out = ['<div class="coda"><div class="coda-lab">Grace note</div>']
    if q:
        out.append(f'<div class="quote">{html.escape(q["text"])}'
                   f'<span class="by">{html.escape(bank[qc]["name"])}</span>'
                   f'<span class="prov">{html.escape(q["src"])}</span></div>')
    out.append('<div class="facts">')
    for c, f in zip((keys[1:] or keys), facts):
        if not f: continue
        out.append(f'<div class="fact"><span class="ftag">{c.upper()}</span><span>{html.escape(f["text"])} '
                   f'<span class="fsrc">{html.escape(f["src"].split(";")[0])}</span></span></div>')
    out.append("</div></div>")
    return "".join(out)

# ---------- render ----------
def svg(w):
    t = w["t"]; W, H, L, R, T, B = 340, 86, 12, 328, 12, 60
    lo, hi = min(t) - 3, max(t) + 4
    xat = lambda h: L + h / 23 * (R - L); yat = lambda v: B - (v - lo) / (hi - lo) * (B - T)
    P = [(xat(i), yat(v)) for i, v in enumerate(t)]
    d = f"M{P[0][0]:.1f} {P[0][1]:.1f}"
    for i in range(len(P) - 1):
        a = P[i-1] if i else P[0]; b, c = P[i], P[i+1]; e = P[i+2] if i+2 < len(P) else P[-1]
        d += (f" C{b[0]+(c[0]-a[0])/6:.1f} {b[1]+(c[1]-a[1])/6:.1f} "
              f"{c[0]-(e[0]-b[0])/6:.1f} {c[1]-(e[1]-b[1])/6:.1f} {c[0]:.1f} {c[1]:.1f}")
    hi_i, lo_i = t.index(max(t)), t.index(min(t))
    s = (f'<svg viewBox="0 0 {W} {H}" width="100%" preserveAspectRatio="xMidYMid meet" '
         f'font-family="\'IBM Plex Mono\',monospace"><defs>'
         '<linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#7E96A6"/>'
         '<stop offset="0.5" stop-color="#C5792B"/><stop offset="1" stop-color="#7E96A6"/></linearGradient>'
         '<linearGradient id="fg" x1="0" x2="0" y1="0" y2="1">'
         '<stop offset="0" stop-color="#C5792B" stop-opacity="0.16"/>'
         '<stop offset="1" stop-color="#C5792B" stop-opacity="0"/></linearGradient></defs>')
    if w.get("shower"):
        a, b = xat(w["shower"][0]), xat(w["shower"][1])
        s += (f'<rect x="{a:.1f}" y="{T}" width="{b-a:.1f}" height="{B-T}" fill="#6E7D84" opacity="0.13"/>'
              f'<text x="{(a+b)/2:.1f}" y="{T+9}" font-size="7.5" fill="#6E7D84" text-anchor="middle" '
              'letter-spacing="0.5">SHOWERS</text>')
    s += f'<path d="{d} L{R} {B} L{L} {B} Z" fill="url(#fg)"/><path d="{d}" fill="none" stroke="url(#tg)" stroke-width="2.2" stroke-linecap="round"/>'
    s += (f'<circle cx="{xat(hi_i):.1f}" cy="{yat(t[hi_i]):.1f}" r="2.6" fill="#C5792B"/>'
          f'<text x="{xat(hi_i):.1f}" y="{yat(t[hi_i])-6:.1f}" font-size="9" fill="#C5792B" text-anchor="middle" font-weight="500">H {w["hi"]}°</text>'
          f'<circle cx="{xat(lo_i):.1f}" cy="{yat(t[lo_i]):.1f}" r="2.6" fill="#7E96A6"/>'
          f'<text x="{xat(lo_i):.1f}" y="{yat(t[lo_i])+13:.1f}" font-size="9" fill="#7E96A6" text-anchor="middle" font-weight="500">L {w["lo"]}°</text>')
    for h, lab in ((6, "6a"), (12, "12p"), (18, "6p")):
        s += f'<text x="{xat(h):.1f}" y="{B+13}" font-size="8" fill="#8A9A9B" text-anchor="middle">{lab}</text>'
    return s + "</svg>"

def wxcard(w):
    if not w.get("ok"):
        return ('<div class="wx"><div class="wx-top"><div class="wx-sum">'
                '<b>Forecast unavailable this morning.</b><br>schedule below.</div></div></div>')
    sub = []
    sub.append("Thunderstorms possible" if w["thunder"] else "Showers possible" if w.get("shower") else "Dry")
    foot = (f'<div class="wx-foot"><span>Wettest <b>≈ {w["wet"]}</b></span>'
            f'<span>Sun <b>↑ {w["rise"]}</b> · <b>↓ {w["set"]}</b></span></div>') if w["wet"] else \
           f'<div class="wx-foot"><span>Sun <b>↑ {w["rise"]}</b> · <b>↓ {w["set"]}</b></span></div>'
    return (f'<div class="wx"><div class="wx-top"><div class="wx-temp">{w["hi"]}°<small> / {w["lo"]}°F</small></div>'
            f'<div class="wx-sum"><b>{", ".join(sub)} in the afternoon.</b><br>light wind</div></div>'
            f'<div class="wx-curve">{svg(w)}</div>{foot}</div>')

def tline(s, e):
    return (f'<div class="time"><span class="s">{s}</span>'
            + (f'<span class="e">{e}</span>' if e else "") + "</div>")

def timeline(day, w):
    ev = []  # (sortkey, html)
    for s, e, piece, room in day["allhands"]:
        ev.append((s, f'<div class="row"><div class="time"><span class="s">{s}</span>'
                   + (f'<span class="e">{e}</span>' if e else "")
                   + f'</div><div class="body ev"><span class="dot"></span><div class="tag">All welcome</div>'
                   f'<div class="what">{html.escape(piece)}</div></div></div>'))
    for s, e, piece, room, coach, tag, key in day["mine"]:
        pc = "Perform" if tag == "P" else "Coach" if tag == "C" else ""
        chip = f'<span class="roomchip">{html.escape(room)}</span>' if room else ""
        cw = f'<span class="coach">with <b>{html.escape(coach)}</b></span>' if coach else ""
        kick = f'<div class="kicker"><span>Your rehearsal</span><span class="pc">{pc}</span></div>'
        ev.append((s, f'<div class="row mine">{tline(s,e)}<div class="body"><span class="dot"></span>'
                   f'<div class="card">{kick}<div class="piece">{html.escape(piece)}</div>'
                   f'<div class="meta">{chip}{cw}</div></div></div></div>'))
    for s, e, kind, venue in day["meals"]:
        ev.append((s, f'<div class="row meal">{tline(s,e)}<div class="body"><span class="dot"></span>'
                   f'<div class="what">{kind} · {html.escape(venue)}</div></div></div>'))
    if day["evening"]:
        s0 = min((x[0] for x in day["evening"]), key=mins)
        items, occ = [], []
        for s, e, piece, room, fac in sorted(day["evening"]):
            if "closed" in piece.lower():
                occ.append((room, "closed")); continue
            if not piece: continue
            flag = ""
            if any(q in piece.lower() for q in ("quartet", "langsamer satz")):
                flag = '<span class="flag">String Quartet</span>'
            if next((1 for k in MINE if k in norm(piece)), 0):
                flag = '<span class="flag">Your piece</span>'
            items.append(f'<div class="mh-item"><span class="rm">{html.escape(room)}</span>'
                         f'<span class="pl"><b>{html.escape(piece)}</b> <span class="who">· faculty</span></span>{flag}</div>')
            occ.append((room, "faculty"))
        taken = " and ".join(f"<b>{r}</b>" for r, _ in occ if _ == "faculty")
        closed = ", ".join(f"<b>{r}</b>" for r, k in occ if k == "closed")
        note = "Practice rooms open"
        if taken: note += f" except {taken} (faculty)"
        if closed: note += f" and the {closed} (closed)"
        note += " — sign up in the Akademie."
        mh = ('<div class="meanwhile"><div class="mh-lab">Worth sitting in on</div>' + "".join(items) + "</div>") if items else ""
        ev.append((s0, f'<div class="row"><div class="time"><span class="s">{s0}</span></div>'
                   f'<div class="body ev"><span class="dot"></span><div class="tag">Evening · your time</div>'
                   f'<div class="what">Practice Block / Free Reading</div>{mh}'
                   f'<div class="roomnote">{note}</div></div></div>'))
    ev.sort(key=lambda x: mins(x[0]))
    out = [h for _, h in ev]
    # one weather cue before the latest afternoon rehearsal if wet
    if w.get("ok") and (w.get("thunder") or w.get("shower")):
        aft = [e for e in day["mine"] if mins(e[0]) >= 840]
        if aft:
            tw = ", maybe thunder," if w["thunder"] else ","
            note = '<div class="wxnote">Showers' + tw + ' building through the afternoon — umbrella, and a cloth for the violin.</div>'
            piece = aft[-1][2]
            for i, hrow in enumerate(out):
                if 'class="row mine"' in hrow and piece and html.escape(piece) in hrow:
                    out.insert(i, note); break
    return "\n".join(out)

# ---------- main ----------
def main():
    a = sys.argv[1:]
    def opt(f): return a[a.index(f) + 1] if f in a else None
    date = dt.date.fromisoformat(opt("--date")) if "--date" in a else dt.datetime.now(ZoneInfo(TZ)).date()
    rows = grid(date, opt("--csv"))
    day = parse(rows)
    if not (day["mine"] or day["meals"] or day["allhands"]):
        print("schedule not posted yet for", date); 
    w = weather(date, offline="--offline" in a)
    bank = json.load(open(os.path.join(HERE, "composer-bank.json")))
    spath = os.path.join(HERE, "briefing-state.json")
    state = json.load(open(spath)) if os.path.exists(spath) else {}
    tpl = open(os.path.join(HERE, "briefing-template.html")).read()
    n = (date - dt.date(2026, 6, 29)).days + 1
    eyebrow = (day["eyebrow"] + f" · Day {n}") if (day["eyebrow"] and n >= 1) else day["eyebrow"]
    out = (tpl.replace("{{EYEBROW}}", eyebrow or "")
              .replace("{{DOW}}", date.strftime("%A"))
              .replace("{{DATE}}", date.strftime("%-d %B"))
              .replace("{{WEATHER}}", wxcard(w))
              .replace("{{TIMELINE}}", timeline(day, w))
              .replace("{{CODA}}", coda(day, bank, state)))
    os.makedirs(OUT, exist_ok=True)
    fp = os.path.join(OUT, f"briefing-{date}.html")
    open(fp, "w").write(out)
    json.dump(state, open(spath, "w"))
    print("wrote", fp, "| rehearsals:", len(day["mine"]), "| weather:", w.get("note") or "live")
    if "--no-open" not in a:
        for cmd in (["open", fp],
                    ["osascript", "-e", f'display notification "Tap to open · {len(day["mine"])} rehearsals" '
                     f'with title "Briefing · {date:%a %-d %b}"']):
            try: subprocess.run(cmd, check=False)
            except Exception: pass

if __name__ == "__main__":
    main()
