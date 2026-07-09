#!/usr/bin/env python3
"""Estimate active time on AKM from Claude Code transcripts + git history.

Attribution model:
- A gap ending in a HUMAN prompt = you hands-on (reading/thinking/typing),
  credited up to HANDS_CAP (longer = you walked away).
- A gap ending in a machine record = Claude working, credited up to WORK_CAP
  (longer = stall / session left idle).
- Your metrics are computed on a MERGED global timeline (parallel sessions
  don't double-count you). Claude gets both: busy = union wall-clock,
  effort = sum across parallel sessions.
- Waiting = per merged Claude-busy stretch: first WAIT_FULL watched fully,
  then 25% attention (alt-tabbing).
- Cloud sessions (Claude-authored commits, grouped by Claude-Session trailer):
  commits clustered into bursts (<45 min apart); Claude work = burst span +
  CLOUD_PAD; you get CLOUD_PROMPT hands-on per burst; no waiting (fire+forget).
"""
import json, glob, subprocess, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Vienna")
HANDS_CAP = 300
WORK_CAP  = 600
WAIT_FULL = 120
WAIT_FRAC = 0.25
MERGE_TOL = 60        # s: stitch intervals this close when merging
SESSION_GAP = 1800    # s: silence that splits engaged working blocks
CLOUD_PAD   = 12*60
CLOUD_BURST = 45*60
CLOUD_PROMPT = 3*60

DIR = "/Users/jsundram/.claude/projects/-Users-jsundram-Dropbox-Code-AKM"
ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))

hands_iv, act_iv = [], []      # (start_epoch, end_epoch) credited intervals
claude_iv = []                 # (start, end, src) src: local|cloud
effort_events = []             # (t_end, seconds) per-gap Claude effort (sums parallel work)
sessions = []

for path in sorted(glob.glob(f"{DIR}/*.jsonl")):
    events, prompts, tokens, seen = [], 0, 0, set()  # one row per content block; usage repeats per row
    for line in open(path):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = r.get("timestamp")
        if not t:
            continue
        human = r.get("type") == "user" and (r.get("origin") or {}).get("kind") == "human" and not r.get("isMeta")
        if r.get("type") == "assistant":
            m = r.get("message") or {}
            if m.get("id") is None or m["id"] not in seen:
                seen.add(m.get("id"))
                tokens += (m.get("usage") or {}).get("output_tokens", 0)
        events.append((ts(t).timestamp(), human))
        prompts += human
    if not events:
        continue
    events.sort()
    act_iv.extend((t, t) for t, _ in events)  # raw activity marks → engaged blocks
    s_hands = s_work = 0.0
    if events[0][1]:
        hands_iv.append((events[0][0] - 60, events[0][0]))
        s_hands += 60
    for (t0, _), (t1, h1) in zip(events, events[1:]):
        g = t1 - t0
        if g <= 0:
            continue
        if h1:
            c = min(g, HANDS_CAP)
            hands_iv.append((t1 - c, t1))
            s_hands += c
        else:
            c = min(g, WORK_CAP)
            claude_iv.append((t1 - c, t1, "local"))
            effort_events.append((t1, c))
            s_work += c
    sessions.append(dict(id=path.split("/")[-1][:8], kind="local",
        start=events[0][0], end=events[-1][0], prompts=prompts, tokens=tokens,
        hands=s_hands, work=s_work))

# ---------- git commits / cloud sessions ----------
raw = subprocess.run(
    ["git", "-C", "/Users/jsundram/Dropbox/Code/AKM", "log", "--reverse",
     "--format=%h%x00%an%x00%aI%x00%s%x00%(trailers:key=Claude-Session,valueonly)"],
    capture_output=True, text=True).stdout
commits = []
for block in raw.strip().split("\n"):
    if "\x00" not in block:
        continue
    h, an, ai, s, trail = (block.split("\x00") + [""])[:5]
    commits.append(dict(h=h, t=ts(ai).timestamp(), subject=s, cloud=(an == "Claude"),
        session=trail.strip().split("session_")[-1][:12] if "session_" in trail else None))

# code size per commit (net lines of tracked text, sans vendored/baked artifacts)
LOC_EXCLUDE = {"d3.v7.min.js", "map-data.json"}
numstat = subprocess.run(
    ["git", "-C", "/Users/jsundram/Dropbox/Code/AKM", "log", "--reverse", "--numstat", "--format=@%h"],
    capture_output=True, text=True).stdout
loc, loc_at, add_at, del_at, h = 0, {}, {}, {}, None
for line in numstat.splitlines():
    if line.startswith("@"):
        h = line[1:]
    elif "\t" in line:
        a, r, path = line.split("\t", 2)
        if a == "-" or path.split("/")[-1] in LOC_EXCLUDE:
            continue
        add_at[h] = add_at.get(h, 0) + int(a)
        del_at[h] = del_at.get(h, 0) + int(r)
        loc += int(a) - int(r)
    if h:
        loc_at[h] = loc
for c in commits:
    c["loc"], c["add"], c["del"] = loc_at.get(c["h"], 0), add_at.get(c["h"], 0), del_at.get(c["h"], 0)

groups = {}
for c in [c for c in commits if c["cloud"]]:
    groups.setdefault(c["session"] or "untagged", []).append(c)
for key, cs in groups.items():
    cs.sort(key=lambda c: c["t"])
    bursts, cur = [], [cs[0]]
    for c in cs[1:]:
        (bursts.append(cur), cur.clear(), cur.append(c)) if c["t"] - cur[-1]["t"] > CLOUD_BURST else cur.append(c)
    bursts.append(cur)
    s_work = s_hands = 0.0
    for b in bursts:
        a, z = b[0]["t"] - CLOUD_PAD/2, b[-1]["t"] + CLOUD_PAD/2
        claude_iv.append((a, z, "cloud"))
        effort_events.append((z, z - a))
        hands_iv.append((a - CLOUD_PROMPT, a))
        s_work += z - a
        s_hands += CLOUD_PROMPT
    sessions.append(dict(id=key, kind="cloud", start=cs[0]["t"], end=cs[-1]["t"],
        prompts=len(bursts), tokens=0, commits=len(cs), hands=s_hands, work=s_work))

# ---------- merge + derive ----------
def merge(iv, tol=MERGE_TOL):
    out = []
    for a, z, *_ in sorted(iv):
        if out and a <= out[-1][1] + tol:
            out[-1][1] = max(out[-1][1], z)
        else:
            out.append([a, z])
    return out

hands_m, claude_m = merge(hands_iv), merge(claude_iv)
busy_by_src = {s: [(z, z - a) for a, z in merge([iv for iv in claude_iv if iv[2] == s])]
               for s in ("local", "cloud")}
blocks = merge(act_iv, SESSION_GAP)   # engaged working blocks, wall-to-wall
wait_events = [(z, min(z - a, WAIT_FULL) + WAIT_FRAC * max(0, z - a - WAIT_FULL)) for a, z in claude_m]

def total(evs): return sum(s for _, s in evs)
hands_events   = [(z, z - a) for a, z in hands_m]
busy_events    = [(z, z - a) for a, z in claude_m]
engaged_events = [(z, z - a) for a, z in blocks]

day = lambda t: datetime.fromtimestamp(t, TZ).strftime("%Y-%m-%d")
daily = {}
STREAMS = dict(hands=hands_events, wait=wait_events, busy=busy_events, effort=effort_events, engaged=engaged_events,
               busy_local=busy_by_src["local"], busy_cloud=busy_by_src["cloud"])
for k, evs in STREAMS.items():
    for t, s in evs:
        daily.setdefault(day(t), dict.fromkeys(STREAMS, 0.0))[k] += s

marks = sorted((t, k, s) for k, evs in STREAMS.items() for t, s in evs)
cum = dict.fromkeys(STREAMS, 0.0)
series, bin_start = [], None
for t, k, s in marks:
    cum[k] += s
    b = t // 900 * 900
    row = dict(t=b, **{k: round(v) for k, v in cum.items()})
    if b != bin_start:
        series.append(row); bin_start = b
    else:
        series[-1] = row

iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat()
out = dict(
    generated=datetime.now(TZ).isoformat(),
    totals={k: round(total(e)) for k, e in STREAMS.items()},
    daily={d: {k: round(v) for k, v in v.items()} for d, v in sorted(daily.items())},
    sessions=[{**s, "start": iso(s["start"]), "end": iso(s["end"])} for s in sorted(sessions, key=lambda s: s["start"])],
    commits=[dict(h=c["h"], t=iso(c["t"]), subject=c["subject"], cloud=c["cloud"], loc=c["loc"], add=c["add"], rm=c["del"]) for c in commits],
    blocks=[dict(start=iso(a), end=iso(z)) for a, z in blocks],
    series=[dict(r, t=iso(r["t"])) for r in series],
)
json.dump(out, open(sys.argv[1], "w"), indent=1)

hrs = lambda s: f"{s/3600:.1f}h"
print("TOTALS hands:", hrs(total(hands_events)), " wait:", hrs(total(wait_events)),
      " busy:", hrs(total(busy_events)), " effort:", hrs(total(effort_events)))
print(f"{sum(s['kind']=='local' for s in sessions)} local + {sum(s['kind']=='cloud' for s in sessions)} cloud sessions, {len(commits)} commits, {sum(s['tokens'] for s in sessions)} output tokens")
for d, v in sorted(daily.items()):
    print(d, "".join(f"  {k} {hrs(v[k]):>6}" for k in STREAMS))
