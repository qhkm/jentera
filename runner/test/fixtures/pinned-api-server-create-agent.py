    def _create_agent(
        self,
        ephemeral_system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        stream_delta_callback=None,
        tool_progress_callback=None,
        tool_start_callback=None,
        tool_complete_callback=None,
        gateway_session_key: Optional[str] = None,
        route: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """
        Create an AIAgent instance using the gateway's runtime config.

        Uses _resolve_runtime_agent_kwargs() to pick up model, api_key,
        base_url, etc. from config.yaml / env vars.  Toolsets are resolved
        from config.yaml platform_toolsets.api_server (same as all other
        gateway platforms), falling back to the hermes-api-server default.

        ``gateway_session_key`` is a stable per-channel identifier supplied
        by the client (via ``X-Hermes-Session-Key``).  Unlike ``session_id``
        which scopes the short-term transcript and rotates on /new, this
        key is meant to persist across transcripts so long-term memory
        providers (e.g. Honcho) can scope their per-chat state correctly
        — matching the semantics of the native gateway's ``session_key``.

        ``route`` is an optional ``model_routes`` entry (per-client model
        routing).  When set — and no session ``/model`` override exists for
        this session — its model/provider/api_key/base_url override the
        global defaults for this agent instance only.
        """
        from run_agent import AIAgent
        from gateway.run import (
            _checkpoint_agent_kwargs,
            _current_max_iterations,
            _resolve_runtime_agent_kwargs,
            _resolve_gateway_model,
            _load_gateway_config,
            GatewayRunner,
        )
        from hermes_cli.tools_config import _get_platform_tools

        runtime_kwargs = _resolve_runtime_agent_kwargs()
        reasoning_config = GatewayRunner._load_reasoning_config()
        model = _resolve_gateway_model()

        # When the primary provider's auth fails (expired token / 429 quota
        # cap), _resolve_runtime_agent_kwargs() falls through to the fallback
        # provider chain, whose runtime dict carries its own ``model`` key.
        # Pop it and let it override the config model, mirroring the native
        # gateway path (_resolve_session_agent_runtime in run.py). Otherwise
        # the explicit ``model=model`` below collides with the ``**runtime_kwargs``
        # spread → "got multiple values for keyword argument 'model'", 500ing
        # every /v1/chat/completions request while a fallback is active.
        runtime_model = runtime_kwargs.pop("model", None)
        if runtime_model:
            model = runtime_model

        # Per-client model routing (model_routes config).  The route was
        # resolved from the request's ``model`` field by the HTTP handler.
        # Precedence (highest first): session ``/model`` override → model_routes
        # route → global config — an explicit user-issued ``/model`` on the
        # session always beats static per-client route config.
        session_override = self._session_model_override_for(
            gateway_session_key or session_id
        )
        if route and not session_override:
            if route.get("provider"):
                # Resolve real credentials for the routed provider (mirrors
                # the channel_overrides path in gateway/run.py) so a route
                # without an explicit api_key/base_url still gets the right
                # provider auth instead of the default provider's key.
                try:
                    from gateway.run import _resolve_runtime_agent_kwargs_for_provider
                    provider_kwargs = _resolve_runtime_agent_kwargs_for_provider(
                        route["provider"]
                    )
                    provider_kwargs.pop("model", None)
                    runtime_kwargs.update(provider_kwargs)
                except Exception:
                    # Fall back to just switching the provider name; explicit
                    # per-route api_key/base_url below can still complete auth.
                    runtime_kwargs["provider"] = route["provider"]
            if route.get("model"):
                model = route["model"]
            # Per-route secrets are upstream provider credentials. Never log
            # them (compare _check_auth: caller auth stays the global bearer
            # key checked with hmac.compare_digest).
            if route.get("api_key"):
                runtime_kwargs["api_key"] = route["api_key"]
            if route.get("base_url"):
                runtime_kwargs["base_url"] = route["base_url"]
            logger.debug(
                "api_server model route applied: model=%s provider=%s",
                model,
                runtime_kwargs.get("provider"),
            )
        elif route and session_override:
            logger.debug(
                "api_server model route skipped: session /model override wins for %s",
                gateway_session_key or session_id,
            )

        user_config = _load_gateway_config()
        enabled_toolsets = sorted(_get_platform_tools(user_config, "api_server"))

        max_iterations = _current_max_iterations()

        # Load fallback provider chain so the API server platform has the
        # same fallback behaviour as Telegram/Discord/Slack (fixes #4954).
        fallback_model = GatewayRunner._load_fallback_model()

        agent = AIAgent(
            model=model,
            **runtime_kwargs,
            **_checkpoint_agent_kwargs(user_config),
            max_iterations=max_iterations,
            quiet_mode=True,
            verbose_logging=False,
            ephemeral_system_prompt=ephemeral_system_prompt or None,
            enabled_toolsets=enabled_toolsets,
            session_id=session_id,
            platform="api_server",
            stream_delta_callback=stream_delta_callback,
            tool_progress_callback=tool_progress_callback,
            tool_start_callback=tool_start_callback,
            tool_complete_callback=tool_complete_callback,
            session_db=self._ensure_session_db(),
            fallback_model=fallback_model,
            reasoning_config=reasoning_config,
            gateway_session_key=gateway_session_key,
        )
        return agent

    # ------------------------------------------------------------------
    # HTTP Handlers
    # ------------------------------------------------------------------

