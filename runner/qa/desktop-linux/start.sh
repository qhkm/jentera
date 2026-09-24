#!/usr/bin/env bash
set -euo pipefail
export AISAR_DISPLAY_ENV_FILE=/tmp/jentera-desktop-fixture/display.env
export AISAR_DESKTOP_VIEW=1
install -m 755 runner/bin/jentera-terminal.sh /home/sprite/aisar/runner/jentera-terminal.sh
bash runner/bin/display-service.sh &
for attempt in $(seq 1 50); do
  [[ -r "$AISAR_DISPLAY_ENV_FILE" ]] && DISPLAY=:99 xdpyinfo >/dev/null 2>&1 && break
  sleep .1
done
set -a
source "$AISAR_DISPLAY_ENV_FILE"
set +a
node runner/bin/desktop-smoke.mjs

# A running tint2 process is not enough. Prove the actual X11 geometry, the
# full-width work area left for maximized apps, and that the launcher opens.
panel="$(DISPLAY=:99 xdotool search --class Tint2 | head -1)"
panel_x="$(DISPLAY=:99 xwininfo -id "$panel" | awk -F: '/Absolute upper-left X/{gsub(/ /, "", $2); print $2}')"
panel_y="$(DISPLAY=:99 xwininfo -id "$panel" | awk -F: '/Absolute upper-left Y/{gsub(/ /, "", $2); print $2}')"
panel_width="$(DISPLAY=:99 xwininfo -id "$panel" | awk -F: '/Width:/{gsub(/ /, "", $2); print $2}')"
panel_height="$(DISPLAY=:99 xwininfo -id "$panel" | awk -F: '/Height:/{gsub(/ /, "", $2); print $2}')"
[[ "$panel_x,$panel_y,$panel_width,$panel_height" == "0,758,1280,42" ]] || {
  echo "desktop panel has wrong geometry: x=$panel_x y=$panel_y width=$panel_width height=$panel_height" >&2
  exit 1
}
DISPLAY=:99 xprop -root _NET_WORKAREA | grep -Eq '= 0, 0, 1280, 758(,|$)' || {
  echo "desktop work area is not full width" >&2
  DISPLAY=:99 xprop -root _NET_WORKAREA >&2
  exit 1
}
DISPLAY=:99 xdotool mousemove 20 778 click 1
for attempt in $(seq 1 30); do
  pgrep -x xterm >/dev/null && break
  sleep .1
done
pgrep -x xterm >/dev/null || { echo "terminal launcher did not open xterm" >&2; exit 1; }
terminal_pid="$(pgrep -x xterm | head -1)"
for attempt in $(seq 1 30); do
  shell_pid="$(pgrep -P "$terminal_pid" -x bash | head -1 || true)"
  [[ -n "$shell_pid" ]] && break
  sleep .1
done
[[ -n "${shell_pid:-}" ]] || { echo "terminal shell did not start" >&2; exit 1; }
terminal_env="$(tr '\0' '\n' < "/proc/$shell_pid/environ")"
grep -Fxq 'USER=jentera' <<< "$terminal_env" || { echo "terminal exposes the runtime OS user" >&2; exit 1; }
grep -Fq 'PS1=jentera@computer:' <<< "$terminal_env" || { echo "terminal prompt is not owner-safe" >&2; exit 1; }
grep -Fq 'sprite@' <<< "$terminal_env" && { echo "terminal prompt leaks the provider identity" >&2; exit 1; }
pkill -x xterm

exec node runner/qa/desktop-linux/fixture.mjs
