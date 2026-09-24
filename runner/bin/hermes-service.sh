#!/usr/bin/env bash
set -euo pipefail

runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
hermes_env="${AISAR_HERMES_ENV_FILE:-/home/sprite/aisar/hermes.env}"
if [[ ! -r "$runtime_env" || ! -r "$hermes_env" ]]; then
  echo "runtime environment is unavailable" >&2
  exit 1
fi

set -a
source "$runtime_env"
source "$hermes_env"
set +a

export HERMES_HOME="/home/sprite/.hermes"
export PATH="/home/sprite/.local/bin:$PATH"
export CUA_DRIVER_RS_TELEMETRY_ENABLED=0

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
  [[ -n "${DISPLAY:-}" && -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]] || {
    echo "computer-use runtime has an incomplete display environment" >&2
    exit 1
  }
  # The install-time doctor proves the pinned driver and stack in isolation.
  # This second check proves the exact DISPLAY/session bus inherited by the
  # long-running gateway. A green test on a throwaway Xvfb must never attest a
  # broken service environment as healthy.
  if ! timeout --foreground -k 5 120 \
      /home/sprite/.hermes/hermes-agent/venv/bin/hermes computer-use doctor \
      >/dev/null 2>&1; then
    echo "computer-use doctor failed in the gateway display environment" >&2
    exit 1
  fi
elif [[ -r "$display_env" ]]; then
  set -a
  source "$display_env"
  set +a
fi
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
# --- persistent gateway log --------------------------------------------------
#
# Nothing retained this process's output. stdout and stderr went to a pipe with
# no reader, journalctl was empty, there were no systemd units, and the only
# file on disk was a list of restart timestamps. A failed task left no evidence
# on a live sprite, so "why did this break?" could only be answered by reading
# SQLite tables after the fact.
#
# An exec redirect rather than a pipe: the service manager tracks the pid it
# spawned and signals it on stop and restart, so the gateway has to stay this
# script's exec'd process rather than become a child of a pipeline.
# Overridable so this is testable off a sprite, and so an operator can move the
# log to a larger volume without editing the service.
log_dir="${AISAR_GATEWAY_LOG_DIR:-${HERMES_HOME:-/home/sprite/.hermes}/logs}"
log_file="$log_dir/gateway.log"
mkdir -p "$log_dir"

# Rotate on start, keeping three generations. There is no logrotate and no cron
# on a sprite, so start-up is the only moment this can reliably happen -- which
# means a gateway that never restarts can still outgrow the cap. That is the
# accepted limit of a dependency-free approach; 95G free and a restart-heavy
# service make it a safe one.
gateway_log_max_bytes=$((64 * 1024 * 1024))
if [[ -f "$log_file" ]]; then
  gateway_log_size=$(wc -c < "$log_file" 2>/dev/null || echo 0)
  if (( gateway_log_size > gateway_log_max_bytes )); then
    # Written as if/then, not `[[ -f x ]] && mv`: under `set -e` an && list whose
    # test fails is tolerated only by a subtlety of bash's rules, and a later edit
    # that turned it into a plain command would abort the gateway on first start.
    rm -f "$log_file.3"
    if [[ -f "$log_file.2" ]]; then mv "$log_file.2" "$log_file.3"; fi
    if [[ -f "$log_file.1" ]]; then mv "$log_file.1" "$log_file.2"; fi
    mv "$log_file" "$log_file.1"
  fi
fi

# Redirected here, at the end: the checks above this point still report to the
# service manager, so a sprite that cannot start at all fails visibly rather
# than into a file nobody is watching yet.
printf '=== gateway start %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"
exec >>"$log_file" 2>&1

exec /home/sprite/.hermes/hermes-agent/venv/bin/hermes gateway run --replace
