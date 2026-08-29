#!/usr/bin/env bash
set -euo pipefail

# Idempotent bootstrap executed inside one newly-created Sprite. The transfer
# file contains base64 data, never shell code, and is removed on every exit.
incoming="${1:-/home/sprite/aisar/bootstrap.env.in}"
hermes_installer_sha256="0582d9b1562efcb6e0ac62f4451021667830b830a72ce7d91eaea9fee8b6c09b"

if [[ ! -r "$incoming" ]]; then
  echo "runtime bootstrap transfer is unavailable" >&2
  exit 1
fi
trap 'rm -f "$incoming"' EXIT

BUSINESS_ID_B64=
RUNTIME_RELEASE_B64=
RUNNER_KEY_B64=
HERMES_KEY_B64=
EDGE_TOKEN_B64=
MODEL_PROVIDER_B64=
MODEL_BASE_B64=
MODEL_KEY_B64=
MODEL_NAME_B64=
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
    EDGE_TOKEN_B64) EDGE_TOKEN_B64="$value" ;;
    MODEL_PROVIDER_B64) MODEL_PROVIDER_B64="$value" ;;
    MODEL_BASE_B64) MODEL_BASE_B64="$value" ;;
    MODEL_KEY_B64) MODEL_KEY_B64="$value" ;;
    MODEL_NAME_B64) MODEL_NAME_B64="$value" ;;
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
: "${MODEL_PROVIDER_B64:?missing model provider}"
: "${MODEL_BASE_B64:?missing model base URL}"
: "${MODEL_KEY_B64:?missing model key}"
: "${MODEL_NAME_B64:?missing model name}"
: "${HERMES_TAG_B64:?missing Hermes tag}"
: "${HERMES_COMMIT_B64:?missing Hermes commit}"

business_id="$(decode "$BUSINESS_ID_B64")"
runtime_release="$(decode "$RUNTIME_RELEASE_B64")"
runner_key="$(decode "$RUNNER_KEY_B64")"
hermes_key="$(decode "$HERMES_KEY_B64")"
model_provider="$(decode "$MODEL_PROVIDER_B64")"
model_base="$(decode "$MODEL_BASE_B64")"
model_key="$(decode "$MODEL_KEY_B64")"
model_name="$(decode "$MODEL_NAME_B64")"
hermes_tag="$(decode "$HERMES_TAG_B64")"
hermes_commit="$(decode "$HERMES_COMMIT_B64")"
edge_token="$(decode "$EDGE_TOKEN_B64")"

[[ "$business_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || {
  echo "business id must be a UUID" >&2
  exit 1
}
[[ ${#runner_key} -ge 32 && ${#hermes_key} -ge 8 && ${#model_key} -ge 20 ]] || {
  echo "runtime credential is too short" >&2
  exit 1
}
[[ "$runtime_release" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$ ]] || {
  echo "runtime release is invalid" >&2
  exit 1
}
[[ "$hermes_tag" =~ ^v[0-9]{4}\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$hermes_commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
hermes_installer_url="https://raw.githubusercontent.com/NousResearch/hermes-agent/${hermes_commit}/scripts/install.sh"
[[ "$model_provider" == "openrouter" ]] || {
  echo "only the reviewed OpenRouter provider is allowed" >&2
  exit 1
}
[[ "$model_base" == "https://openrouter.ai/api/v1" ]] || {
  echo "OpenRouter base URL is not pinned" >&2
  exit 1
}
[[ "$model_name" =~ ^[A-Za-z0-9._~-]+/[A-Za-z0-9._:~-]+$ ]] || {
  echo "OpenRouter model id is invalid" >&2
  exit 1
}

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

# Hermes' reviewed commit pins nanoid 3.3.17, which is affected by
# GHSA-2v37-7h3g-55p8. Apply the narrow patched release without allowing a
# broad audit fix to rewrite unrelated dependencies, then make future high
# severity production advisories a release-blocking event.
/.sprite/bin/node /home/sprite/aisar/runner/patch-hermes-dependencies.mjs "$install_dir"
(
  cd "$install_dir"
  npm install --ignore-scripts --no-audit --no-fund
)
/.sprite/bin/node /home/sprite/aisar/runner/patch-hermes-dependencies.mjs \
  "$install_dir" --verify
(
  cd "$install_dir"
  npm audit --omit=dev --audit-level=high
)

# A terminated installer can leave the pinned Git commit and node_modules in
# place before Playwright downloads Chromium. The commit alone is therefore
# not proof of a complete runtime. Repair the browser layer independently and
# assert the executable exists before any service can be marked ready.
browser_cache=/home/sprite/.cache/ms-playwright
browser_binary="$(find "$browser_cache" -type f \
  -path '*/chrome-headless-shell-linux64/chrome-headless-shell' \
  -perm -111 -print -quit 2>/dev/null || true)"
if [[ -z "$browser_binary" ]]; then
  case "$(uname -m)" in
    x86_64|amd64) playwright_platform=ubuntu24.04-x64 ;;
    aarch64|arm64) playwright_platform=ubuntu24.04-arm64 ;;
    *)
      echo "Playwright has no reviewed Linux build for this architecture" >&2
      exit 1
      ;;
  esac
  (
    cd "$install_dir"
    PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="$playwright_platform" \
      timeout --foreground -k 10 600 npx playwright install --with-deps chromium
  )
  browser_binary="$(find "$browser_cache" -type f \
    -path '*/chrome-headless-shell-linux64/chrome-headless-shell' \
    -perm -111 -print -quit 2>/dev/null || true)"
fi
[[ -n "$browser_binary" ]] || {
  echo "Playwright Chromium is unavailable after installation" >&2
  exit 1
}

runtime_env=/home/sprite/aisar/runtime.env
runtime_tmp="$(mktemp /home/sprite/aisar/runtime.env.XXXXXX)"
trap 'rm -f "$incoming" "$runtime_tmp"' EXIT
{
  printf 'AISAR_BUSINESS_ID=%q\n' "$business_id"
  printf 'AISAR_RUNTIME_RELEASE=%q\n' "$runtime_release"
  printf 'AISAR_TOOL_MODE=%q\n' 'full-tools'
  printf 'AISAR_WEB_SEARCH_BACKEND=%q\n' 'ddgs'
  printf 'AISAR_RUNNER_KEY=%q\n' "$runner_key"
  if [[ -n "$edge_token" ]]; then
    printf 'AISAR_EDGE_TOKEN=%q\n' "$edge_token"
  fi
  printf 'HERMES_API_KEY=%q\n' "$hermes_key"
  printf 'API_SERVER_KEY=%q\n' "$hermes_key"
  printf 'HERMES_ORIGIN=%q\n' 'http://127.0.0.1:8642'
  printf 'PORT=%q\n' '8080'
  printf 'OPENROUTER_API_KEY=%q\n' "$model_key"
} > "$runtime_tmp"
chmod 600 "$runtime_tmp"
mv "$runtime_tmp" "$runtime_env"
trap 'rm -f "$incoming"' EXIT

"$install_dir/venv/bin/python" /home/sprite/aisar/runner/configure-model-provider.py \
  "$model_provider" "$model_base" "$model_name" OPENROUTER_API_KEY

# The pinned Hermes release supports DDGS as its keyless production search
# provider, but does not install the optional package in its base environment.
# Pin it as part of this immutable Jentera release, then prove both import and
# a real search before the runtime can be checkpointed or marked ready.
hermes_uv=/home/sprite/.hermes/bin/uv
[[ -x "$hermes_uv" ]] || {
  echo "Hermes managed uv is unavailable" >&2
  exit 1
}
UV_NO_CONFIG=1 UV_NO_PROGRESS=1 "$hermes_uv" pip install \
  --python "$install_dir/venv/bin/python" 'ddgs==9.16.0'
UV_NO_CONFIG=1 "$hermes_uv" pip check --python "$install_dir/venv/bin/python"
web_search_ready=false
for _attempt in 1 2 3; do
  if timeout --foreground -k 5 45 \
      "$install_dir/venv/bin/python" /home/sprite/aisar/runner/web-search-smoke.py; then
    web_search_ready=true
    break
  fi
  sleep 2
done
[[ "$web_search_ready" == "true" ]] || {
  echo "Hermes web search did not pass its live smoke test" >&2
  exit 1
}

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
  sprite-env checkpoints create --comment "Jentera runtime $runtime_release ready" >/dev/null
  checkpoint_created=true
fi
rm -f "$incoming"
trap - EXIT
printf '{"ok":true,"release":"%s","provider":"%s","model":"%s","checkpointCreated":%s}\n' \
  "$runtime_release" "$model_provider" "$model_name" "$checkpoint_created"
