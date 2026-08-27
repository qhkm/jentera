#!/usr/bin/env python3
"""Configure AISAR's pinned HTTPS model provider without persisting its key."""

from __future__ import annotations

import re
import sys
from urllib.parse import urlparse

from hermes_cli.config import load_config, save_config


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit("usage: configure-model-provider.py PROVIDER BASE_URL MODEL KEY_ENV")
    provider, base_url, model_name, key_env = (value.strip() for value in sys.argv[1:])
    parsed = urlparse(base_url)
    if provider != "openrouter":
        raise SystemExit("only the reviewed OpenRouter provider is allowed")
    if (
        parsed.scheme != "https"
        or parsed.hostname != "openrouter.ai"
        or parsed.username
        or parsed.password
        or parsed.path.rstrip("/") != "/api/v1"
        or parsed.query
        or parsed.fragment
    ):
        raise SystemExit("OpenRouter base URL must be exactly https://openrouter.ai/api/v1")
    if not re.fullmatch(r"[A-Za-z0-9._~-]+/[A-Za-z0-9._:~-]+", model_name):
        raise SystemExit("OpenRouter model id is invalid")
    if key_env != "OPENROUTER_API_KEY":
        raise SystemExit("OpenRouter key must use OPENROUTER_API_KEY")

    config = load_config()
    current_model = config.get("model")
    model = dict(current_model) if isinstance(current_model, dict) else {}
    model.update(
        {
            "default": model_name,
            "provider": provider,
            "base_url": base_url.rstrip("/"),
            "api_key": f"${{{key_env}}}",
            "api_mode": "chat_completions",
        }
    )
    config["model"] = model
    save_config(config)


if __name__ == "__main__":
    main()
