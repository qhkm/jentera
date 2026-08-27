#!/usr/bin/env bash
set -euo pipefail

incoming="${1:-/home/sprite/aisar/vrs.env.in}"
runtime_env="${AISAR_RUNTIME_ENV_FILE:-/home/sprite/aisar/runtime.env}"
if [[ ! -r "$incoming" || ! -r "$runtime_env" ]]; then
  echo "VRS transfer or runtime environment is unavailable" >&2
  exit 1
fi

# Parse the transfer as data rather than shell code. Only the three expected
# base64 fields are accepted; the plaintext key exists only in this process.
VRS_BASE_B64=
VRS_KEY_B64=
VRS_MODEL_B64=
while IFS='=' read -r name value; do
  [[ -z "$name" ]] && continue
  [[ "$value" =~ ^[A-Za-z0-9+/]*={0,2}$ ]] || {
    echo "VRS transfer contains invalid base64" >&2
    exit 1
  }
  case "$name" in
    VRS_BASE_B64) VRS_BASE_B64="$value" ;;
    VRS_KEY_B64) VRS_KEY_B64="$value" ;;
    VRS_MODEL_B64) VRS_MODEL_B64="$value" ;;
    *)
      echo "VRS transfer contains an unknown field" >&2
      exit 1
      ;;
  esac
done < "$incoming"
: "${VRS_BASE_B64:?missing VRS base URL}"
: "${VRS_KEY_B64:?missing VRS key}"
: "${VRS_MODEL_B64:?missing VRS model}"

base_url="$(printf '%s' "$VRS_BASE_B64" | base64 --decode)"
vrs_key="$(printf '%s' "$VRS_KEY_B64" | base64 --decode)"
model_name="$(printf '%s' "$VRS_MODEL_B64" | base64 --decode)"
[[ "$base_url" == http://* || "$base_url" == https://* ]] || exit 1
[[ ${#vrs_key} -ge 8 ]] || exit 1
[[ -n "$model_name" ]] || exit 1

key_env=HERMES_CUSTOM_60_51_17_97_9999_API_KEY
runtime_tmp="$(mktemp /home/sprite/aisar/runtime.env.XXXXXX)"
trap 'rm -f "$runtime_tmp"' EXIT
grep -v "^${key_env}=" "$runtime_env" > "$runtime_tmp"
printf '%s=' "$key_env" >> "$runtime_tmp"
printf '%q\n' "$vrs_key" >> "$runtime_tmp"
chmod 600 "$runtime_tmp"
mv "$runtime_tmp" "$runtime_env"

/home/sprite/.hermes/hermes-agent/venv/bin/python \
  /home/sprite/aisar/runner/configure-vrs.py "$base_url" "$model_name" "$key_env"

rm -f "$incoming"
trap - EXIT
printf '{"ok":true,"provider":"vrs","model":"%s"}\n' "$model_name"
