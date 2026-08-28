/* ============================================================
   Credentials, linking, and rate limiting.

   The account-linking tests are the ones worth reading. Three ways in
   is easy; the hard part is deciding when two credentials are the same
   person, and getting that wrong is a silent account takeover rather
   than a visible bug.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, testEnv, truncateAll } from './harness';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from '../src/password';
import { authLandingPath, claimGoogleIdentity } from '../src/auth';
import { countAndRecord } from '../src/ratelimit';

beforeEach(async () => {
  await truncateAll();
});

/* The REAL query, not a copy of it: claimGoogleIdentity takes a
   connection rather than an Env precisely so this suite can run the
   same SQL production runs. */
async function googleClaims(email: string, subject: string, name: string | null) {
  return asApp((sql) => claimGoogleIdentity(sql, { email, subject, name }));
}

describe('password hashing', () => {
  it('round-trips', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-batteru', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password-twice');
    const b = await hashPassword('same-password-twice');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-twice', a)).toBe(true);
    expect(await verifyPassword('same-password-twice', b)).toBe(true);
  });

  it('records its own cost, so it can be raised later without a migration', async () => {
    const hash = await hashPassword('whatever-goes-here');
    const [scheme, digest, iterations] = hash.split('$');
    expect(scheme).toBe('pbkdf2');
    expect(digest).toBe('sha256');
    expect(Number(iterations)).toBeGreaterThanOrEqual(100_000);
  });

  it('fails closed on anything malformed', async () => {
    for (const bad of [null, '', 'not-a-hash', 'pbkdf2$sha256$abc$x$y', 'pbkdf2$md5$1$a$b']) {
      expect(await verifyPassword('anything', bad as string | null)).toBe(false);
    }
  });

  it('has a dummy hash that verifies as a real one, so a miss costs the same work', async () => {
    // If DUMMY_HASH were malformed, verifyPassword would return early
    // and the timing gap it exists to close would reopen.
    expect(DUMMY_HASH.split('$')).toHaveLength(5);
    expect(await verifyPassword('certainly-not-the-password', DUMMY_HASH)).toBe(false);
  });

  it('enforces length, not composition', async () => {
    expect(passwordProblem('short')).toMatch(/at least/);
    expect(passwordProblem('a'.repeat(600))).toMatch(/too long/);
    expect(passwordProblem(undefined)).toMatch(/required/);
    // No uppercase, no digit, no symbol — and correctly accepted.
    expect(passwordProblem('all lowercase words here')).toBeNull();
  });
});

describe('account linking', () => {
  it('clears the password when Google claims an UNVERIFIED account', async () => {
    /* The pre-hijacking case. Someone registers a password against an
       address they do not own and waits; the real owner arrives via
       Google. Linking without clearing hands the squatter a live
       credential on someone else's account. */
    const hash = await hashPassword('squatter-chosen-password');
    await asApp(
      (sql) => sql`insert into app_user (email, password_hash, email_verified)
                   values ('victim@example.com', ${hash}, false)`,
    );

    await googleClaims('victim@example.com', 'google-sub-1', 'Real Owner');

    const [row] = await asOwner(
      (sql) => sql`select password_hash, email_verified from app_user
                    where email = 'victim@example.com'`,
    );
    expect(row.password_hash).toBeNull();
    expect(row.email_verified).toBe(true);
  });

  it('keeps the password when Google claims a VERIFIED account', async () => {
    // Same person, two credentials they both chose. Nothing to revoke.
    const hash = await hashPassword('my-own-real-password');
    await asApp(
      (sql) => sql`insert into app_user (email, password_hash, email_verified)
                   values ('owner@example.com', ${hash}, true)`,
    );

    await googleClaims('owner@example.com', 'google-sub-2', 'Owner');

    const [row] = await asOwner(
      (sql) => sql`select password_hash from app_user where email = 'owner@example.com'`,
    );
    expect(row.password_hash).toBe(hash);
    expect(await verifyPassword('my-own-real-password', row.password_hash)).toBe(true);
  });

  it('keys the identity on Google subject, not email', async () => {
    /* An address can be changed or reassigned; the subject cannot. If
       this were keyed on email, a reassigned Google Workspace address
       would inherit the previous holder's account. */
    const id = await googleClaims('person@example.com', 'stable-sub', 'Person');
    await asOwner(
      (sql) => sql`update app_user set email = 'renamed@example.com' where id = ${id}`,
    );

    const [link] = await asApp(
      (sql) => sql`select user_id from oauth_identity
                    where provider = 'google' and subject = 'stable-sub'`,
    );
    expect(link.user_id).toBe(id);
  });

  it('does not create a second account when the same Google user returns', async () => {
    const first = await googleClaims('repeat@example.com', 'sub-repeat', 'Repeat');
    const second = await googleClaims('repeat@example.com', 'sub-repeat', 'Repeat');
    expect(second).toBe(first);

    const [{ count }] = await asOwner(
      (sql) => sql<{ count: string }[]>`select count(*)::text from app_user`,
    );
    expect(Number(count)).toBe(1);
  });

  it('never overwrites an existing password on signup', async () => {
    /* signUpWithPassword uses `on conflict do nothing`. If it were
       `do update`, guessing an address would be enough to take the
       account. */
    const original = await hashPassword('the-real-password');
    await asApp(
      (sql) => sql`insert into app_user (email, password_hash, email_verified)
                   values ('taken@example.com', ${original}, true)`,
    );

    const attacker = await hashPassword('attacker-password');
    const rows = await asApp(
      (sql) => sql`insert into app_user (email, password_hash, email_verified)
                   values ('taken@example.com', ${attacker}, false)
                   on conflict (email) do nothing
                   returning id`,
    );

    expect(rows).toHaveLength(0); // signals 'exists' to the caller
    const [row] = await asOwner(
      (sql) => sql`select password_hash, email_verified from app_user
                    where email = 'taken@example.com'`,
    );
    expect(row.password_hash).toBe(original);
    expect(row.email_verified).toBe(true);
  });
});

describe('first authenticated destination', () => {
  it('sends every new identity method to onboarding until membership exists', async () => {
    const [user] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('new@example.com', true) returning id`);
    expect(await authLandingPath(testEnv(), user.id)).toBe('/onboard');

    const businessId = '11111111-1111-4111-8111-111111111111';
    await asOwner(async (sql) => {
      await sql`insert into business (id, name, playbook_key)
                values (${businessId}, 'New business', 'generic')`;
      await sql`insert into membership (user_id, business_id, role)
                values (${user.id}, ${businessId}, 'owner')`;
    });
    expect(await authLandingPath(testEnv(), user.id)).toBe('/app');
  });
});

describe('magic-link tokens', () => {
  it('can be consumed once', async () => {
    const hash = 'a'.repeat(64);
    await asApp(
      (sql) => sql`insert into login_token (token_hash, email, expires_at)
                   values (${hash}, 'once@example.com', now() + interval '15 minutes')`,
    );

    const consume = () =>
      asApp(
        (sql) => sql`update login_token set consumed_at = now()
                      where token_hash = ${hash} and consumed_at is null
                        and expires_at > now()
                      returning email`,
      );

    expect(await consume()).toHaveLength(1);
    expect(await consume()).toHaveLength(0);
  });

  it('cannot be consumed after expiry', async () => {
    const hash = 'b'.repeat(64);
    await asApp(
      (sql) => sql`insert into login_token (token_hash, email, expires_at)
                   values (${hash}, 'late@example.com', now() - interval '1 second')`,
    );
    const rows = await asApp(
      (sql) => sql`update login_token set consumed_at = now()
                    where token_hash = ${hash} and consumed_at is null
                      and expires_at > now()
                    returning email`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('rate-limit ledger', () => {
  /* Again the real implementation, so a change to the CTE cannot pass
     these tests by leaving a stale copy behind. */
  const count = async (email: string, ip: string) => {
    const r = await asApp((sql) => countAndRecord(sql, email, ip));
    return { email: r.byEmail, ip: r.byIp };
  };

  it('does not count a request against itself', async () => {
    expect(await count('a@example.com', 'ip1')).toEqual({ email: 0, ip: 0 });
  });

  it('counts previous attempts and records each one', async () => {
    await count('a@example.com', 'ip1');
    await count('a@example.com', 'ip1');
    expect(await count('a@example.com', 'ip1')).toEqual({ email: 2, ip: 2 });
  });

  it('separates addresses from each other while sharing an IP', async () => {
    await count('a@example.com', 'shared');
    await count('b@example.com', 'shared');
    // Third caller behind the same NAT: their own address is clean,
    // but the shared IP has two attempts on it.
    expect(await count('c@example.com', 'shared')).toEqual({ email: 0, ip: 2 });
  });

  it('ignores attempts older than the window', async () => {
    await asOwner(
      (sql) => sql`insert into auth_attempt (email, ip_hash, created_at)
                   values ('old@example.com', 'ip1', now() - interval '25 hours')`,
    );
    expect(await count('old@example.com', 'ip1')).toEqual({ email: 0, ip: 0 });
  });

  it('sweeps rows past the retention window', async () => {
    await asOwner(
      (sql) => sql`insert into auth_attempt (email, ip_hash, created_at)
                   values ('ancient@example.com', 'ip9', now() - interval '8 days')`,
    );
    await count('trigger@example.com', 'ip1');
    const rows = await asOwner(
      (sql) => sql`select 1 from auth_attempt where email = 'ancient@example.com'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('can be inserted into by the app role, identity column and all', async () => {
    /* bigserial would have needed a separate USAGE grant on its
       sequence, which the default privileges here do not confer. */
    await expect(
      asApp((sql) => sql`insert into auth_attempt (email, ip_hash) values ('x@y.z', 'ip')`),
    ).resolves.toBeDefined();
  });
});
