#!/usr/bin/env python3
"""Prove the configured model endpoint, credential, and model alias together."""

from __future__ import annotations

import json
import os
import sys
import time
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


def smoke_local() -> None:
    """Prove quick+deep routing through the staged Hermes API server.

    Starts a /v1/runs run per configured model id and polls
    /v1/runs/{run_id} until completion. The completed status echoes the
    requested model id (api_server.py _set_run_status) and — for the deep
    model — must carry non-empty "reasoning" (the B1a reasoning patch
    proof), which provider-direct smokes can never observe.
    """
    api_key = os.environ.get("API_SERVER_KEY", "").strip()
    if not api_key:
        raise SystemExit("model smoke requires API_SERVER_KEY for --local")
    model = os.environ.get("AISAR_MODEL_NAME", "").strip()
    if not model:
        raise SystemExit("model smoke requires AISAR_MODEL_NAME for --local")
    port = os.environ.get("API_SERVER_PORT", "8642").strip() or "8642"
    base_url = f"http://127.0.0.1:{port}"

    deep_model = os.environ.get("AISAR_DEEP_MODEL_NAME", "").strip()
    model_ids = [model]
    if deep_model and deep_model != model:
        model_ids.append(deep_model)

    runs = len(model_ids)
    for model_id in model_ids:
        # The deep id is only ever appended when it differs from the quick id.
        deep_requested = model_id != model
        run_id = _start_run(base_url, api_key, model_id)
        _poll_run(base_url, api_key, run_id, model_id, deep_requested=deep_requested)
        print(json.dumps({"ok": True, "model": model_id, "runs": runs}, separators=(",", ":")))


def _start_run(base_url: str, api_key: str, model_id: str) -> str:
    payload = json.dumps({"input": "Reply with OK.", "model": model_id}).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/v1/runs",
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

    if status != 202 or len(body) > 64 * 1024:
        raise SystemExit("model smoke returned an invalid response")
    try:
        decoded = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SystemExit("model smoke returned invalid JSON") from None
    run_id = decoded.get("run_id") if isinstance(decoded, dict) else None
    if not run_id or not isinstance(run_id, str):
        raise SystemExit("model smoke start run returned no run_id")
    return run_id


def _poll_run(base_url: str, api_key: str, run_id: str, requested: str,
              deep_requested: bool) -> dict:
    request = urllib.request.Request(
        f"{base_url}/v1/runs/{run_id}",
        method="GET",
        headers={
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Jentera-Runtime-Smoke/1",
        },
    )
    deadline = time.monotonic() + 305
    while True:
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
        if not isinstance(decoded, dict):
            raise SystemExit("model smoke returned no run status")
        status = decoded

        run_status = status.get("status")
        if run_status in ("failed", "error", "stopped"):
            raise SystemExit(f"model smoke run {run_id} ended {run_status}")
        if run_status == "completed":
            if status.get("model") != requested:
                raise SystemExit(
                    f"model smoke routing failed ({requested}): run status echoes {status.get('model')!r}"
                )
            if deep_requested and not status.get("reasoning"):
                raise SystemExit(
                    f"model smoke deep routing failed ({requested}): completed run carried no reasoning"
                )
            return status
        if time.monotonic() >= deadline:
            raise SystemExit(f"model smoke run {run_id} timed out")
        time.sleep(1)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--local":
        smoke_local()
    else:
        main()
