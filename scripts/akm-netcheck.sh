#!/usr/bin/env bash
# AKM cloud network-allowlist smoke test.
# Verifies the Google Sheets pulls (and the app's other outbound hosts) are
# reachable from a cloud session. Run this in a FRESH session after editing the
# domain allowlist -- the network policy is applied at container creation, so an
# already-running container won't reflect an allowlist edit.
#
# Usage:  bash scripts/akm-netcheck.sh
#
# Exit 0 = every REQUIRED host reachable. Exit 1 = at least one required host blocked.
#
# IMPORTANT — which egress path we test. A cloud session has TWO outbound paths:
#   1. Claude Code's agent proxy (HTTPS_PROXY, 127.0.0.1) — broadly permissive,
#      NOT governed by your environment's domain allowlist.
#   2. Direct egress — the environment firewall that DOES enforce your allowlist,
#      and the path Node's fetch + the actual app/tests use.
# We must test path 2, or a blocked host looks reachable. So every probe here
# uses `curl --noproxy '*'` to bypass the agent proxy and hit the real firewall
# (a blocked host returns "Host not in allowlist: <host>...").

set -u

# --- real AKM sheet IDs (public, view-only) ---
SCHED_SID="1AvNjAUQMFPjJAlwY4Day2MgHt5-2Vd8EDocpdxJQ6_A"
ROSTER_SID="1j__RMUvFWQlX9UuT-Uxkw7BkqWHCQkbR_hKsTyNwiyo"
ROSTER_GID="800090339"
REP_GID="244347893"

fail=0
c()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }        # section
ok() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
no() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }
warn(){ printf '  \033[33mWARN\033[0m %s\n' "$1"; }

# probe URL, expected-substring, label, required(1)/optional(0)
# NOTE: --noproxy '*' bypasses the agent proxy so we test the REAL egress allowlist.
probe() {
  local url="$1" want="$2" label="$3" req="$4"
  printf '\n\033[36m--- %s ---\033[0m\n%s\n' "$label" "$url"
  local body code
  body="$(curl -sSL --noproxy '*' -v --max-time 25 "$url" 2>/tmp/nc_verbose)" ; code=$?
  grep -Ei '^\* (Connected|Trying|SSL|Proxy|Recv|Closing)|^< HTTP/|^< location:|^< access-control-allow-origin' /tmp/nc_verbose \
    | sed 's/^/    /' | head -40
  # firewall denials come back as a plaintext body, not a transport error
  if printf '%s' "$body" | grep -qi 'not in allowlist'; then
    printf '    firewall: %s\n' "$(printf '%s' "$body" | head -c 160 | tr -d '\n')"
    if [ "$req" -eq 1 ]; then no "$label — BLOCKED by egress allowlist"; else warn "$label — blocked (optional)"; fi
    return
  fi
  if [ "$code" -ne 0 ]; then
    if [ "$req" -eq 1 ]; then no "$label — curl exit $code (blocked / timed out / reset)"; else warn "$label — curl exit $code (optional)"; fi
    return
  fi
  if [ -z "$want" ] || printf '%s' "$body" | grep -qF "$want"; then
    ok "$label — reachable${want:+ (got '$want')}"
    printf '    first bytes: %s\n' "$(printf '%s' "$body" | head -c 90 | tr -d '\n')"
  else
    printf '    first bytes: %s\n' "$(printf '%s' "$body" | head -c 200 | tr -d '\n')"
    if [ "$req" -eq 1 ]; then no "$label — reached host but payload unexpected"; else warn "$label — unexpected payload (optional)"; fi
  fi
}

echo "AKM network-allowlist smoke test"
echo "curl: $(curl --version 2>/dev/null | head -1)"
echo "(probes bypass the agent proxy via --noproxy '*' to test the real egress allowlist)"

# ============ REQUIRED: Google Sheets pulls ============
# These exercise BOTH docs.google.com (first hop) AND *.googleusercontent.com
# (the 307 redirect target that serves the actual gviz/CSV payload).
c "REQUIRED — Google Sheets (docs.google.com -> *.googleusercontent.com)"

probe \
  "https://docs.google.com/spreadsheets/d/${SCHED_SID}/gviz/tq?sheet=Mon%206/29&tqx=out:json" \
  "google.visualization.Query" "Schedule sheet (gviz JSONP)" 1

probe \
  "https://docs.google.com/spreadsheets/d/${ROSTER_SID}/gviz/tq?gid=${ROSTER_GID}&tqx=out:json" \
  "google.visualization.Query" "Roster sheet (gviz JSONP)" 1

probe \
  "https://docs.google.com/spreadsheets/d/${ROSTER_SID}/gviz/tq?gid=${REP_GID}&tqx=out:json" \
  "google.visualization.Query" "Repertoire sheet (gviz JSONP)" 1

# ============ OPTIONAL: the app's other outbound hosts ============
c "OPTIONAL — weather / fonts / analytics"

probe \
  "https://api.open-meteo.com/v1/forecast?latitude=46.69&longitude=12.81&hourly=temperature_2m" \
  "temperature_2m" "Open-Meteo weather" 0

probe \
  "https://fonts.gstatic.com/" \
  "" "Google Fonts static (fonts.gstatic.com)" 0

probe \
  "https://script.google.com/" \
  "" "Apps Script analytics endpoint (script.google.com)" 0

# ============ App-level confirmation (if repo present) ============
# The definitive check: these use Node fetch == the real egress path. If the
# curl probes above pass but these fail, something other than the allowlist is off.
c "App-level — live smoke tests (only if run from an AKM checkout)"
if [ -f scripts/schedule-test.js ] && command -v node >/dev/null 2>&1; then
  echo "  running node scripts/schedule-test.js ..."; node scripts/schedule-test.js && ok "schedule-test.js" || no "schedule-test.js"
  echo "  running node scripts/network-test.js ..." ; node scripts/network-test.js  && ok "network-test.js"  || no "network-test.js"
else
  warn "scripts/schedule-test.js not found (run from the AKM repo root to include these) — or node missing"
fi

# ============ verdict ============
c "VERDICT"
if [ "$fail" -eq 0 ]; then
  printf '  \033[32mALL REQUIRED HOSTS REACHABLE\033[0m — the Google Sheets allowlist fix is working.\n'
  exit 0
else
  printf '  \033[31mONE OR MORE REQUIRED HOSTS BLOCKED.\033[0m\n'
  echo   "  A 'Host not in allowlist: docs.google.com' above = add docs.google.com to the allowlist."
  echo   "  A stall after 'HTTP 307' + 'location: ...googleusercontent.com' = add *.googleusercontent.com."
  echo   "  Remember: edit the allowlist, then start a FRESH session (policy is set at container creation)."
  exit 1
fi
