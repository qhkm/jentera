import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveRefusals, preflightRefusals, collectScript, SPRITE_NAME, ALLOWED } from './move-runtime-region.mjs';

test('carries the agent memory and conversation history', () => {
  assert.deepEqual(archiveRefusals([
    'memories/MEMORY.md',
    'memories/USER.md',
    'sessions/',
    'sessions/2026-09-20/turn.json',
    'profiles/operations/memories/USER.md',
    'profiles/growth/sessions/abc.json',
    'profiles/growth/state.db',
    'profiles/growth/state.db-wal',
  ]), []);
});

test('refuses every credential-bearing file, whatever the allowlist thinks', () => {
  for (const entry of [
    'profiles/growth/.env',
    'auth.json',
    'profiles/growth/config.yaml',
    'memories/MEMORY.md.lock',
    'profiles/default/pairing/token',
  ]) {
    assert.equal(archiveRefusals([entry]).length, 1, entry);
  }
});

test('refuses anything outside the allowlist rather than filtering it', () => {
  assert.match(archiveRefusals(['profiles/growth/workspace/notes.txt'])[0], /not in the allowlist/);
  assert.match(archiveRefusals(['../../etc/passwd'])[0], /escaping/);
  assert.match(archiveRefusals(['/etc/passwd'])[0], /absolute/);
  assert.match(archiveRefusals(['skills/thing.md'])[0], /not in the allowlist/);
});

test('the collected set and the allowlist cannot drift apart', () => {
  /* Every path the snippet collects must be one the verifier accepts, or a
     backup refuses itself after doing the work. */
  const script = collectScript('/tmp/x.tgz');
  for (const sample of [
    'memories/MEMORY.md', 'memories/USER.md', 'sessions',
    'profiles/growth/memories/MEMORY.md', 'profiles/growth/sessions',
    'profiles/growth/state.db', 'profiles/growth/state.db-shm', 'profiles/growth/state.db-wal',
  ]) {
    assert.equal(archiveRefusals([sample]).length, 0, sample);
  }
  assert.match(script, /memories\/MEMORY\.md/);
  assert.doesNotMatch(script, /\.env/);
  assert.doesNotMatch(script, /auth\.json/);
});

test('refuses a sprite that is busy, not ready, or already placed correctly', () => {
  const ready = { business_id: 'b', status: 'ready', created_at: '2026-08-28T00:00:00Z' };
  assert.deepEqual(preflightRefusals({ runtime: ready, activeRuns: 0, openTasks: 0 }), []);
  assert.match(preflightRefusals({ runtime: ready, activeRuns: 2, openTasks: 0 })[0], /2 runs/);
  assert.match(preflightRefusals({ runtime: ready, activeRuns: 0, openTasks: 1 })[0], /1 runtime tasks/);
  assert.match(preflightRefusals({ runtime: { ...ready, status: 'provisioning' }, activeRuns: 0, openTasks: 0 })[0], /not ready/);
  assert.match(
    preflightRefusals({ runtime: { ...ready, created_at: '2026-09-18T00:00:00Z' }, activeRuns: 0, openTasks: 0 })[0],
    /already provisioned from the placed invocation/,
  );
  assert.match(preflightRefusals({ runtime: null, activeRuns: 0, openTasks: 0 })[0], /no runtime row/);
});

test('only names a sprite can actually have', () => {
  assert.ok(SPRITE_NAME.test('aisar-b-c679d9df0aaa77ba1ec7'));
  assert.ok(SPRITE_NAME.test('aisar-p-aa39ec7b8d8e447a8560e8b8d012600d'));
  assert.ok(!SPRITE_NAME.test('aisar-b-../../etc'));
  assert.ok(!SPRITE_NAME.test('; rm -rf /'));
  assert.ok(ALLOWED.length > 0);
});

test('a candidate is old and either known-US or not yet seen', async () => {
  const { isCandidate } = await import('./move-runtime-region.mjs');
  const old = '2026-09-01T00:00:00Z';
  assert.equal(isCandidate({ created_at: old, egress_country: 'US' }), true);
  assert.equal(isCandidate({ created_at: old, egress_country: null }), true);
  assert.equal(isCandidate({ created_at: old, egress_country: 'SG' }), false);
  /* Made after the consumer moved: already provisioned from the placed
     invocation, wherever it happens to have landed. */
  assert.equal(isCandidate({ created_at: '2026-09-20T00:00:00Z', egress_country: 'US' }), false);
});

test('a sprite that cannot be provisioned again is never moved, --force or not', async () => {
  const { blockers } = await import('./move-runtime-region.mjs');
  const ready = { business_id: 'b', status: 'ready', created_at: '2026-08-28T00:00:00Z' };
  /* Name the mode rather than inheriting whatever wrangler.toml currently
     says: this is about the rule, not about today's deployment. */
  assert.equal(blockers({ canProvision: true }, 'waitlist').length, 0);
  assert.match(blockers({ canProvision: false }, 'waitlist')[0], /platform_access/);
  /* The blocker is inside the refusals too, so the single-sprite path reports
     it even before it reaches the check that --force cannot bypass. */
  const refusals = preflightRefusals({ runtime: ready, activeRuns: 0, openTasks: 0, canProvision: false },
    undefined, 'waitlist');
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /could not be undone/);
});

test('ids are bound as an array literal, not a bare comma list', async () => {
  const { arrayParameter } = await import('./move-runtime-region.mjs');
  assert.equal(arrayParameter(['a', 'b']), '{"a","b"}');
  assert.equal(arrayParameter([]), '{}');
  /* Postgres reads a bare comma list as a malformed array literal, which is
     what every wait in this script did until the deletes were already sent. */
  assert.notEqual(arrayParameter(['a', 'b']), 'a,b');
});

/* The grant only decides admission while ACCESS_MODE is waitlist. access.ts
   reads `restrictedAccess = env.ACCESS_MODE === 'waitlist'` and
   businessHasAccess returns true unconditionally otherwise, so once the mode
   is open a missing grant stops nothing. The blocker outlived that: on 23
   September it refused to move three sprites whose businesses the control
   plane would in fact have re-provisioned without complaint. */
test('the grant blocker applies only while access is restricted', async () => {
  const { blockers } = await import('./move-runtime-region.mjs');
  // Waitlist: a missing grant really would strand the business.
  assert.match(blockers({ canProvision: false }, 'waitlist')[0], /platform_access/);
  assert.equal(blockers({ canProvision: true }, 'waitlist').length, 0);
  // Open: businessHasAccess never consults the grant, so neither do we.
  assert.equal(blockers({ canProvision: false }, 'open').length, 0);
  assert.equal(blockers({ canProvision: true }, 'open').length, 0);
  // An unreadable mode is treated as waitlist: fail closed, not open. null is
  // the explicit "unknown" — a default parameter would swallow undefined.
  assert.match(blockers({ canProvision: false }, null)[0], /platform_access/);
  assert.equal(blockers({ canProvision: true }, null).length, 0);
});


test('an unreadable wrangler.toml reads as unknown, not as open', async () => {
  const { deployedAccessMode } = await import('./move-runtime-region.mjs');
  assert.equal(deployedAccessMode('ACCESS_MODE = "open"'), 'open');
  assert.equal(deployedAccessMode('ACCESS_MODE = "waitlist"'), 'waitlist');
  assert.equal(deployedAccessMode('nothing here'), null);
  assert.equal(deployedAccessMode(''), null);
});

/* A sprite that cannot answer cannot be backed up, and moveOne backs up before
   it deletes — deliberately, so nothing is destroyed that was not first saved.
   Three sprites on 23 September were unreachable in a way that made backup
   impossible by definition, and deleting them anyway was the right call. That
   needs its own opt-in: --force means "I read the refusals", which is a
   different and much smaller claim than "I accept losing the agent memory". */
test('skipping the backup is its own decision, not part of --force', async () => {
  const { backupRefusal } = await import('./move-runtime-region.mjs');
  // Default: a failed backup stops the move.
  assert.match(backupRefusal({ force: false, skipBackup: false }), /--skip-backup/);
  assert.match(backupRefusal({ force: true, skipBackup: false }), /--skip-backup/);
  // --skip-backup alone is not enough either; it must be a considered move.
  assert.match(backupRefusal({ force: false, skipBackup: true }), /--force/);
  // Both, explicitly, and only then.
  assert.equal(backupRefusal({ force: true, skipBackup: true }), null);
});

