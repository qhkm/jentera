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

exec /.sprite/bin/node /home/sprite/aisar/runner/server.mjs
