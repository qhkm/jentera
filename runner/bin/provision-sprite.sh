#!/usr/bin/env bash
set -euo pipefail

# Trusted operator entrypoint. Until a dedicated provisioning worker exists,
# this gives Jentera one reproducible and auditable canary deployment path.
: "${AISAR_BUSINESS_ID:?AISAR_BUSINESS_ID is required}"
: "${AISAR_RUNTIME_RELEASE:?AISAR_RUNTIME_RELEASE is required}"
: "${AISAR_RUNNER_KEY:?AISAR_RUNNER_KEY is required}"
: "${HERMES_API_KEY:?HERMES_API_KEY is required}"
: "${AISAR_MODEL_KEY:?AISAR_MODEL_KEY is required}"
: "${AISAR_MODEL_PROVIDER:=openrouter}"
: "${AISAR_MODEL_BASE:=https://openrouter.ai/api/v1}"
: "${AISAR_MODEL_NAME:=deepseek/deepseek-v4-flash-0731}"
: "${AISAR_DEEP_MODEL_NAME:=$AISAR_MODEL_NAME}"

sprite_org="${AISAR_SPRITE_ORG:-aisar}"
hermes_tag="${AISAR_HERMES_TAG:-v2026.8.19}"
hermes_commit="${AISAR_HERMES_COMMIT:-fcbd1076a93841fa88855acce810e342a5b78101}"
[[ "$AISAR_MODEL_PROVIDER" == "openrouter" ]] || exit 1
case "$AISAR_MODEL_BASE" in
  "https://openrouter.ai/api/v1"|"https://router.fmcv.my") ;;
  *) exit 1 ;;
esac

if [[ -n "${AISAR_SPRITE_NAME:-}" ]]; then
  sprite_name="$AISAR_SPRITE_NAME"
else
  business_hash="$(printf '%s' "$AISAR_BUSINESS_ID" | shasum -a 256)"
  business_hash="${business_hash%% *}"
  sprite_name="aisar-b-${business_hash:0:20}"
fi
[[ "$sprite_name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo "derived Sprite name is invalid" >&2
  exit 1
}

transfer="$(mktemp /tmp/aisar-runtime-bootstrap.XXXXXX)"
chmod 600 "$transfer"
trap 'rm -f "$transfer"' EXIT
encode() { printf '%s' "$1" | base64 | tr -d '\n'; }
{
  printf 'BUSINESS_ID_B64=%s\n' "$(encode "$AISAR_BUSINESS_ID")"
  printf 'RUNTIME_RELEASE_B64=%s\n' "$(encode "$AISAR_RUNTIME_RELEASE")"
  printf 'RUNNER_KEY_B64=%s\n' "$(encode "$AISAR_RUNNER_KEY")"
  printf 'HERMES_KEY_B64=%s\n' "$(encode "$HERMES_API_KEY")"
  if [[ -n "${AISAR_EDGE_TOKEN:-}" ]]; then
    printf 'EDGE_TOKEN_B64=%s\n' "$(encode "$AISAR_EDGE_TOKEN")"
  fi
  printf 'MODEL_PROVIDER_B64=%s\n' "$(encode "$AISAR_MODEL_PROVIDER")"
  printf 'MODEL_BASE_B64=%s\n' "$(encode "$AISAR_MODEL_BASE")"
  printf 'MODEL_KEY_B64=%s\n' "$(encode "$AISAR_MODEL_KEY")"
  printf 'MODEL_NAME_B64=%s\n' "$(encode "$AISAR_MODEL_NAME")"
  printf 'DEEP_MODEL_NAME_B64=%s\n' "$(encode "$AISAR_DEEP_MODEL_NAME")"
  printf 'HERMES_TAG_B64=%s\n' "$(encode "$hermes_tag")"
  printf 'HERMES_COMMIT_B64=%s\n' "$(encode "$hermes_commit")"
} > "$transfer"

if ! sprite list -o "$sprite_org" | grep -Fxq "$sprite_name"; then
  sprite create -o "$sprite_org" "$sprite_name" --skip-console
fi

sprite exec -o "$sprite_org" -s "$sprite_name" -- mkdir -p /home/sprite/aisar/runner
sprite file push -o "$sprite_org" -s "$sprite_name" -p \
  runner/src/server.mjs \
  runner/bin/browser-smoke.mjs \
  runner/bin/configure-model-provider.py \
  runner/bin/patch-hermes-dependencies.mjs \
  runner/bin/hermes-service.sh \
  runner/bin/runner-service.sh \
  runner/bin/bootstrap-runtime.sh \
  /home/sprite/aisar/runner/
sprite file push -o "$sprite_org" -s "$sprite_name" -p \
  "$transfer" /home/sprite/aisar/bootstrap.env.in
sprite exec -o "$sprite_org" -s "$sprite_name" -- \
  chmod 755 \
    /home/sprite/aisar/runner/configure-model-provider.py \
    /home/sprite/aisar/runner/hermes-service.sh \
    /home/sprite/aisar/runner/runner-service.sh \
    /home/sprite/aisar/runner/bootstrap-runtime.sh
sprite exec -o "$sprite_org" -s "$sprite_name" -- \
  /home/sprite/aisar/runner/bootstrap-runtime.sh /home/sprite/aisar/bootstrap.env.in

rm -f "$transfer"
trap - EXIT
