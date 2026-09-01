#!/usr/bin/env python3
"""Prove the configured model endpoint, credential, and model alias together."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> None:
    base_url = os.environ.get("OPENROUTER_BASE_URL", "").strip().rstrip("/")
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    model = os.environ.get("AISAR_MODEL_NAME", "").strip()
    if base_url not in ("https://openrouter.ai/api/v1", "https://router.fmcv.my"):
        raise SystemExit("model smoke endpoint is not pinned")
    if len(api_key) < 20 or not model:
        raise SystemExit("model smoke configuration is incomplete")

    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "max_tokens": 1,
            "temperature": 0,
            "stream": False,
            "reasoning": {"enabled": False},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Jentera-Runtime-Smoke/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read(64 * 1024 + 1)
            status = response.status
    except urllib.error.HTTPError as error:
        raise SystemExit(f"model smoke failed (HTTP {error.code})") from None
    except (TimeoutError, urllib.error.URLError) as error:
        reason = type(getattr(error, "reason", error)).__name__
        raise SystemExit(f"model smoke transport failed ({reason})") from None

    if status != 200 or len(body) > 64 * 1024:
        raise SystemExit("model smoke returned an invalid response")
    try:
        decoded = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SystemExit("model smoke returned invalid JSON") from None
    if not isinstance(decoded, dict) or not isinstance(decoded.get("choices"), list) \
            or not decoded["choices"]:
        raise SystemExit("model smoke returned no completion")
    print(json.dumps({"ok": True, "model": model}, separators=(",", ":")))


if __name__ == "__main__":
    main()
