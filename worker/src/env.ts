/* Bindings declared in wrangler.toml. */
export interface Env {
  DB: D1Database;
  /** Comma-separated list of origins permitted to call this API. */
  ALLOWED_ORIGINS: string;
}
