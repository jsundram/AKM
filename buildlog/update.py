#!/usr/bin/env python3
"""Nightly buildlog refresh — laptop-only (crunch.py reads the local
Claude Code transcripts, which never leave this machine).

crunch → splice the DATA blob into index.html → commit → push.
Idempotent: if nothing but the generated-timestamp moved, exits clean.
Self-expiring: no-ops after END. Network-tolerant: a failed pull or
push leaves the commit for the next run.
"""
import json, re, subprocess, sys, tempfile
from datetime import date
from pathlib import Path

BL = Path(__file__).resolve().parent
ROOT = BL.parent
END = date(2026, 7, 13)   # festival ends 7/12; last refresh the morning after

# the usage page rides this same nightly job — run it first, before our own
# expiry check, since it keeps refreshing for a week after the buildlog stops
subprocess.run([sys.executable, ROOT / "usage" / "update.py"])

if date.today() > END:
    print("past festival; nothing to do")
    sys.exit(0)

def git(*args, ok=False):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode and not ok:
        sys.exit(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r

git("pull", "--rebase", "origin", "main", ok=True)   # offline: refresh local anyway

with tempfile.NamedTemporaryFile(suffix=".json") as tmp:
    subprocess.run([sys.executable, BL / "crunch.py", tmp.name], check=True)
    data = json.load(open(tmp.name))

html = (BL / "index.html").read_text()
old = json.loads(re.search(r"const DATA = (\{.*?\});\n", html, re.S).group(1))
if {k: v for k, v in old.items() if k != "generated"} == \
   {k: v for k, v in data.items() if k != "generated"}:
    print("no change since last refresh")
    sys.exit(0)

blob = json.dumps(data, separators=(",", ":"))
html, n = re.subn(r"const DATA = \{.*?\};\n", lambda m: f"const DATA = {blob};\n", html, count=1, flags=re.S)
assert n == 1, "DATA blob not found in index.html"
(BL / "index.html").write_text(html)

git("add", "buildlog/index.html")
git("commit", "-m", f"buildlog: refresh through {date.today()} "
    f"({len(data['commits'])} commits, {data['totals']['engaged']//3600}h in session)")
if git("push", "origin", "main", ok=True).returncode:
    print("push failed (offline?) — committed locally, next run will push")
else:
    print(f"refreshed + pushed: {len(data['commits'])} commits")
