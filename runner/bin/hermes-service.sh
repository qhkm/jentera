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

export API_SERVER_HOST="127.0.0.1"
export API_SERVER_PORT="${HERMES_PORT:-8642}"
unset API_SERVER_CORS_ORIGINS

exec /home/sprite/.hermes/hermes-agent/venv/bin/hermes gateway run
