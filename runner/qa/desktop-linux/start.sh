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

# A running tint2 process is not enough: Openbox can remap a dock to its
# packaged TopLeft default and let the maximized browser hide the launcher.
# Prove the actual X11 geometry and that the visible launcher opens xterm.
panel="$(DISPLAY=:99 xdotool search --class Tint2 | head -1)"
panel_y="$(DISPLAY=:99 xwininfo -id "$panel" | awk -F: '/Absolute upper-left Y/{gsub(/ /, "", $2); print $2}')"
[[ "$panel_y" -ge 750 ]] || { echo "desktop panel is not on the bottom edge: y=$panel_y" >&2; exit 1; }
DISPLAY=:99 xdotool mousemove 20 778 click 1
for attempt in $(seq 1 30); do
  pgrep -x xterm >/dev/null && break
  sleep .1
done
pgrep -x xterm >/dev/null || { echo "terminal launcher did not open xterm" >&2; exit 1; }
pkill -x xterm

exec node runner/qa/desktop-linux/fixture.mjs
