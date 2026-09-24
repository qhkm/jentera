#!/usr/bin/env node
/**
 * bundle-upload.mjs — put one commit's packed runner bundle in R2.
 *
 * Called by ship-runtime.sh as part of a release; usable by hand to place a
 * bundle for a commit that predates this mechanism.
 *
 * It uploads and then reads the bytes back. `wrangler r2 object put` without
 * `--remote` writes a local miniflare store, prints "Upload complete." and
 * exits 0 — twelve uploads once "succeeded" that way against a bucket that
 * never changed, and what caught it was fetching one object back and hashing
 * it. So `--remote` is passed on both calls and the round trip is the check;
 * the exit code is not evidence.
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleKey, packBundle } from './bundle-pack.mjs';
import { execWrangler } from './wrangler-cli.mjs';

export function bucketName() {
  const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const name = wrangler.match(/binding\s*=\s*"RUNTIME_BUNDLES"\s*\nbucket_name\s*=\s*"([^"]+)"/)?.[1];
  if (!name) throw new Error('the RUNTIME_BUNDLES r2_buckets binding is missing from wrangler.toml');
  return name;
}

/** Upload a commit's bundle and prove it arrived. Returns its sha256. */
export function uploadBundle(commit, { bucket = bucketName() } = {}) {
  const { bytes, sha256, assets } = packBundle(commit);
  const key = bundleKey(commit);
  const dir = mkdtempSync(join(tmpdir(), 'bundle-upload-'));
  try {
    const local = join(dir, 'bundle.tar.gz');
    writeFileSync(local, bytes);
    execWrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--file', local,
      '--content-type', 'application/gzip', '--remote'], { stdio: 'pipe' });

    const back = join(dir, 'roundtrip.tar.gz');
    execWrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--file', back, '--remote'],
      { stdio: 'pipe' });
    const got = createHash('sha256').update(readFileSync(back)).digest('hex');
    if (got !== sha256) {
      throw new Error(`uploaded ${sha256} to ${bucket}/${key} but read back ${got}`);
    }
    return { key, sha256, bytes: bytes.length, assets: assets.length, bucket };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isDirectExecution = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const commit = process.argv[2];
  if (!commit) {
    console.error('usage: bundle-upload.mjs <commit>');
    process.exit(2);
  }
  try {
    console.log(JSON.stringify({ ok: true, commit, ...uploadBundle(commit) }));
  } catch (error) {
    console.error(`FAIL  ${String(error.stderr ?? error.message).trim()}`);
    process.exit(1);
  }
}
