#!/usr/bin/env bash
set -euo pipefail

# Development smoke setup only. Production provisioning writes the two
# control-plane-generated credentials directly and never generates them here.
: "${AISAR_BUSINESS_ID:?AISAR_BUSINESS_ID is required}"
: "${AISAR_RUNTIME_RELEASE:?AISAR_RUNTIME_RELEASE is required}"

install -d -m 700 /home/sprite/aisar
runtime_env=/home/sprite/aisar/runtime.env
runner_env=/home/sprite/aisar/runner.env
hermes_env=/home/sprite/aisar/hermes.env

if [[ ! -e "$runtime_env" || ! -e "$runner_env" || ! -e "$hermes_env" ]]; then
  umask 077
  runner_key="$(openssl rand -hex 32)"
  hermes_key="$(openssl rand -hex 32)"
  {
    printf 'AISAR_BUSINESS_ID=%s\n' "$AISAR_BUSINESS_ID"
    printf 'AISAR_RUNTIME_RELEASE=%s\n' "$AISAR_RUNTIME_RELEASE"
    printf 'HERMES_ORIGIN=http://127.0.0.1:8642\n'
    printf 'PORT=8080\n'
  } > "$runtime_env"
  {
    printf 'AISAR_RUNNER_KEY=%s\n' "$runner_key"
    printf 'HERMES_API_KEY=%s\n' "$hermes_key"
  } > "$runner_env"
  {
    printf 'HERMES_API_KEY=%s\n' "$hermes_key"
    printf 'API_SERVER_KEY=%s\n' "$hermes_key"
  } > "$hermes_env"
fi
chmod 600 "$runtime_env" "$runner_env" "$hermes_env"

sprite-env services create hermes \
  --cmd /home/sprite/aisar/runner/hermes-service.sh \
  --env AISAR_RUNTIME_ENV_FILE=/home/sprite/aisar/runtime.env \
  --env AISAR_HERMES_ENV_FILE=/home/sprite/aisar/hermes.env \
  --dir /home/sprite/.hermes/hermes-agent \
  --no-stream

sprite-env services create aisar-runner \
  --cmd /home/sprite/aisar/runner/runner-service.sh \
  --env AISAR_RUNTIME_ENV_FILE=/home/sprite/aisar/runtime.env \
  --env AISAR_RUNNER_ENV_FILE=/home/sprite/aisar/runner.env \
  --needs hermes \
  --http-port 8080 \
  --no-stream
