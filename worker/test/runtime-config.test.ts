import { beforeEach, describe, expect, it } from 'vitest';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import { CONFIG_SCHEMA, ConfigSchemaUnsupported, renderRuntimeConfig } from '../src/runtime/config-document';
import { handleRuntimeConfig, RUNTIME_CONFIG_PATH } from '../src/routes/runtime-config';
import { resolveRuntimeIdentity, RuntimeIdentityError } from '../src/runtime/identity';
import { asApp, asOwner, req, testEnv, truncateAll } from './harness';
import type { Env } from '../src/env';

const CONTROL_SECRET = 'fmcv-control-secret-'.padEnd(48, 's');
const RID = 'aisar-b-0123456789abcdef0123';
const EXTRACT = 'https://extract.kitakod.com';
const KEY = 'k'.repeat(64);

const configEnv = (over: Record<string, unknown> = {}) => testEnv({
  AISAR_MODEL_KEY: CONTROL_SECRET,
  AISAR_EXTRACT_BASE: EXTRACT,
  AISAR_EXTRACT_KEY: KEY,
  ...over,
});

async function credential(secret = CONTROL_SECRET): Promise<string> {
  return (await deriveJenteraRuntimeCredential(secret, RID)).key;
}

/** A provisioned fly-sprite runtime for RID, as the migration's function expects. */
async function seedRuntime(): Promise<string> {
  const businessId = '33333333-3333-4333-8333-333333333333';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${businessId}, 'Config Test', 'restaurant')`;
    await sql`
      insert into agent_runtime (business_id, provider, provider_name, status, desired_release)
      values (${businessId}, 'fly-sprite', ${RID}, 'ready', '2026.09.10-5')`;
  });
  return businessId;
}

async function call(env: Env, opts: { token?: string; schema?: string; method?: string } = {}) {
  const { request, url } = req(opts.method ?? 'GET', RUNTIME_CONFIG_PATH);
  const withHeaders = new Request(request, {
    headers: {
      ...Object.fromEntries(request.headers),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.schema ? { 'X-Aisar-Config-Schema': opts.schema } : {}),
    },
  });
  return handleRuntimeConfig(withHeaders, env, url, {});
}

beforeEach(async () => {
  await truncateAll();
});

describe('the rendered configuration document', () => {
  const runtime = { desiredRelease: '2026.09.10-5' };

  it('names the extract backend only when the credentials exist to serve it', async () => {
    /* Exactly the decision configure-model-provider.py makes on the sprite:
       naming firecrawl without a URL and key would replace a working
       fallback with a hard failure. */
    const on = await renderRuntimeConfig(configEnv(), runtime);
    expect(on.hermes.web).toEqual({
      backend: 'ddgs', search_backend: 'ddgs', extract_backend: 'firecrawl',
    });
    expect(on.hermesEnv).toEqual({ FIRECRAWL_API_URL: EXTRACT, FIRECRAWL_API_KEY: KEY });

    const off = await renderRuntimeConfig(
      configEnv({ AISAR_EXTRACT_BASE: undefined, AISAR_EXTRACT_KEY: undefined }), runtime);
    expect(off.hermes.web.extract_backend).toBeUndefined();
    expect(off.hermesEnv).toEqual({});
  });

  it('gives the same version for the same configuration, whatever the clock says', async () => {
    /* The version is compared for equality, so it must not drift with time
       or with object insertion order. */
    const a = await renderRuntimeConfig(configEnv(), runtime, CONFIG_SCHEMA, new Date('2026-01-01T00:00:00Z'));
    const b = await renderRuntimeConfig(configEnv(), runtime, CONFIG_SCHEMA, new Date('2026-09-11T02:00:00Z'));
    expect(a.version).toBe(b.version);
    expect(a.issuedAt).not.toBe(b.issuedAt);
  });

  it('moves the version when the configuration changes', async () => {
    const on = await renderRuntimeConfig(configEnv(), runtime);
    const off = await renderRuntimeConfig(
      configEnv({ AISAR_EXTRACT_BASE: undefined, AISAR_EXTRACT_KEY: undefined }), runtime);
    expect(on.version).not.toBe(off.version);
  });

  it('moves the version when the owner changes a specialist remit', async () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      profile: 'sp-pastry',
      name: 'Pastry R&D',
      description: 'Develop recipes.',
      instructions: '',
      enabled: true,
    };
    const first = await renderRuntimeConfig(
      configEnv(), runtime, CONFIG_SCHEMA, new Date(), [base]);
    const revised = await renderRuntimeConfig(
      configEnv(), runtime, CONFIG_SCHEMA, new Date(),
      [{ ...base, description: 'Develop and cost recipes.' }]);
    expect(revised.version).not.toBe(first.version);
  });

  it('never lets a secret reach the version hash', async () => {
    /* Values are replaced by the names of the settings they came from before
       hashing. A rotated key therefore does not move the version — stated as
       a tradeoff in the module, not an accident — and its bytes never enter
       a hash the control plane logs. */
    const one = await renderRuntimeConfig(configEnv(), runtime);
    const rotated = await renderRuntimeConfig(configEnv({ AISAR_EXTRACT_KEY: 'z'.repeat(64) }), runtime);
    expect(rotated.version).toBe(one.version);
    expect(rotated.hermesEnv.FIRECRAWL_API_KEY).toBe('z'.repeat(64));
  });

  it('refuses a schema it cannot render', async () => {
    await expect(renderRuntimeConfig(configEnv(), runtime, CONFIG_SCHEMA + 1)).rejects.toThrow(ConfigSchemaUnsupported);
  });
});

describe('the runtime config route', () => {
  it('refuses a missing, malformed or foreign credential', async () => {
    const env = configEnv();
    expect((await call(env))!.status).toBe(401);
    expect((await call(env, { token: 'not-a-jentera-key' }))!.status).toBe(401);
    const foreign = await credential('another-control-secret-'.padEnd(48, 'x'));
    expect((await call(env, { token: foreign }))!.status).toBe(401);
  });

  it('refuses a real credential whose runtime does not exist', async () => {
    /* 403, not 401: the credential verified, the runtime is gone. Telling
       those apart is what makes a revoked sprite legible in the logs. */
    const response = await call(configEnv(), { token: await credential() });
    expect(response!.status).toBe(403);
  });

  it('serves the document to the runtime that credential belongs to', async () => {
    const businessId = await seedRuntime();
    await asApp(async (sql) => {
      await sql.begin(async (tx) => {
        await tx`select set_config('app.business_id', ${businessId}, true)`;
        await tx`insert into specialist_profile
          (business_id, profile_key, name, description, instructions)
          values (${businessId}, 'sp-pastry', 'Pastry R&D',
                  'Develop recipes and test lamination.', 'Prefer local ingredients.')`;
      });
    });
    const response = await call(configEnv(), { token: await credential() });
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Cache-Control')).toBe('no-store');
    const body = await response!.json() as Record<string, unknown>;
    expect(body.schema).toBe(CONFIG_SCHEMA);
    expect(body.release).toBe('2026.09.10-5');
    expect((body.hermesEnv as Record<string, string>).FIRECRAWL_API_URL).toBe(EXTRACT);
    expect(body.specialists).toEqual([{
      profile: 'sp-pastry',
      name: 'Pastry R&D',
      description: 'Develop recipes and test lamination.',
      instructions: 'Prefer local ingredients.',
    }]);
    expect(typeof body.version).toBe('string');
  });

  it('answers 409 for a schema it cannot render, so the runtime keeps last known good', async () => {
    await seedRuntime();
    const response = await call(configEnv(), { token: await credential(), schema: String(CONFIG_SCHEMA + 1) });
    expect(response!.status).toBe(409);
    expect(await response!.json()).toMatchObject({ err: 'schema unsupported', supported: CONFIG_SCHEMA });
  });

  it('rejects a nonsense schema header rather than guessing', async () => {
    await seedRuntime();
    for (const schema of ['nope', '0', '-1']) {
      const response = await call(configEnv(), { token: await credential(), schema });
      expect(response!.status).toBe(400);
    }
  });

  it('only answers GET, and ignores every other path', async () => {
    await seedRuntime();
    const post = await call(configEnv(), { token: await credential(), method: 'POST' });
    expect(post!.status).toBe(405);
    const other = req('GET', '/v1/runtime/other');
    expect(await handleRuntimeConfig(other.request, configEnv(), other.url, {})).toBeNull();
  });
});

describe('runtime identity', () => {
  it('resolves the rider to its business as the app role, not the owner', async () => {
    /* The mapping row is behind RLS, so this only works because migration
       027's function is SECURITY DEFINER. Asserting as aisar_app is the
       point: an owner-side assertion would pass while production could not
       resolve anything. */
    const businessId = await seedRuntime();
    const [row] = await asApp((sql) => sql<{ id: string | null }[]>`
      select public.runtime_business_for_rider(${RID}) as id`);
    expect(row.id).toBe(businessId);
  });

  it('returns nothing for an unknown rider', async () => {
    const [row] = await asApp((sql) => sql<{ id: string | null }[]>`
      select public.runtime_business_for_rider('aisar-b-nosuchrider00000') as id`);
    expect(row.id).toBeNull();
  });

  it('surfaces a missing control secret as a typed 503 rather than a 401', async () => {
    /* A misconfigured worker is not a bad credential, and answering 401
       would send someone hunting the sprite instead of the deploy. */
    const { request } = req('GET', RUNTIME_CONFIG_PATH);
    const authed = new Request(request, {
      headers: { Authorization: `Bearer ${await credential()}` },
    });
    await expect(resolveRuntimeIdentity(testEnv({ AISAR_MODEL_KEY: '' }), authed))
      .rejects.toBeInstanceOf(RuntimeIdentityError);
  });
});
