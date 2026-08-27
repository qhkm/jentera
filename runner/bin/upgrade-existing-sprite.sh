#!/usr/bin/env bash
set -euo pipefail

# Recovery/canary helper executed inside an already-provisioned Sprite. Secrets
# never leave the runtime: this converts its mode-0600 environment back into
# bootstrap's data-only transfer and immediately rotates it through bootstrap.
release="${1:?runtime release is required}"
runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
[[ "$release" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$ ]] || exit 1
[[ -r "$runtime_env" ]] || exit 1

set -a
source "$runtime_env"
set +a
: "${AISAR_BUSINESS_ID:?missing business id}"
: "${AISAR_RUNNER_KEY:?missing runner key}"
: "${HERMES_API_KEY:?missing Hermes key}"
: "${OPENROUTER_API_KEY:?missing OpenRouter key}"

transfer="$(mktemp /home/sprite/aisar/bootstrap.env.in.XXXXXX)"
chmod 600 "$transfer"
trap 'rm -f "$transfer"' EXIT
encode() { printf '%s' "$1" | base64 | tr -d '\n'; }
{
  printf 'BUSINESS_ID_B64=%s\n' "$(encode "$AISAR_BUSINESS_ID")"
  printf 'RUNTIME_RELEASE_B64=%s\n' "$(encode "$release")"
  printf 'RUNNER_KEY_B64=%s\n' "$(encode "$AISAR_RUNNER_KEY")"
  printf 'HERMES_KEY_B64=%s\n' "$(encode "$HERMES_API_KEY")"
  printf 'MODEL_PROVIDER_B64=%s\n' "$(encode 'openrouter')"
  printf 'MODEL_BASE_B64=%s\n' "$(encode 'https://openrouter.ai/api/v1')"
  printf 'MODEL_KEY_B64=%s\n' "$(encode "$OPENROUTER_API_KEY")"
  printf 'MODEL_NAME_B64=%s\n' "$(encode 'deepseek/deepseek-v4-flash-0731')"
  printf 'HERMES_TAG_B64=%s\n' "$(encode 'v2026.8.19')"
  printf 'HERMES_COMMIT_B64=%s\n' "$(encode 'fcbd1076a93841fa88855acce810e342a5b78101')"
} > "$transfer"

AISAR_BOOTSTRAP_CONTROL_PLANE=1 \
  /home/sprite/aisar/runner/bootstrap-runtime.sh "$transfer"
