"""Jentera: reorder OpenAI chat.completions wire bodies for byte-order-sensitive routers.

Why
---
router.fmcv.my (OpenRouter-style aggregator) serves multiple backends. One of them
(MiniMax-M3) keys its Kuafu-style KV cache on the **raw byte prefix** of the
incoming request body, not on a semantically parsed prompt. The OpenAI Python SDK
serializes chat.completions bodies in its own canonical field order (messages,
model, stream, stream_options, tools, ...). With `messages` first, the per-turn
user message sits at the very front of the body, so every new user turn changes
the first bytes and the shared ~22K-token prefix (system prompt + tools) can
never be cache-reused: cached_tokens ≈ 0–6% on consecutive turns.

The validated fix (probe on aisar-poc-cu, 2026-09-03) is to re-serialize the
body so the *stable* fields come first and `messages` (whose tail changes every
turn) comes **last**. DeepSeek lands at ~99.6% cached either way; MiniMax goes
from ~5.8% to ~99.9%. Order-neutral, semantic-neutral for every backend — this
only reorders JSON object keys, never values.

Where we hook
-------------
Both the primary client (run_agent._build_keepalive_http_client via
agent_runtime_helpers.create_openai_client) and every auxiliary client
(agent/auxiliary_client.py -> agent.process_bootstrap.build_keepalive_http_client)
construct the OpenAI SDK client with an injected httpx.Client. The OpenAI SDK
(2.x) requires `http_client` to pass `isinstance(client, httpx.Client)` / 
`httpx.AsyncClient`, so we patch the client **in place**: `send()` (and the
async variant) is replaced with a version that reorders the request body before
handing it to the original method. The object remains the same httpx client, so
the isinstance gate passes and all other state (mounts, pools, close semantics)
is untouched. Every OpenAI SDK request (main loop, compression, vision,
web_extract, title generation, ...) is covered at one chokepoint, regardless of
which transport/profile code path built the kwargs.

Safety
------
- Only POST bodies whose path ends in /chat/completions are touched.
- Re-serialization uses httpx's exact JSON encoder settings
  (json.dumps(ensure_ascii=False, separators=(",", ":"), allow_nan=False)),
  so output bytes are identical to what httpx would have produced except for
  key order — no whitespace/unicode drift that could itself break prefix cache.
- Unknown/malformed bodies pass through untouched.
- The patch degrades to the original send() on ANY exception; it can never
  fail a request that would otherwise have succeeded.
- Re-applying the patch (idempotent rollout) is a no-op via a marker attribute.
"""

from __future__ import annotations

import json
from typing import Any, Optional, Tuple

# Jentera: reviewed wire-order stabilization for fmcv router prefix caches.
PATCH_ID = "jentera-wire-order-2026-09-03"

# Marker used to make wrap_http_client idempotent on a patched client.
_MARKER = "_jentera_wire_order_patched"

# Field order for the re-serialized chat.completions body:
# 1. tool_choice/tools (largest stable block — system prompt + tools)
# 2. every other stable field (model, stream, stream_options, extra body…)
# 3. messages LAST — the only block whose tail (user msg) changes per turn
_LEAD_KEYS = ("tool_choice", "tools", "parallel_tool_calls", "functions")
_TAIL_KEY = "messages"


def _reorder_body(body: bytes) -> Tuple[bytes, Optional[bytes]]:
    """Return (maybe_reordered, original) — or (original, None) on any doubt.

    On success `original` is the untouched input so callers can compare and
    return the reordered bytes only when they differ (cheap fast-path).
    """
    try:
        payload = json.loads(body)
    except Exception:
        return body, None
    if not isinstance(payload, dict):
        return body, None
    if _TAIL_KEY not in payload:
        return body, None

    # Fast path: messages already last — leave the bytes exactly as-is.
    keys = list(payload.keys())
    if keys and keys[-1] == _TAIL_KEY:
        return body, None

    ordered: dict[str, Any] = {}
    for k in _LEAD_KEYS:
        if k in payload and k not in ordered:
            ordered[k] = payload[k]
    for k in payload:
        if k not in ordered and k != _TAIL_KEY:
            ordered[k] = payload[k]
    ordered[_TAIL_KEY] = payload[_TAIL_KEY]

    reordered = json.dumps(
        ordered,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    if reordered == body:
        return body, None
    return reordered, body


def _reorder_request(request: Any) -> Any:
    """Return a request with the chat.completions body reordered (same obj if no-op)."""
    try:
        if request.method != "POST":
            return request
        path = str(getattr(request, "url", "") or "")
        if not path.endswith("/chat/completions"):
            return request
        content = getattr(request, "content", None)
        if content is None:
            return request
        body = content if isinstance(content, bytes) else bytes(content)
        reordered, original = _reorder_body(body)
        if reordered is original:
            return request
        # Preserve every header/extension EXCEPT Content-Length: the original
        # request may already carry a length for the pre-reorder body, and
        # sending a reordered body of a different size under the stale header
        # would truncate or over-read the request. httpx recomputes the header
        # from the new content on send.
        headers = dict(request.headers)
        headers.pop("content-length", None)
        headers.pop("Content-Length", None)

        import httpx

        return httpx.Request(
            method=request.method,
            url=str(request.url),
            headers=headers,
            content=reordered,
            extensions=dict(getattr(request, "extensions", {}) or {}),
        )
    except Exception:
        return request


def _make_reorder_send(original_send: Any, is_async: bool) -> Any:
    """Build a send() replacement that reorders chat.completions bodies."""
    if is_async:

        async def send(request: Any, *args: Any, **kwargs: Any) -> Any:
            return await original_send(_reorder_request(request), *args, **kwargs)

    else:

        def send(request: Any, *args: Any, **kwargs: Any) -> Any:
            return original_send(_reorder_request(request), *args, **kwargs)

    return send


def wrap_http_client(client: Any, *, async_mode: bool = False) -> Any:
    """Patch an httpx client so chat.completions bodies hit the wire tools-first.

    The client is modified in place: its `send` method is replaced with a
    reordering version, and the SAME client object is returned so OpenAI SDK
    2.x isinstance checks (`http_client` must be httpx.Client/AsyncClient)
    still pass. Returns the input unchanged on any doubt (never breaks clients
    that were built without keepalive bootstrap, e.g. stale-install fallbacks).
    """
    if client is None:
        return client
    try:
        if getattr(client, _MARKER, False):
            return client  # idempotent: already patched
        import httpx

        if async_mode:
            if not isinstance(client, httpx.AsyncClient):
                return client
        else:
            if not isinstance(client, httpx.Client):
                return client
        original_send = client.send
        client.send = _make_reorder_send(original_send, is_async=async_mode)
        setattr(client, _MARKER, True)
    except Exception:
        pass
    return client
