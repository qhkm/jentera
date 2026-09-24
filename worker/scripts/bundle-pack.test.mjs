import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleAssets, bundleEntryName, bundleKey, packBundle, repoRoot } from './bundle-pack.mjs';

/* The bundle is a derived artifact, so the release gate cannot verify it by
   content address the way it verified a commit on GitHub. It verifies it by
   rebuilding it, which is only a check if packing is deterministic — hence
   the first test, which is the load-bearing one. */

const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot() }).toString().trim();

test('packing the same commit twice produces the same bytes', () => {
  const a = packBundle(HEAD);
  const b = packBundle(HEAD);
  assert.equal(a.sha256, b.sha256);
  assert.ok(a.bytes.equals(b.bytes), 'bundle bytes must not depend on when it was packed');
});

test('real tar can read it, and every file arrives byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-pack-'));
  try {
    const archive = join(dir, 'bundle.tar.gz');
    const { assets } = packBundle(HEAD);
    writeFileSync(archive, packBundle(HEAD).bytes);
    // Hand-written ustar headers are exactly the kind of thing that passes a
    // unit test and fails on the sprite. Let tar be the judge.
    execFileSync('tar', ['-xzf', archive, '-C', dir]);

    for (const asset of assets) {
      const landed = readFileSync(join(dir, bundleEntryName(asset)));
      const expected = execFileSync('git', ['show', `${HEAD}:${asset}`],
        { cwd: repoRoot(), maxBuffer: 64 * 1024 * 1024 });
      assert.ok(landed.equals(expected), `${asset} did not survive the round trip`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it carries exactly what provision.ts downloads, flattened the same way', () => {
  const provision = readFileSync(
    new URL('../src/runtime/provision.ts', import.meta.url), 'utf8');
  const { assets } = packBundle(HEAD);
  // The curls wrote runner/src/foo.mjs and runner/bin/bar.sh both to
  // /home/sprite/aisar/runner/. Anything else moves a file the bootstrap
  // then cannot find.
  for (const asset of assets) {
    assert.ok(provision.includes(`'${asset}'`), `${asset} is not in provision.ts`);
    assert.ok(!bundleEntryName(asset).includes('/'), `${asset} must flatten to a basename`);
  }
  assert.ok(assets.includes('runner/bin/bootstrap-runtime.sh'),
    'the bootstrap is the one file the control plane executes by name');
});

test('two assets may not flatten onto each other', () => {
  const names = bundleAssets().map(bundleEntryName);
  assert.equal(new Set(names).size, names.length,
    'runner/src and runner/bin share one directory on the sprite');
});

test('refuses anything but a full commit sha', () => {
  assert.throws(() => packBundle('HEAD'), /full sha/);
  assert.throws(() => packBundle(HEAD.slice(0, 12)), /full sha/);
});

test('an empty asset list is a failure, not an empty bundle', () => {
  assert.throws(() => bundleAssets('const assets = [];'), /no runner assets/);
});

test('the key is derived from the commit alone', () => {
  assert.equal(bundleKey(HEAD), `bundles/${HEAD}.tar.gz`);
});
