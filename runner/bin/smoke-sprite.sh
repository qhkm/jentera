#!/usr/bin/env bash
set -euo pipefail

runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
set -a
source "$runtime_env"
set +a

curl --fail-with-body --silent --show-error http://127.0.0.1:8080/healthz
printf '\n'
curl --fail-with-body --silent --show-error \
  -H "X-Aisar-Runner-Key: $AISAR_RUNNER_KEY" \
  http://127.0.0.1:8080/readyz
printf '\n'
