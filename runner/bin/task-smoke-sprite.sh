#!/usr/bin/env bash
set -euo pipefail

runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
set -a
source "$runtime_env"
set +a

exec /.sprite/bin/node /home/sprite/aisar/runner/task-smoke-sprite.mjs
