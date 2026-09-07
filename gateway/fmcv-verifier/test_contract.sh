#!/usr/bin/env bash
# Cross-implementation contract test: worker-side derivation (Node/WebCrypto,
# same algorithm as deriveFmcvRuntimeCredential) vs gateway-side verification
# (Python/HMAC). Proves a key issued by the worker is accepted by the verifier,
# and that tampered / wrong-secret keys are rejected.
#
# Usage: ./test_contract.sh
set -euo pipefail
cd "$(dirname "$0")"

SECRET="${JENTERA_FMCV_CONTROL_SECRET:-$(openssl rand -base64 48 | tr -d '\n')}"
RID="aisar-b-$(openssl rand -hex 10)"
PY="${PYTHON:-python3}"

echo "== derive (node, worker algorithm) =="
KEY=$(node derive_key.mjs "$SECRET" "$RID")
echo "key: ${KEY:0:24}... (${#KEY} chars)"

echo "== verify (python, gateway verifier) =="
"$PY" custom_auth.py --token "$KEY" --secret "$SECRET"

echo "== negative: wrong secret =="
if "$PY" custom_auth.py --token "$KEY" --secret "${SECRET}x"; then
  echo "FAIL: wrong secret accepted"; exit 1
fi
echo "ok (rejected)"

echo "== negative: tampered payload =="
P="${KEY#sk-jentera-v1.}"
PAYLOAD="${P%.*}"
SIG="${P##*.}"
if [ "${PAYLOAD:10:1}" = "a" ]; then FLIP="b"; else FLIP="a"; fi
FLIPPED="sk-jentera-v1.${PAYLOAD:0:10}${FLIP}${PAYLOAD:11}.${SIG}"
if "$PY" custom_auth.py --token "$FLIPPED" --secret "$SECRET" 2>/dev/null; then
  echo "FAIL: tampered payload accepted"; exit 1
fi
echo "ok (rejected)"

echo "ALL CONTRACT TESTS PASSED"
