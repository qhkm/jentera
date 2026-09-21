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
