#!/usr/bin/env bash
# ============================================================
#  Jentera weekly pulse — a short "is this useful?" report
#  delivered to Telegram once a week (Monday 09:00 via launchd).
#
#  Covers, for the trailing 7 days (vs the previous 7 where useful):
#    👥  users / verified / new signups
#    🏢  businesses / setup-done / active (ran something)
#    ⚡  runs this week vs previous, completed/failed/cancelled
#    🛠  work_record: work items, minutes saved (7d + all-time)
#    💰  spend (runtime_usage, microusd → USD, 7d + total)
#    🏆  top businesses by runs this week
#
#  Always sends the report (unlike health-alert.sh which is silent
#  when healthy). Use --dry-run to print instead of sending.
#
#  Requires: ~/.hermes/.env  (TELEGRAM_BOT_TOKEN, TELEGRAM_HOME_CHANNEL)
#  Logs every run to $LOG.
#  Exit: 0 sent / printed, 1 send failed, 9 infra missing.
# ============================================================
set -uo pipefail

# launchd runs with a stripped environment — fix PATH/HOME first
export PATH="/Users/dr.noranizaahmad/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export HOME="${HOME:-/Users/$(stat -f %Su /dev/console)}"

REPO="${HOME}/ios/aisar-site"
ENV_FILE="${HOME}/.hermes/.env"
LOG="${HOME}/.hermes/logs/jentera-pulse.log"
STAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; fi

mkdir -p "$(dirname "$LOG")"
[ -f "$ENV_FILE" ] || { echo "$STAMP ERROR .env missing: $ENV_FILE" >> "$LOG"; exit 9; }

# macOS bash 3.2 has no `timeout` — run a command with a watchdog.
# Usage: with_timeout <seconds> <cmd...>  → stdout is the command's stdout.
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
# DB connection (read-only, owner role like stats.sh)
# ------------------------------------------------------------
CS=""
if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then
  CS="$AISAR_NEON_OWNER_URL"
elif command -v neonctl >/dev/null 2>&1; then
  CS=$(with_timeout 20 neonctl connection-string --project-id "${AISAR_NEON_PROJECT_ID:-red-haze-10375483}" \
       --role-name neondb_owner) || CS=""
fi
if [[ -z "$CS" ]]; then
  echo "$STAMP ERROR no Neon connection string" >> "$LOG"
  exit 9
fi

export PGOPTIONS='-c default_transaction_read_only=on'
export PGCONNECT_TIMEOUT=10
q() { with_timeout 25 psql "$CS" -X -q -tAc "$1" 2>/dev/null; }

# ------------------------------------------------------------
# 1. Users / businesses / connections
# ------------------------------------------------------------
ROW=$(q "select
  (select count(*) from app_user)                              as users,
  (select count(*) from app_user where email_verified)         as verified,
  (select count(*) from app_user where created_at > now() - interval '7 days') as new_7d,
  (select count(*) from business)                              as businesses,
  (select count(*) from business where setup_done)             as setup_done,
  (select count(*) from business b where exists
     (select 1 from run r where r.business_id = b.id
       and r.created_at > now() - interval '7 days'))          as active_7d,
  (select count(*) from connection where status = 'connected') as connections")
IFS='|' read -r USERS VERIFIED NEW7D BIZ SETUP_DONE ACTIVE7D CONNS <<<"$ROW"
USERS=${USERS:-0}; VERIFIED=${VERIFIED:-0}; NEW7D=${NEW7D:-0}
BIZ=${BIZ:-0}; SETUP_DONE=${SETUP_DONE:-0}; ACTIVE7D=${ACTIVE7D:-0}; CONNS=${CONNS:-0}

# ------------------------------------------------------------
# 2. Runs: this week vs previous, by status
# ------------------------------------------------------------
RUNS=$(q "select
  count(*) filter (where created_at > now() - interval '7 days')                           as runs_7d,
  count(*) filter (where created_at between now() - interval '14 days' and now() - interval '7 days') as runs_prev,
  count(*) filter (where created_at > now() - interval '7 days' and status = 'completed')  as done_7d,
  count(*) filter (where created_at > now() - interval '7 days' and status = 'failed')     as fail_7d,
  count(*) filter (where created_at > now() - interval '7 days' and status = 'cancelled')  as canc_7d
from run")
IFS='|' read -r RUNS7D RUNS_PREV DONE7D FAIL7D CANC7D <<<"$RUNS"
RUNS7D=${RUNS7D:-0}; RUNS_PREV=${RUNS_PREV:-0}; DONE7D=${DONE7D:-0}; FAIL7D=${FAIL7D:-0}; CANC7D=${CANC7D:-0}

# ------------------------------------------------------------
# 3. work_record: work items + minutes saved
# ------------------------------------------------------------
WORK=$(q "select
  count(*) filter (where occurred_at > now() - interval '7 days')                          as work_7d,
  count(*) filter (where occurred_at > now() - interval '7 days' and status = 'completed') as wdone_7d,
  coalesce(sum(minutes_saved) filter (where occurred_at > now() - interval '7 days'), 0)   as mins_7d,
  count(*)                                                                                 as work_total,
  coalesce(sum(minutes_saved), 0)                                                          as mins_total
from work_record")
IFS='|' read -r WORK7D WDONE7D MINS7D WORK_TOTAL MINS_TOTAL <<<"$WORK"
WORK7D=${WORK7D:-0}; WDONE7D=${WDONE7D:-0}; MINS7D=${MINS7D:-0}; WORK_TOTAL=${WORK_TOTAL:-0}; MINS_TOTAL=${MINS_TOTAL:-0}

# ------------------------------------------------------------
# 4. Cost (runtime_usage, microusd)
# ------------------------------------------------------------
COST=$(q "select
  round(coalesce(sum(cost_microusd) filter (where completed_at > now() - interval '7 days'), 0) / 1e6, 3) as usd_7d,
  round(coalesce(sum(cost_microusd), 0) / 1e6, 3)                                                        as usd_total
from runtime_usage")
IFS='|' read -r USD7D USD_TOTAL <<<"$COST"
USD7D=${USD7D:-0}; USD_TOTAL=${USD_TOTAL:-0}

# ------------------------------------------------------------
# 5. Top businesses by runs this week
# ------------------------------------------------------------
TOP=$(q "select b.name, count(*)
  from run r join business b on b.id = r.business_id
  where r.created_at > now() - interval '7 days'
  group by b.name order by 2 desc limit 3")

# ------------------------------------------------------------
# Assemble + deliver
# ------------------------------------------------------------
DELTA=""
if [[ "$RUNS_PREV" -gt 0 ]]; then
  P=$(( RUNS7D * 100 / RUNS_PREV ))
  if [[ "$P" -ge 110 ]]; then DELTA=" (+${P}% vs prev wk)"
  elif [[ "$P" -le 90 ]]; then DELTA=" (${P}% of prev wk)"
  else DELTA=" (~flat vs prev wk)"
  fi
fi

ACTIVE_LINE="🏢 *Businesses:* ${BIZ} · setup ${SETUP_DONE} · active ${ACTIVE7D} this wk · 🔌 ${CONNS} conn"
FAIL_LINE=""
if [[ "$FAIL7D" -gt 0 ]]; then FAIL_LINE=" · ❌ failed ${FAIL7D}"; fi
TOP_LINE="🏆 *Most active:* none this wk"
if [[ -n "$TOP" ]]; then
  TOP_LINE="🏆 *Most active:*"
  while IFS='|' read -r TN TC; do
    [[ -z "${TN:-}" ]] && continue
    TOP_LINE="${TOP_LINE}"$'\n'"   • ${TN} (${TC} runs)"
  done <<<"$TOP"
fi

OWN=$(date '+%b %d')
MSG="📊 *Jentera Pulse* — ${OWN} (trailing 7d)

👥 *Users:* ${USERS} total (${VERIFIED} verified · +${NEW7D} new this wk)
${ACTIVE_LINE}

⚡ *Runs this wk:* ${RUNS7D}${DELTA} · ✅ completed ${DONE7D}${FAIL_LINE} · ⏸ cancelled ${CANC7D}
🛠 *Work done:* ${WDONE7D}/${WORK7D} items · ⏱ *saved ~${MINS7D} min this wk* (${MINS_TOTAL} min all-time)
💰 *Spend:* \$${USD7D} this wk · \$${USD_TOTAL} all-time

${TOP_LINE}"

if [[ $DRY -eq 1 ]]; then
  printf '%s\n' "$MSG"
  echo "$STAMP DRY-RUN" >> "$LOG"
  exit 0
fi

TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)
CHAT=$(grep -E '^TELEGRAM_HOME_CHANNEL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "$CHAT" ] && [ -n "$TOKEN" ] || { echo "$STAMP ERROR env vars missing" >> "$LOG"; exit 9; }

SENT=$(curl -sS -m 20 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="$CHAT" \
  -d text="$MSG" \
  -d parse_mode=Markdown -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)

if [[ "$SENT" == "200" ]]; then
  echo "$STAMP SENT ok" >> "$LOG"
  exit 0
else
  echo "$STAMP SEND FAILED telegram_http=$SENT" >> "$LOG"
  printf '%s\n' "$MSG" >> "$LOG"
  exit 1
fi
