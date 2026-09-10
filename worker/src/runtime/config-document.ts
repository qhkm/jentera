/* ============================================================
   The configuration a runtime is told, rather than born with.

   Everything here is written into a sprite at bootstrap today, which is why
   changing one Hermes key costs a fleet release. Rendering it instead means
   a config change is a worker deploy that reaches each sprite on its next
   wake.

   Schema 1 is deliberately almost empty: the extract backend and its
   credentials, nothing else. That is the one piece already proven to work
   end to end, and keeping the document small means the first release that
   consumes it changes as little behaviour as possible. Step 3 fills it.

   The renderer is pure — `Env` and a runtime row in, a document out, no I/O
   — so the version hash is reproducible and the whole thing is testable
   without a database.
   ============================================================ */

import type { Env } from '../env';
import { extractEndpoint } from './provision';

/** The only schema this worker knows how to render. */
export const CONFIG_SCHEMA = 1;

export interface RuntimeConfigDocument {
  schema: number;
  version: string;
  issuedAt: string;
  release: string;
  hermes: { web: Record<string, string> };
  hermesEnv: Record<string, string>;
}

export class ConfigSchemaUnsupported extends Error {
  constructor(readonly requested: number) {
    super(`schema ${requested} is not supported`);
  }
}

/**
 * Stable JSON: object keys sorted at every level.
 *
 * The version is a hash, so two renders of the same configuration have to
 * produce the same bytes. Insertion order must not be able to change it.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A version that changes when the configuration changes — without ever
 * hashing a secret.
 *
 * `hermesEnv` values are replaced by the *names* of the settings they came
 * from before hashing. Rotating AISAR_EXTRACT_KEY therefore does not move
 * the version (the sprite already has a way to be told to re-fetch, and a
 * hash that moved on every rotation would churn the fleet), while turning
 * the endpoint on or off does, because a name enters or leaves the set.
 *
 * The tradeoff is stated rather than hidden: a rotated credential alone
 * does not propagate on version comparison, so a rotation that must reach
 * the fleet needs a nudge. Step 5 addresses it; carrying secret bytes into
 * a hash the control plane logs is the worse trade.
 */
async function versionOf(document: Omit<RuntimeConfigDocument, 'version' | 'issuedAt'>): Promise<string> {
  const hashable = {
    ...document,
    hermesEnv: Object.keys(document.hermesEnv).sort(),
  };
  return (await sha256Hex(canonical(hashable))).slice(0, 16);
}

/**
 * Render the document for one runtime.
 *
 * Reads the same `Env` fields `bootstrapRuntime` already reads, so the
 * channel and the transfer cannot disagree about what the configuration is
 * while both exist.
 */
export async function renderRuntimeConfig(
  env: Env,
  runtime: { desiredRelease: string },
  schema: number = CONFIG_SCHEMA,
  now: Date = new Date(),
): Promise<RuntimeConfigDocument> {
  if (schema !== CONFIG_SCHEMA) throw new ConfigSchemaUnsupported(schema);

  const extract = extractEndpoint(env);
  /* ddgs answers search and cannot read a page; extract_backend is only
     named when the credentials to serve it actually exist, exactly as
     configure-model-provider.py decides today. */
  const web: Record<string, string> = { backend: 'ddgs', search_backend: 'ddgs' };
  const hermesEnv: Record<string, string> = {};
  if (extract) {
    web.extract_backend = 'firecrawl';
    hermesEnv.FIRECRAWL_API_URL = extract.base;
    hermesEnv.FIRECRAWL_API_KEY = extract.key;
  }

  const body = {
    schema: CONFIG_SCHEMA,
    release: runtime.desiredRelease,
    hermes: { web },
    hermesEnv,
  };
  return {
    ...body,
    version: await versionOf(body),
    issuedAt: new Date(now.getTime()).toISOString(),
  };
}
