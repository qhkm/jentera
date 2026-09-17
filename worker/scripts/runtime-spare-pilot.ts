/** Private remote-development entry point, never the production Worker main.
 * Calls production preparation/provisioning/consumer code with inherited
 * secrets. No credentials are returned, no customer runtime is patched, and
 * production pool enablement is not changed by this entry point. */
import type { Env } from '../src/env';
import { withTenant, withUser } from '../src/db';
import { ACCESS_OWNER } from '../src/access';
import { getRuntime, getRuntimeAccess } from '../src/agent-runtime';
import { refillSparePool, type SpareQueueMessage } from '../src/runtime/spares';
import { prepareRuntimeSpare } from '../src/runtime/spare-worker';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { handleRuntimeQueueMessage } from '../src/runtime/consumer';
import { enqueueRuntimeTask, runtimeTaskByDedupeKey } from '../src/runtime/tasks';
import { startRun } from '../src/runs';
// Required by the existing Wrangler bindings even though the private preview
// itself does not expose the public event-stream routes.
export { RunStream } from '../src/run-stream';

type PilotEnv = Env & {
  SPARE_PILOT_MODE?: string;
  SPARE_PILOT_OWNER_USER_ID?: string;
  SPARE_PILOT_BUSINESS_ID?: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = 'Sprite pool pilot (operator-only)';
const INPUT = 'Reply with exactly POOL_PILOT_OK. Do not use tools or access any files, websites or connected accounts.';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
});

function authorized(request: Request, env: PilotEnv) {
  const expected = env.AISAR_SUPPORT_KEY?.trim() ?? '';
  const presented = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}

function pilotConfiguration(env: PilotEnv) {
  if (env.SPARE_PILOT_MODE !== 'operator-only' || !UUID.test(env.SPARE_PILOT_OWNER_USER_ID ?? '') ||
      !UUID.test(env.SPARE_PILOT_BUSINESS_ID ?? '') || !env.SPARE_PILOT_BUSINESS_ID!.startsWith('f')) {
    throw new Error('private pilot configuration required');
  }
  return { ownerId: env.SPARE_PILOT_OWNER_USER_ID!, businessId: env.SPARE_PILOT_BUSINESS_ID! };
}

async function checkedOwner(env: PilotEnv) {
  const config = pilotConfiguration(env);
  await withUser(env, async sql => {
    const [role] = await sql<{ role: string }[]>`select current_user as role`;
    if (role.role !== 'aisar_app') throw new Error('restricted application role required');
    const [owner] = await sql`select id from app_user where id=${config.ownerId}
      and lower(email::text)=${ACCESS_OWNER} and email_verified=true`;
    if (!owner) throw new Error('verified founder account required');
    // verifySession selects the lowest owner business UUID. Never change
    // the founder's default business by adding this private test membership.
    const [first] = await sql`select business_id::text as id from membership
      where user_id=${config.ownerId} and role='owner' order by business_id limit 1`;
    if (!first || first.id >= config.businessId) throw new Error('existing founder workspace must remain default');
  });
  return config;
}

async function checkedBusiness(env: PilotEnv, create = false) {
  const config = await checkedOwner(env);
  await withTenant(env, config.businessId, async tx => {
    if (create) {
      await tx`insert into business(id,name,playbook_key,onboarded,setup_done)
        values(${config.businessId},${NAME},'generic',true,true) on conflict(id) do nothing`;
    }
    const [business] = await tx`select name,plan,stripe_customer_id,stripe_subscription_id
      from business where id=${config.businessId} for update`;
    if (!business || business.name !== NAME || business.plan !== 'free' ||
        business.stripe_customer_id || business.stripe_subscription_id) throw new Error('private unbilled pilot workspace required');
    const members = await tx`select user_id,role from membership where business_id=${config.businessId}`;
    if (create && members.length === 0) {
      await tx`insert into membership(user_id,business_id,role) values(${config.ownerId},${config.businessId},'owner')`;
    } else if (members.length !== 1 || members[0].user_id !== config.ownerId || members[0].role !== 'owner') {
      throw new Error('private founder ownership required');
    }
  });
  return config;
}

function isolatedEnv(env: PilotEnv, messages: unknown[] = []): Env {
  return { ...env, RUNTIME_SPARE_POOL_ENABLED: 'true', RUNTIME_SPARE_POOL_TARGET: '1', SELF: undefined,
    RUNTIME_QUEUE: { send: async (message: unknown) => { messages.push(message); } } as unknown as Queue,
  };
}

const confirmations: Record<string, string> = {
  '/prepare': 'prepare-one-clean-spare', '/activate': 'activate-private-pilot',
  '/run': 'run-private-smoke', '/retry': 'retry-with-pool-off',
};

export async function handleSparePilot(request: Request, env: PilotEnv): Promise<Response> {
  if (!authorized(request, env)) return json({ ok: false }, 401);
  try {
    const path = new URL(request.url).pathname;
    const config = await checkedOwner(env);
    if (request.method === 'GET' && path === '/status') {
      const runtime = await withTenant(env, config.businessId, tx => getRuntime(tx, config.businessId));
      return json({ ok: true, productionPoolFlag: env.RUNTIME_SPARE_POOL_ENABLED,
        release: env.RUNTIME_RELEASE, bundle: env.RUNTIME_BUNDLE_COMMIT,
        requiredSecretsPresent: Boolean(env.SPRITES_TOKEN && env.CREDENTIAL_KEY && env.AISAR_MODEL_KEY),
        runtime: runtime ? { name: runtime.providerName, status: runtime.status,
          release: runtime.observedRelease, checkpoint: runtime.latestCheckpointId } : null });
    }
    if (request.method !== 'POST' || !confirmations[path]) return json({ ok: false }, 404);
    const text = await request.text();
    const body = text.length <= 1024 ? JSON.parse(text) : null;
    if (!body || Object.keys(body).length !== 1 || body.confirm !== confirmations[path]) return json({ ok: false }, 400);
    const privateEnv = isolatedEnv(env);
    if (path === '/prepare') {
      const messages: unknown[] = [];
      await refillSparePool(isolatedEnv(env, messages));
      if (messages.length !== 1) return json({ ok: false, err: 'Exactly one queued preparation required.' }, 409);
      const message = messages[0] as SpareQueueMessage;
      const result = await prepareRuntimeSpare(privateEnv, message);
      return json({ ok: result.reason === 'completed', spareId: message.spareId, result }, result.reason === 'completed' ? 200 : 409);
    }
    await checkedBusiness(env, path === '/activate');
    if (path === '/activate') {
      const lifecycle = await withTenant(env, config.businessId, tx => enqueueRuntimeTask(tx, config.businessId,
        { kind: 'provision', dedupeKey: `private-pool-pilot:provision:${env.RUNTIME_RELEASE}` }));
      const result = await handleRuntimeQueueMessage(privateEnv, { version: 1, businessId: config.businessId, taskId: lifecycle.id });
      const runtime = await withTenant(env, config.businessId, tx => getRuntime(tx, config.businessId));
      const ok = runtime?.status === 'ready' && /^aisar-p-[0-9a-f]{32}$/.test(runtime.providerName) &&
        runtime.observedRelease === env.RUNTIME_RELEASE && /^v\d+$/.test(runtime.latestCheckpointId ?? '');
      return json({ ok, result, taskId: lifecycle.id, runtime: runtime ? {
        name: runtime.providerName, status: runtime.status, release: runtime.observedRelease,
        checkpoint: runtime.latestCheckpointId } : null }, ok ? 200 : 409);
    }
    if (path === '/retry') {
      const before = await withTenant(env, config.businessId, tx => getRuntimeAccess(env, tx, config.businessId));
      if (!/^aisar-p-[0-9a-f]{32}$/.test(before.runtime.providerName)) throw new Error('assigned pilot spare required');
      const after = await ensureProviderRuntime({ ...privateEnv, RUNTIME_SPARE_POOL_ENABLED: 'false' }, config.businessId);
      const access = await withTenant(env, config.businessId, tx => getRuntimeAccess(env, tx, config.businessId));
      const sameResource = before.runtime.providerId === after.providerId && before.runtime.providerName === after.providerName;
      const sameTenantCredentials = before.secrets.runnerKey === access.secrets.runnerKey &&
        before.secrets.hermesApiKey === access.secrets.hermesApiKey;
      const ok = sameResource && sameTenantCredentials && after.status === 'ready' && after.observedRelease === env.RUNTIME_RELEASE;
      return json({ ok, sameResource, sameTenantCredentials, poolOff: true }, ok ? 200 : 409);
    }
    const runtime = await withTenant(env, config.businessId, tx => getRuntime(tx, config.businessId));
    if (runtime?.status !== 'ready' || !/^aisar-p-[0-9a-f]{32}$/.test(runtime.providerName)) throw new Error('ready pilot spare required');
    const smoke = await withTenant(env, config.businessId, async tx => {
      const dedupeKey = `private-pool-pilot:smoke:${env.RUNTIME_RELEASE}`;
      const existing = await runtimeTaskByDedupeKey(tx, config.businessId, dedupeKey);
      if (existing) return existing;
      const run = await startRun(tx, config.businessId, { kind: 'ask', triggerShape: 'operator-pilot',
        requestedBy: config.ownerId, runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME });
      return enqueueRuntimeTask(tx, config.businessId, { kind: 'run', runId: run.id, dedupeKey,
        payload: { input: INPUT, instructions: 'Private readiness smoke. No external actions. Answer POOL_PILOT_OK.',
          responseMode: 'quick', model: env.AISAR_MODEL_NAME, requestedAtMs: Date.now() } });
    });
    const result = await handleRuntimeQueueMessage(privateEnv,
      { version: 1, businessId: config.businessId, taskId: smoke.id }, { observationSliceMs: 5_000 });
    const observed = await withTenant(env, config.businessId, async tx => {
      const [row] = await tx`select status,result from runtime_task where id=${smoke.id}`;
      const [run] = await tx`select status from run where id=${smoke.runId!}`;
      return { taskStatus: row.status, runStatus: run.status,
        responseOk: row.status === 'completed' && JSON.stringify(row.result).includes('POOL_PILOT_OK') };
    });
    return json({ ok: true, taskId: smoke.id, result, ...observed });
  } catch {
    // Provider responses and DB errors can contain credentials or records.
    return json({ ok: false, err: 'Private pilot check failed; inspect scoped metadata only.' }, 409);
  }
}

export default { fetch: handleSparePilot };
