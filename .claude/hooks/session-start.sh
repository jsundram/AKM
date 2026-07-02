#!/bin/bash
# Installs the test tooling (playwright-core) so `npm run test:ui` works in a fresh web session.
# The Chromium binary itself is pre-baked into the Claude Code on the web image (/opt/pw-browsers),
# so this only needs to pull the npm package. Idempotent; safe to re-run.
set -euo pipefail

# Only the web env ships the pre-installed browser; skip locally so a laptop clone is untouched.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund --loglevel=error

# Surface the browser path for the test harness (it also auto-detects, this is just belt-and-braces).
shell="$(find "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}" -maxdepth 3 -type f -name headless_shell 2>/dev/null | sort | tail -1)"
if [ -n "${shell:-}" ]; then
  echo "export PW_CHROMIUM=\"$shell\"" >> "$CLAUDE_ENV_FILE"
fi
