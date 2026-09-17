#!/usr/bin/env bash
set -euo pipefail
export AISAR_DISPLAY_ENV_FILE=/tmp/jentera-desktop-fixture/display.env
export AISAR_DESKTOP_VIEW=1
bash runner/bin/display-service.sh &
for attempt in $(seq 1 50); do
  [[ -r "$AISAR_DISPLAY_ENV_FILE" ]] && DISPLAY=:99 xdpyinfo >/dev/null 2>&1 && break
  sleep .1
done
set -a
source "$AISAR_DISPLAY_ENV_FILE"
set +a
node runner/bin/desktop-smoke.mjs
exec node runner/qa/desktop-linux/fixture.mjs
