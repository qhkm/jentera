import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertBootstrapAcceptsHermesTag } from './bootstrap-contract.mjs';

const bootstrap = readFileSync(new URL('../../runner/bin/bootstrap-runtime.sh', import.meta.url), 'utf8');
const pin = readFileSync(new URL('../src/runtime/hermes-pin.ts', import.meta.url), 'utf8');
const tag = pin.match(/HERMES_TAG\s*=\s*'([^']+)'/)[1];
const commit = pin.match(/HERMES_COMMIT\s*=\s*'([0-9a-f]{40})'/)[1];
const oldGuard = '[[ "$hermes_tag" =~ ^v[0-9]{4}\\.[0-9]+\\.[0-9]+$ ]] || exit 1';

test('actual bootstrap guard accepts the central production pin', () => {
  assert.doesNotThrow(() => assertBootstrapAcceptsHermesTag(bootstrap, tag));
});

test('actual guard accepts bounded numeric revisions, not arbitrary ref or shell syntax', () => {
  for (const value of ['v2026.9.18', 'v2026.9.18-1', 'v2026.9.18-1234']) {
    assert.doesNotThrow(() => assertBootstrapAcceptsHermesTag(bootstrap, value));
  }
  for (const value of ['v2026.9.18-12345', 'v2026.9.18-beta', 'v2026.9.18/../main',
    'v2026.9.18;exit 0', 'v2026.9.18$(id)', 'v2026.9.18\n', '']) {
    assert.throws(() => assertBootstrapAcceptsHermesTag(bootstrap, value), /rejects the central Hermes tag/);
  }
});

test('reproduces the old guard rejecting the real revision-tag bug', () => {
  assert.doesNotThrow(() => assertBootstrapAcceptsHermesTag(oldGuard, 'v2026.9.18'));
  assert.throws(() => assertBootstrapAcceptsHermesTag(oldGuard, 'v2026.9.18-1'), /rejects/);
});

test('missing, duplicate or unreviewed guards fail closed without executing downloaded shell', () => {
  for (const source of ['', `${oldGuard}\n${oldGuard}`,
    '[[ "$hermes_tag" =~ ^v$(id)$ ]] || exit 1',
    '[[ "$hermes_tag" =~ ^v$((1))$ ]] || exit 1']) {
    assert.throws(() => assertBootstrapAcceptsHermesTag(source, tag), /guard/);
  }
  // Even an executable failure branch is never run: only the guard is taken.
  assert.throws(() => assertBootstrapAcceptsHermesTag(oldGuard.replace('exit 1', 'printf UNSAFE'), 'bad'), /rejects/);
});

function runGuardScript(script, source, httpStatus = 200, tagStatus = 200) {
  // Hermetic end-to-end test of the real deploy/release scripts: no network,
  // checkout edits, tenant configuration or live credentials.
  const installer = 'Unknown option --branch --commit --skip-setup --non-interactive --dir --hermes-home --force-commit';
  const installerHash = createHash('sha256').update(installer).digest('hex');
  const fixture = source.replace(/hermes_installer_sha256="[0-9a-f]{64}"/,
    `hermes_installer_sha256="${installerHash}"`);
  const mock = `globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/bootstrap-runtime.sh')) return new Response(${JSON.stringify(fixture)}, { status: ${httpStatus} });
    if (url.includes('/git/ref/tags/')) return new Response(JSON.stringify({ object: { type: 'commit', sha: ${JSON.stringify(commit)} } }), { status: ${tagStatus} });
    if (url.endsWith('/scripts/install.sh')) return new Response(${JSON.stringify(installer)});
    return new Response('public runner asset');
  };`;
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-contract-'));
  const fixturePath = join(dir, 'bootstrap-runtime.sh');
  if (httpStatus === 200) writeFileSync(fixturePath, fixture);
  try {
    return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`,
      new URL(script, import.meta.url).pathname], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 64000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        JENTERA_TEST_BOOTSTRAP_PATH: fixturePath,
        JENTERA_TEST_SKIP_BUNDLE_BUCKET_CHECK: '1',
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('predeploy exercises the pinned guard and blocks mismatches and unavailable bootstrap', () => {
  const valid = runGuardScript('./check-transfer-fields.mjs', bootstrap);
  assert.equal(valid.status, 0, valid.stderr);
  const incompatible = bootstrap.replace(/^\[\[ "\$hermes_tag" =~ [^\n]+ \]\] \|\|/m,
    '[[ "$hermes_tag" =~ ^v0$ ]] ||');
  const rejected = runGuardScript('./check-transfer-fields.mjs', incompatible);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /pinned bootstrap rejects/);
  const unavailable = runGuardScript('./check-transfer-fields.mjs', bootstrap, 503);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /cannot prove deployment compatibility/);
});

test('release gate exercises the pinned guard, not just tag existence', () => {
  const valid = runGuardScript('./validate-release.mjs', bootstrap);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /pinned bootstrap accepts the central Hermes tag/);
  const incompatible = bootstrap.replace(/^\[\[ "\$hermes_tag" =~ [^\n]+ \]\] \|\|/m,
    '[[ "$hermes_tag" =~ ^v0$ ]] ||');
  const rejected = runGuardScript('./validate-release.mjs', incompatible);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /pinned bootstrap rejects/);
});

test('release gate cannot silently skip a missing installer tag', () => {
  const result = runGuardScript('./validate-release.mjs', bootstrap, 200, 404);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot prove the installer pin/);
});
