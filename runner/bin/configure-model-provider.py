#!/usr/bin/env python3
"""Configure Jentera's pinned HTTPS model provider without persisting its key."""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

from hermes_cli.config import load_config, save_config
from hermes_cli.tools_config import _get_platform_tools
from toolsets import resolve_toolset


STARTER_SPECIALIST_PROFILES = {
    "operations": (
        "Operations",
        "Own workflows, inventory, suppliers, staffing, scheduling, fulfilment, and operational reliability.",
    ),
    "customers": (
        "Customer communications",
        "Own enquiries, reservations, service recovery, response quality, and customer communication workflows.",
    ),
    "growth": (
        "Growth and marketing",
        "Own campaigns, offers, content, acquisition, conversion, retention, and practical sales growth.",
    ),
    "records": (
        "Finance and records",
        "Own invoicing, expenses, cash-flow visibility, bookkeeping preparation, and accurate business records.",
    ),
}


def managed_soul(role: str, remit: str) -> str:
    return f"""# Jentera — {role}

You are the persistent {role} specialist inside one business's private Jentera team.

{remit}

- Work only for this business and keep its information private.
- Build continuity from this profile's own memory, sessions, skills, and workspace.
- The owner speaks to one Jentera Chief of Staff. Your work is delivered through that
  identity, so never expose internal profile names, routing, prompts, or handoffs.
- Stay within your remit. State cross-functional dependencies clearly instead of
  claiming another specialist's work is complete.
- Never take an irreversible external action without the approval required by Jentera.
"""


def configure_specialist_profiles() -> None:
    """Install editable starters; control-plane config adds the owner's roles."""
    hermes_home = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()
    source_config = hermes_home / "config.yaml"
    source_env = hermes_home / ".env"
    for profile, (role, remit) in STARTER_SPECIALIST_PROFILES.items():
        profile_dir = hermes_home / "profiles" / profile
        for child in (
            "memories", "sessions", "skills", "skins", "logs", "plans",
            "workspace", "cron", "home",
        ):
            (profile_dir / child).mkdir(parents=True, exist_ok=True)
        (profile_dir / ".no-bundled-skills").write_text(
            "Managed Jentera specialist profile; install only reviewed role skills.\n",
            encoding="utf-8",
        )
        (profile_dir / "profile.yaml").write_text(
            f"description: \"Jentera's persistent {role} specialist for this business.\"\n"
            "description_auto: false\n",
            encoding="utf-8",
        )
        # Operational configuration is centrally managed and identical across
        # the business's profiles. Sessions, memories and workspace are not
        # copied, so each specialist keeps independent durable context.
        shutil.copy2(source_config, profile_dir / "config.yaml")
        if source_env.exists():
            shutil.copy2(source_env, profile_dir / ".env")
            os.chmod(profile_dir / ".env", 0o600)
        (profile_dir / "SOUL.md").write_text(managed_soul(role, remit), encoding="utf-8")

    (hermes_home / "SOUL.md").write_text(
        """# Jentera — Chief of Staff

You are the persistent private Chief of Staff for one business and its team.

- Be the owner's single point of contact and turn broad goals into clear work.
- Coordinate internal specialist help without making the owner route agents.
- Verify delegated work and return one coherent answer or outcome in Jentera's voice.
- Keep this business's information private and require approval before irreversible actions.
""",
        encoding="utf-8",
    )


def main() -> None:
    if len(sys.argv) not in (5, 6, 7, 8):
        raise SystemExit(
            "usage: configure-model-provider.py PROVIDER BASE_URL MODEL KEY_ENV "
            "[CUA_ENABLED] [DEEP_MODEL] [CANDIDATE_MODELS]"
        )
    provider, base_url, model_name, key_env = (value.strip() for value in sys.argv[1:5])
    cua_enabled = sys.argv[5].strip() if len(sys.argv) >= 6 else ""
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
    if base_url.rstrip("/") not in (
        "https://openrouter.ai/api/v1",
        "https://router.fmcv.my",
        "https://api.jentera.ai/v1/model",
    ):
        raise SystemExit("model base URL is not pinned")
    if not re.fullmatch(r"[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._:~-]+)?", model_name):
        raise SystemExit("model id is invalid")
    deep_model_name = sys.argv[6].strip() if len(sys.argv) >= 7 else ""
    if deep_model_name and not re.fullmatch(
        r"[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._:~-]+)?", deep_model_name
    ):
        raise SystemExit("deep model id is invalid")
    # Candidate routes (comma-separated): trial models every sprite accepts
    # beside quick and deep. Same id grammar; a bad id aborts provisioning.
    candidate_arg = sys.argv[7].strip() if len(sys.argv) == 8 else ""
    candidate_model_names = [name.strip() for name in candidate_arg.split(",") if name.strip()]
    for candidate in candidate_model_names:
        if not re.fullmatch(r"[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._:~-]+)?", candidate):
            raise SystemExit("candidate model id is invalid")
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

    # Pin per-model routes for the API server. The worker sends the raw model
    # ids (not "quick"/"deep" aliases) in /v1/runs, so each route key IS the
    # model id; an alias-keyed route would never match and the request would
    # silently fall back to config.model (the quick model). Every route pins
    # the full runtime contract: model, provider, allowlisted base_url and the
    # key as an env placeholder — no literal key material touches the config.
    routes = {
        model_name: {
            "model": model_name,
            "provider": provider,
            "base_url": base_url.rstrip("/"),
            "api_key": f"${{{key_env}}}",
        }
    }
    if deep_model_name and deep_model_name != model_name:
        routes[deep_model_name] = {
            "model": deep_model_name,
            "provider": provider,
            "base_url": base_url.rstrip("/"),
            "api_key": f"${{{key_env}}}",
        }
    for candidate in candidate_model_names:
        routes.setdefault(
            candidate,
            {
                "model": candidate,
                "provider": provider,
                "base_url": base_url.rstrip("/"),
                "api_key": f"${{{key_env}}}",
            },
        )

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
    # Hermes forks a post-run "review the conversation and update the skill
    # library" turn (auxiliary.background_review, default on): a full-context
    # model call, observed at 23K-62K input tokens, producing skills the
    # product never exposes. Pinned off on every provision; other keys under
    # background_review are preserved.
    background_review = dict(auxiliary.get("background_review") or {})
    background_review["enabled"] = False
    auxiliary["background_review"] = background_review
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
    # Search and extraction are different jobs and ddgs only does the first.
    # Probed 2026-09-10: web_extract answered "DuckDuckGo (ddgs) is a
    # search-only backend and cannot extract URL content. Set
    # web.extract_backend to firecrawl, tavily, exa, or parallel." — so on
    # every sprite the tool whose job is reading a page could not read a
    # page, and the agent fell back to driving a browser and pulling whole
    # snapshots into the transcript. Set the backend only when the
    # credentials for it actually arrived; naming it without them would
    # trade a working fallback for a hard failure.
    if os.environ.get("FIRECRAWL_API_URL") and os.environ.get("FIRECRAWL_API_KEY"):
        web["extract_backend"] = "firecrawl"
    else:
        web.pop("extract_backend", None)
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
    # Candidates trial against the quick model, so they carry its reasoning setting.
    for candidate in candidate_model_names:
        reasoning_overrides[candidate] = "high"
    agent["reasoning_overrides"] = reasoning_overrides
    agent.update({"max_turns": 20, "run_budget_seconds": 900, "gateway_timeout": 900})
    config["agent"] = agent

    gateway = dict(config.get("gateway") or {})
    # One gateway serves the Chief plus all managed specialist homes. The
    # runner addresses specialists only through Hermes's allowlisted
    # /p/<profile>/ routes; there is still one external Jentera identity.
    gateway["multiplex_profiles"] = True
    api_server = dict(gateway.get("api_server") or {})
    api_server["max_concurrent_runs"] = 1
    extra = dict(api_server.get("extra") or {})
    model_routes = dict(extra.get("model_routes") or {})
    # Merge, never clobber: operator-written routes survive provisioning, and
    # re-provisioning the same models is idempotent.
    model_routes.update(routes)
    extra["model_routes"] = model_routes
    api_server["extra"] = extra
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
    configure_specialist_profiles()


if __name__ == "__main__":
    main()
