#!/usr/bin/env node
/**
 * check-transfer-fields.mjs — predeploy guard for the sprite bootstrap contract.
 *
 * `bootstrapRuntime` (worker/src/runtime/provision.ts) downloads the runner
 * bundle, `runner/bin/bootstrap-runtime.sh` among its files, packed from
 * RUNTIME_BUNDLE_COMMIT, and executes that copy. So the pinned commit decides what can be parsed, not
 * whatever a sprite happens to have on disk — and the bootstrap rejects any
 * transfer field outside its closed `case`, exiting 1.
 *
 * The dangerous shape is therefore a `provision.ts` that has outrun its pin,
 * which `wrangler deploy` will happily ship on its own with no release
 * involved. On 2026-09-10 EXTRACT_BASE_B64 went out exactly that way: the
 * pinned bundle's bootstrap had no matching arm, every sprite rejected the
 * transfer, upgrade tasks retried to exhaustion, and the fleet stopped
 * converging. The release gate would not have caught it, because no release
 * was being cut.
 *
 * Runs as `predeploy`, so `pnpm run deploy` cannot ship the mismatch.
 * Also exercises the pinned bootstrap's actual Hermes tag guard. A new valid
 * tag whose syntax the older bundle rejects must not reach production.
 * An unreadable bundle fails closed; retry rather than assuming compatibility.
 * Exit 0 = safe to deploy. Exit 1 = the deploy would strand the fleet.
 */
import { readFileSync } from 'node:fs';
import { assertBootstrapAcceptsHermesTag } from './bootstrap-contract.mjs';
import { readAtCommit } from './bundle-pack.mjs';

const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const provision = readFileSync(new URL('../src/runtime/provision.ts', import.meta.url), 'utf8');

const commit = wrangler.match(/RUNTIME_BUNDLE_COMMIT\s*=\s*"([0-9a-f]{40})"/)?.[1];
if (!commit) {
  console.error('FAIL  RUNTIME_BUNDLE_COMMIT not found in wrangler.toml');
  process.exit(1);
}

const sent = [...provision.matchAll(/field\('([A-Z0-9_]+_B64)'/g)].map((m) => m[1]);
if (sent.length < 5) {
  console.error(`FAIL  parsed only ${sent.length} transfer fields from provision.ts; the parser is broken`);
  process.exit(1);
}

/* Read from the local object store, not over HTTP. A commit is
   content-addressed, so these are the same bytes; ship-runtime.sh already
   refuses a bundle that is not an ancestor of origin/main. It is also what
   lets this repository be private — the whole point of the R2 bundle. */
const bootstrapBytes = readAtCommit(commit, 'runner/bin/bootstrap-runtime.sh');
if (!bootstrapBytes) {
  console.error(`FAIL  bootstrap at ${commit} unreadable; cannot prove deployment compatibility.
      Fetch the commit (git fetch origin ${commit}) rather than skipping the guard.`);
  process.exit(1);
}
const bootstrap = bootstrapBytes.toString('utf8');
const pinSource = readFileSync(new URL('../src/runtime/hermes-pin.ts', import.meta.url), 'utf8');
const hermesTag = pinSource.match(/HERMES_TAG\s*=\s*'([^']+)'/)?.[1];
if (!hermesTag) {
  console.error('FAIL  HERMES_TAG not found in hermes-pin.ts');
  process.exit(1);
}
try {
  assertBootstrapAcceptsHermesTag(bootstrap, hermesTag);
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}
const allowlisted = new Set(
  [...bootstrap.matchAll(/^\s*([A-Z0-9_]+_B64)\)\s*\1=/gm)].map((m) => m[1]),
);
if (allowlisted.size < 5) {
  console.error('FAIL  bootstrap allowlist parsed as almost empty; the parser is broken');
  process.exit(1);
}

const missing = sent.filter((f) => !allowlisted.has(f));
if (missing.length) {
  console.error(
    `FAIL  provision.ts sends ${missing.join(', ')}, which the bootstrap at the pinned\n` +
    `      bundle ${commit} rejects. Deploying this would make every sprite refuse its\n` +
    '      transfer and stop converging.\n\n' +
    '      Add the `case` arm to runner/bin/bootstrap-runtime.sh, then ship a release\n' +
    '      (worker/scripts/ship-runtime.sh) so RUNTIME_BUNDLE_COMMIT names a bundle\n' +
    '      that contains it. Deploy after that, not before.',
  );
  process.exit(1);
}

console.log(`ok    pinned bootstrap (${commit.slice(0, 12)}) accepts all ${sent.length} transfer fields`);
