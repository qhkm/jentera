#!/usr/bin/env bash
set -euo pipefail

runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
runner_env="${AISAR_RUNNER_ENV_FILE:-/home/sprite/aisar/runner.env}"
if [[ ! -r "$runtime_env" || ! -r "$runner_env" ]]; then
  echo "runtime environment is unavailable" >&2
  exit 1
fi

set -a
source "$runtime_env"
source "$runner_env"
set +a

if [[ "${AISAR_DESKTOP_VIEW:-0}" == "1" ]]; then
  display_env="${AISAR_DISPLAY_ENV_FILE:-/home/sprite/aisar/display.env}"
  [[ -r "$display_env" ]] || { echo "desktop display is unavailable" >&2; exit 1; }
  set -a
  source "$display_env"
  set +a
  [[ -n "${DISPLAY:-}" ]] || { echo "desktop display is unavailable" >&2; exit 1; }
fi

exec /.sprite/bin/node /home/sprite/aisar/runner/server.mjs
