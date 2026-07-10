#!/usr/bin/env bash
# AKM cloud network-allowlist smoke test.
# Verifies the Google Sheets pulls (and the app's other outbound hosts) are
# reachable from a cloud session. Run this in a FRESH session after editing the
# domain allowlist -- the network policy is applied at container creation, so an
# already-running container won't reflect an allowlist edit.
#
# Usage:  bash <(curl -sSL "<this-gist-raw-url>")
#   or:   curl -sSL "<raw-url>" -o netcheck.sh && bash netcheck.sh
#
# Exit 0 = every REQUIRED host reachable. Exit 1 = at least one required host blocked.

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
probe() {
  local url="$1" want="$2" label="$3" req="$4"
  printf '\n\033[36m--- %s ---\033[0m\n%s\n' "$label" "$url"
  # -v to stderr so we can see which hop (docs.google vs googleusercontent) fails
  local body code
  body="$(curl -sSL -v --max-time 25 "$url" 2>/tmp/nc_verbose)" ; code=$?
  # show the redirect chain + any proxy errors, trimmed
  grep -Ei '^\* (Connected|Trying|SSL|Proxy|Recv|Closing)|^< HTTP/|^< location:|^< access-control-allow-origin' /tmp/nc_verbose \
    | sed 's/^/    /' | head -40
  if [ "$code" -ne 0 ]; then
    if [ "$req" -eq 1 ]; then no "$label — curl exit $code (blocked / timed out)"; else warn "$label — curl exit $code (optional)"; fi
    return
  fi
  if printf '%s' "$body" | grep -qF "$want"; then
    ok "$label — got expected payload ('$want')"
    printf '    first bytes: %s\n' "$(printf '%s' "$body" | head -c 90 | tr -d '\n')"
  else
    printf '    first bytes: %s\n' "$(printf '%s' "$body" | head -c 200 | tr -d '\n')"
    if [ "$req" -eq 1 ]; then no "$label — reached host but payload unexpected (auth/redirect blocked?)"; else warn "$label — unexpected payload (optional)"; fi
  fi
}

echo "AKM network-allowlist smoke test"
echo "curl: $(curl --version 2>/dev/null | head -1)"
[ -n "${HTTPS_PROXY:-}" ] && echo "HTTPS_PROXY is set (traffic goes through the agent proxy)"

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
# Once the domains are reachable, the repo's live smoke tests ASSERT instead of
# skipping. They live in the AKM checkout; run from repo root if available.
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
  echo   "  Check the redirect chain above: a stall after 'HTTP/2 307' + 'location: https://<x>.googleusercontent.com'"
  echo   "  means *.googleusercontent.com is still blocked; a failure on the first hop means docs.google.com is."
  exit 1
fi
