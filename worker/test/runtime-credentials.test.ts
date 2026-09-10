import { beforeEach, describe, expect, it } from 'vitest';
import { saveConnection } from '../src/connections';
import { CONFIG_SCHEMA, renderRuntimeConfig } from '../src/runtime/config-document';
import {
  isRuntimeConnector,
  RUNTIME_CREDENTIALS,
  runtimeCredentials,
} from '../src/runtime/runtime-credentials';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

async function business(id: string, name: string) {
  await asOwner(async (sql) => {
    await sql`insert into app_user (id, email) values (${USER}, ${`${id}@test`})
              on conflict (id) do nothing`;
    await sql`insert into business (id, name, playbook_key) values (${id}, ${name}, 'restaurant')
              on conflict (id) do nothing`;
  });
}

beforeEach(async () => {
  await truncateAll();
  await business(A, 'Kedai A');
  await business(B, 'Kedai B');
});

describe('which credentials reach a sprite', () => {
  it('delivers a runtime connector as the environment variable it maps to', async () => {
    const env = testEnv();
    await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'Cloudflare',
      method: 'api_token',
      externalId: 'acct-1',
      displayName: 'Kitakod Cloudflare',
      secret: 'cf-token-value',
      connectedBy: USER,
    }));

    const delivered = await asTenant(A, (tx) => runtimeCredentials(env, tx, A));
    expect(delivered).toEqual({ CLOUDFLARE_API_TOKEN: 'cf-token-value' });
  });

  it('never delivers a control-plane connector, whatever it is called', async () => {
    /* This is the load-bearing one. A sprite runs a general-purpose agent
       with a terminal, and web_extract now reads arbitrary pages into its
       context — so a credential delivered there is one a stranger's page can
       ask it to repeat. An owner's payment key has no business on that
       machine, and the Worker makes those calls itself. */
    const env = testEnv();
    for (const connector of ['Payment gateway', 'WhatsApp', 'Shopee']) {
      await asTenant(A, (tx) => saveConnection(env, tx, A, {
        connector,
        method: 'api_token',
        externalId: `${connector}-1`,
        displayName: connector,
        secret: `${connector}-secret`,
        connectedBy: USER,
      }));
      expect(isRuntimeConnector(connector)).toBe(false);
    }

    expect(await asTenant(A, (tx) => runtimeCredentials(env, tx, A))).toEqual({});

    const document = await renderRuntimeConfig(
      env, { desiredRelease: '2026.09.11-1' }, CONFIG_SCHEMA, new Date(), [],
      await asTenant(A, (tx) => runtimeCredentials(env, tx, A)),
    );
    const serialised = JSON.stringify(document);
    for (const connector of ['Payment gateway', 'WhatsApp', 'Shopee']) {
      expect(serialised).not.toContain(`${connector}-secret`);
    }
  });

  it('hands one business nothing belonging to another', async () => {
    const env = testEnv();
    await asTenant(B, (tx) => saveConnection(env, tx, B, {
      connector: 'Cloudflare',
      method: 'api_token',
      externalId: 'acct-b',
      displayName: 'Other business',
      secret: 'b-only-token',
      connectedBy: USER,
    }));
    expect(await asTenant(A, (tx) => runtimeCredentials(env, tx, A))).toEqual({});
  });

  it('skips a connector that is present but not connected', async () => {
    /* A token in the environment that no longer works reads to the agent as
       a permissions problem, which is harder to act on than absence. */
    const env = testEnv();
    await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'Cloudflare',
      method: 'api_token',
      externalId: 'acct-1',
      displayName: 'Kitakod Cloudflare',
      secret: 'cf-token-value',
      connectedBy: USER,
    }));
    await asOwner(async (sql) => {
      await sql`update connection set status = 'revoked' where business_id = ${A}`;
    });
    expect(await asTenant(A, (tx) => runtimeCredentials(env, tx, A))).toEqual({});
  });
});

describe('the configuration document', () => {
  it('carries the token in hermesEnv but never its value in the version', async () => {
    const env = testEnv();
    const withToken = await renderRuntimeConfig(
      env, { desiredRelease: '2026.09.11-1' }, CONFIG_SCHEMA, new Date(), [],
      { CLOUDFLARE_API_TOKEN: 'first-token' },
    );
    expect(withToken.hermesEnv.CLOUDFLARE_API_TOKEN).toBe('first-token');

    /* Rotating the value must not move the fleet; only names are hashed.
       The trade is deliberate and documented on versionOf(). */
    const rotated = await renderRuntimeConfig(
      env, { desiredRelease: '2026.09.11-1' }, CONFIG_SCHEMA, new Date(), [],
      { CLOUDFLARE_API_TOKEN: 'second-token' },
    );
    expect(rotated.version).toBe(withToken.version);

    /* Connecting or disconnecting one does move it: a name enters the set. */
    const without = await renderRuntimeConfig(
      env, { desiredRelease: '2026.09.11-1' }, CONFIG_SCHEMA, new Date(), [], {},
    );
    expect(without.version).not.toBe(withToken.version);
    expect(without.hermesEnv.CLOUDFLARE_API_TOKEN).toBeUndefined();
  });

  it('maps every runtime connector to a distinct variable', () => {
    const variables = Object.values(RUNTIME_CREDENTIALS);
    expect(new Set(variables).size).toBe(variables.length);
  });
});
