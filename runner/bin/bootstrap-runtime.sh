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
DEEP_MODEL_NAME_B64=
HERMES_TAG_B64=
HERMES_COMMIT_B64=
CUA_ENABLED_B64=
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
    DEEP_MODEL_NAME_B64) DEEP_MODEL_NAME_B64="$value" ;;
    HERMES_TAG_B64) HERMES_TAG_B64="$value" ;;
    HERMES_COMMIT_B64) HERMES_COMMIT_B64="$value" ;;
    CUA_ENABLED_B64) CUA_ENABLED_B64="$value" ;;
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
deep_model_name="$(decode "${DEEP_MODEL_NAME_B64:-$MODEL_NAME_B64}")"
hermes_tag="$(decode "$HERMES_TAG_B64")"
hermes_commit="$(decode "$HERMES_COMMIT_B64")"
edge_token="$(decode "$EDGE_TOKEN_B64")"
cua_enabled="$(decode "${CUA_ENABLED_B64:-}")"
[[ "$cua_enabled" =~ ^(0|1)?$ ]] || {
  echo "CUA_ENABLED_B64 must decode to 0 or 1 (absent means disabled)" >&2
  exit 1
}

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
case "$model_base" in
  "https://openrouter.ai/api/v1"|"https://router.fmcv.my") ;;
  *)
    echo "base URL is not pinned" >&2
    exit 1
    ;;
esac
[[ "$model_name" =~ ^[A-Za-z0-9._~-]+(/[A-Za-z0-9._:~-]+)?$ ]] || {
  echo "model id is invalid" >&2
  exit 1
}
[[ "$deep_model_name" =~ ^[A-Za-z0-9._~-]+(/[A-Za-z0-9._:~-]+)?$ ]] || {
  echo "deep model id is invalid" >&2
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
  # npm audit is a security gate, not a build step — a registry outage
  # (503/ECONNRESET/timeout) must never block a runtime upgrade that has
  # already installed and verified its dependencies. Only a real high-severity
  # finding fails the bootstrap; patch-hermes-dependencies.mjs --verify above
  # remains the hard gate for the one advisory we ship around.
  if audit_text="$(npm audit --omit=dev --audit-level=high 2>&1)"; then
    :
  else
    audit_rc=$?
    if printf '%s\n' "$audit_text" | grep -qiE 'vulnerabilit|found [0-9]+ (moderate|high|critical)|GHSA'; then
      printf '%s\n' "$audit_text" >&2
      echo "high-severity production advisory present — upgrade blocked, review required" >&2
      exit 1
    fi
    echo "npm audit could not reach the registry (rc=$audit_rc) — non-fatal, continuing" >&2
  fi
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
runner_source_sha256="$(sha256sum /home/sprite/aisar/runner/server.mjs)"
runner_source_sha256="${runner_source_sha256%% *}"
[[ "$runner_source_sha256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "runner source digest is unavailable" >&2
  exit 1
}
{
  printf 'AISAR_BUSINESS_ID=%q\n' "$business_id"
  printf 'AISAR_RUNTIME_RELEASE=%q\n' "$runtime_release"
  printf 'AISAR_TOOL_MODE=%q\n' 'full-tools'
  printf 'AISAR_WEB_SEARCH_BACKEND=%q\n' 'ddgs'
  printf 'AISAR_MODEL_NAME=%q\n' "$model_name"
  printf 'AISAR_DEEP_MODEL_NAME=%q\n' "$deep_model_name"
  printf 'AISAR_RUNNER_SOURCE_SHA256=%q\n' "$runner_source_sha256"
  printf 'AISAR_RUNNER_KEY=%q\n' "$runner_key"
  if [[ -n "$edge_token" ]]; then
    printf 'AISAR_EDGE_TOKEN=%q\n' "$edge_token"
  fi
  printf 'HERMES_API_KEY=%q\n' "$hermes_key"
  printf 'API_SERVER_KEY=%q\n' "$hermes_key"
  printf 'HERMES_ORIGIN=%q\n' 'http://127.0.0.1:8642'
  printf 'PORT=%q\n' '8080'
  printf 'OPENROUTER_API_KEY=%q\n' "$model_key"
  # Hermes discards config.yaml's `model.base_url` whenever the provider is
  # `openrouter`: hermes_cli/runtime_provider.py sets use_config_base_url only
  # for `auto` and `custom`, so resolution falls through to the hardcoded
  # https://openrouter.ai/api/v1 and the router key gets a 401. The env var is
  # the one override that path honours, and it still selects
  # OPENROUTER_API_KEY. configure-model-provider.py below writes the same URL
  # into config.yaml, which stays useful as the declared value the operator
  # reads — but it is this line that decides where traffic goes.
  printf 'OPENROUTER_BASE_URL=%q\n' "$model_base"
} > "$runtime_tmp"
chmod 600 "$runtime_tmp"
mv "$runtime_tmp" "$runtime_env"
trap 'rm -f "$incoming"' EXIT

hermes_python="$install_dir/venv/bin/python"
"$hermes_python" /home/sprite/aisar/runner/configure-model-provider.py \
  "$model_provider" "$model_base" "$model_name" OPENROUTER_API_KEY "$cua_enabled"

# Readiness without one real inference only proves that processes started. It
# previously allowed an official OpenRouter key to be installed against FMCV,
# leaving the runtime green until the owner's first message failed. Prove the
# endpoint, credential, and both configured model aliases before checkpointing.
smoke_models=("$model_name")
if [[ "$deep_model_name" != "$model_name" ]]; then
  smoke_models+=("$deep_model_name")
fi
for smoke_model in "${smoke_models[@]}"; do
  model_ready=false
  for _attempt in 1 2 3; do
    if OPENROUTER_BASE_URL="$model_base" OPENROUTER_API_KEY="$model_key" \
        AISAR_MODEL_NAME="$smoke_model" \
        "$hermes_python" /home/sprite/aisar/runner/model-smoke.py; then
      model_ready=true
      break
    fi
    sleep 2
  done
  [[ "$model_ready" == "true" ]] || {
    echo "model inference did not pass its live smoke test" >&2
    exit 1
  }
done

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

# Optional capability: computer use. Gated by CUA_ENABLED_B64=1 in the
# operator handoff — the toolset is added to config.yaml only when requested
# and the runtime attests the capability only after every check below passes:
#
#   1. The X11 accessibility stack resolves (Xvfb, openbox, dbus, AT-SPI).
#   2. cua-driver is installed from the pinned release asset and its SHA-256
#      matches the digest recorded when this release was reviewed. A live
#      installer script is never fetched.
#   3. `hermes computer-use doctor` passes against the same display stack the
#      x11-display service will run. AISAR_CUA_ENABLED is written to
#      runtime.env only after this — fail-closed: a broken display or driver
#      can never be attested as ready.
if [[ "$cua_enabled" == "1" ]]; then
  # The sprite user is non-root; apt-get needs sudo (passwordless on sprites).
  DEBIAN_FRONTEND=noninteractive sudo apt-get update -qq
  DEBIAN_FRONTEND=noninteractive sudo apt-get install -y --no-install-recommends \
    xvfb openbox dbus at-spi2-core x11-utils xdotool \
    >/dev/null

  case "$(uname -m)" in
    x86_64|amd64)
      cua_arch=x86_64
      cua_driver_sha256="01bf8339ec129cc00f4b4b2c6056ef1a7c5b52df39ff83ad17c9b16818aec500"
      ;;
    aarch64|arm64)
      cua_arch=arm64
      cua_driver_sha256="be22768a207796a4bc1de50c52f32f9ef680b5e86e58c059e02eec2caba2e7bb"
      ;;
    *)
      echo "cua-driver has no reviewed Linux build for this architecture" >&2
      exit 1
      ;;
  esac
  cua_tarball="$(mktemp /tmp/aisar-cua-driver.XXXXXX.tar.gz)"
  trap 'rm -f "$incoming" "$cua_tarball"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.23.2/cua-driver-rs-0.23.2-linux-${cua_arch}-binary.tar.gz" \
    --output "$cua_tarball"
  actual_sha="$(sha256sum "$cua_tarball")"
  actual_sha="${actual_sha%% *}"
  if [[ "$actual_sha" != "$cua_driver_sha256" ]]; then
    echo "cua-driver checksum changed; release review required" >&2
    exit 1
  fi
  install -d -m 755 /home/sprite/.local/bin
  tar -xzf "$cua_tarball" -C /home/sprite/.local/bin
  chmod 755 /home/sprite/.local/bin/cua-driver
  /home/sprite/.local/bin/cua-driver --version >/dev/null
  rm -f "$cua_tarball"
  trap 'rm -f "$incoming"' EXIT

  cua_doctor_ready=false
  for _attempt in 1 2 3; do
    if timeout --foreground -k 5 120 \
        dbus-run-session -- xvfb-run -a \
        "$install_dir/venv/bin/hermes" computer-use doctor >/dev/null 2>&1; then
      cua_doctor_ready=true
      break
    fi
    sleep 2
  done
  [[ "$cua_doctor_ready" == "true" ]] || {
    echo "Hermes computer-use doctor did not pass its live smoke test" >&2
    exit 1
  }
  # Attest the capability only now that the display stack and driver have
  # been proven on this exact bootstrap run.
  printf 'AISAR_CUA_ENABLED=%q\n' '1' >> "$runtime_env"
fi

services=(aisar-runner hermes)
if [[ "$cua_enabled" == "1" ]]; then
  services+=(x11-display)
fi
for service in "${services[@]}"; do
  if sprite-env services get "$service" >/dev/null 2>&1; then
    sprite-env services stop "$service" >/dev/null 2>&1 || true
    sprite-env services delete "$service" >/dev/null
  fi
done
if [[ "$cua_enabled" == "1" ]]; then
  sprite-env services create x11-display \
    --cmd /home/sprite/aisar/runner/display-service.sh \
    --env AISAR_DISPLAY_ENV_FILE=/home/sprite/aisar/display.env \
    --no-stream
fi
hermes_needs=()
if [[ "$cua_enabled" == "1" ]]; then
  hermes_needs=(--needs x11-display)
fi
sprite-env services create hermes \
  --cmd /home/sprite/aisar/runner/hermes-service.sh \
  --env AISAR_RUNTIME_ENV_FILE=/home/sprite/aisar/runtime.env \
  --dir "$install_dir" \
  "${hermes_needs[@]}" \
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
