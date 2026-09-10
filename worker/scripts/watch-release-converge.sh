#!/usr/bin/env bash
# Watch the drift sweep converge the fleet onto the current RUNTIME_RELEASE.
# Polls every 60s for up to 25 min: upgrade tasks for the release + runtime observed releases.
#
# Usage: ./worker/scripts/watch-release-converge.sh [release]
# Auth: uses neonctl (like stats.sh) or AISAR_NEON_OWNER_URL.
set -uo pipefail

RELEASE="${1:-2026.09.05-1}"
PROJECT_ID="${AISAR_NEON_PROJECT_ID:-red-haze-10375483}"

conn() {
  if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then
    printf '%s' "$AISAR_NEON_OWNER_URL"
    return
  fi
  neonctl connection-string --project-id "$PROJECT_ID" --role-name neondb_owner
}

CS="$(conn)"
q() { psql "$CS" -X -q -t -A -F'|' "$@"; }

# release-quoted for the LIKE payload check
REL_ESCAPED="${RELEASE//./\\.}"

# The sweep runs seconds after `wrangler deploy`, so a consumer isolate still
# on the previous version can hand one sprite the old release. Asking again is
# the fix; waiting for the */15 cron outlasts this watch, which is how a ship
# ends up reporting less than it achieved.
resweep() {
  local key="${AISAR_SUPPORT_KEY:-}"
  [[ -z "$key" && -s "$HOME/.config/jentera/support-key" ]] && key="$(cat "$HOME/.config/jentera/support-key")"
  local origin
  origin="$(sed -n 's/^API_ORIGIN = "\(.*\)"$/\1/p' "$(dirname "$0")/../wrangler.toml" | head -1)"
  if [[ -z "$key" || -z "$origin" ]]; then
    echo "  (no support key or API_ORIGIN; the */15 cron will sweep)"
    return
  fi
  echo "  progress stalled — sweeping again"
  curl -sS -m 60 -X POST "$origin/api/support/drift-sweep" -H "Authorization: Bearer $key" \
    | sed 's/^/  /' || echo "  (sweep request failed; the cron still will)"
  echo
}

LAST_CONV=""
STALL=0
RESWEEPS=0
for i in $(seq 1 25); do
  TS=$(date -u +%H:%M:%S)
  TASKS=$(q -c "select count(*) from runtime_task where kind='upgrade' and payload::text like '%${REL_ESCAPED}%' and created_at > now() - interval '30 minutes';" 2>/dev/null || echo "ERR")
  CONV=$(q -c "select count(*) from agent_runtime where deleted_at is null and observed_release = '${RELEASE}';" 2>/dev/null || echo "ERR")
  # Against the target, not against itself: a sprite handed the previous
  # release by a stale consumer isolate has desired and observed BOTH stale,
  # so desired <> observed sees nothing wrong. runtime_drift_targets() has
  # always compared against the current release; the two disagreeing is what
  # let one sprite sit a release behind on 2026-09-10 with drift reading 0.
  DRIFT=$(q -c "select count(*) from agent_runtime where deleted_at is null and (desired_release is distinct from '${RELEASE}' or observed_release is distinct from '${RELEASE}');" 2>/dev/null || echo "ERR")
  # Converged means every live runtime, not a number that was true once.
  TOTAL=$(q -c "select count(*) from agent_runtime where deleted_at is null;" 2>/dev/null || echo "ERR")
  echo "tick=$i ts=$TS upgrade_tasks_30m=$TASKS converged=$CONV/$TOTAL still_drifted=$DRIFT"
  if [[ "$DRIFT" == "0" && "$TOTAL" != "ERR" && "$TOTAL" -gt 0 && "$CONV" -ge "$TOTAL" ]]; then
    echo "FLEET CONVERGED: all sprites on $RELEASE"
    exit 0
  fi
  # Three quiet minutes means whatever was going to land has landed, and
  # anything left needs asking again rather than more patience. Bounded:
  # a sweep that keeps not helping is a fleet problem to read about.
  if [[ "$CONV" == "$LAST_CONV" ]]; then
    STALL=$((STALL + 1))
  else
    STALL=0
    LAST_CONV="$CONV"
  fi
  if [[ "$STALL" -ge 3 && "$RESWEEPS" -lt 3 && "$CONV" != "ERR" ]]; then
    resweep
    RESWEEPS=$((RESWEEPS + 1))
    STALL=0
  fi
  sleep 60
done
echo "TIMEOUT: not fully converged after 25 min (converged=$CONV still_drifted=$DRIFT)"
exit 1
