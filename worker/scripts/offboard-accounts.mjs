import assert from 'node:assert/strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_EMAIL = 'qhkmdev90@gmail.com';
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
const arrayParameter = values => '{' + values.map(value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"').join(',') + '}';

/** Exact, reviewed operator targets only. Does not erase businesses, VMs,
 * files, billing evidence or task results. Requires a verified backup before
 * deletion. Unsupported dependencies fail closed rather than cascading data. */
export async function offboardAccounts(sql, targets, backup) {
  assert.ok(Array.isArray(targets) && targets.length > 0 && targets.length <= 10, 'Explicit targets required');
  assert.equal(typeof backup, 'function', 'Verified backup callback required');
  assert.equal(new Set(targets.map(target => target.id)).size, targets.length, 'Duplicate target');
  for (const target of targets) {
    assert.ok(UUID.test(target.id) && typeof target.email === 'string' && target.email.includes('@'), 'Invalid target');
    assert.equal(target.email, target.email.trim().toLowerCase(), 'Email must be normalized');
    assert.notEqual(target.email, OWNER_EMAIL, 'Protected operator account');
  }
  return sql.begin('isolation level serializable', async tx => {
    const [role] = await tx`select current_user as role`;
    assert.notEqual(role.role, 'aisar_app', 'Operator role required');
    // fetch_types is disabled. Bind a quoted array literal as a parameter,
    // never SQL text; the server casts it without relying on array OID maps.
    const ids = arrayParameter(targets.map(target => target.id));
    const users = await tx`select * from app_user where id = any(${ids}::uuid[]) for update`;
    assert.equal(users.length, targets.length, 'Some target accounts are missing');
    for (const target of targets) assert.equal(users.find(user => user.id === target.id)?.email.toLowerCase(), target.email, 'Target identity changed');
    const memberships = await tx`select * from membership where user_id = any(${ids}::uuid[]) for update`;
    assert.ok(memberships.every(member => member.role === 'owner'), 'Shared workspace requires separate offboarding review');
    const businesses = arrayParameter(memberships.map(member => member.business_id));
    const [others] = await tx`select count(*)::int as count from membership
      where business_id=any(${businesses}::uuid[]) and not(user_id=any(${ids}::uuid[]))`;
    assert.equal(others.count, 0, 'Other workspace members require separate offboarding review');
    const [active] = await tx`select count(*)::int as count from run where business_id=any(${businesses}::uuid[])
      and status in ('queued','working','needs_approval')`;
    assert.equal(active.count, 0, 'Active work requires separate offboarding review');
    const identities = await tx`select * from oauth_identity where user_id = any(${ids}::uuid[])`;
    const sessions = await tx`select * from session where user_id = any(${ids}::uuid[])`;

    const references = await tx`select n.nspname as schema, c.relname as table, a.attname as column,
        k.confdeltype as on_delete, array_length(k.conkey,1) as columns from pg_constraint k
      join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid and a.attnum=k.conkey[1]
      where k.confrelid='public.app_user'::regclass and k.contype='f'`;
    const allowed = new Set(['public.membership.user_id', 'public.oauth_identity.user_id', 'public.session.user_id',
      'public.chat_preview_account.user_id', 'public.business_fact.confirmed_by', 'public.run.requested_by']);
    for (const ref of references) {
      assert.equal(ref.columns, 1, 'Composite dependency requires separate offboarding review');
      const path = `${ref.schema}.${ref.table}.${ref.column}`;
      const [count] = await tx.unsafe(`select count(*)::int as count from ${identifier(ref.schema)}.${identifier(ref.table)} where ${identifier(ref.column)}=any($1::uuid[])`, [ids]);
      assert.ok(count.count === 0 || allowed.has(path), 'Unsupported account dependency; removal aborted');
    }
    const previews = await tx`select * from chat_preview_account where user_id = any(${ids}::uuid[])`;
    const previewRequests = await tx`select * from chat_preview_request where user_id = any(${ids}::uuid[])`;
    const facts = await tx`select id, confirmed_by from business_fact where confirmed_by = any(${ids}::uuid[])`;
    const runs = await tx`select id, requested_by from run where requested_by = any(${ids}::uuid[])`;
    const canonicalEmails = await tx`select public.canonical_account_email(address) as email
      from unnest(${arrayParameter(targets.map(target => target.email))}::text[]) as address`;
    const emails = arrayParameter(canonicalEmails.map(row => row.email));
    assert.ok(!canonicalEmails.some(row => row.email === OWNER_EMAIL), 'Protected operator account');
    const logins = await tx`select * from login_token where public.canonical_account_email(email::text)=any(${emails}::text[])`;
    const waitlist = await tx`select * from waitlist_entry where public.canonical_account_email(email)=any(${emails}::text[])`;
    const grants = await tx`select * from platform_access where public.canonical_account_email(email)=any(${emails}::text[])`;
    assert.ok(grants.every(grant => grant.kind !== 'paid'), 'Paid grant requires billing offboarding review');
    const recovery = await backup({ users, memberships, identities, sessions, previews, previewRequests, facts, runs, logins, waitlist, grants });
    assert.ok(recovery?.verified === true, 'Backup must be verified before deletion');

    for (const target of targets) await tx`insert into account_block(email)
      values(public.canonical_account_email(${target.email})) on conflict(email) do nothing`;
    for (const identity of identities) await tx`insert into account_identity_block(provider, subject)
      values(${identity.provider}, ${identity.subject}) on conflict(provider,subject) do nothing`;
    await tx`delete from chat_preview_request where user_id = any(${ids}::uuid[])`;
    await tx`delete from chat_preview_account where user_id = any(${ids}::uuid[])`;
    await tx`delete from login_token where public.canonical_account_email(email::text)=any(${emails}::text[])`;
    await tx`delete from waitlist_entry where public.canonical_account_email(email)=any(${emails}::text[])`;
    await tx`update platform_access set revoked_at=now() where public.canonical_account_email(email)=any(${emails}::text[])`;
    await tx`update business_fact set confirmed_by=null where confirmed_by = any(${ids}::uuid[])`;
    await tx`update run set requested_by=null where requested_by = any(${ids}::uuid[])`;
    const removed = await tx`delete from app_user where id = any(${ids}::uuid[]) returning id`;
    assert.equal(removed.length, targets.length, 'Removal verification failed');
    const [remaining] = await tx`select count(*)::int as count from app_user where id = any(${ids}::uuid[])`;
    assert.equal(remaining.count, 0, 'Account records remain');
    return { removed: removed.length, revokedSessions: sessions.length, blockedIdentities: identities.length,
      removedPreviewLedgers: previews.length, preservedFacts: facts.length, preservedRuns: runs.length, recovery: recovery.path ?? null };
  });
}
