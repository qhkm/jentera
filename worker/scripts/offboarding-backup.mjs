import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Owner-only, encrypted metadata recovery. No credentials or plaintext records
 * are printed. The key is separate from each backup; keep both private. */
export async function writeRecoveryBackup(snapshot, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0
    && info.uid === process.getuid(), 'Recovery directory must be owner-only');
  const keyPath = join(directory, 'recovery.key');
  try {
    const file = await open(keyPath, 'wx', 0o600);
    try { await file.writeFile(randomBytes(32)); await file.sync(); } finally { await file.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const keyFile = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let key;
  try {
    const info = await keyFile.stat();
    assert.ok(info.isFile() && info.uid === process.getuid() && (info.mode & 0o077) === 0,
      'Recovery key must be owner-only');
    key = await keyFile.readFile();
    assert.equal(key.length, 32, 'Invalid recovery key');
  } finally { await keyFile.close(); }
  const plaintext = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), snapshot }));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64') });
  const path = join(directory, `accounts-${randomUUID()}.json.enc`);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(payload); await file.sync(); } finally { await file.close(); }
  const recovered = JSON.parse(await readFile(path, 'utf8'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(recovered.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(recovered.tag, 'base64'));
  const roundTrip = Buffer.concat([decipher.update(Buffer.from(recovered.ciphertext, 'base64')), decipher.final()]);
  assert.ok(roundTrip.equals(plaintext), 'Recovery round-trip failed; deletion is not safe');
  plaintext.fill(0); roundTrip.fill(0); key.fill(0);
  return { verified: true, path };
}
