#!/usr/bin/env bash
# Fleet convergence watch — DB-free, polls each sprite runner's /readyz release.
# Usage: fleet-converge-watch.sh <release> [interval_sec] [max_ticks]
# Exits 0 when ALL aisar prod sprites report <release>; 1 on timeout.
set -uo pipefail
REL="${1:?usage: fleet-converge-watch.sh <release> [interval_sec] [max_ticks]}"
INTERVAL="${2:-240}"
MAX_TICKS="${3:-12}"
SPRITE_BIN="$HOME/.local/bin/sprite"

for i in $(seq 1 "$MAX_TICKS"); do
  sprites=$(timeout 60 "$SPRITE_BIN" list -o aisar 2>/dev/null | grep '^aisar-b-' | sort)
  total=$(printf '%s\n' "$sprites" | grep -c .)
  results=""
  on_target=0
  while IFS= read -r line; do
    results="$results
$line"
    rel=$(echo "$line" | cut -d'|' -f2)
    [ "$rel" = "$REL" ] && on_target=$((on_target+1))
  done < <(printf '%s\n' "$sprites" | xargs -P 4 -n 1 "$(dirname "$0")/fleet-readyz-probe.sh" 2>/dev/null)
  echo "[$(date -u +%H:%M:%S)] tick=$i on_target=$on_target/$total target=$REL"
  echo "$results" | grep -v '^$' | sed 's/^/  /'
  if [ "$total" -gt 0 ] && [ "$on_target" -eq "$total" ]; then
    echo "ALL_CONVERGED — every prod sprite reports $REL"
    exit 0
  fi
  [ "$i" -lt "$MAX_TICKS" ] && sleep "$INTERVAL"
done
echo "TIMEOUT after ~$((INTERVAL * MAX_TICKS / 60))m — on_target=$on_target/$total"
exit 1
