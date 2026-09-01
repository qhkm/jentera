#!/usr/bin/env bash
# ============================================================
#  Jentera health alert wrapper — silent when healthy, pings
#  Telegram ONLY on failure. Meant for cron (every 15 min).
#
#  Requires: ~/.hermes/.env  (TELEGRAM_BOT_TOKEN, TELEGRAM_HOME_CHANNEL)
#            worker/scripts/health.sh
#
#  Logs every run to $LOG below. Exit: 0 healthy / 5+ unhealthy.
# ============================================================
set -uo pipefail

# cron/launchd run with a stripped environment — fix PATH/HOME first
export PATH="/Users/dr.noranizaahmad/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export HOME="${HOME:-/Users/$(stat -f %Su /dev/console)}"

REPO="${HOME}/ios/aisar-site"
HEALTH="${REPO}/worker/scripts/health.sh"
ENV_FILE="${HOME}/.hermes/.env"
LOG="${HOME}/.hermes/logs/jentera-health.log"
STAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

mkdir -p "$(dirname "$LOG")"

[ -x "$HEALTH" ] || { echo "$STAMP ERROR health.sh missing: $HEALTH" >> "$LOG"; exit 9; }
[ -f "$ENV_FILE" ] || { echo "$STAMP ERROR .env missing: $ENV_FILE" >> "$LOG"; exit 9; }

# Run the check (--quiet: only failures print). Never echo $BOT_TOKEN.
OUTPUT=$( "$HEALTH" --quiet 2>&1 )
RC=$?

if [[ $RC -eq 0 ]]; then
  echo "$STAMP OK" >> "$LOG"
  exit 0                                  # healthy → stay silent
fi

# Unhealthy: notify Telegram, then log + exit with the check's code.
TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)
CHAT=$(grep -E '^TELEGRAM_HOME_CHANNEL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "$CHAT" ] && [ -n "$TOKEN" ] || { echo "$STAMP ERROR env vars missing" >> "$LOG"; exit 9; }

MSG="⚠️ *Jentera UNHEALTHY* ($(hostname -s))
$STAMP — exit $RC

$(echo "$OUTPUT" | head -30)"

SENT=$(curl -sS -m 20 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="$CHAT" \
  -d text="$MSG" \
  -d parse_mode=Markdown -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)
echo "$STAMP UNHEALTHY rc=$RC telegram_http=$SENT" >> "$LOG"
echo "$OUTPUT" >> "$LOG"

[[ "$SENT" == "200" ]] && exit $RC || exit 9
