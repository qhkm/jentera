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
  /** Dedicated Jentera model credential. Never use a personal/shared key. */
  AISAR_MODEL_PROVIDER?: string;
  AISAR_MODEL_BASE?: string;
  AISAR_MODEL_KEY?: string;
  /** Management credential stays control-plane-only and issues separate
      capped/expiring inference keys. The shared key is a one-canary bridge. */
  AISAR_OPENROUTER_MANAGEMENT_KEY?: string;
  RUNTIME_SHARED_MODEL_KEY_BUSINESS_IDS?: string;
  AISAR_MODEL_NAME?: string;
  /** Durable provisioning and Hermes task delivery. */
  RUNTIME_QUEUE?: Queue<import('./runtime/consumer').RuntimeQueueMessage>;
  /** Hibernating per-run WebSocket fan-out. Postgres remains task truth. */
  RUN_STREAMS?: DurableObjectNamespace;
  /** First-party, pseudonymous activation funnel. No business content or PII. */
  PRODUCT_ANALYTICS?: AnalyticsEngineDataset;
  /** Override the sender, e.g. for a staging origin. Must be a domain
      verified in Resend, and should match APP_ORIGIN. */
  MAGIC_FROM?: string;
}
