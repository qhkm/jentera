#!/usr/bin/env python3
"""Configure AISAR's pinned HTTPS model provider without persisting its key."""

from __future__ import annotations

import re
import sys
from urllib.parse import urlparse

from hermes_cli.config import load_config, save_config
from hermes_cli.tools_config import _get_platform_tools
from toolsets import resolve_toolset


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

    # The public Sprite URL reaches AISAR's runner, never Hermes. Hermes' own
    # API remains loopback-only but receives the complete tool bundle from the
    # pinned release. Resolve and compare it during every bootstrap so a bad
    # configuration cannot silently expose a different capability surface.
    platform_toolsets = dict(config.get("platform_toolsets") or {})
    # The composite carries the complete API-server surface. Home Assistant is
    # normally default-off even though it belongs to that composite, so list it
    # explicitly as the pinned resolver's opt-in signal (its own credential
    # check still controls whether schemas register at runtime).
    platform_toolsets["api_server"] = ["hermes-api-server", "homeassistant"]
    config["platform_toolsets"] = platform_toolsets

    agent = dict(config.get("agent") or {})
    agent.update({"max_turns": 20, "run_budget_seconds": 900, "gateway_timeout": 900})
    config["agent"] = agent

    gateway = dict(config.get("gateway") or {})
    api_server = dict(gateway.get("api_server") or {})
    api_server["max_concurrent_runs"] = 1
    gateway["api_server"] = api_server
    config["gateway"] = gateway

    expected_tools = set(resolve_toolset("hermes-api-server"))
    resolved_toolsets = set(_get_platform_tools(config, "api_server"))
    resolved_tools = {
        tool
        for toolset in resolved_toolsets
        for tool in resolve_toolset(toolset)
    }
    if not expected_tools or not expected_tools.issubset(resolved_tools):
        raise SystemExit("Hermes API server did not resolve the pinned full toolset")
    save_config(config)


if __name__ == "__main__":
    main()
