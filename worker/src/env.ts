export interface Env {
  /** Enable only after migration 041 and confirmed paid grants are installed. */
  ACCESS_MODE?: 'open' | 'waitlist';
  /** Lifetime ten-chat preview; enable only after migration 057. */
  CHAT_PREVIEW_ENABLED?: string;
  /** Postgres on Neon, pooled through Hyperdrive. */
  HYPERDRIVE: Hyperdrive;
  /** Comma-separated list of origins permitted to call this API. */
  ALLOWED_ORIGINS: string;
  /** Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
  /** Where magic links point, e.g. https://jentera.ai */
  APP_ORIGIN: string;
  /** Cloudflare Worker secrets; never ship Stripe credentials in the frontend. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_BILLING_SANDBOX_ENABLED?: string;
  /** Explicit live release gate; also requires production origins/catalog/account. */
  STRIPE_BILLING_LIVE_ENABLED?: string;
  /** New-purchase brake, independent of ongoing signed payment fulfillment. */
  STRIPE_CHECKOUT_ENABLED?: string;
  STRIPE_EXPECTED_ACCOUNT_ID?: string;
  STRIPE_LAUNCH_PRODUCT?: string;
  STRIPE_LAUNCH_MONTHLY_PRICE?: string;
  STRIPE_LAUNCH_COUPON?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_ANNUAL?: string;
  STRIPE_PRICE_TEAM_MONTHLY?: string;
  STRIPE_PRICE_TEAM_ANNUAL?: string;
  /** Not enabled until applicable tax obligations and registrations are reviewed. */
  STRIPE_AUTOMATIC_TAX?: string;
  /** Founder support invite; only returned after operator-verified payment. */
  LAUNCH_FOUNDER_GROUP_URL?: string;
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
  /** Config-channel brake, keyed by rider rather than IP: sprites share
      egress addresses, so an IP key would let one busy runtime brake the
      rest. A sprite fetches at start and on a nudge, so this is generous. */
  RUNTIME_CONFIG_BURST: RateLimit;
  /** Paid agent-run admission. Separate from lifecycle mutations so
      normal conversation does not share a three-per-minute bucket with provisioning. */
  AGENT_RUN_BURST: RateLimit;
  /** One "can't read this yet" reply per Telegram album, limit 1 a minute per
      album. Fails open: an outage costs duplicate replies, never silence. */
  TELEGRAM_ALBUM_REPLY: RateLimit;
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
  /** Optional dedicated OAuth client for Google Workspace connections. A
      separate client prevents Calendar disconnects from affecting sign-in.
      Pilot environments may fall back to the sign-in client above. */
  GOOGLE_WORKSPACE_CLIENT_ID?: string;
  GOOGLE_WORKSPACE_CLIENT_SECRET?: string;
  /** Organization-scoped Fly Sprites API token. Control plane only. */
  SPRITES_TOKEN?: string;
  /** Override only for tests or a future compatible provider gateway. */
  SPRITES_API_ORIGIN?: string;
  /** Disabled by default. Both flag and explicit business UUID pilot list required. */
  DESKTOP_VIEW_ENABLED?: string;
  DESKTOP_VIEW_BUSINESS_IDS?: string;
  /** Specialists hand work to each other (docs/plans/2026-09-26-specialist-handoff.md). */
  HANDOFF_ENABLED?: string;
  /** Exact business UUIDs on the hand-off pilot, comma-separated; empty means nobody. */
  HANDOFF_BUSINESS_IDS?: string;
  /* Apps pilot (docs/plans/2026-09-23-apps-shell-and-bookings-v1.md).
     Exact business ids only, like desktop view: an empty list is nobody. */
  APPS_ENABLED?: string;
  APPS_BUSINESS_IDS?: string;
  /* The public origin of the sites deploy, https://book.jentera.ai — used to
     build booking links; the sites deploy redirects every other host to it. */
  SITES_ORIGIN?: string;
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
  /** Immutable Git commit containing runner release assets. No longer public:
      the bundle is served from R2 by routes/runtime-bundle.ts, which is what
      lets this repository be private. */
  RUNTIME_BUNDLE_COMMIT?: string;
  /** sha256 of that commit's packed bundle, written by ship-runtime.sh.
      Pinned beside the commit rather than read back from the bucket, so the
      sprite's check is the control plane asserting what it expects instead of
      the bucket agreeing with itself. */
  RUNTIME_BUNDLE_SHA256?: string;
  /** Second half of provisioning; false leaves raw provider compute unselected. */
  RUNTIME_BOOTSTRAP_ENABLED?: string;
  /** Clean, never-used Sprite inventory. Apply migration 059 and run a canary
      before enabling. Maximum two spares, one preparation at a time. */
  RUNTIME_SPARE_POOL_ENABLED?: string;
  RUNTIME_SPARE_POOL_TARGET?: string;
  /** Migration 060: bounded retirement of clean unused spares and operator alerts. */
  RUNTIME_SPARE_POOL_RECOVERY_ENABLED?: string;
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
  /** Direct DeepSeek credential, held only by the model proxy. */
  DEEPSEEK_API_KEY?: string;
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
  /** Web push. The VAPID key pair as one JWK string (`generateVapidJwk`
      in src/push/crypto.ts makes one); set with `wrangler secret put
      VAPID_PRIVATE_JWK`. The public half is derived from it. Absent: the
      app offers no notification switch and no push is ever sent. */
  VAPID_PRIVATE_JWK?: string;
  /** RFC 8292 subject, `mailto:` an address the push services can reach. */
  VAPID_SUBJECT?: string;
  /** Placement spike: a service binding to this Worker itself. */
  SELF?: Fetcher;
  /** Isolated credential broker. Owner-facing calls use this private binding,
      never the vault's public workers.dev hostname. */
  VAULT?: Fetcher;
  /** Defence-in-depth credential shared with aisar-vault over the binding. */
  VAULT_INTERNAL_TOKEN?: string;
  /** Public Worker with exactly one direct-deposit route. Returned to the
      browser only after an owner-authenticated one-time ticket is minted. */
  VAULT_DEPOSIT_ORIGIN?: string;
  /** R2 bucket for files the agent hands the owner (routes/artifacts.ts).
      Keys are `<business>/<run>/<artifact id>/<name>`; nothing reads the
      bucket without first resolving the artifact row under RLS. */
  ARTIFACTS?: R2Bucket;
  /** R2 bucket holding the runner bundle, one gzipped object per commit at
      `bundles/<commit>.tar.gz` (routes/runtime-bundle.ts). Separate from
      ARTIFACTS on purpose: that bucket holds tenant bytes reached only after
      an RLS-resolved row, and release artifacts have no tenant at all. */
  RUNTIME_BUNDLES?: R2Bucket;
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
  /** 'true' turns owner-scheduled deterministic and Sprite-backed jobs on. */
  ROUTINES_ENABLED?: string;
  /* 'true' opens /api/auth/native/*. Anything else, including unset, answers
     404 as though the routes do not exist. */
  NATIVE_AUTH_ENABLED?: string;
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
  /** Where a plain-text notice goes each time a new account is made,
      through any door. Unset: nobody is told. A var, not a secret. */
  SIGNUP_NOTICE_TO?: string;
  /** The address a waiting-list announcement offers as its unsubscribe.
      It must be an inbox that receives: jentera.ai has no MX, so a
      mailto at that domain would be a black hole, and an unsubscribe
      nobody can act on is what turns into a spam complaint against the
      domain the magic links come from. Unset: the launch administrator's
      own address. A var, not a secret. */
  WAITLIST_UNSUBSCRIBE_TO?: string;
  /** Cloudflare Turnstile secret for the link, signup and password-login
      doors. Set with `wrangler secret put TURNSTILE_SECRET`. Unset: the
      check is skipped, which is how tests and local runs work. Set it only
      after the app ships with its site key, or every door refuses. */
  TURNSTILE_SECRET?: string;
  /* Sites deploy only (jentera-sites, [env.sites]). The public Turnstile
     site key the booking form renders; the same value as the app's
     VITE_TURNSTILE_SITE_KEY. */
  TURNSTILE_SITE_KEY?: string;
  /* Sites deploy only: 10 booking-form posts per 60 s per address. */
  BOOKING_BURST?: RateLimit;
  /* Sites deploy only: 60 page requests per 60 s per address. */
  SITES_BURST?: RateLimit;
  /** How long any dispatch keeps the Sprite held active past the dispatch
      (hours) — all plans since 2026-09-01 (launch posture). Refreshed on
      every dispatch; a silent business releases itself after this window.
      Default 24h. */
  AISAR_KEEPALIVE_GRACE_HOURS?: string;
}
