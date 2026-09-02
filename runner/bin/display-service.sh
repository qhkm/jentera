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
install -d -m 700 "$state_dir"
dbus_address_file="$state_dir/.dbus.address"
dbus_pid_file="$state_dir/.dbus.pid"
xvfb_pid_file="$state_dir/.xvfb.pid"
openbox_pid_file="$state_dir/.openbox.pid"
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
  DISPLAY=":$display" openbox >/dev/null 2>&1 &
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

while true; do
  start_dbus
  start_xvfb
  start_openbox
  publish
  sleep 3
done
