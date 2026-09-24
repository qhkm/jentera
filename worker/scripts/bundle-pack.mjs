#!/usr/bin/env node
/**
 * bundle-pack.mjs — build the runner bundle a sprite downloads, as one object.
 *
 * Until 2026-09-23 a sprite fetched its bundle as 24 separate curls against
 * raw.githubusercontent.com/qhkm/jentera/<commit>/<path>. That is the one
 * thing standing between this repository and being private: raw.github serves
 * public repositories anonymously and nothing else, so flipping visibility
 * returned 404 to every bootstrap and the next fresh provision died with
 * curl exit 22. Visibility was reverted to restore service.
 *
 * So the bundle moves to R2 and the sprite fetches one authenticated object.
 * Three things follow from packing it here rather than pointing curl somewhere
 * new:
 *
 *   - It is a derived artifact, so the release gate cannot verify it by
 *     content address the way it verified a commit. It is verified by being
 *     rebuilt: pack the pinned commit again and compare sha256. That only
 *     works if packing is deterministic, which is why nothing below reads the
 *     clock, the filesystem, or an environment variable.
 *   - One round trip replaces 24. docs/provisioning-time.md is the reason to
 *     care.
 *   - The archive is written by hand rather than shelled out to tar, so the
 *     layout, the modes and every header byte are decided here. `git archive`
 *     would carry repo paths and need --transform on the sprite to flatten
 *     them; a bundle is not worth a GNU-tar dependency.
 *
 * Entries are flat basenames at mode 0644, which is exactly what 24 curls
 * plus the bootstrap's chmod line produced. The chmod line stays: reproducing
 * today's on-disk state exactly is worth more than folding one command in.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Where the repo root is, relative to this script. */
export const repoRoot = () => new URL('../../', import.meta.url).pathname;

/**
 * The asset list, read from provision.ts rather than restated.
 *
 * provision.ts is the authority on what a sprite downloads and the release
 * gate already reads it with this same pattern. A second copy here would be a
 * list that keeps passing its own tests while the real one drifts.
 */
export function bundleAssets(provisionSource) {
  const source = provisionSource ?? readFileSync(
    new URL('../src/runtime/provision.ts', import.meta.url), 'utf8');
  const assets = [...source.matchAll(/'(runner\/(?:src|bin)\/[^']+)'/g)].map((m) => m[1]);
  if (!assets.length) throw new Error('no runner assets found in provision.ts');
  return [...new Set(assets)].sort();
}

/**
 * One file as it stands at a commit.
 *
 * The gate used to read these over HTTP from raw.githubusercontent.com. It
 * does not need to: a commit is content-addressed, so the local object and
 * the remote one are the same bytes by construction, and ship-runtime.sh
 * already refuses a bundle that is not an ancestor of origin/main. Reading
 * locally is also the end of "raw.githubusercontent lags new SHAs and
 * throttles bursts, retrying in 45s".
 */
export function readAtCommit(commit, path, options = {}) {
  const cwd = options.cwd ?? repoRoot();
  try {
    return execFileSync('git', ['show', `${commit}:${path}`], { cwd, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    /* A shallow or stale clone is a fixable problem, not a reason to pass. */
    try {
      execFileSync('git', ['fetch', '-q', 'origin', commit], { cwd, stdio: 'ignore' });
      return execFileSync('git', ['show', `${commit}:${path}`], { cwd, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return null;
    }
  }
}

/** The name a file takes on the sprite: the same flattening the curls did. */
export const bundleEntryName = (asset) => asset.replace(/^runner\/(?:src|bin)\//, '');

/** One 512-byte ustar header. Everything variable is pinned to a constant. */
function header(name, size) {
  const block = Buffer.alloc(512);
  const put = (text, offset, length) => block.write(text.padEnd(length, '\0'), offset, length, 'binary');
  if (Buffer.byteLength(name) > 100) throw new Error(`bundle entry name too long: ${name}`);
  put(name, 0, 100);
  put('000644 \0', 100, 8);          // mode
  put('000000 \0', 108, 8);          // uid: nobody in particular
  put('000000 \0', 116, 8);          // gid
  put(size.toString(8).padStart(11, '0') + ' ', 124, 12);
  put('00000000000 ', 136, 12);      // mtime 0: the clock must not reach the bytes
  block.write('        ', 148, 8, 'binary'); // checksum field, spaces while summing
  put('0', 156, 1);                  // typeflag: regular file
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return block;
}

/**
 * Pack one commit's bundle. Returns the gzipped bytes and their sha256.
 *
 * Reading through `git show` rather than the working tree is deliberate: the
 * bundle must be the commit, not whatever the checkout happens to hold. That
 * is the same reason ship-runtime.sh pins origin/main and refuses your HEAD.
 */
export function packBundle(commit, options = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('bundle commit must be a full sha');
  const cwd = options.cwd ?? repoRoot();
  const assets = options.assets ?? bundleAssets();
  const blocks = [];
  for (const asset of assets) {
    const body = execFileSync('git', ['show', `${commit}:${asset}`], {
      cwd, maxBuffer: 64 * 1024 * 1024,
    });
    blocks.push(header(bundleEntryName(asset), body.length), body);
    const remainder = body.length % 512;
    if (remainder) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks end an archive
  /* level 9 and mtime 0: gzip stamps the time into its own header otherwise,
     and a bundle that hashes differently every time cannot be verified by
     rebuilding it. */
  const bytes = gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), assets };
}

/** Where a commit's bundle lives in the bucket. */
export const bundleKey = (commit) => `bundles/${commit}.tar.gz`;

// macOS exposes /tmp and /var through /private symlinks. Comparing the raw
// argv path with import.meta.url therefore makes direct execution look like an
// import inside the detached worktree used by ship-runtime.sh. Canonicalise
// both sides so the CLI works from any real or symlinked checkout path.
const isDirectExecution = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const [commit, out] = process.argv.slice(2);
  if (!commit) {
    console.error('usage: bundle-pack.mjs <commit> [output.tar.gz]');
    process.exit(2);
  }
  const { bytes, sha256, assets } = packBundle(commit);
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, bytes);
  }
  console.log(JSON.stringify({ commit, key: bundleKey(commit), sha256, bytes: bytes.length, assets: assets.length }));
}
