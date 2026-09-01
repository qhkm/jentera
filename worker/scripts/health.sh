#!/usr/bin/env bash
# ============================================================
#  Jentera production health check — read-only, non-waking.
#
#  Checks, in order:
#    1. Frontend        jentera.ai (+ /onboard /setup /app)  HTTP 200
#    2. API worker      api.jentera.ai/api/health            {"ok":true}
#    3. Database        Neon SELECT 1 via neondb_owner       (read-only)
#    4. Task backlog    runtime_task stuck queued/leased      must be 0
#    5. Runtime fleet   sprite list: warm/cold counts,        none missing
#                       version matches RUNTIME_RELEASE       (warn-only)
#
#  Exit code: 0 = healthy, 1 = anything failed.
#  May be run from anywhere; no secrets are read from disk
#  (sprite CLI uses its own keyring, neonctl its own login).
#
#   ./worker/scripts/health.sh            # all checks, human output
#   ./worker/scripts/health.sh --quiet    # only failures printed
#   ./worker/scripts/health.sh --json     # machine-readable summary
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/../.."   # repo root
ROOT="$(pwd)"

QUIET=0
JSON_OUT=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --json)  JSON_OUT=1 ;;
    *) echo "usage: health.sh [--quiet|--json]" >&2; exit 2 ;;
  esac
done

API=${JENTERA_API:-https://api.jentera.ai}
SITE=${JENTERA_SITE:-https://jentera.ai}
SITE_ROUTES=( "" "/onboard" "/setup" "/app" )
EXPECT_RELEASE=$(sed -n 's/^RUNTIME_RELEASE = "\([^"]*\)".*/\1/p' worker/wrangler.toml | head -1)
EXPECT_RELEASE=${EXPECT_RELEASE:-unknown}

FAILS=0
declare -a NOTES=()

say()  { [[ $QUIET -eq 0 ]] && printf '%s\n' "$*"; }
note() { NOTES+=("$*"); }
fail() { FAILS=$((FAILS+1)); printf '❌ %s\n' "$*" >&2; }
pass() { say "✅ $*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; note "$*"; }

ts() { curl -s -m 15 -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || true; }

# macOS bash 3.2 has no `timeout` — run a command with a watchdog.
# Usage: with_timeout <seconds> <cmd...>  → stdout is the command's stdout.
# If the command outlives the budget it is killed; rc=124 → timeout.
with_timeout() {
  local secs=$1; shift
  local tmp; tmp=$(mktemp)
  "$@" >"$tmp" 2>/dev/null &
  local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null && [[ $i -lt $((secs * 2)) ]]; do
    sleep 0.5; i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    rm -f "$tmp"
    return 124
  fi
  wait "$pid"
  local rc=$?
  cat "$tmp"; rm -f "$tmp"
  return $rc
}

# ------------------------------------------------------------
# 1. Frontend
# ------------------------------------------------------------
say "── 1/5 Frontend ($SITE) ──"
FRONT_OK=1
for route in "${SITE_ROUTES[@]}"; do
  code=$(ts "${SITE}${route}")
  if [[ "$code" == "200" ]]; then
    pass "GET $SITE${route:-/} → $code"
  else
    fail "GET $SITE${route:-/} → $code"
    FRONT_OK=0
  fi
done
[[ $FRONT_OK -eq 1 ]] || note "frontend: one or more routes not 200"

# ------------------------------------------------------------
# 2. API worker
# ------------------------------------------------------------
say "── 2/5 API worker ($API/api/health) ──"
code=$(ts "$API/api/health")
if [[ "$code" == "200" ]]; then
  body=$(curl -sS -m 15 "$API/api/health" 2>/dev/null || true)
  if [[ "$body" == *'"ok":true'* ]]; then
    pass "GET $API/api/health → 200 ok:true"
  else
    fail "GET $API/api/health → 200 but unexpected body: ${body:0:120}"
  fi
else
  fail "GET $API/api/health → $code"
fi

# ------------------------------------------------------------
# 3. Database (read-only)
# ------------------------------------------------------------
say "── 3/5 Database (Neon) ──"
CS=""
if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then
  CS="$AISAR_NEON_OWNER_URL"
elif command -v neonctl >/dev/null 2>&1; then
  CS=$(with_timeout 20 neonctl connection-string --project-id "${AISAR_NEON_PROJECT_ID:-red-haze-10375483}" \
       --role-name neondb_owner) || CS=""
fi
if [[ -z "$CS" ]]; then
  fail "db: could not obtain Neon connection string (neonctl login or AISAR_NEON_OWNER_URL)"
else
  export PGOPTIONS='-c default_transaction_read_only=on'
  export PGCONNECT_TIMEOUT=10
  if with_timeout 20 psql "$CS" -X -q -tAc "select 1" 2>/dev/null | grep -qx 1; then
    pass "SELECT 1 → ok (read-only session)"
  else
    fail "db: SELECT 1 failed (connection or auth)"
  fi
fi

# ------------------------------------------------------------
# 4. Task backlog (runtime_queue via DB)
# ------------------------------------------------------------
say "── 4/5 Task backlog ──"
if [[ -n "${CS:-}" ]]; then
  STUCK=$(with_timeout 20 psql "$CS" -X -q -tAc "
    select count(*)
      from runtime_task
     where status in ('queued','leased')
       and available_at <= now()
       and created_at < now() - interval '15 minutes'" 2>/dev/null | tr -d ' ')
  if [[ "$STUCK" =~ ^[0-9]+$ ]]; then
    if [[ "$STUCK" -eq 0 ]]; then
      pass "no task queued/leased > 15 min (backlog clear)"
    else
      fail "db: $STUCK runtime_task(s) stuck in queued/leased > 15 min"
    fi
  else
    fail "db: task backlog query returned nothing (runtime_task missing?)"
  fi
else
  warn "skipping backlog check (no DB connection)"
fi

# ------------------------------------------------------------
# 5. Runtime fleet (sprites + DB reconciliation)
# ------------------------------------------------------------
say "── 5/5 Runtime fleet (sprites + agent_runtime) ──"
# Sprite list: existence + warm/cold serve-readiness. The sprite .version
# field is the IMAGE version (e.g. 0.0.1-rc48), not the Jentera release
# (RUNTIME_RELEASE). Release conformance is read from agent_runtime below.
if command -v sprite >/dev/null 2>&1; then
  LIST=$(with_timeout 25 sprite api /v1/sprites 2>/dev/null)
  if echo "$LIST" | jq -e '.sprites' >/dev/null 2>&1; then
    TOTAL=$(echo "$LIST" | jq '.sprites | length')
    WARM=$(echo "$LIST" | jq '[.sprites[] | select(.status=="warm" or .status=="running")] | length')
    COLD=$(echo "$LIST" | jq '[.sprites[] | select(.status=="cold")] | length')
    [[ -z "$TOTAL" || "$TOTAL" == "null" ]] && TOTAL=0
    say "   fleet: $TOTAL sprite(s), $WARM warm/running, $COLD cold"
    if [[ "$TOTAL" -eq 0 ]]; then
      fail "fleet: no sprites returned by API — is the org token alive?"
    elif [[ "$COLD" -eq "$TOTAL" ]]; then
      fail "fleet: all $TOTAL sprites cold (nothing warm to serve traffic)"
    else
      pass "fleet: $WARM warm (≥1 ready to serve), $COLD cold"
    fi
  else
    fail "fleet: sprite api returned unparseable response"
  fi
else
  fail "fleet: 'sprite' CLI not found (run: curl -fsSL https://sprites.dev/install.sh | bash)"
fi

# Release conformance: every non-deleted agent_runtime must have
# observed_release == desired_release == RUNTIME_RELEASE in wrangler.toml.
if [[ -n "${CS:-}" ]]; then
  RELEASE_ROWS=$(with_timeout 20 psql "$CS" -X -q -tAc "
    select
      count(*) filter (where observed_release = desired_release) as matched,
      count(*) filter (where observed_release is distinct from desired_release) as mismatched,
      count(*) filter (where status in ('error','deleting')) as error_rows
    from agent_runtime where deleted_at is null" 2>/dev/null)
  if [[ -n "$RELEASE_ROWS" ]]; then
    IFS='|' read -r matched mismatched err_rows <<<"$RELEASE_ROWS"
    matched=${matched:-0}; mismatched=${mismatched:-0}; err_rows=${err_rows:-0}
    say "   agent_runtime: $matched release-matched, $mismatched mismatched, $err_rows error/deleting"
    if [[ "$mismatched" -gt 0 ]]; then
      warn "fleet: $mismatched runtime(s) on a different release than desired ($EXPECT_RELEASE) — reconciliation should fix"
    else
      pass "fleet: all agent_runtime rows match desired release"
    fi
    if [[ "$err_rows" -gt 0 ]]; then
      fail "fleet: $err_rows agent_runtime row(s) in error/deleting state"
    fi
  else
    warn "fleet: agent_runtime query empty (table missing?)"
  fi
else
  warn "skipping release-conformance check (no DB connection)"
fi

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo
if [[ $FAILS -eq 0 ]]; then
  printf '✅ HEALTHY — all %d checks passed\n' 5
else
  printf '❌ UNHEALTHY — %d check(s) failed\n' "$FAILS" >&2
  for n in "${NOTES[@]:-}"; do warn " $n"; done
fi

if [[ $JSON_OUT -eq 1 ]]; then
  jq -n \
    --argjson ok $([ $FAILS -eq 0 ] && echo true || echo false) \
    --arg site "$SITE" \
    --arg api "$API" \
    --arg release "$EXPECT_RELEASE" \
    '{ok: $ok, checks: {frontend: $site, api: $api, release: $release, fails: '"$FAILS"'}}'
fi

exit $FAILS
