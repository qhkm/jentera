/* ============================================================
   The credential vault.

   These hold other people's secrets — a business owner's bot token,
   which can post as their brand to their customers. The properties
   below are the reason the database can hold them at all.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, asTenant, truncateAll } from './harness';
import { KEY_VERSION, fingerprint, open, seal } from '../src/vault';
import { listConnections, saveConnection, useCredential, webhookSecret } from '../src/connections';
import type { Env } from '../src/env';

/* Only the fields the vault reads. A full Env needs bindings that do
   not exist outside workerd. */
const env = { CREDENTIAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) } as Env;
const other = { CREDENTIAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) } as Env;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let userId: string;

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    const [u] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    userId = u.id;
  });
});

describe('encryption', () => {
  it('round-trips', async () => {
    const sealed = await seal(env, '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    expect(await open(env, sealed, KEY_VERSION)).toBe('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
  });

  it('never produces the same ciphertext twice', async () => {
    /* A fresh IV per call. Reusing one under GCM leaks relationships
       between plaintexts — and would let anyone with the database see
       which businesses share a token. */
    const a = await seal(env, 'same-secret');
    const b = await seal(env, 'same-secret');
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('refuses a tampered ciphertext rather than returning garbage', async () => {
    const sealed = await seal(env, 'a-real-token');
    sealed[sealed.length - 1] ^= 0xff;
    /* AES-GCM authenticates. Under CBC this would decrypt to plausible
       rubbish that then gets sent to Telegram as a token. */
    await expect(open(env, sealed, KEY_VERSION)).rejects.toThrow();
  });

  it('is useless under a different key', async () => {
    const sealed = await seal(env, 'a-real-token');
    await expect(open(other, sealed, KEY_VERSION)).rejects.toThrow();
  });

  it('rejects a key that is not 32 bytes, loudly', async () => {
    // A short key would silently weaken every credential.
    const weak = { CREDENTIAL_KEY: btoa('too-short') } as Env;
    await expect(seal(weak, 'x')).rejects.toThrow(/32 bytes/);
  });

  it('refuses a truncated value', async () => {
    await expect(open(env, new Uint8Array(4), KEY_VERSION)).rejects.toThrow(/truncated/);
  });

  it('fingerprints without revealing', async () => {
    const fp = await fingerprint('123456789:AAHdqTcv');
    expect(fp).toHaveLength(8);
    expect(fp).not.toContain('AAHdqTcv');
    expect(await fingerprint('123456789:AAHdqTcv')).toBe(fp);
  });
});

describe('stored connections', () => {
  const input = {
    connector: 'telegram',
    method: 'bot_token',
    externalId: '123456789',
    displayName: '@alpha_bot',
    secret: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    connectedBy: '',
  };

  it('stores the secret encrypted, not in the clear', async () => {
    await asTenant(A, (tx) => saveConnection(env, tx, A, { ...input, connectedBy: userId }));
    const [row] = await asOwner(
      (sql) => sql<{ ciphertext: Uint8Array }[]>`select ciphertext from credential`,
    );
    const raw = Buffer.from(row.ciphertext).toString('utf8');
    expect(raw).not.toContain('AAHdqTcv');
    expect(raw).not.toContain('123456789:');
  });

  it('gives the secret back only through the vault', async () => {
    const saved = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, { ...input, connectedBy: userId }),
    );
    const token = await asTenant(A, (tx) => useCredential(env, tx, saved.id));
    expect(token).toBe(input.secret);
  });

  it('keeps no secret in the table the connections screen reads', async () => {
    await asTenant(A, (tx) => saveConnection(env, tx, A, { ...input, connectedBy: userId }));
    const rows = await asTenant(A, (tx) => listConnections(tx));
    expect(JSON.stringify(rows)).not.toContain('AAHdqTcv');
    expect(rows[0].displayName).toBe('@alpha_bot');
  });

  it('hides one business’s credential from another', async () => {
    const saved = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, { ...input, connectedBy: userId }),
    );
    /* credential has no business_id of its own; its policy reaches
       through the connection. This is the test that the reach-through
       actually works. */
    await expect(asTenant(B, (tx) => useCredential(env, tx, saved.id))).rejects.toThrow();
    expect(await asTenant(B, (tx) => listConnections(tx))).toHaveLength(0);
  });

  it('shows nothing with no tenant set', async () => {
    await asTenant(A, (tx) => saveConnection(env, tx, A, { ...input, connectedBy: userId }));
    expect(await asApp((sql) => sql`select id from connection`)).toHaveLength(0);
    expect(await asApp((sql) => sql`select connection_id from credential`)).toHaveLength(0);
  });

  it('replaces the secret when a connection is remade', async () => {
    const first = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, { ...input, connectedBy: userId }),
    );
    const second = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, { ...input, secret: 'new:token-value-here', connectedBy: userId }),
    );
    expect(second.id).toBe(first.id); // same connection, not a duplicate
    expect(await asTenant(A, (tx) => useCredential(env, tx, first.id))).toBe('new:token-value-here');
  });

  it('takes the credential with it when the connection goes', async () => {
    const saved = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, { ...input, connectedBy: userId }),
    );
    await asTenant(A, (tx) => tx`delete from connection where id = ${saved.id}`);
    expect(await asOwner((sql) => sql`select connection_id from credential`)).toHaveLength(0);
  });
});

describe('webhook secrets', () => {
  it('differ per connection', async () => {
    const a = await webhookSecret(env, '11111111-1111-4111-8111-111111111111');
    const b = await webhookSecret(env, '22222222-2222-4222-8222-222222222222');
    expect(a).not.toBe(b);
  });

  it('are stable, so they need not be stored', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(await webhookSecret(env, id)).toBe(await webhookSecret(env, id));
  });

  it('are within Telegram’s allowed shape', async () => {
    const s = await webhookSecret(env, '44444444-4444-4444-8444-444444444444');
    expect(s).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });
});
