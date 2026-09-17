import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./watch-spare-pool.mjs', import.meta.url));
const valid = ['2026.09.17-4', 'a'.repeat(40), '2'];
const secret = 'test-only-no-echo-secret';
function run(args, connection) {
  const env = { ...process.env }; delete env.AISAR_NEON_OWNER_URL;
  if (connection) env.AISAR_NEON_OWNER_URL = connection;
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', timeout: 5000 });
}
test('refuses invalid release pins and unbounded pool targets before connecting', () => {
  for (const args of [[], ['bad', valid[1], '2'], [valid[0], 'main', '2'], [valid[0], valid[1], '100']]) {
    assert.equal(run(args).status, 2);
  }
});
test('requires the explicit reviewed production owner without echoing credentials', () => {
  for (const connection of [undefined, `postgres://neondb_owner:${secret}@localhost/neondb`,
    `postgres://aisar_app:${secret}@ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech/neondb`]) {
    const result = run(valid, connection); assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  }
});
