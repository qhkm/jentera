"""LiteLLM CustomAuthHandler for Jentera FMCV virtual keys (B3).

Accepts `sk-jentera-v1.<payload>.<signature>` bearer tokens derived by the
aisar worker's `deriveFmcvRuntimeCredential` (worker/src/runtime/openrouter-keys.ts).
The signature is HMAC-SHA256 over `"jentera-fmcv-runtime-key:v1:" + payload`
with the shared control secret. Payload claims:

    {"v":1, "rid":"aisar-b-<40hex>", "limitUsd":5, "limitReset":"monthly"}

The handler is stateless: it needs only the control secret (env
JENTERA_FMCV_CONTROL_SECRET, which MUST equal the worker's AISAR_MODEL_KEY).
Non-`sk-jentera-v1` tokens fall through to LiteLLM's default auth so the
master key / admin virtual keys keep working.

Deploy (see README.md):
  1. copy this file next to the LiteLLM config (e.g. /etc/litellm/custom_auth.py)
  2. export JENTERA_FMCV_CONTROL_SECRET=<worker AISAR_MODEL_KEY value>
  3. in config.yaml:  litellm_settings: { custom_auth: custom_auth.user_api_key_auth }
  4. restart the LiteLLM proxy, run the live synthetic test in README.md
"""

import base64
import hashlib
import hmac
import json
import os
import re

# Keep in sync with FMCV_DERIVATION_CONTEXT in the worker.
DERIVATION_CONTEXT = "jentera-fmcv-runtime-key:v1"
TOKEN_RE = re.compile(r"^sk-jentera-v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$")  # payload.sig
RID_RE = re.compile(r"^aisar-b-[0-9a-f]{20}$")
# Budget mapping: worker claim limitReset:"monthly" -> LiteLLM budget_duration.
BUDGET_DURATION = os.environ.get("JENTERA_FMCV_BUDGET_DURATION", "1mo")


class JenteraKeyError(Exception):
    """Raised for any invalid/expired/unknown jentera key (maps to 401)."""


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def verify_jentera_key(token: str, secret: str) -> dict:
    """Verify a derived key and return its claims, or raise JenteraKeyError."""
    if len(secret) < 32:
        raise JenteraKeyError("gateway control secret not configured (len<32)")
    m = TOKEN_RE.match(token)
    if not m:
        raise JenteraKeyError("malformed jentera key")
    payload, signature = token.split(".")[1], token.split(".")[2]
    try:
        sig = _b64url_decode(signature)
        claims = json.loads(_b64url_decode(payload))
    except Exception as exc:  # noqa: BLE001 - any decode error => 401
        raise JenteraKeyError("undecodable jentera key") from exc
    if len(sig) != 32:
        raise JenteraKeyError("bad jentera signature length")
    expected = hmac.new(
        secret.encode(), f"{DERIVATION_CONTEXT}:{payload}".encode(), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(expected, sig):
        raise JenteraKeyError("jentera signature mismatch")
    if claims.get("v") != 1 or not isinstance(claims.get("rid"), str):
        raise JenteraKeyError("unsupported jentera claims version")
    if not RID_RE.match(claims["rid"]):
        raise JenteraKeyError("invalid jentera runtime id")
    if claims.get("limitUsd") != 5 or claims.get("limitReset") != "monthly":
        raise JenteraKeyError("unsupported jentera limit claims")
    return claims


def _make_auth(claims: dict):
    from litellm.proxy.auth.user_api_key_auth import UserAPIKeyAuth

    return UserAPIKeyAuth(
        user_id=claims["rid"],
        team_id="jentera-fmcv",
        max_budget=float(claims["limitUsd"]),
        budget_duration=BUDGET_DURATION,
        metadata={"issuer": "jentera-b3", "rid": claims["rid"]},
    )


async def user_api_key_auth(request, call_type, **kwargs):  # noqa: ANN001
    """LiteLLM custom_auth entrypoint (see README.md for wiring)."""
    try:
        from litellm.proxy.auth.user_api_key_auth import (
            user_api_key_auth as default_auth,
        )
    except ImportError:  # pragma: no cover - version drift guard
        from litellm.proxy.proxy_server import user_api_key_auth as default_auth

    authz = request.headers.get("authorization", "") if hasattr(request, "headers") else ""
    if not authz.lower().startswith("bearer "):
        return await default_auth(request, call_type, **kwargs)
    token = authz[7:].strip()
    if not token.startswith("sk-jentera-v1."):
        # Not a derived key: let LiteLLM's normal key checks (master key,
        # virtual keys) decide.
        return await default_auth(request, call_type, **kwargs)
    secret = os.environ.get("JENTERA_FMCV_CONTROL_SECRET", "")
    try:
        claims = verify_jentera_key(token, secret)
    except JenteraKeyError:
        from litellm.proxy.auth.auth_checks import raise_unauthorized_exception

        raise_unauthorized_exception("invalid jentera virtual credential")
    return _make_auth(claims)


if __name__ == "__main__":
    # CLI self-test / cross-implementation check:
    #   python3 custom_auth.py --token sk-jentera-v1... --secret <sec>
    import argparse
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument("--token", required=True)
    ap.add_argument("--secret", required=True)
    args = ap.parse_args()
    try:
        claims = verify_jentera_key(args.token, args.secret)
    except JenteraKeyError as exc:
        print(f"FAIL: {exc}")
        sys.exit(1)
    print(f"OK: rid={claims['rid']} limitUsd={claims['limitUsd']} {claims['limitReset']}")
