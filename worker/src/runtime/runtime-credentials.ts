import type postgres from 'postgres';
import type { Env } from '../env';
import { useCredential } from '../connections';

/**
 * The connectors whose work the agent does itself, on its own machine.
 *
 * Everything absent from this map is control-plane: the Worker makes the
 * call, and the credential never reaches a sprite at all. That is the
 * default, and it is the important half of the design. A sprite runs a
 * general-purpose agent holding a terminal, so a credential delivered there
 * is one the agent can read and therefore one it can be talked into
 * repeating. Since `web_extract` began pulling arbitrary pages into that
 * agent's context, "the agent can read it" and "a stranger's web page can
 * ask for it" describe the same exposure.
 *
 * So an owner's payment or messaging credentials stay in the control plane
 * where no prompt can reach them, and only the few tools the agent must
 * genuinely run itself appear below.
 */
export const RUNTIME_CREDENTIALS: Readonly<Record<string, string>> = Object.freeze({
  /* wrangler reads this and skips its OAuth flow entirely. That flow cannot
     complete on a sprite in any case: it opens a browser on Jentera's
     machine, which the owner has no way to see, so it blocks until the tool
     times out. A scoped token is not a workaround for that — it is the
     better grant, being limited to the permissions the owner picked and
     revocable from Cloudflare without involving us. */
  Cloudflare: 'CLOUDFLARE_API_TOKEN',
});

/** Whether this connector's credential is delivered to the sprite. */
export function isRuntimeConnector(connector: string): boolean {
  return Object.hasOwn(RUNTIME_CREDENTIALS, connector);
}

interface CredentialRow {
  id: string;
  connector: string;
}

/**
 * The runtime-class credentials this business has connected, as the
 * environment the sprite should hold.
 *
 * Runs inside `withTenant`, so the rows are the caller's own by RLS rather
 * than by the predicate below; the predicate is the belt to that braces.
 * A connector that is present but not connected is skipped rather than
 * delivered broken — an expired token in the environment reads to the agent
 * as a permissions problem, which is a worse thing to debug than absence.
 */
export async function runtimeCredentials(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<Record<string, string>> {
  if (!Object.keys(RUNTIME_CREDENTIALS).length) return {};

  /* Membership is decided in TypeScript against the map above rather than
     passed into SQL as an array. A business holds a handful of connections,
     and the one authority on which are runtime-class should be the map, not
     a parameter whose array typing is a separate thing to get right. */
  const rows = await tx<CredentialRow[]>`
    select id, connector
      from connection
     where business_id = ${businessId}
       and status = 'connected'
     order by connected_at desc`;

  const out: Record<string, string> = {};
  for (const row of rows) {
    const variable = RUNTIME_CREDENTIALS[row.connector];
    /* First connection wins for a connector; the query is newest-first, so
       reconnecting supersedes without leaving the older row to race it. */
    if (!variable || out[variable]) continue;
    out[variable] = await useCredential(env, tx, row.id);
  }
  return out;
}
