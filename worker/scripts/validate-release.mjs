#!/usr/bin/env node
/**
 * validate-release.mjs — release gate for the jentera worker + sprite runtime.
 *
 * Catches the bug class that blocked release 2026.09.05-1: the sprite
 * bootstrap passed --force-commit, but the pinned hermes v2026.9.5 installer
 * dropped the flag and exits 1 on unknown options. (v2026.9.6 restores the
 * nanoid@^3 override so the install gate accepts the lineage.) Every release
 * that changes the hermes pin or the runner bundle MUST pass this gate
 * before shipping.
 *
 * Checks. The jentera half reads the local git object store — a commit is
 * content-addressed, so it is the same bytes GitHub served, and ship-runtime
 * .sh already refuses a bundle that is not an ancestor of origin/main. That
 * is also what lets this repository be private. The hermes-agent half still
 * reads GitHub, because that is a different, still-public repository.
 *   1. bootstrap-runtime.sh exists at RUNTIME_BUNDLE_COMMIT (worker pin).
 *   2. The bundle packs from that commit, its digest matches the pin every
 *      sprite is made to assert, and those bytes are in R2.
 *   3. hermes install.sh at the provision.ts HERMES_COMMIT hash-matches the
 *      sha256 pin baked into bootstrap-runtime.sh.
 *   4. Every flag the bootstrap passes to the installer is accepted by the
 *      pinned installer: the flag literal must appear in install.sh, or the
 *      installer must have no unknown-option rejection path (else FAIL).
 *   5. HERMES_TAG resolves to HERMES_COMMIT on the qhkm/hermes-agent fork.
 *   6. Every transfer field provision.ts sends is allowlisted by the bootstrap
 *      at RUNTIME_BUNDLE_COMMIT. bootstrapRuntime curls that bootstrap and
 *      executes it, so the pin — not whatever a sprite has on disk — decides
 *      what parses. The hazard is a provision.ts newer than its pinned bundle,
 *      which a worker deploy can ship without any release; that stalled
 *      convergence on 2026-09-10. check-transfer-fields.mjs runs the same
 *      comparison as a predeploy hook.
 *   7. The actual pinned bootstrap Bash guard accepts the central Hermes tag,
 *      including reviewed numeric revision suffixes. Missing or unverifiable
 *      tag resolution is a failure, not a silently skipped check.
 *
 * Usage: node worker/scripts/validate-release.mjs
 * Run from the repo root (reads worker/wrangler.toml + worker/src/runtime/provision.ts).
 * Exit 0 = gate passed. Exit 1 = release-blocking.
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertBootstrapAcceptsHermesTag } from './bootstrap-contract.mjs';
import { bundleKey, packBundle, readAtCommit } from './bundle-pack.mjs';
import { execWrangler } from './wrangler-cli.mjs';

const HERMES_REPO = 'qhkm/hermes-agent';
const RAW = 'https://raw.githubusercontent.com';

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok    ${msg}`);
const warn = (msg) => console.log(`warn  ${msg}`);

async function httpGet(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  return res;
}
async function readRaw(repo, ref, path) {
  const res = await httpGet(`${RAW}/${repo}/${ref}/${path}`);
  if (!res.ok) return null;
  return res.text();
}

// ---- 1. Load pins from the worker source -------------------------------
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const provision = readFileSync(new URL('../src/runtime/provision.ts', import.meta.url), 'utf8');

const bundleCommit = wrangler.match(/RUNTIME_BUNDLE_COMMIT\s*=\s*"([0-9a-f]{40})"/)?.[1];
if (!bundleCommit) { fail('RUNTIME_BUNDLE_COMMIT not found in wrangler.toml'); process.exit(1); }
ok(`bundle commit ${bundleCommit}`);

/* The pin moved out of provision.ts on 2026-09-17 and this kept reading it
   there, so it matched a quoted literal that no longer exists and failed
   every release after the refactor. It reads the pin at its source now and
   checks that provision.ts still sends it, which is the part that can
   actually drift — `hermes-pin.test.ts` forbids a literal here, so a
   validator looking for one contradicts the test that keeps the pin
   single. */
const pinSource = readFileSync(new URL('../src/runtime/hermes-pin.ts', import.meta.url), 'utf8');
const hermesTag = pinSource.match(/HERMES_TAG\s*=\s*'([^']+)'/)?.[1];
const hermesCommit = pinSource.match(/HERMES_COMMIT\s*=\s*'([0-9a-f]{40})'/)?.[1];
if (!hermesTag || !hermesCommit) { fail('HERMES_TAG/HERMES_COMMIT not found in hermes-pin.ts'); process.exit(1); }
for (const field of ['HERMES_TAG_B64', 'HERMES_COMMIT_B64']) {
  if (!provision.includes(`field('${field}'`)) {
    fail(`${field} is no longer sent by provision.ts`);
    process.exit(1);
  }
}
ok(`hermes pin ${hermesTag} @ ${hermesCommit}`);

const assets = [...provision.matchAll(/'(runner\/(?:src|bin)\/[^']+)'/g)].map((m) => m[1]);
if (!assets.length) { fail('no runner assets found in provision.ts'); process.exit(1); }

// ---- 2. Bootstrap script at the pinned bundle commit --------------------
/* Read from the local object store. A commit is content-addressed, so this
   is the same file raw.githubusercontent used to serve, and ship-runtime.sh
   already refuses a bundle that is not an ancestor of origin/main. It also
   removes this half of the gate's dependence on a public repository. */
const bootstrapBytes = process.env.NODE_ENV === 'test' && process.env.JENTERA_TEST_BOOTSTRAP_PATH
  ? (() => {
      try {
        return readFileSync(process.env.JENTERA_TEST_BOOTSTRAP_PATH);
      } catch {
        return null;
      }
    })()
  : readAtCommit(bundleCommit, 'runner/bin/bootstrap-runtime.sh');
const bootstrap = bootstrapBytes?.toString('utf8');
if (!bootstrap) { fail(`bootstrap-runtime.sh unreadable at ${bundleCommit}; git fetch origin ${bundleCommit}`); process.exit(1); }
ok('bootstrap-runtime.sh present at bundle commit');

// 2026-09-18: a real tag resolved to the correct commit, but the bootstrap
// rejected its numeric revision suffix before installation. GitHub existence
// and clean-install patch tests do not exercise this production Bash guard.
try {
  assertBootstrapAcceptsHermesTag(bootstrap, hermesTag);
  ok('pinned bootstrap accepts the central Hermes tag');
} catch (error) {
  fail(error.message);
}

const shaPin = bootstrap.match(/hermes_installer_sha256="([0-9a-f]{64})"/)?.[1];
if (!shaPin) { fail('hermes_installer_sha256 pin missing in bootstrap-runtime.sh'); process.exit(1); }

// Flags the bootstrap hands to the installer (probe-aware: grab the install_cmd array).
const invocation = bootstrap.match(/install_cmd=\(bash "\$installer"([^)]*)\)/)?.[1]
  ?? bootstrap.match(/bash "\$installer" \\\n((?:.*\\\n)*?.*)/)?.[1] ?? '';
const bootstrapFlags = [...invocation.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
if (!bootstrapFlags.length) { fail('could not parse bootstrap installer invocation'); process.exit(1); }
ok(`bootstrap passes flags: ${bootstrapFlags.map((f) => `--${f}`).join(' ')}`);

// ---- 3. Installer hash vs pin -------------------------------------------
/* Fail, but keep going. raw.githubusercontent throttles bursts and lags new
   SHAs, so this check false-FAILs often enough to have its own note in the
   runbook — and `process.exit(1)` here meant one throttled fetch silently
   skipped every check below it, including the transfer-field guard that
   exists to stop a fleet-wide stall. A gate that reports everything wrong is
   worth more than one that stops at the first flake; ship-runtime.sh already
   retries the whole gate three times. */
const installSh = await readRaw(HERMES_REPO, hermesCommit, 'scripts/install.sh');
if (!installSh) {
  fail(`install.sh unreadable at ${HERMES_REPO} ${hermesCommit} (throttling? re-run) — hash check skipped`);
} else {
  const actualSha = createHash('sha256').update(installSh).digest('hex');
  if (actualSha !== shaPin) {
    fail(`installer sha256 mismatch: pin ${shaPin} vs actual ${actualSha} (hermes ${hermesCommit})`);
  } else {
    ok(`installer sha256 matches pin (${shaPin.slice(0, 16)}…)`);
  }
}

// ---- 4. Flag compatibility (the 2026.09.05-1 bug class) ------------------
if (!installSh) {
  warn('installer unreadable; flag-compatibility check skipped');
} else {
  const rejectsUnknown = /Unknown option/.test(installSh);
  for (const flag of bootstrapFlags) {
    if (installSh.includes(`--${flag}`)) {
      ok(`installer supports --${flag}`);
    } else if (rejectsUnknown) {
      fail(`installer does not support --${flag} and rejects unknown options — bootstrap would exit 1`);
    } else {
      warn(`installer has no literal --${flag} but no unknown-option rejection found; assume permissive`);
    }
  }
}

// ---- 5. Tag resolves to the pinned commit --------------------------------
try {
  const refs = await httpGet(`https://api.github.com/repos/${HERMES_REPO}/git/ref/tags/${hermesTag}`);
  if (refs.ok) {
    const ref = await refs.json();
    const target = ref.object.type === 'tag'
      ? (await (await httpGet(ref.object.url)).json()).object.sha
      : ref.object.sha;
    if (target === hermesCommit) ok(`tag ${hermesTag} resolves to ${hermesCommit}`);
    else fail(`tag ${hermesTag} resolves to ${target}, not ${hermesCommit}`);
  } else {
    fail(`tag ${hermesTag} unreadable on ${HERMES_REPO} (HTTP ${refs.status}); cannot prove the installer pin`);
  }
} catch {
  fail('GitHub API unreachable; cannot prove the installer tag resolves to the pinned commit');
}

// ---- 6. The bundle a sprite will actually download -------------------------
//
// Until 2026-09-23 this fetched each asset from raw.githubusercontent.com one
// at a time, which proved only that a public URL resolved. A sprite now
// downloads one object from R2 — the change that lets this repository be
// private — so what has to be proven is different and stronger: that packing
// the pinned commit works at all, that the digest the control plane will make
// every sprite assert matches it, and that those exact bytes are in the
// bucket. Packing reads every asset out of the commit, so a missing file
// fails here as loudly as a missing URL used to.
let packed;
try {
  packed = packBundle(bundleCommit);
  ok(`bundle packs from ${bundleCommit.slice(0, 12)}: ${packed.assets.length} files, ${packed.bytes.length} bytes`);
  for (const asset of assets) {
    if (!packed.assets.includes(asset)) fail(`asset not in the packed bundle: ${asset}`);
  }
} catch (error) {
  fail(`bundle could not be packed at ${bundleCommit}: ${error.message}`);
}

const pinnedSha = wrangler.match(/RUNTIME_BUNDLE_SHA256\s*=\s*"([0-9a-f]{64})"/)?.[1];
if (!pinnedSha) {
  fail('RUNTIME_BUNDLE_SHA256 not found in wrangler.toml; provisioning refuses to run without it');
} else if (packed && pinnedSha !== packed.sha256) {
  fail(`RUNTIME_BUNDLE_SHA256 is ${pinnedSha} but packing ${bundleCommit} produces ${packed.sha256}; every sprite would reject a correct bundle`);
} else if (packed) {
  ok(`pin matches the packed bundle (${pinnedSha.slice(0, 16)}\u2026)`);
}

/* Round-trip the bytes rather than trusting an exit code. `wrangler r2 object
   get` without --remote reads a local miniflare store and exits 0; twelve
   uploads once "succeeded" that way against a bucket that never changed. */
const bucketName = wrangler.match(/binding\s*=\s*"RUNTIME_BUNDLES"\s*\nbucket_name\s*=\s*"([^"]+)"/)?.[1];
if (!bucketName) {
  fail('the RUNTIME_BUNDLES r2_buckets binding is missing from wrangler.toml');
} else if (process.env.NODE_ENV === 'test' && process.env.JENTERA_TEST_SKIP_BUNDLE_BUCKET_CHECK === '1') {
  warn('bundle bucket round-trip skipped by the hermetic release-gate test');
} else if (packed) {
  const dir = mkdtempSync(join(tmpdir(), 'release-bundle-'));
  try {
    const out = join(dir, 'bundle.tar.gz');
    execWrangler(['r2', 'object', 'get', `${bucketName}/${bundleKey(bundleCommit)}`,
      '--file', out, '--remote'], { stdio: 'pipe' });
    const got = createHash('sha256').update(readFileSync(out)).digest('hex');
    if (got === packed.sha256) ok(`${bucketName}/${bundleKey(bundleCommit)} round-trips to the pin`);
    else fail(`${bucketName}/${bundleKey(bundleCommit)} hashes to ${got}, not ${packed.sha256}; the right key holds the wrong bytes`);
  } catch (error) {
    fail(`${bucketName}/${bundleKey(bundleCommit)} could not be read back; upload it before shipping (${String(error.stderr ?? error.message).trim().split('\n').slice(-1)[0]})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 7. The pinned bootstrap can parse every field provision.ts sends -----
//
// bootstrap-runtime.sh parses the transfer against a closed `case` and exits 1
// on anything else. The commit that matters is RUNTIME_BUNDLE_COMMIT: a
// control-plane bootstrap curls the runner assets — bootstrap-runtime.sh
// included — from that commit and executes them, so a sprite runs the pinned
// bootstrap, never the one it happens to have on disk.
//
// The hazard is therefore a `provision.ts` newer than the bundle it is pinned
// to, which a worker deploy can ship on its own without any release. That is
// what happened on 2026-09-10: EXTRACT_BASE_B64 went out in a worker deploy
// while RUNTIME_BUNDLE_COMMIT still named a bundle whose bootstrap had no
// matching `case` arm. Every sprite rejected the transfer, upgrade tasks
// retried to exhaustion, and convergence stalled.
//
// `worker/scripts/check-transfer-fields.mjs` runs this same comparison as a
// predeploy hook, because a deploy is the path that can outrun the pin.
const allowlistOf = (script) =>
  new Set([...script.matchAll(/^\s*([A-Z0-9_]+_B64)\)\s*\1=/gm)].map((m) => m[1]));
const sentFields = [...provision.matchAll(/field\('([A-Z0-9_]+_B64)'/g)].map((m) => m[1]);

if (!sentFields.length) {
  fail('no transfer fields found in provision.ts — the parser is broken, not the release');
} else {
  const pinned = allowlistOf(bootstrap);
  if (pinned.size < 5) {
    fail('bootstrap allowlist parsed as almost empty — the parser is broken, not the release');
  }
  const missing = sentFields.filter((f) => !pinned.has(f));
  if (missing.length) {
    fail(
      `bootstrap at ${bundleCommit} rejects: ${missing.join(', ')}. ` +
      'Add the `case` arm to runner/bin/bootstrap-runtime.sh and pin a bundle ' +
      'that contains it, in the same release that starts sending the field.',
    );
  } else {
    ok(`pinned bootstrap accepts all ${sentFields.length} transfer fields`);
  }
}

if (process.exitCode) {
  console.error('\nGATE FAILED — do not ship this release.');
  process.exit(1);
}
console.log('\nGATE PASSED — release consistent (bundle, installer pin, flags, assets).');
