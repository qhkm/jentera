#!/usr/bin/env python3
"""Configure Jentera's pinned HTTPS model provider without persisting its key."""

from __future__ import annotations

import re
import sys
from urllib.parse import urlparse

from hermes_cli.config import load_config, save_config
from hermes_cli.tools_config import _get_platform_tools
from toolsets import resolve_toolset


def main() -> None:
    if len(sys.argv) not in (5, 6):
        raise SystemExit(
            "usage: configure-model-provider.py PROVIDER BASE_URL MODEL KEY_ENV [CUA_ENABLED]"
        )
    provider, base_url, model_name, key_env = (value.strip() for value in sys.argv[1:5])
    cua_enabled = sys.argv[5].strip() if len(sys.argv) == 6 else ""
    if cua_enabled not in ("", "0", "1"):
        raise SystemExit("CUA_ENABLED must be 0 or 1")
    parsed = urlparse(base_url)
    if provider != "openrouter":
        raise SystemExit("only the reviewed OpenRouter provider is allowed")
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise SystemExit("model base URL must be https without credentials or query")
    if base_url.rstrip("/") not in ("https://openrouter.ai/api/v1", "https://router.fmcv.my"):
        raise SystemExit("model base URL is not pinned")
    if not re.fullmatch(r"[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._:~-]+)?", model_name):
        raise SystemExit("model id is invalid")
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

    # Hermes' auxiliary client (context compression, session titles, memory
    # flush, session search, vision, web extract, approval gating, skills hub,
    # MCP) resolves provider "openrouter" against the hardcoded OpenRouter
    # endpoint (hermes_constants.OPENROUTER_BASE_URL) — NOT config.yaml
    # model.base_url and NOT the OPENROUTER_BASE_URL env var the main chat
    # path honours. With a customer router (FMCV) every aux call therefore
    # 401s ("Invalid proxy server token") while the main model works, so
    # transcripts never compress and sessions never get titles. Pin each aux
    # task to the same reviewed router + key as the main model so the aux
    # client resolves against the pinned endpoint too. api_key uses the same
    # ${ENV_VAR} form as model.api_key above (expanded at config load,
    # never persisted as a literal).
    auxiliary = dict(config.get("auxiliary") or {})
    for task in (
        "compression",
        "title_generation",
        "session_search",
        "vision",
        "web_extract",
        "approval",
        "skills_hub",
        "mcp",
    ):
        task_cfg = dict(auxiliary.get(task) or {})
        task_cfg.update(
            {
                "provider": "custom",
                "base_url": base_url.rstrip("/"),
                "api_key": f"${{{key_env}}}",
                "model": model_name,
                "api_mode": "chat_completions",
            }
        )
        auxiliary[task] = task_cfg
    config["auxiliary"] = auxiliary

    # Keep DS4 Flash fixed while requiring an underlying OpenRouter endpoint
    # that supports every parameter Hermes sends, especially tool calling.
    # Latency-first routing made short text replies win over agent quality.
    provider_routing = dict(config.get("provider_routing") or {})
    provider_routing.pop("sort", None)
    provider_routing["order"] = ["morph"]
    provider_routing["allow_fallbacks"] = True
    provider_routing["require_parameters"] = True
    config["provider_routing"] = provider_routing

    # Production research must have a deterministic backend. DDGS is the
    # reviewed keyless search provider; bootstrap installs and exercises it
    # before the runtime is allowed to attest readiness.
    web = dict(config.get("web") or {})
    web["backend"] = "ddgs"
    web["search_backend"] = "ddgs"
    config["web"] = web

    # The public Sprite URL reaches Jentera's runner, never Hermes. Hermes' own
    # API remains loopback-only but receives the complete tool bundle from the
    # pinned release. Resolve and compare it during every bootstrap so a bad
    # configuration cannot silently expose a different capability surface.
    platform_toolsets = dict(config.get("platform_toolsets") or {})
    # The composite carries the complete API-server surface. Home Assistant is
    # normally default-off even though it belongs to that composite, so list it
    # explicitly as the pinned resolver's opt-in signal (its own credential
    # check still controls whether schemas register at runtime).
    platform_toolsets["api_server"] = ["hermes-api-server", "homeassistant"]
    # Computer use is an operator-granted capability (CUA_ENABLED=1 in the
    # bootstrap handoff). It is not part of the API-server composite, so it is
    # added explicitly when granted. Production always pins `bounded`
    # permissions — the POC's `unrestricted` value is dev-only — and disables
    # cua-driver telemetry. Destructive key combinations are hard-blocked by
    # the pinned Hermes release regardless of this value.
    if cua_enabled == "1":
        platform_toolsets["api_server"].append("computer_use")
        config["computer_use"] = {
            "cua_telemetry": False,
            "permissions": "bounded",
        }
    config["platform_toolsets"] = platform_toolsets

    agent = dict(config.get("agent") or {})
    reasoning_overrides = dict(agent.get("reasoning_overrides") or {})
    reasoning_overrides[model_name] = "high"
    agent["reasoning_overrides"] = reasoning_overrides
    agent.update({"max_turns": 20, "run_budget_seconds": 900, "gateway_timeout": 900})
    config["agent"] = agent

    gateway = dict(config.get("gateway") or {})
    api_server = dict(gateway.get("api_server") or {})
    api_server["max_concurrent_runs"] = 1
    gateway["api_server"] = api_server
    config["gateway"] = gateway

    # Approval surface (execute_code consent relayed over Telegram):
    # the worker keeps the Approve/Deny bubble alive for
    # HERMES_APPROVAL_WAIT_SECONDS (60 s), so the gate must outlive that
    # window or Hermes auto-denies before the owner can tap. Override the
    # stock default (20 s) on every provision.
    approvals = dict(config.get("approvals") or {})
    approvals["timeout"] = 90
    config["approvals"] = approvals

    expected_tools = set(resolve_toolset("hermes-api-server"))
    if cua_enabled == "1":
        expected_tools |= set(resolve_toolset("computer_use"))
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
