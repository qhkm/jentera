import type postgres from 'postgres';
import type { Env } from './env';
import { KEY_VERSION, open, seal } from './vault';
import type { ObservedRuntime, RuntimeState } from './runtime/provider';

export interface AgentRuntimeRecord {
  id: string;
  businessId: string;
  provider: ObservedRuntime['provider'];
  providerId: string | null;
  providerName: string;
  providerUrl: string | null;
  status: RuntimeState;
  desiredRelease: string;
  observedRelease: string | null;
  latestCheckpointId: string | null;
  lastReadyAt: Date | null;
  lastError: string | null;
  modelKeyHash: string | null;
  modelKeyExpiresAt: Date | null;
  modelKeyPendingRevocationHash: string | null;
  /** Authenticated runner attestation, persisted with its lifecycle task. */
  observedRegion: string | null;
}

export interface RuntimeSecrets {
  runnerKey: string;
  hermesApiKey: string;
}

export interface RuntimeModelCredential {
  key: string;
  hash: string;
  expiresAt: Date;
}

export interface StoredRuntimeModelCredential extends RuntimeModelCredential {
  pendingRevocationHash: string | null;
}

interface RuntimeRow {
  id: string;
  business_id: string;
  provider: AgentRuntimeRecord['provider'];
  provider_id: string | null;
  provider_name: string;
  provider_url: string | null;
  status: RuntimeState;
  desired_release: string;
  observed_release: string | null;
  latest_checkpoint_id: string | null;
  last_ready_at: Date | null;
  last_error: string | null;
  model_key_hash: string | null;
  model_key_expires_at: Date | null;
  model_key_pending_revocation_hash: string | null;
}

const columns = `id, business_id, provider, provider_id, provider_name, provider_url,
                 status, desired_release, observed_release, latest_checkpoint_id,
                 last_ready_at, last_error, model_key_hash, model_key_expires_at,
                 model_key_pending_revocation_hash`;

const toRecord = (row: RuntimeRow): AgentRuntimeRecord => ({
  id: row.id,
  businessId: row.business_id,
  provider: row.provider,
  providerId: row.provider_id,
  providerName: row.provider_name,
  providerUrl: row.provider_url,
  status: row.status,
  desiredRelease: row.desired_release,
  observedRelease: row.observed_release,
  latestCheckpointId: row.latest_checkpoint_id,
  lastReadyAt: row.last_ready_at,
  lastError: row.last_error,
  modelKeyHash: row.model_key_hash,
  modelKeyExpiresAt: row.model_key_expires_at,
  modelKeyPendingRevocationHash: row.model_key_pending_revocation_hash,
  observedRegion: null,
});

/** Latest authenticated region attested by a successful lifecycle task. */
export async function getRuntimeRegion(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<string | null> {
  const [row] = await tx<{ region: string | null }[]>`
    select result->>'region' as region
      from runtime_task
     where business_id = ${businessId}
       and kind in ('provision', 'upgrade', 'reconcile')
       and status = 'completed'
       and jsonb_typeof(result) = 'object'
       and result ? 'region'
     order by completed_at desc nulls last
     limit 1`;
  const region = row?.region?.trim().toLowerCase() ?? '';
  return /^[a-z0-9]{3}$/.test(region) ? region : null;
}

/** Stable, opaque, and free of customer-identifying text. */
export async function runtimeName(businessId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(businessId));
  const suffix = [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `aisar-b-${suffix}`;
}

/** Claim exactly one runtime row before making an external API call. */
export async function claimRuntime(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    provider: AgentRuntimeRecord['provider'];
    providerName: string;
    release: string;
    runnerKey: string;
    hermesApiKey: string;
  },
): Promise<AgentRuntimeRecord> {
  const [encryptedRunnerKey, encryptedHermesKey] = await Promise.all([
    seal(env, input.runnerKey),
    seal(env, input.hermesApiKey),
  ]);
  const [row] = await tx<RuntimeRow[]>`
    insert into agent_runtime
      (business_id, provider, provider_name, status, desired_release,
       runner_key_ciphertext, runner_key_version,
       hermes_key_ciphertext, hermes_key_version)
    values
      (${businessId}, ${input.provider}, ${input.providerName}, 'provisioning',
       ${input.release}, ${encryptedRunnerKey}, ${KEY_VERSION},
       ${encryptedHermesKey}, ${KEY_VERSION})
    on conflict (business_id) do update
      set desired_release = excluded.desired_release,
          updated_at = now()
    returning ${tx.unsafe(columns)}`;
  return toRecord(row);
}

export async function getRuntime(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<AgentRuntimeRecord | null> {
  const [row] = await tx<RuntimeRow[]>`
    select ${tx.unsafe(columns)} from agent_runtime where business_id = ${businessId}`;
  return row ? toRecord(row) : null;
}

/** Load the runtime routing snapshot and one Telegram credential in a single
 * admission query. Both rows are already protected by the active tenant RLS
 * transaction; combining them removes one inter-region round trip without
 * placing the bot token on the durable Queue message. */
export async function getRuntimeTelegramAccess(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
  connectionId: string,
): Promise<{ runtime: AgentRuntimeRecord | null; token: string }> {
  const runtimeColumns = columns
    .split(',')
    .map((column) => `ar.${column.trim()}`)
    .join(', ');
  const [row] = await tx<(RuntimeRow & {
    ciphertext: Uint8Array;
    key_version: number;
  })[]>`
    select ${tx.unsafe(runtimeColumns)}, cr.ciphertext, cr.key_version
      from credential cr
      left join agent_runtime ar
        on ar.business_id = ${businessId} and ar.deleted_at is null
     where cr.connection_id = ${connectionId}`;
  if (!row?.ciphertext || row.key_version === null) {
    throw new Error('that connection has no credential');
  }
  return {
    runtime: row.id ? toRecord(row) : null,
    token: await open(env, row.ciphertext, row.key_version),
  };
}

/** Load runtime routing metadata and its two internal credentials together.
 * Dispatch needs all three before it can contact the runner; querying the same
 * tenant row twice only adds a Hyperdrive/Neon round trip. */
export async function getRuntimeAccess(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<{ runtime: AgentRuntimeRecord; secrets: RuntimeSecrets }> {
  const [row] = await tx<(RuntimeRow & {
    runner_key_ciphertext: Uint8Array | null;
    runner_key_version: number | null;
    hermes_key_ciphertext: Uint8Array | null;
    hermes_key_version: number | null;
  })[]>`
    select ${tx.unsafe(columns)},
           runner_key_ciphertext, runner_key_version,
           hermes_key_ciphertext, hermes_key_version
      from agent_runtime
     where business_id = ${businessId}`;
  if (!row?.runner_key_ciphertext || row.runner_key_version === null ||
      !row.hermes_key_ciphertext || row.hermes_key_version === null) {
    throw new Error('runtime credentials are unavailable');
  }
  const [runnerKey, hermesApiKey] = await Promise.all([
    open(env, row.runner_key_ciphertext, row.runner_key_version),
    open(env, row.hermes_key_ciphertext, row.hermes_key_version),
  ]);
  return {
    runtime: toRecord(row),
    secrets: { runnerKey, hermesApiKey },
  };
}

/** Paid-plan gate for runtime entitlements. Absent or unknown plans
    are treated as 'free' (wake-on-request, no always-on hold). */
export async function getBusinessPlan(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<'free' | 'pro'> {
  const [row] = await tx<{ plan: string | null }[]>`
    select plan from business where id = ${businessId}`;
  return row?.plan === 'pro' ? 'pro' : 'free';
}

/** Decrypt runtime credentials only inside a tenant-scoped transaction. */
export async function getRuntimeSecrets(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<RuntimeSecrets> {
  const [row] = await tx<{
    runner_key_ciphertext: Uint8Array | null;
    runner_key_version: number | null;
    hermes_key_ciphertext: Uint8Array | null;
    hermes_key_version: number | null;
  }[]>`
    select runner_key_ciphertext, runner_key_version,
           hermes_key_ciphertext, hermes_key_version
      from agent_runtime
     where business_id = ${businessId}`;
  if (!row?.runner_key_ciphertext || row.runner_key_version === null ||
      !row.hermes_key_ciphertext || row.hermes_key_version === null) {
    throw new Error('runtime credentials are unavailable');
  }
  const [runnerKey, hermesApiKey] = await Promise.all([
    open(env, row.runner_key_ciphertext, row.runner_key_version),
    open(env, row.hermes_key_ciphertext, row.hermes_key_version),
  ]);
  return { runnerKey, hermesApiKey };
}

export async function getRuntimeModelCredential(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<StoredRuntimeModelCredential | null> {
  const [row] = await tx<{
    model_key_ciphertext: Uint8Array | null;
    model_key_version: number | null;
    model_key_hash: string | null;
    model_key_expires_at: Date | null;
    model_key_pending_revocation_hash: string | null;
  }[]>`
    select model_key_ciphertext, model_key_version, model_key_hash, model_key_expires_at,
           model_key_pending_revocation_hash
      from agent_runtime where business_id = ${businessId}`;
  if (!row?.model_key_ciphertext || row.model_key_version === null ||
      !row.model_key_hash || !row.model_key_expires_at) return null;
  return {
    key: await open(env, row.model_key_ciphertext, row.model_key_version),
    hash: row.model_key_hash,
    expiresAt: row.model_key_expires_at,
    pendingRevocationHash: row.model_key_pending_revocation_hash,
  };
}

export async function storeRuntimeModelCredential(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
  credential: RuntimeModelCredential,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(credential.hash) || credential.key.length < 32 ||
      credential.expiresAt.getTime() <= Date.now()) {
    throw new Error('runtime model credential is invalid');
  }
  const ciphertext = await seal(env, credential.key);
  const rows = await tx`
    update agent_runtime
       set model_key_ciphertext = ${ciphertext}, model_key_version = ${KEY_VERSION},
           model_key_hash = ${credential.hash},
           model_key_expires_at = ${credential.expiresAt},
           model_key_pending_revocation_hash = case
             when model_key_hash is null or model_key_hash = ${credential.hash}
               then model_key_pending_revocation_hash
             else coalesce(model_key_pending_revocation_hash, model_key_hash)
           end,
           updated_at = now()
     where business_id = ${businessId}
    returning id`;
  if (rows.length !== 1) throw new Error('runtime disappeared while storing model credential');
}

export async function markRuntimeModelKeyRevoked(
  tx: postgres.TransactionSql,
  businessId: string,
  hash: string,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('runtime model key hash is invalid');
  await tx`
    update agent_runtime
       set model_key_pending_revocation_hash = case
             when model_key_pending_revocation_hash = ${hash} then null
             else model_key_pending_revocation_hash
           end,
           updated_at = now()
     where business_id = ${businessId}`;
}

export async function recordProviderRuntime(
  tx: postgres.TransactionSql,
  businessId: string,
  observed: ObservedRuntime,
): Promise<AgentRuntimeRecord> {
  const [row] = await tx<RuntimeRow[]>`
    update agent_runtime
       set provider_id = ${observed.id},
           provider_name = ${observed.name},
           provider_url = ${observed.url},
           status = ${observed.state},
           last_error = null,
           updated_at = now()
     where business_id = ${businessId}
       and provider = ${observed.provider}
       and provider_name = ${observed.name}
    returning ${tx.unsafe(columns)}`;
  if (!row) throw new Error('observed runtime does not match the claimed provider resource');
  return toRecord(row);
}

export async function markRuntimeReady(
  tx: postgres.TransactionSql,
  businessId: string,
  release: string,
  checkpointId: string,
): Promise<void> {
  await tx`
    update agent_runtime
       set status = 'ready', observed_release = ${release},
           latest_checkpoint_id = ${checkpointId}, last_ready_at = now(),
           last_error = null, updated_at = now()
     where business_id = ${businessId}`;
  await tx`update business set runtime = 'hermes-sprite' where id = ${businessId}`;
}

export async function markRuntimeFailed(
  tx: postgres.TransactionSql,
  businessId: string,
  error: string,
): Promise<void> {
  await tx`
    update agent_runtime
       set status = 'error', last_error = ${error.slice(0, 1000)}, updated_at = now()
     where business_id = ${businessId}`;
}

export async function markRuntimeState(
  tx: postgres.TransactionSql,
  businessId: string,
  status: RuntimeState,
): Promise<void> {
  await tx`
    update agent_runtime set status = ${status}, updated_at = now()
     where business_id = ${businessId}`;
}

/** Remove both encrypted runtime credentials and the product routing marker. */
export async function removeRuntimeRecord(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<void> {
  await tx`delete from agent_runtime where business_id = ${businessId}`;
  await tx`update business set runtime = 'aisar-native' where id = ${businessId}`;
}
