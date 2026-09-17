import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./apply-runtime-spares.mjs', import.meta.url));
const secret = 'test-only-migration-password';

function run(connection, recovery = false) {
  const env = { ...process.env };
  delete env.AISAR_NEON_OWNER_URL;
  if (connection !== undefined) env.AISAR_NEON_OWNER_URL = connection;
  return spawnSync(process.execPath, [script, ...(recovery ? ['--recovery'] : [])], { env, encoding: 'utf8', timeout: 5000 });
}

test('requires an explicit owner URL, without opening a database connection', () => {
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AISAR_NEON_OWNER_URL is required/);
});

test('recovery migration also requires an explicit reviewed owner target', () => {
  assert.equal(run(undefined, true).status, 1);
  for (const value of [`invalid:${secret} [ malformed`, `postgres://neondb_owner:${secret}@127.0.0.1/neondb`]) {
    const result = run(value, true); assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  }
});

test('rejects malformed URLs without echoing their input', () => {
  const result = run(`invalid:${secret} [ malformed`);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test('refuses every unreviewed database target before connecting', () => {
  const host = 'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech';
  for (const connection of [
    `postgres://neondb_owner:${secret}@127.0.0.1/neondb`,
    `postgres://aisar_app:${secret}@${host}/neondb`,
    `postgres://neondb_owner:${secret}@${host}/other_database`,
    `postgres://neondb_owner:${secret}@${host}:6432/neondb`,
    `postgres://neondb_owner:${secret}@${host}/neondb#unexpected`,
  ]) {
    const result = run(connection);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the reviewed production owner target/);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  }
});
