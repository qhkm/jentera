#!/usr/bin/env bash
set -euo pipefail

runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
if [[ ! -r "$runtime_env" ]]; then
  echo "runtime environment is unavailable" >&2
  exit 1
fi

set -a
source "$runtime_env"
set +a

# Computer-use capability: the x11-display service publishes the virtual
# display and session bus handles. When the runtime attests AISAR_CUA_ENABLED,
# a missing display contract means the capability cannot actually run — fail
# fast instead of letting the gateway start without a screen.
display_env="${AISAR_DISPLAY_ENV_FILE:-/home/sprite/aisar/display.env}"
if [[ "${AISAR_CUA_ENABLED:-0}" == "1" ]]; then
  [[ -r "$display_env" ]] || {
    echo "computer-use runtime is missing its display environment" >&2
    exit 1
  }
  set -a
  source "$display_env"
  set +a
elif [[ -r "$display_env" ]]; then
  set -a
  source "$display_env"
  set +a
fi

export HERMES_HOME="/home/sprite/.hermes"
export API_SERVER_HOST="127.0.0.1"
export API_SERVER_PORT="${HERMES_PORT:-8642}"
unset API_SERVER_CORS_ORIGINS

# A supervisor restart can leave the old gateway alive after its wrapper was
# reaped. The replacement then crash-loops on the occupied port while the old
# process keeps answering health checks. Only terminate the PID Hermes itself
# recorded, and only when /proc proves it is this Sprite's reviewed gateway.
gateway_pid_file="$HERMES_HOME/gateway.pid"
if [[ -s "$gateway_pid_file" ]]; then
  IFS= read -r existing_pid < "$gateway_pid_file" || true
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    existing_cmd="$(tr '\0' ' ' < "/proc/$existing_pid/cmdline" 2>/dev/null || true)"
    case "$existing_cmd" in
      *"/home/sprite/.hermes/hermes-agent/venv/bin/"*"gateway"*"run"*)
        kill -TERM "$existing_pid"
        for _attempt in $(seq 1 50); do
          kill -0 "$existing_pid" 2>/dev/null || break
          sleep 0.1
        done
        if kill -0 "$existing_pid" 2>/dev/null; then
          kill -KILL "$existing_pid"
        fi
        ;;
      *)
        echo "refusing to terminate unrecognised gateway pid $existing_pid" >&2
        exit 1
        ;;
    esac
  fi
  rm -f "$gateway_pid_file"
fi

# `--replace` closes the narrow race between the PID preflight and exec. Each
# Sprite has exactly one Hermes profile, so replacement cannot cross tenants.
exec /home/sprite/.hermes/hermes-agent/venv/bin/hermes gateway run --replace
