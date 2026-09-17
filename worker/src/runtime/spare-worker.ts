import type { Env } from '../env';
import { withUser } from '../db';
import { canBootstrap, type RuntimeProvider, type ObservedRuntime } from './provider';
import { downloadRuntimeBundle, runtimeProviderFor, sparePreparationTransfer } from './provision';
import { sparePoolConfig, validSpareMessage, type SpareQueueMessage } from './spares';
import type { RuntimeMessageResult } from './consumer';

/** Installation only. No fake business, shared inference key, agent execution,
 * runner service, browser session, Tasks API keepalive or public endpoint. */
export async function prepareRuntimeSpare(
  env: Env, message: SpareQueueMessage, options: { provider?: RuntimeProvider } = {},
): Promise<RuntimeMessageResult> {
  const config = sparePoolConfig(env);
  if (!config || !validSpareMessage(message)) return { action: 'ack', reason: 'missing' };
  const provider = options.provider ?? runtimeProviderFor(env);
  if (provider.id !== 'fly-sprite' || !canBootstrap(provider)) return { action: 'ack', reason: 'missing' };
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  const [spare] = await withUser(env, sql => sql<{
    spare_id: string; provider_name: string; release: string; bundle_commit: string;
  }[]>`select * from public.lease_runtime_spare(${message.spareId},${token},${config.release},${config.bundle})`);
  // Another preparation may hold the slot. Cron re-publishes queued ids.
  if (!spare) return { action: 'ack', reason: 'already_done' };
  let observed: ObservedRuntime | undefined;
  try {
    observed = await provider.create({
      businessId: '', name: spare.provider_name, release: spare.release,
    });
    if (observed.provider !== 'fly-sprite' || observed.name !== spare.provider_name ||
        !/^https:\/\/[a-zA-Z0-9.-]+\.sprites\.app$/.test(observed.url)) {
      throw new Error('spare identity is invalid');
    }
    await downloadRuntimeBundle(provider, observed, spare.bundle_commit, true);
    await provider.writeFile(observed, '/home/sprite/aisar/bootstrap.env.in',
      sparePreparationTransfer(spare.release), 0o600);
    // The process-group deadline is on the Sprite itself, not just on the
    // caller: abandoning an HTTP response must not leave an installer alive.
    const prepared = await provider.exec(observed, '/bin/bash', ['-lc',
      'exec timeout -k 10 600 /home/sprite/aisar/runner/bootstrap-runtime.sh /home/sprite/aisar/bootstrap.env.in',
    ], { env: [
        'AISAR_BOOTSTRAP_PREPARE_SPARE=1', `AISAR_SPARE_BUNDLE_COMMIT=${spare.bundle_commit}`,
      ] });
    if (prepared.exitCode !== 0 || !preparationAttested(prepared.stdout, spare)) {
      throw new Error('spare preparation did not attest');
    }
    const checkpoint = await provider.checkpoint(observed, `Jentera clean spare ${spare.release}`);
    if (!/^v[0-9]+$/.test(checkpoint)) throw new Error('spare checkpoint is not versioned');
    const [saved] = await withUser(env, sql => sql<{ ok: boolean }[]>`
      select public.finish_runtime_spare(${spare.spare_id},${token},${observed!.id},
        ${observed!.url},${checkpoint},true) as ok`);
    if (!saved?.ok) throw new Error('spare preparation lease is no longer current');
    console.info('[runtime-spares]', JSON.stringify({ stage: 'prepared', elapsedMs: Date.now()-startedAt }));
    return { action: 'ack', reason: 'completed' };
  } catch {
    // Fixed diagnostic code only. Provider error bodies and environment
    // values are never persisted or logged. Do not recycle or replace it.
    await withUser(env, sql => sql`select public.finish_runtime_spare(${spare.spare_id},${token},
      ${observed?.id ?? null},${observed?.url ?? null},null,false)`);
    console.warn('[runtime-spares] preparation quarantined; operator review required');
    return { action: 'ack', reason: 'failed' };
  }
}

function preparationAttested(stdout: string, spare: { release: string; bundle_commit: string }): boolean {
  try {
    const body = JSON.parse(stdout.trimEnd().split('\n').pop() ?? '');
    return body?.prepared === true && body.release === spare.release &&
      body.bundleCommit === spare.bundle_commit &&
      body.hermesCommit === 'bb0305ae08bf1dc9ac5a39d2b017f27e42854170';
  } catch { return false; }
}
