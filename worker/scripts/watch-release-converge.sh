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

for i in $(seq 1 25); do
  TS=$(date -u +%H:%M:%S)
  TASKS=$(q -c "select count(*) from runtime_task where kind='upgrade' and payload::text like '%${REL_ESCAPED}%' and created_at > now() - interval '30 minutes';" 2>/dev/null || echo "ERR")
  CONV=$(q -c "select count(*) from agent_runtime where deleted_at is null and observed_release = '${RELEASE}';" 2>/dev/null || echo "ERR")
  DRIFT=$(q -c "select count(*) from agent_runtime where deleted_at is null and desired_release <> observed_release;" 2>/dev/null || echo "ERR")
  echo "tick=$i ts=$TS upgrade_tasks_30m=$TASKS converged=$CONV still_drifted=$DRIFT"
  if [[ "$DRIFT" == "0" && "$CONV" -ge 11 ]]; then
    echo "FLEET CONVERGED: all sprites on $RELEASE"
    exit 0
  fi
  sleep 60
done
echo "TIMEOUT: not fully converged after 25 min (converged=$CONV still_drifted=$DRIFT)"
exit 1
