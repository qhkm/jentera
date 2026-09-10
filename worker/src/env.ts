export interface Env {
  /** Postgres on Neon, pooled through Hyperdrive. */
  HYPERDRIVE: Hyperdrive;
  /** Comma-separated list of origins permitted to call this API. */
  ALLOWED_ORIGINS: string;
  /** Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
  /** Where magic links point, e.g. https://jentera.ai */
  APP_ORIGIN: string;
  /** 32 random bytes, base64. Encrypts the credentials business
      owners paste in — their secrets, not ours. */
  CREDENTIAL_KEY: string;
  /** Workers AI. Ingestion runs on this rather than an external
      provider so the feature needs no third-party credential. */
  AI: Ai;
  /** Edge burst limiter for /api/auth/request. Per-colo, so it is a
      brake on floods rather than an exact quota. */
  AUTH_BURST: RateLimit;
  /** General API and high-cost runtime mutation burst brakes. Both run
      before session verification or any database/provider work. */
  API_BURST: RateLimit;
  RUNTIME_MUTATION_BURST: RateLimit;
  /** Paid agent-run admission. Separate from lifecycle mutations so
      normal conversation does not share a three-per-minute bucket with provisioning. */
  AGENT_RUN_BURST: RateLimit;
  /** New realtime connection admission. Fail closed before session/Neon/DO work. */
  RUN_STREAM_BURST: RateLimit;
  /** Key for the IP HMAC in the rate-limit ledger. A Worker secret;
      without it the stored hashes are brute-forceable. */
  RATE_LIMIT_PEPPER?: string;
  /** This Worker's own public origin, used to build the Google OAuth
      redirect URI. Must match a redirect registered on the client. */
  API_ORIGIN: string;
  /** Google OAuth client. Absent means the button is simply not
      offered — the other two ways in keep working. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Organization-scoped Fly Sprites API token. Control plane only. */
  SPRITES_TOKEN?: string;
  /** Override only for tests or a future compatible provider gateway. */
  SPRITES_API_ORIGIN?: string;
  /** Immutable runner + Hermes + browser release identifier. */
  RUNTIME_RELEASE?: string;
  /** Preferred Fly region for diagnostics. Sprites cannot currently be pinned. */
  RUNTIME_EXPECTED_REGION?: string;
  /** Customer provisioning requires explicit enablement, verified secure
      model transport, production bootstrap, and all provider credentials. */
  RUNTIME_PROVISIONING_ENABLED?: string;
  MODEL_TRANSPORT_READY?: string;
  /** Fleet-wide emergency brake. A ready tenant runtime remains required. */
  RUNTIME_EXECUTION_ENABLED?: string;
  /** Immutable public Git commit containing runner release assets. */
  RUNTIME_BUNDLE_COMMIT?: string;
  /** Second half of provisioning; false leaves raw provider compute unselected. */
  RUNTIME_BOOTSTRAP_ENABLED?: string;
  /** FMCV inference credential. Kept in the control plane and installed only
      into isolated Jentera runtimes while FMCV tenant-key issuance is pending. */
  AISAR_MODEL_PROVIDER?: string;
  /** Upstream model gateway the model proxy (routes/model.ts) forwards to.
      Must be an allowlisted base; the credential it expects is
      FMCV_UPSTREAM_KEY, never AISAR_MODEL_KEY. */
  AISAR_MODEL_BASE?: string;
  /** Control secret signing runtime-facing `sk-jentera-v1.…` credentials.
      Random, at least 32 characters, kept entirely inside this Worker —
      never installed into a runtime, never sent to any gateway. Rotating
      it deterministically rotates every runtime credential. */
  AISAR_MODEL_KEY?: string;
  /** Model base handed to runtimes. When set to this Worker's own model
      proxy (<API_ORIGIN>/v1/model), runtime credentials are derived tokens
      verified here, and the upstream + its credential are configured purely
      by AISAR_MODEL_BASE + FMCV_UPSTREAM_KEY. Absent: the official
      OpenRouter endpoint is faced directly, and every other allowlisted
      upstream automatically routes through this Worker's model proxy. */
  AISAR_RUNTIME_MODEL_BASE?: string;
  /** Credential the model proxy presents to the upstream gateway
      (AISAR_MODEL_BASE) for every proxied call, and the only key the
      upstream ever sees from this Worker. For the reviewed FMCV upstream
      this is the FMCV master key pinned at B3 control-secret rotation. */
  FMCV_UPSTREAM_KEY?: string;
  /** Origin of the self-hosted Firecrawl that backs Hermes's `web_extract`.
      Without it the pinned `ddgs` backend is search-only and cannot read a
      page at all — it answers "DuckDuckGo (ddgs) is a search-only backend
      and cannot extract URL content" — which leaves the twelve browser tools
      as the only way the agent can see a web page, at a snapshot's token
      cost per look. Set: sprites get `firecrawl` as their extract backend. */
  AISAR_EXTRACT_BASE?: string;
  /** Bearer the sprites present to AISAR_EXTRACT_BASE. Firecrawl self-hosted
      has no authentication of its own — its SELF_HOST.md says so — so this is
      checked by the reverse proxy in front of it, and it is the only thing
      between that instance and anyone who can reach the origin. */
  AISAR_EXTRACT_KEY?: string;
  /** Official OpenRouter management credential stays control-plane-only and
      issues separate capped/expiring inference keys when that endpoint is used. */
  AISAR_OPENROUTER_MANAGEMENT_KEY?: string;
  /** Key for the staff support endpoints (telegram-pairing minting).
      Falls back to AISAR_OPENROUTER_MANAGEMENT_KEY when unset. */
  AISAR_SUPPORT_KEY?: string;
  /** Placement spike: a service binding to this Worker itself. */
  SELF?: Fetcher;
  AISAR_MODEL_NAME?: string;
  /** Optional heavier model used only for explicit deep/research work. */
  AISAR_DEEP_MODEL_NAME?: string;
  /** Comma-separated extra model ids routed on every sprite beside quick and
      deep (bootstrap transfer + Hermes model_routes + runner allowlist), so a
      candidate can be trialled without moving fleet traffic. */
  AISAR_CANDIDATE_MODEL_NAMES?: string;
  /** Comma-separated `<businessId>=<modelId>`: quick replies for that business
      use the named model instead of AISAR_MODEL_NAME. The model must be a
      routed one (quick, deep, or a candidate); deep work is never overridden. */
  AISAR_QUICK_MODEL_OVERRIDES?: string;
  /** Routines v1: 'true' turns owner-scheduled jobs on. Off by default. */
  ROUTINES_ENABLED?: string;
  /** Comma-separated business ids allowed to see and use routines while the
      feature is canaried; empty means every business once enabled. */
  AISAR_ROUTINES_BUSINESS_IDS?: string;
  /** Durable provisioning and Hermes task delivery. */
  RUNTIME_QUEUE?: Queue<import('./runtime/consumer').RuntimeQueueMessage>;
  /** Hibernating per-run WebSocket fan-out. Postgres remains task truth. */
  RUN_STREAMS?: DurableObjectNamespace;
  /** First-party, pseudonymous activation funnel. No business content or PII. */
  PRODUCT_ANALYTICS?: AnalyticsEngineDataset;
  /** Override the sender, e.g. for a staging origin. Must be a domain
      verified in Resend, and should match APP_ORIGIN. */
  MAGIC_FROM?: string;
  /** How long any dispatch keeps the Sprite held active past the dispatch
      (hours) — all plans since 2026-09-01 (launch posture). Refreshed on
      every dispatch; a silent business releases itself after this window.
      Default 24h. */
  AISAR_KEEPALIVE_GRACE_HOURS?: string;
}
