#!/usr/bin/env bash
# fleet-verify.sh — what "healthy on release X" means, checked on every sprite.
#
# One line per sprite; exit 0 only when every sprite passes all of:
#   - runtime.env carries AISAR_RUNTIME_RELEASE=<release>
#   - the runner's /readyz reports that same release (so the process that is
#     actually serving was started from it, not just the file on disk)
#   - patch-hermes-dependencies.mjs --verify passes on the live Hermes tree
#   - sprite-services shows hermes and aisar-runner running
#
# ship-runtime.sh runs this after convergence. Run it alone after any manual
# intervention, or to answer "is the fleet what we think it is" at any time.
#
# Usage: fleet-verify.sh <release> [fleet-exec options, e.g. -p 6 --only a,b]
set -uo pipefail

REL="${1:?usage: fleet-verify.sh <release> [fleet-exec options]}"
shift

read -r -d '' SNIPPET <<'EOS' || true
set -u
WANT="__RELEASE__"
E=/home/sprite/aisar/runtime.env
R=/home/sprite/aisar/runner.env
H=/home/sprite/.hermes/hermes-agent
rel=$(awk -F= '/^AISAR_RUNTIME_RELEASE=/{print $2}' "$E" 2>/dev/null)
key=$(awk -F= '/^AISAR_RUNNER_KEY=/{print $2}' "$R" 2>/dev/null)
ready=$(curl -s -m 10 -H "X-Aisar-Runner-Key: $key" http://127.0.0.1:8080/readyz 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('release','?'))" 2>/dev/null \
  || echo unreachable)
/.sprite/bin/node /home/sprite/aisar/runner/patch-hermes-dependencies.mjs "$H" --verify >/dev/null 2>&1
pv=$?
svc=$(sprite-services list 2>/dev/null \
  | python3 -c "import json,sys; print(','.join(s['name']+'='+s['state']['status'] for s in json.load(sys.stdin) if s['name'] in ('hermes','aisar-runner')))" 2>/dev/null \
  || echo "services=?")
ok=1
[ "$rel" = "$WANT" ] || ok=0
[ "$ready" = "$WANT" ] || ok=0
[ "$pv" = 0 ] || ok=0
case ",$svc," in *,hermes=running,*) ;; *) ok=0 ;; esac
case ",$svc," in *,aisar-runner=running,*) ;; *) ok=0 ;; esac
echo "release=$rel readyz=$ready patch_verify=$pv $svc ok=$ok"
[ "$ok" = 1 ]
EOS

exec "$(dirname "$0")/fleet-exec.sh" "$@" "${SNIPPET//__RELEASE__/$REL}"
