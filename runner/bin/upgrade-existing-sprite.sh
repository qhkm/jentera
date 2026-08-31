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

hermes_python=/home/sprite/.hermes/hermes-agent/venv/bin/python
model_base="${AISAR_MODEL_BASE:-${OPENROUTER_BASE_URL:-}}"
model_name="${AISAR_MODEL_NAME:-}"
if [[ -z "$model_base" ]]; then
  model_base="$($hermes_python -c 'import yaml; d=yaml.safe_load(open("/home/sprite/.hermes/config.yaml")) or {}; print((d.get("model") or {}).get("base_url") or "")')"
fi
if [[ -z "$model_name" ]]; then
  model_name="$($hermes_python -c 'import yaml; d=yaml.safe_load(open("/home/sprite/.hermes/config.yaml")) or {}; print((d.get("model") or {}).get("default") or "")')"
fi
deep_model_name="${AISAR_DEEP_MODEL_NAME:-deepseek-v4-flash}"
case "$model_base" in
  "https://openrouter.ai/api/v1"|"https://router.fmcv.my") ;;
  *) echo "existing runtime model endpoint is not pinned" >&2; exit 1 ;;
esac
[[ -n "$model_name" && -n "$deep_model_name" ]] || exit 1

transfer="$(mktemp /home/sprite/aisar/bootstrap.env.in.XXXXXX)"
chmod 600 "$transfer"
trap 'rm -f "$transfer"' EXIT
encode() { printf '%s' "$1" | base64 | tr -d '\n'; }
{
  printf 'BUSINESS_ID_B64=%s\n' "$(encode "$AISAR_BUSINESS_ID")"
  printf 'RUNTIME_RELEASE_B64=%s\n' "$(encode "$release")"
  printf 'RUNNER_KEY_B64=%s\n' "$(encode "$AISAR_RUNNER_KEY")"
  printf 'HERMES_KEY_B64=%s\n' "$(encode "$HERMES_API_KEY")"
  if [[ -n "${AISAR_EDGE_TOKEN:-}" ]]; then
    printf 'EDGE_TOKEN_B64=%s\n' "$(encode "$AISAR_EDGE_TOKEN")"
  fi
  printf 'MODEL_PROVIDER_B64=%s\n' "$(encode 'openrouter')"
  printf 'MODEL_BASE_B64=%s\n' "$(encode "$model_base")"
  printf 'MODEL_KEY_B64=%s\n' "$(encode "$OPENROUTER_API_KEY")"
  printf 'MODEL_NAME_B64=%s\n' "$(encode "$model_name")"
  printf 'DEEP_MODEL_NAME_B64=%s\n' "$(encode "$deep_model_name")"
  printf 'HERMES_TAG_B64=%s\n' "$(encode 'v2026.8.19')"
  printf 'HERMES_COMMIT_B64=%s\n' "$(encode 'fcbd1076a93841fa88855acce810e342a5b78101')"
} > "$transfer"

AISAR_BOOTSTRAP_CONTROL_PLANE=1 \
  /home/sprite/aisar/runner/bootstrap-runtime.sh "$transfer"
