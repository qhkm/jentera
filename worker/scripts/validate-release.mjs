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
 * Checks (all against the actual repo state on GitHub):
 *   1. bootstrap-runtime.sh exists at RUNTIME_BUNDLE_COMMIT (worker pin).
 *   2. Every runner asset provision.ts downloads exists at that commit.
 *   3. hermes install.sh at the provision.ts HERMES_COMMIT hash-matches the
 *      sha256 pin baked into bootstrap-runtime.sh.
 *   4. Every flag the bootstrap passes to the installer is accepted by the
 *      pinned installer: the flag literal must appear in install.sh, or the
 *      installer must have no unknown-option rejection path (else FAIL).
 *   5. HERMES_TAG resolves to HERMES_COMMIT on the qhkm/hermes-agent fork.
 *   6. Every transfer field provision.ts sends is allowlisted by the bootstrap
 *      at the shipped bundle commit AND by the bootstrap the fleet is still
 *      running. The second half is the one that matters: a sprite bootstraps
 *      with the release it is currently on, so a field introduced in a single
 *      release makes every sprite reject the payload carrying its own
 *      replacement. That deadlocked the fleet on 2026-09-10 (0/12 converged,
 *      24 upgrade tasks exhausted). A new field takes two releases.
 *
 * Usage: node worker/scripts/validate-release.mjs
 * Run from the repo root (reads worker/wrangler.toml + worker/src/runtime/provision.ts).
 * Exit 0 = gate passed. Exit 1 = release-blocking.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REPO = 'qhkm/jentera';
const HERMES_REPO = 'qhkm/hermes-agent';
const RAW = 'https://raw.githubusercontent.com';

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok    ${msg}`);
const warn = (msg) => console.log(`warn  ${msg}`);

async function httpGet(url) {
  const res = await fetch(url, { redirect: 'follow' });
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

const hermesTag = provision.match(/field\('HERMES_TAG_B64', '([^']+)'\)/)?.[1];
const hermesCommit = provision.match(/field\('HERMES_COMMIT_B64', '([0-9a-f]{40})'\)/)?.[1];
if (!hermesTag || !hermesCommit) { fail('HERMES_TAG_B64/HERMES_COMMIT_B64 not found in provision.ts'); process.exit(1); }
ok(`hermes pin ${hermesTag} @ ${hermesCommit}`);

const assets = [...provision.matchAll(/'(runner\/(?:src|bin)\/[^']+)'/g)].map((m) => m[1]);
if (!assets.length) { fail('no runner assets found in provision.ts'); process.exit(1); }

// ---- 2. Bootstrap script at the pinned bundle commit --------------------
const bootstrap = await readRaw(REPO, bundleCommit, 'runner/bin/bootstrap-runtime.sh');
if (!bootstrap) { fail(`bootstrap-runtime.sh missing at ${bundleCommit}`); process.exit(1); }
ok('bootstrap-runtime.sh present at bundle commit');

const shaPin = bootstrap.match(/hermes_installer_sha256="([0-9a-f]{64})"/)?.[1];
if (!shaPin) { fail('hermes_installer_sha256 pin missing in bootstrap-runtime.sh'); process.exit(1); }

// Flags the bootstrap hands to the installer (probe-aware: grab the install_cmd array).
const invocation = bootstrap.match(/install_cmd=\(bash "\$installer"([^)]*)\)/)?.[1]
  ?? bootstrap.match(/bash "\$installer" \\\n((?:.*\\\n)*?.*)/)?.[1] ?? '';
const bootstrapFlags = [...invocation.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
if (!bootstrapFlags.length) { fail('could not parse bootstrap installer invocation'); process.exit(1); }
ok(`bootstrap passes flags: ${bootstrapFlags.map((f) => `--${f}`).join(' ')}`);

// ---- 3. Installer hash vs pin -------------------------------------------
const installSh = await readRaw(HERMES_REPO, hermesCommit, 'scripts/install.sh');
if (!installSh) { fail(`install.sh missing at ${HERMES_REPO} ${hermesCommit}`); process.exit(1); }
const actualSha = createHash('sha256').update(installSh).digest('hex');
if (actualSha !== shaPin) {
  fail(`installer sha256 mismatch: pin ${shaPin} vs actual ${actualSha} (hermes ${hermesCommit})`);
} else {
  ok(`installer sha256 matches pin (${shaPin.slice(0, 16)}…)`);
}

// ---- 4. Flag compatibility (the 2026.09.05-1 bug class) ------------------
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
    warn(`tag ${hermesTag} not found on ${HERMES_REPO} (peeled-commit check skipped)`);
  }
} catch {
  warn('GitHub API unreachable; tag resolution skipped');
}

// ---- 6. Runner assets exist at the bundle commit --------------------------
for (const asset of assets) {
  const res = await httpGet(`${RAW}/${REPO}/${bundleCommit}/${asset}`);
  if (res.ok) ok(`asset ${asset}`);
  else fail(`asset missing at ${bundleCommit}: ${asset}`);
}

// ---- 7. Every transfer field is allowlisted, in BOTH directions -----------
//
// bootstrap-runtime.sh parses the transfer against a closed `case` and exits 1
// on anything else. Two commits matter, and only one of them is obvious.
//
// Forward: the bootstrap being shipped must accept every field, or the new
// release is broken on arrival.
//
// Backward is the one that bites. A sprite runs the bootstrap from the release
// it is CURRENTLY on, so during a rollout the old bootstrap must accept the
// payload too — including the payload carrying its own replacement. On
// 2026-09-10 EXTRACT_BASE_B64 shipped in a single release: every sprite
// rejected the transfer, 24 upgrade tasks retried to exhaustion, convergence
// sat at 0/12, and the release with the fix could not be delivered. The fleet
// could not be rescued by shipping harder.
//
// So a new field takes two releases: teach the fleet to accept it, then start
// sending it. This check is what makes that a gate rather than a discipline.
const allowlistOf = (script) =>
  new Set([...script.matchAll(/^\s*([A-Z0-9_]+_B64)\)\s*\1=/gm)].map((m) => m[1]));
const sentFields = [...provision.matchAll(/field\('([A-Z0-9_]+_B64)'/g)].map((m) => m[1]);

if (!sentFields.length) {
  fail('no transfer fields found in provision.ts — the parser is broken, not the release');
} else {
  const shipped = allowlistOf(bootstrap);
  const missing = sentFields.filter((f) => !shipped.has(f));
  if (missing.length) fail(`bootstrap at ${bundleCommit} rejects: ${missing.join(', ')}`);
  else ok(`shipped bootstrap accepts all ${sentFields.length} transfer fields`);

  /* The pins are edited in the working tree before this runs, so HEAD still
     carries what the fleet is converging from. */
  let previousBundle = null;
  try {
    const { execFileSync } = await import('node:child_process');
    const head = execFileSync('git', ['show', 'HEAD:worker/wrangler.toml'], {
      cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8',
    });
    previousBundle = head.match(/RUNTIME_BUNDLE_COMMIT\s*=\s*"([0-9a-f]{40})"/)?.[1] ?? null;
  } catch {
    warn('could not read the previous bundle pin from git; backward check skipped');
  }

  if (previousBundle && previousBundle !== bundleCommit) {
    const older = await readRaw(REPO, previousBundle, 'runner/bin/bootstrap-runtime.sh');
    if (!older) {
      warn(`bootstrap at previous bundle ${previousBundle} unreadable; backward check skipped`);
    } else {
      const accepted = allowlistOf(older);
      const rejected = sentFields.filter((f) => !accepted.has(f));
      if (rejected.length) {
        fail(
          `the fleet's current bootstrap (${previousBundle}) rejects: ${rejected.join(', ')}. ` +
          'Ship a release that allowlists the field first, with the value still unset, ' +
          'and send it only once the fleet has converged.',
        );
      } else {
        ok('the fleet\'s current bootstrap accepts every field this release sends');
      }
    }
  } else if (previousBundle) {
    ok('bundle unchanged; no backward compatibility question');
  }
}

if (process.exitCode) {
  console.error('\nGATE FAILED — do not ship this release.');
  process.exit(1);
}
console.log('\nGATE PASSED — release consistent (bundle, installer pin, flags, assets).');
