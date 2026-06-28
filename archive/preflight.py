# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Preflight for the Lesachtal briefing — confirms the two live calls this sandbox couldn't.
  uv run preflight.py                # checks today (Vienna)
  uv run preflight.py 2026-06-29     # checks a specific festival day
Run it on a machine with normal network (your Mini). Exit 0 = ready.
"""
import sys, csv, io, json, datetime as dt
from zoneinfo import ZoneInfo
import urllib.parse as up, urllib.request as ur

SID = "1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A"
LAT, LON, TZ = 46.70, 12.85, "Europe/Vienna"
G = lambda b: "\033[32mPASS\033[0m" if b else "\033[31mFAIL\033[0m"

def check_tab(d):
    name = d.strftime("%a %-m/%-d")
    url = (f"https://docs.google.com/spreadsheets/d/{SID}/gviz/tq"
           f"?tqx=out:csv&sheet={up.quote(name, safe='')}")
    try:
        body = ur.urlopen(url, timeout=20).read().decode("utf-8", "replace")
        rows = [r for r in csv.reader(io.StringIO(body)) if any(c.strip() for c in r)]
        ok = len(rows) > 1
        print(f"{G(ok)}  tab '{name}': {len(rows)} rows")
        return ok
    except Exception as e:
        print(f"{G(False)}  tab '{name}': {e}"); return False

def check_weather(d):
    url = ("https://api.open-meteo.com/v1/forecast"
           f"?latitude={LAT}&longitude={LON}"
           "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,weathercode"
           "&hourly=temperature_2m,precipitation,precipitation_probability,weathercode"
           f"&temperature_unit=fahrenheit&timezone={up.quote(TZ)}"
           f"&start_date={d}&end_date={d}")
    try:
        j = json.load(ur.urlopen(url, timeout=20))
        dl, n = j["daily"], len(j["hourly"]["temperature_2m"])
        ok = n >= 24
        print(f"{G(ok)}  open-meteo: {dl['temperature_2m_max'][0]:.0f}/{dl['temperature_2m_min'][0]:.0f}F, "
              f"{n} hourly pts, sun {dl['sunrise'][0][-5:]}–{dl['sunset'][0][-5:]}")
        return ok
    except Exception as e:
        print(f"{G(False)}  open-meteo: {e}"); return False

def check_bank(p="composer-bank.json"):
    try:
        d = json.load(open(p))
        n = sum(len(v.get("quotes", [])) + len(v.get("facts", []))
                for k, v in d.items() if k != "_meta")
        print(f"{G(n > 0)}  bank: {n} entries / {len(d) - 1} composers")
        return n > 0
    except Exception as e:
        print(f"{G(False)}  bank ({p}): {e}"); return False

if __name__ == "__main__":
    d = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else dt.datetime.now(ZoneInfo(TZ)).date()
    print(f"Preflight — {d:%a %Y-%m-%d} (Vienna)\n")
    res = [check_tab(d), check_weather(d), check_bank()]
    print("\n" + ("READY ✓" if all(res) else "NOT READY — fix FAIL lines above"))
    sys.exit(0 if all(res) else 1)
