#!/usr/bin/env bash
set -euo pipefail

# Idempotent bootstrap executed inside one newly-created Sprite. The transfer
# file contains base64 data, never shell code, and is removed on every exit.
incoming="${1:-/home/sprite/aisar/bootstrap.env.in}"
allow_insecure="${AISAR_ALLOW_INSECURE_VRS:-0}"
hermes_installer_url="https://hermes-agent.nousresearch.com/install.sh"
hermes_installer_sha256="c0380bc1f78d3d662a77663ce20cc17e14cbc4bec35e61ab7a33bac5f3afed2d"

if [[ ! -r "$incoming" ]]; then
  echo "runtime bootstrap transfer is unavailable" >&2
  exit 1
fi
trap 'rm -f "$incoming"' EXIT

BUSINESS_ID_B64=
RUNTIME_RELEASE_B64=
RUNNER_KEY_B64=
HERMES_KEY_B64=
VRS_BASE_B64=
VRS_KEY_B64=
VRS_MODEL_B64=
HERMES_TAG_B64=
HERMES_COMMIT_B64=
while IFS='=' read -r name value; do
  [[ -z "$name" ]] && continue
  [[ "$value" =~ ^[A-Za-z0-9+/]*={0,2}$ ]] || {
    echo "runtime bootstrap transfer contains invalid base64" >&2
    exit 1
  }
  case "$name" in
    BUSINESS_ID_B64) BUSINESS_ID_B64="$value" ;;
    RUNTIME_RELEASE_B64) RUNTIME_RELEASE_B64="$value" ;;
    RUNNER_KEY_B64) RUNNER_KEY_B64="$value" ;;
    HERMES_KEY_B64) HERMES_KEY_B64="$value" ;;
    VRS_BASE_B64) VRS_BASE_B64="$value" ;;
    VRS_KEY_B64) VRS_KEY_B64="$value" ;;
    VRS_MODEL_B64) VRS_MODEL_B64="$value" ;;
    HERMES_TAG_B64) HERMES_TAG_B64="$value" ;;
    HERMES_COMMIT_B64) HERMES_COMMIT_B64="$value" ;;
    *)
      echo "runtime bootstrap transfer contains an unknown field" >&2
      exit 1
      ;;
  esac
done < "$incoming"

decode() {
  printf '%s' "$1" | base64 --decode
}

: "${BUSINESS_ID_B64:?missing business id}"
: "${RUNTIME_RELEASE_B64:?missing runtime release}"
: "${RUNNER_KEY_B64:?missing runner key}"
: "${HERMES_KEY_B64:?missing Hermes key}"
: "${VRS_BASE_B64:?missing VRS base URL}"
: "${VRS_KEY_B64:?missing VRS key}"
: "${VRS_MODEL_B64:?missing VRS model}"
: "${HERMES_TAG_B64:?missing Hermes tag}"
: "${HERMES_COMMIT_B64:?missing Hermes commit}"

business_id="$(decode "$BUSINESS_ID_B64")"
runtime_release="$(decode "$RUNTIME_RELEASE_B64")"
runner_key="$(decode "$RUNNER_KEY_B64")"
hermes_key="$(decode "$HERMES_KEY_B64")"
vrs_base="$(decode "$VRS_BASE_B64")"
vrs_key="$(decode "$VRS_KEY_B64")"
vrs_model="$(decode "$VRS_MODEL_B64")"
hermes_tag="$(decode "$HERMES_TAG_B64")"
hermes_commit="$(decode "$HERMES_COMMIT_B64")"

[[ "$business_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || {
  echo "business id must be a UUID" >&2
  exit 1
}
[[ ${#runner_key} -ge 32 && ${#hermes_key} -ge 8 && ${#vrs_key} -ge 8 ]] || {
  echo "runtime credential is too short" >&2
  exit 1
}
[[ "$runtime_release" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$ ]] || {
  echo "runtime release is invalid" >&2
  exit 1
}
[[ "$hermes_tag" =~ ^v[0-9]{4}\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$hermes_commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ -n "$vrs_model" && ${#vrs_model} -le 200 ]] || exit 1
case "$vrs_base" in
  https://*) ;;
  http://*)
    if [[ "$allow_insecure" != "1" ]]; then
      echo "refusing plaintext VRS; configure HTTPS/private transport" >&2
      exit 1
    fi
    ;;
  *)
    echo "VRS base URL must be absolute HTTP(S)" >&2
    exit 1
    ;;
esac

install -d -m 700 /home/sprite/aisar /home/sprite/aisar/runner /home/sprite/.hermes
install_dir=/home/sprite/.hermes/hermes-agent
installed_commit=
if [[ -d "$install_dir/.git" ]]; then
  installed_commit="$(git -C "$install_dir" rev-parse HEAD 2>/dev/null || true)"
fi
if [[ "$installed_commit" != "$hermes_commit" ]]; then
  installer="$(mktemp /tmp/aisar-hermes-install.XXXXXX)"
  trap 'rm -f "$incoming" "$installer"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$hermes_installer_url" --output "$installer"
  actual_sha="$(sha256sum "$installer")"
  actual_sha="${actual_sha%% *}"
  if [[ "$actual_sha" != "$hermes_installer_sha256" ]]; then
    echo "Hermes installer checksum changed; release review required" >&2
    exit 1
  fi
  chmod 700 "$installer"
  HERMES_HOME=/home/sprite/.hermes bash "$installer" \
    --branch "$hermes_tag" \
    --commit "$hermes_commit" \
    --force-commit \
    --skip-setup \
    --non-interactive \
    --dir "$install_dir" \
    --hermes-home /home/sprite/.hermes
  rm -f "$installer"
  trap 'rm -f "$incoming"' EXIT
fi

runtime_env=/home/sprite/aisar/runtime.env
runtime_tmp="$(mktemp /home/sprite/aisar/runtime.env.XXXXXX)"
trap 'rm -f "$incoming" "$runtime_tmp"' EXIT
endpoint_identity="${vrs_base#*://}"
endpoint_identity="${endpoint_identity%%/*}"
key_slug="$(printf '%s' "$endpoint_identity" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9' '_')"
key_slug="${key_slug##_}"
key_slug="${key_slug%%_}"
vrs_key_env="HERMES_CUSTOM_${key_slug}_API_KEY"
{
  printf 'AISAR_BUSINESS_ID=%q\n' "$business_id"
  printf 'AISAR_RUNTIME_RELEASE=%q\n' "$runtime_release"
  printf 'AISAR_RUNNER_KEY=%q\n' "$runner_key"
  printf 'HERMES_API_KEY=%q\n' "$hermes_key"
  printf 'API_SERVER_KEY=%q\n' "$hermes_key"
  printf 'HERMES_ORIGIN=%q\n' 'http://127.0.0.1:8642'
  printf 'PORT=%q\n' '8080'
  printf '%s=%q\n' "$vrs_key_env" "$vrs_key"
} > "$runtime_tmp"
chmod 600 "$runtime_tmp"
mv "$runtime_tmp" "$runtime_env"
trap 'rm -f "$incoming"' EXIT

"$install_dir/venv/bin/python" /home/sprite/aisar/runner/configure-vrs.py \
  "$vrs_base" "$vrs_model" "$vrs_key_env"

for service in aisar-runner hermes; do
  if sprite-env services get "$service" >/dev/null 2>&1; then
    sprite-env services stop "$service" >/dev/null 2>&1 || true
    sprite-env services delete "$service" >/dev/null
  fi
done
sprite-env services create hermes \
  --cmd /home/sprite/aisar/runner/hermes-service.sh \
  --env AISAR_RUNTIME_ENV_FILE=/home/sprite/aisar/runtime.env \
  --dir "$install_dir" \
  --no-stream
sprite-env services create aisar-runner \
  --cmd /home/sprite/aisar/runner/runner-service.sh \
  --env AISAR_RUNTIME_ENV_FILE=/home/sprite/aisar/runtime.env \
  --needs hermes \
  --http-port 8080 \
  --no-stream

ready=0
for _attempt in $(seq 1 60); do
  if curl --fail --silent --show-error \
    -H "X-Aisar-Runner-Key: $runner_key" \
    http://127.0.0.1:8080/readyz >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == "1" ]] || {
  echo "runner did not become ready" >&2
  exit 1
}

/.sprite/bin/node /home/sprite/aisar/runner/browser-smoke.mjs >/dev/null
checkpoint_created=false
if [[ "${AISAR_BOOTSTRAP_CONTROL_PLANE:-0}" != "1" ]]; then
  sprite-env checkpoints create --comment "AISAR runtime $runtime_release ready" >/dev/null
  checkpoint_created=true
fi
rm -f "$incoming"
trap - EXIT
printf '{"ok":true,"release":"%s","model":"%s","checkpointCreated":%s}\n' \
  "$runtime_release" "$vrs_model" "$checkpoint_created"
