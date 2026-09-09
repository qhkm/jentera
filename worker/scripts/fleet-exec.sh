#!/usr/bin/env bash
# fleet-exec.sh — run one bash snippet on every production sprite, the same
# way every time, and report one line per sprite.
#
# This is the only sanctioned way to touch the fleet by hand. Anything that
# has to be true on every sprite belongs in the bundle (bootstrap-runtime.sh,
# configure-model-provider.py, patch-hermes-dependencies.mjs) and ships via
# ship-runtime.sh; a sweep here is for reading state, or for a one-off
# cleanup the next release makes permanent.
#
# The sprite list comes from agent_runtime — the control plane's view of live
# tenants — so the POC sprite and anything half-provisioned are excluded.
# --from-sprites lists the Sprites org instead. Iteration is bash `while
# read` on purpose: zsh does not word-split $var, and a loop written that way
# ran once with all twelve names glued together (2026-09-08). stdin is closed
# for every exec so a here-string cannot be eaten by the first sprite.
#
# Usage:
#   fleet-exec.sh [-p N] [--only a,b] [--from-sprites] 'snippet'
#   fleet-exec.sh [-p N] [--only a,b] [--from-sprites] --script file
#   fleet-exec.sh 'awk -F= "/RELEASE/{print \$2}" /home/sprite/aisar/runtime.env'
#
# Output: <sprite>  exit=<n>  <last line the snippet printed>
#         full per-sprite logs under $FLEET_EXEC_LOG_DIR (default /tmp/fleet-exec-<utc ts>)
# Exit:   0 when every sprite exited 0; 1 when any did not; 2 on usage.
# Env:    AISAR_NEON_OWNER_URL or a logged-in neonctl (for the sprite list),
#         SPRITE_BIN (default sprite), SPRITE_ORG (default aisar).
set -uo pipefail

ORG="${SPRITE_ORG:-aisar}"
SPRITE_BIN="${SPRITE_BIN:-sprite}"
PROJECT_ID="${AISAR_NEON_PROJECT_ID:-red-haze-10375483}"
PARALLEL=4
ONLY=""
FROM_SPRITES=0
SCRIPT=""
SNIPPET=""

usage() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--parallel) PARALLEL="${2:?}"; shift 2 ;;
    --only) ONLY="${2:?}"; shift 2 ;;
    --from-sprites) FROM_SPRITES=1; shift ;;
    --script) SCRIPT="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; SNIPPET="$*"; break ;;
    -*) echo "fleet-exec: unknown flag $1" >&2; usage >&2; exit 2 ;;
    *) SNIPPET="$1"; shift ;;
  esac
done
if [[ -n "$SCRIPT" ]]; then
  SNIPPET="$(cat "$SCRIPT")" || exit 2
fi
if [[ -z "$SNIPPET" ]]; then
  echo "fleet-exec: a snippet or --script is required" >&2
  usage >&2
  exit 2
fi

list_sprites() {
  if [[ -n "$ONLY" ]]; then
    tr ',' '\n' <<<"$ONLY"
    return
  fi
  if [[ "$FROM_SPRITES" == 1 ]]; then
    "$SPRITE_BIN" list -o "$ORG" | grep '^aisar-b-' | sort
    return
  fi
  local cs
  if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then
    cs="$AISAR_NEON_OWNER_URL"
  else
    cs="$(neonctl connection-string --project-id "$PROJECT_ID" --role-name neondb_owner)" || return 1
  fi
  psql "$cs" -X -q -t -A -c \
    "select provider_name from agent_runtime
      where deleted_at is null and provider = 'fly-sprite'
      order by provider_name"
}

LOG_DIR="${FLEET_EXEC_LOG_DIR:-/tmp/fleet-exec-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$LOG_DIR"
printf '%s\n' "$SNIPPET" > "$LOG_DIR/snippet.sh"

run_one() {
  local s="$1" log="$LOG_DIR/$1.log" rc
  # WebSocket transport (the default): --http-post answers "no exit frame
  # received" and loses the exit code, which is the one thing a sweep needs.
  "$SPRITE_BIN" exec -o "$ORG" -s "$s" -- bash -c "$SNIPPET" \
    < /dev/null > "$log" 2>&1
  rc=$?
  printf '%s\texit=%s\t%s\n' "$s" "$rc" "$(tail -n 1 "$log" | tr -d '\r')"
}
export -f run_one
export SPRITE_BIN ORG SNIPPET LOG_DIR

SPRITES="$(list_sprites | grep . | grep -v '^(')" || { echo "fleet-exec: could not list sprites" >&2; exit 1; }
TOTAL="$(printf '%s\n' "$SPRITES" | grep -c .)"
if [[ "$TOTAL" == 0 ]]; then
  echo "fleet-exec: no sprites to run on" >&2
  exit 1
fi

printf '%s\n' "$SPRITES" \
  | xargs -P "$PARALLEL" -I{} bash -c 'run_one "$1"' _ {} \
  | sort > "$LOG_DIR/summary.tsv"

column -t -s $'\t' "$LOG_DIR/summary.tsv" 2>/dev/null || cat "$LOG_DIR/summary.tsv"
FAILED="$(grep -vc $'\texit=0\t' "$LOG_DIR/summary.tsv")"
echo "fleet-exec: $((TOTAL - FAILED))/$TOTAL ok, logs in $LOG_DIR"
[[ "$FAILED" == 0 ]]
