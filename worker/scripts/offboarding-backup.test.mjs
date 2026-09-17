import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { writeRecoveryBackup } from './offboarding-backup.mjs';

test('encrypts recovery records, verifies them and protects files from other users', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jentera-recovery-test-'));
  try {
    const snapshot = { users: [{ email: 'private-fixture@example.test', password_hash: 'private-test-hash' }] };
    const result = await writeRecoveryBackup(snapshot, directory);
    assert.equal(result.verified, true);
    const encoded = await readFile(result.path, 'utf8');
    assert.ok(!encoded.includes('private-fixture') && !encoded.includes('private-test-hash'));
    assert.equal((await stat(result.path)).mode & 0o077, 0);
    const keyPath = join(directory, 'recovery.key');
    assert.equal((await stat(keyPath)).mode & 0o077, 0);
    const payload = JSON.parse(encoded);
    const decrypt = createDecipheriv('aes-256-gcm', await readFile(keyPath), Buffer.from(payload.iv, 'base64'));
    decrypt.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const recovered = Buffer.concat([decrypt.update(Buffer.from(payload.ciphertext, 'base64')), decrypt.final()]);
    assert.deepEqual(JSON.parse(recovered).snapshot, snapshot);
    await chmod(keyPath, 0o644);
    await assert.rejects(writeRecoveryBackup(snapshot, directory), /key must be owner-only/);
  } finally { await rm(directory, { recursive: true }); }
});
