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
  /** Override the sender, e.g. for a staging origin. Must be a domain
      verified in Resend, and should match APP_ORIGIN. */
  MAGIC_FROM?: string;
}
