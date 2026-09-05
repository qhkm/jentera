#!/usr/bin/env bash
# Probe one aisar prod sprite's runner /readyz; print "<name>|<release>|held=<b>".
SP=${1:?sprite name}
OUT=$(timeout 90 ~/.local/bin/sprite exec -o aisar -s "$SP" -- sh -c 'K=$(grep "^AISAR_RUNNER_KEY=" /home/sprite/aisar/runtime.env 2>/dev/null | cut -d= -f2-); curl -s -m 10 -H "X-Aisar-Runner-Key: $K" http://127.0.0.1:8080/readyz' 2>/dev/null)
RC=$?
if [ -z "$OUT" ]; then
  echo "$SP|UNREACHABLE|rc=$RC"
else
  echo "$OUT" | python3 -c "
import json,sys
sp='$SP'
try:
  d=json.load(sys.stdin)
  print(sp+'|'+d.get('release','?')+'|held='+str((d.get('keepalive') or {}).get('held','?')))
except Exception:
  print(sp+'|?|parse-fail')
"
fi
