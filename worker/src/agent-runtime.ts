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
}

export interface RuntimeSecrets {
  runnerKey: string;
  hermesApiKey: string;
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
}

const columns = `id, business_id, provider, provider_id, provider_name, provider_url,
                 status, desired_release, observed_release, latest_checkpoint_id,
                 last_ready_at, last_error`;

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
});

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
