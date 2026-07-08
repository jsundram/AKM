#!/usr/bin/env python3
"""Nightly usage-page refresh — rides the buildlog launchd job (buildlog/update.py
invokes this first, before its own expiry check, so this keeps running after the
buildlog stops).

crunch → splice the DATA blob into index.html → commit → push.
Idempotent: if nothing but the generated-timestamp moved, exits clean.
Self-expiring: no-ops after END. Network-tolerant: a failed crunch (offline, or
the pings tab unpublished) or push leaves things for the next run.
"""
import json, re, subprocess, sys, tempfile
from datetime import date
from pathlib import Path

US = Path(__file__).resolve().parent
ROOT = US.parent
END = date(2026, 7, 19)   # a week past the festival — the trailing opens taper off

if date.today() > END:
    print("usage: past festival; nothing to do")
    sys.exit(0)

def git(*args, ok=False):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode and not ok:
        sys.exit(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r

git("pull", "--rebase", "origin", "main", ok=True)   # offline: refresh local anyway

with tempfile.NamedTemporaryFile(suffix=".json") as tmp:
    if subprocess.run([sys.executable, US / "crunch.py", tmp.name]).returncode:
        print("usage: crunch failed (offline?) — keeping the current page")
        sys.exit(0)
    data = json.load(open(tmp.name))

html = (US / "index.html").read_text()
old = json.loads(re.search(r"const DATA = (\{.*?\});\n", html, re.S).group(1))
if {k: v for k, v in old.items() if k != "generated"} == \
   {k: v for k, v in data.items() if k != "generated"}:
    print("usage: no change since last refresh")
    sys.exit(0)

blob = json.dumps(data, separators=(",", ":"))
html, n = re.subn(r"const DATA = \{.*?\};\n", lambda m: f"const DATA = {blob};\n", html, count=1, flags=re.S)
assert n == 1, "DATA blob not found in usage/index.html"
(US / "index.html").write_text(html)

git("add", "usage/index.html")
git("commit", "-m", f"usage: refresh through {date.today()} "
    f"({data['total']} opens, {data['identified']} people)")
if git("push", "origin", "main", ok=True).returncode:
    print("usage: push failed (offline?) — committed locally, next run will push")
else:
    print(f"usage: refreshed + pushed ({data['total']} opens)")
