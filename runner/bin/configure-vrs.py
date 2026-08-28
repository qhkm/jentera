#!/usr/bin/env python3
"""Configure one authenticated OpenAI-compatible VRS endpoint without inlining its key."""

from __future__ import annotations

import re
import sys
from urllib.parse import urlparse

from hermes_cli.config import load_config, save_config


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: configure-vrs.py BASE_URL MODEL KEY_ENV")
    base_url, model_name, key_env = (value.strip() for value in sys.argv[1:])
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("VRS base URL must be an absolute HTTP(S) URL")
    if not model_name or len(model_name) > 200:
        raise SystemExit("VRS model is invalid")
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,127}", key_env):
        raise SystemExit("VRS key environment name is invalid")

    config = load_config()
    current_model = config.get("model")
    model = dict(current_model) if isinstance(current_model, dict) else {}
    model.update(
        {
            "default": model_name,
            "provider": "custom",
            "base_url": base_url.rstrip("/"),
            "api_key": f"${{{key_env}}}",
            "api_mode": "chat_completions",
        }
    )
    config["model"] = model

    providers = config.get("custom_providers")
    providers = list(providers) if isinstance(providers, list) else []
    entry = {
        "name": "Jentera VRS",
        "base_url": base_url.rstrip("/"),
        "key_env": key_env,
        "model": model_name,
        "api_mode": "chat_completions",
    }
    replaced = False
    for index, provider in enumerate(providers):
        if isinstance(provider, dict) and provider.get("base_url", "").rstrip("/") == entry["base_url"]:
            providers[index] = entry
            replaced = True
            break
    if not replaced:
        providers.append(entry)
    config["custom_providers"] = providers
    save_config(config)


if __name__ == "__main__":
    main()
