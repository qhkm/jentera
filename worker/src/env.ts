export interface Env {
  /** Postgres on Neon, pooled through Hyperdrive. */
  HYPERDRIVE: Hyperdrive;
  /** Comma-separated list of origins permitted to call this API. */
  ALLOWED_ORIGINS: string;
  /** Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
  /** Where magic links point, e.g. https://jentera.ai */
  APP_ORIGIN: string;
}
