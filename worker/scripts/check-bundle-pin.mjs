#!/usr/bin/env node
/**
 * check-bundle-pin.mjs — predeploy guard that the bundle a sprite will be
 * sent actually exists, and is the one the deploy claims.
 *
 * Since 2026-09-23 a sprite downloads one object from R2 instead of 24 curls
 * against raw.githubusercontent.com, which is what lets this repository be
 * private. Two new ways to strand provisioning came with it, both of which
 * `wrangler deploy` would ship without complaint:
 *
 *   - RUNTIME_BUNDLE_COMMIT names a commit nobody ever packed and uploaded.
 *     Every bootstrap then 404s, which is exactly the outage that followed
 *     making the repo private the first time.
 *   - RUNTIME_BUNDLE_SHA256 does not match what packing that commit produces,
 *     so every sprite downloads a correct bundle and rejects it.
 *
 * Both are checked here rather than trusted, and the bucket is checked by
 * pulling the bytes back and hashing them. `wrangler r2 object get` without
 * `--remote` reads a local miniflare store, prints nothing alarming and exits
 * 0; twelve uploads once "succeeded" that way against a bucket that never
 * changed. Exit codes are not evidence about a bucket. Bytes are.
 *
 * Exit 0 = safe to deploy. Exit 1 = the deploy would strand provisioning.
 */
import { readFileSync, mkdtempSync, readFileSync as read, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleKey, packBundle } from './bundle-pack.mjs';

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exit(1); };

const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const commit = wrangler.match(/RUNTIME_BUNDLE_COMMIT\s*=\s*"([0-9a-f]{40})"/)?.[1];
const pinned = wrangler.match(/RUNTIME_BUNDLE_SHA256\s*=\s*"([0-9a-f]{64})"/)?.[1];
const bucket = wrangler.match(/binding\s*=\s*"RUNTIME_BUNDLES"\s*\nbucket_name\s*=\s*"([^"]+)"/)?.[1];
if (!commit) fail('RUNTIME_BUNDLE_COMMIT not found in wrangler.toml');
if (!pinned) fail('RUNTIME_BUNDLE_SHA256 not found in wrangler.toml; provisioning refuses to run without it');
if (!bucket) fail('the RUNTIME_BUNDLES r2_buckets binding is missing from wrangler.toml');

// ---- 1. the pin describes what packing that commit actually produces ------
let packed;
try {
  packed = packBundle(commit);
} catch (error) {
  fail(`could not pack ${commit}: ${error.message}\n` +
       `      Fetch the commit (git fetch origin ${commit}) before deploying.`);
}
if (packed.sha256 !== pinned) {
  fail(`RUNTIME_BUNDLE_SHA256 is ${pinned}\n` +
       `      but packing ${commit} produces ${packed.sha256}.\n` +
       '      Every sprite would download a correct bundle and reject it. Repin with\n' +
       '      worker/scripts/ship-runtime.sh rather than editing wrangler.toml by hand.');
}
console.log(`ok    pin matches a local repack of ${commit.slice(0, 12)} (${packed.bytes.length} bytes, ${packed.assets.length} files)`);

// ---- 2. the bucket actually holds those bytes ----------------------------
if (process.env.SKIP_BUNDLE_BUCKET_CHECK === '1') {
  console.log('warn  bucket round-trip skipped by SKIP_BUNDLE_BUCKET_CHECK');
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), 'bundle-pin-'));
try {
  const out = join(dir, 'bundle.tar.gz');
  try {
    execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'get', `${bucket}/${bundleKey(commit)}`,
      '--file', out, '--remote'], { stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname });
  } catch (error) {
    fail(`${bucket}/${bundleKey(commit)} could not be read back.\n` +
         `      ${String(error.stderr ?? error.message).trim().split('\n').slice(-2).join(' ')}\n` +
         '      Upload it first: worker/scripts/ship-runtime.sh does this as part of a release,\n' +
         `      or node worker/scripts/bundle-upload.mjs ${commit}`);
  }
  const got = createHash('sha256').update(read(out)).digest('hex');
  if (got !== pinned) {
    fail(`${bucket}/${bundleKey(commit)} hashes to ${got}, not the pinned ${pinned}.\n` +
         '      The right key is holding the wrong bytes; re-upload before deploying.');
  }
  console.log(`ok    ${bucket}/${bundleKey(commit)} round-trips to the pinned digest`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
