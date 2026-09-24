#!/usr/bin/env bash
set -euo pipefail

# The x11-display service owns the virtual display + session bus that Hermes'
# computer_use toolset drives. The bootstrap proves this exact stack with
# `hermes computer-use doctor` BEFORE the runtime may attest the capability;
# this service keeps the same stack alive across gateway restarts and
# publishes the connection handles for child processes via display.env.
#
# hermes-service.sh sources display.env before exec, so every Hermes child
# (including spawned cua-driver processes) inherits DISPLAY and
# DBUS_SESSION_BUS_ADDRESS. The file is the contract; nothing else crosses
# process boundaries.

display_env="${AISAR_DISPLAY_ENV_FILE:-/home/sprite/aisar/display.env}"
display="${AISAR_DISPLAY_NUM:-99}"
screen_geometry="${AISAR_DISPLAY_GEOMETRY:-1280x800x24}"

state_dir="$(dirname "$display_env")"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
tint2_config="${AISAR_TINT2_CONFIG:-$script_dir/jentera-tint2rc}"
openbox_config="$state_dir/openbox-rc.xml"
install -d -m 700 "$state_dir"
dbus_address_file="$state_dir/.dbus.address"
dbus_pid_file="$state_dir/.dbus.pid"
xvfb_pid_file="$state_dir/.xvfb.pid"
openbox_pid_file="$state_dir/.openbox.pid"
tint2_pid_file="$state_dir/.tint2.pid"
display_lock="/tmp/.X${display}-lock"
display_socket_dir="/tmp/.X11-unix"

is_alive() {
  [[ -s "$1" ]] || return 1
  kill -0 "$(cat "$1")" 2>/dev/null
}

# Reuse a live session bus; otherwise start one and record its address and
# pid. The address changes every restart, so consumers must re-read
# display.env (hermes-service.sh does at every gateway start).
start_dbus() {
  local out
  if [[ -s "$dbus_address_file" ]] &&
      DBUS_SESSION_BUS_ADDRESS="$(cat "$dbus_address_file")" \
        dbus-send --session --dest=org.freedesktop.DBus \
          / org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
    export DBUS_SESSION_BUS_ADDRESS="$(cat "$dbus_address_file")"
    return 0
  fi
  out="$(dbus-daemon --session --fork --print-address=1 --print-pid=1)"
  printf '%s\n' "${out%%$'\n'*}" > "$dbus_address_file"
  printf '%s\n' "${out##*$'\n'}" > "$dbus_pid_file"
  chmod 600 "$dbus_address_file" "$dbus_pid_file"
  export DBUS_SESSION_BUS_ADDRESS="$(cat "$dbus_address_file")"
}

start_xvfb() {
  if is_alive "$xvfb_pid_file"; then
    return 0
  fi
  # A crashed Xvfb leaves its lock/socket behind; clear them so the restart
  # can bind the same display number.
  rm -f "$display_lock" "$display_socket_dir/X${display}"
  Xvfb ":$display" -screen 0 "$screen_geometry" -nolisten tcp >/dev/null 2>&1 &
  echo $! > "$xvfb_pid_file"
}

start_openbox() {
  if is_alive "$openbox_pid_file"; then
    return 0
  fi
  # Openbox treats tint2 as a dock application and its packaged default puts
  # every dock at TopLeft, overriding tint2's own bottom-panel position. Build
  # a private config from the installed defaults so keyboard/mouse behaviour
  # stays native while the terminal launcher remains visible at the bottom.
  local packaged=/etc/xdg/openbox/rc.xml tmp="${openbox_config}.$$"
  [[ -r "$packaged" ]] || { echo "Openbox defaults are unavailable" >&2; return 1; }
  sed 's#<position>TopLeft</position>#<position>BottomLeft</position>#' "$packaged" > "$tmp"
  grep -q '<position>BottomLeft</position>' "$tmp" || {
    rm -f "$tmp"
    echo "Openbox dock position could not be configured" >&2
    return 1
  }
  chmod 600 "$tmp"
  mv -f "$tmp" "$openbox_config"
  DISPLAY=":$display" openbox --config-file "$openbox_config" >/dev/null 2>&1 &
  echo $! > "$openbox_pid_file"
}

publish() {
  local tmp="${display_env}.$$"
  {
    printf 'DISPLAY=%q\n' ":$display"
    printf 'DBUS_SESSION_BUS_ADDRESS=%q\n' "${DBUS_SESSION_BUS_ADDRESS:-}"
  } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$display_env"
}

start_panel() {
  [[ "${AISAR_DESKTOP_VIEW:-0}" == "1" ]] || return 0
  is_alive "$tint2_pid_file" && return 0
  # Use the reviewed panel instead of tint2's first-run generated config. It
  # keeps the desktop compact while exposing the installed Terminal as a real
  # application beside the running-browser task button.
  install -d -m 700 "$state_dir/applications"
  install -m 600 "$script_dir/jentera-terminal.desktop" "$state_dir/applications/jentera-terminal.desktop"
  XDG_DATA_HOME="$state_dir" DISPLAY=":$display" tint2 -c "$tint2_config" >/dev/null 2>&1 &
  echo $! > "$tint2_pid_file"
}

while true; do
  start_dbus
  start_xvfb
  start_openbox
  start_panel
  publish
  sleep 3
done
