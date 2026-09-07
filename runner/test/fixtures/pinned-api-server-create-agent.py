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

        # Jentera: apply reviewed OpenRouter routing to API-server agents.
        provider_routing = user_config.get("provider_routing") or {}
        if not isinstance(provider_routing, dict):
            provider_routing = {}

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
            providers_allowed=provider_routing.get("only"),
            providers_ignored=provider_routing.get("ignore"),
            providers_order=provider_routing.get("order"),
            provider_sort=provider_routing.get("sort"),
            provider_require_parameters=provider_routing.get("require_parameters", False),
            provider_data_collection=provider_routing.get("data_collection"),
            gateway_session_key=gateway_session_key,
        )
        return agent

    # ------------------------------------------------------------------


# --------------------------------------------------------------------------
# Verbatim slices of the pinned Hermes api_server.py @
# ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413 - health handler dict
# (lines 2014-2036) and the run.completed reporting block (lines 5184-5244,
# incl. the usage-on-cancel port from the v0.20.5 line).
# They keep the Stage-2 runtime anchors honest: if a future pin changes
# either region the pinnedFixture test fails loudly instead of the patch
# drifting silently.
# --------------------------------------------------------------------------

            "readiness": readiness,
            "platform": "hermes-agent",
            # Jentera: expose bounded final reasoning and attest this runtime patch.
            "version": _hermes_version(),
            "jentera_patch": "jentera-runtime-2026-09-06",
            "gateway_state": gw_state,
            "platforms": runtime.get("platforms", {}),
            "active_agents": gw_active,
            "gateway_busy": derive_gateway_busy(
                gateway_running=True,
                gateway_state=gw_state,
                active_agents=gw_active,
            ),
            "gateway_drainable": derive_gateway_drainable(
                gateway_running=True,
                gateway_state=gw_state,
            ),
            "exit_reason": runtime.get("exit_reason"),
            # Contract: updated_at is RFC3339 string | null, never a number —
            # the state file may carry legacy epoch floats or hand-edited junk.
            "updated_at": normalize_updated_at(runtime.get("updated_at")),
            "pid": os.getpid(),
        })
                # Check for structured failure (non-retryable client errors like
                # 401/400 return failed=True instead of raising, so the except
                # block below never fires — issue #15561).
                elif isinstance(result, dict) and result.get("failed"):
                    error_msg = _redact_api_error_text(result.get("error") or "agent run failed")
                    _put_event_if_active({
                        "event": "run.failed",
                        "run_id": run_id,
                        "timestamp": time.time(),
                        "error": error_msg,
                    })
                    self._set_run_status(
                        run_id,
                        "failed",
                        error=error_msg,
                        last_event="run.failed",
                    )
                else:
                    final_response = result.get("final_response", "") if isinstance(result, dict) else ""
                    reasoning = (
                        result.get("last_reasoning")
                        if isinstance(result, dict)
                        and isinstance(result.get("last_reasoning"), str)
                        else None
                    )
                    _put_event_if_active({
                        "event": "run.completed",
                        "run_id": run_id,
                        "timestamp": time.time(),
                        "output": final_response,
                        "usage": usage,
                        **({"reasoning": reasoning} if reasoning else {}),
                    })
                    self._set_run_status(
                        run_id,
                        "completed",
                        output=final_response,
                        usage=usage,
                        **({"reasoning": reasoning} if reasoning else {}),
                        last_event="run.completed",
                    )
            except asyncio.CancelledError:
                self._set_run_status(
                    run_id,
                    "cancelled",
                    last_event="run.cancelled",
                    **({"usage": usage} if usage is not None else {}),
                )
                try:
                    _put_event_if_active({
                        "event": "run.cancelled",
                        "run_id": run_id,
                        "timestamp": time.time(),
                        **({"usage": usage} if usage is not None else {}),
                    })
                except Exception:
                    pass
                raise
            except Exception as exc:
                logger.exception("[api_server] run %s failed", run_id)
                self._set_run_status(
