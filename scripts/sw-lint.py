#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Catch a shell change that forgot to bump the service-worker cache version.

`sw.js` precaches the app SHELL and serves it **cache-first**, so an edit to any
precached file (app.js, a page, a program PDF, …) only reaches installed clients
when `V` changes — a new `V` is what evicts the old cache on activate. Forget the
bump and the fix ships to the repo but never to anyone's home-screen copy (this
bit the v77 concert-card rewrite: three app.js commits, no bump, stale card).

So: if this commit stages any SHELL file but leaves `V` identical to HEAD's, warn.

Pure-stdlib, no network. Exit 1 if it fires (gate CI); the pre-commit hook runs it
warn-only. Run by hand:  python3 scripts/sw-lint.py
"""
import re, subprocess, sys


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True)


def ver(src):
    m = re.search(r'const V\s*=\s*"([^"]*)"', src)
    return m.group(1) if m else None


def shell_paths(src):
    m = re.search(r"const SHELL\s*=\s*\[(.*?)\]", src, re.S)
    if not m:
        return set()
    # repo-relative: strip the leading "./", drop the bare root ("./")
    return {p.lstrip("./") for p in re.findall(r'"([^"]+)"', m.group(1)) if p.strip("./")}


def main():
    idx = sh("git", "show", ":sw.js")            # staged sw.js (index)
    if idx.returncode != 0:
        return 0                                  # no sw.js staged / not a repo — nothing to check
    src = idx.stdout
    shell = shell_paths(src)
    staged = set(sh("git", "diff", "--cached", "--name-only").stdout.split())

    touched = sorted((staged & shell) - {"sw.js"})
    if not touched:
        return 0

    head = sh("git", "show", "HEAD:sw.js")        # empty on the first commit
    old = ver(head.stdout) if head.returncode == 0 else None
    new = ver(src)
    if old is None or new != old:                 # first commit, or V already bumped — fine
        return 0

    print(f"  sw.js: V is still \"{new}\" but this commit changes precached shell files:")
    for f in touched:
        print(f"           {f}")
    print("  Bump V in sw.js or installed clients keep the cached version.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
