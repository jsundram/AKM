#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Catch CLAUDE.md drift before it lands. Two checks, both pure-stdlib, no network:

  broken ref   — a `file.ext` the doc names that no longer exists anywhere tracked
                 (a rename/delete the prose didn't follow — e.g. the old footer links)
  undocumented — a tracked *root-level* app file the doc never mentions
                 (a new sibling the prose didn't gain — e.g. nav.css / notes.html)

References resolve by basename-anywhere (the doc cites `analytics.gs`, the file is
`scripts/analytics.gs`) — this lints existence, not path-accuracy. Subdirs (scripts/,
archive/, …) aren't orphan-checked; root is where the app surface lives. `icon-*.png`
and other globs in the doc count as covering the files they match.

Exit 1 if anything fires, so it can gate CI. The pre-commit hook runs it warn-only.
Run by hand:  python3 scripts/doc-lint.py
"""
import re, subprocess, sys
from fnmatch import fnmatch
from pathlib import Path

DOC = "CLAUDE.md"
EXTS = "js html json css png svg jpg jpeg py sh gs md plist pdf txt webmanifest".split()
# root files intentionally not in CLAUDE.md (build/meta, not app surface)
ORPHAN_OK = {"CLAUDE.md", "README.md", "RESTRUCTURE.md", "ANALYTICS.md",
             ".gitignore", "package.json", "package-lock.json"}
FILEISH = re.compile(r"^[\w./-]+\.(" + "|".join(EXTS) + r")$")
DIRISH = re.compile(r"^[\w.-][\w./-]*/$")


def main():
    text = Path(DOC).read_text()
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split()
    bases = {Path(f).name for f in files}
    dirs = {"/".join(f.split("/")[:i + 1]) + "/"                  # every dir prefix
            for f in files for i in range(f.count("/"))}
    # strip ``` fenced blocks first, else their backticks mispair with inline spans
    prose = re.sub(r"```.*?```", "", text, flags=re.S)
    toks = set(re.findall(r"`([^`]+)`", prose))
    globs = [t for t in toks if "*" in t and FILEISH.match(t.replace("*", "x"))]

    broken = []
    for t in sorted(toks):
        if any(c in t for c in " *|<"):                          # command lines, globs, placeholders
            continue
        if t.endswith("/"):                                      # directory ref
            if DIRISH.match(t) and t not in dirs:
                broken.append(t)
        elif FILEISH.match(t) and t not in files and Path(t).name not in bases:
            broken.append(t)

    orphans = [f for f in files if "/" not in f and f not in ORPHAN_OK
               and Path(f).name not in text
               and not any(fnmatch(f, g) for g in globs)]

    for b in broken:
        print(f"  broken ref:   `{b}` — named in {DOC}, no such tracked file")
    for o in orphans:
        print(f"  undocumented: {o} — tracked at root, not mentioned in {DOC}")
    if broken or orphans:
        print(f"\n{DOC} looks out of date ({len(broken)} broken, {len(orphans)} undocumented).")
    return 1 if broken or orphans else 0


if __name__ == "__main__":
    sys.exit(main())
