#!/usr/bin/env bash
set -euo pipefail

runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
set -a
source "$runtime_env"
set +a

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $API_SERVER_KEY" \
  http://127.0.0.1:8642/health/detailed
printf '\n'
