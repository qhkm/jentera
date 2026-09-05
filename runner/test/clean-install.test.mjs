import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, before, test } from 'node:test';

/** Black-box contract test for bin/patch-hermes-dependencies.mjs against the
 * REAL pinned Hermes commit — no fixtures, no network. Each test extracts the
 * pin from the read-only local clone (~/ios/hermes-agent) with `git archive`
 * and then drives the script as a subprocess, exactly as CI would. */
const PIN = '111949b9750f7dafc8adaf0829de9cc108aa4236';
const SCRIPT = new URL('../bin/patch-hermes-dependencies.mjs', import.meta.url).pathname;
const HERMES_REPO = process.env.HERMES_AGENT_REPO || join(homedir(), 'ios', 'hermes-agent');

const ROUTING_MARKER = '# Jentera: apply reviewed OpenRouter routing to API-server agents.';
const RUNTIME_MARKER = '# Jentera: expose bounded final reasoning and attest this runtime patch.';
const WIRE_ORDER_MARKER = '# Jentera: reorder chat.completions wire bodies (tools first, messages last).';
const RUNTIME_PATCH_ID = 'jentera-runtime-2026-09-01';
const WIRE_ORDER_PATCH_ID = 'jentera-wire-order-2026-09-03';

// Canary-era legacy shapes normalizeLegacyReasoningPatch() recognizes and
// strips so the durable B1 patch can re-anchor (exact 20/24-space indents).
const LEGACY_REASONING_LINE =
  '                    reasoning = result.get("last_reasoning") if isinstance(result, dict) else None';
const LEGACY_EVENT_LINE = '                        "reasoning": reasoning,';
const LEGACY_STATUS_LINE = '                        reasoning=reasoning,';

// Pinned Hermes anchors that carry the injected code (verified verbatim on the
// pin; a future pin that drifts any of these fails the tests loudly).
const FINAL_RESPONSE_LINE =
  '                    final_response = result.get("final_response", "") if isinstance(result, dict) else ""';
const USAGE_LINE = '                        "usage": usage,';
const EVENT_USAGE_UNIT = `${USAGE_LINE}\n                    })`;
const STATUS_USAGE_UNIT = '                        output=final_response,\n                        usage=usage,\n';

const directories = [];

before(async () => {
  const probe = spawnSync('git', ['-C', HERMES_REPO, 'rev-parse', '--verify', `${PIN}^{commit}`], {
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0,
    `pinned Hermes commit ${PIN} must exist in the read-only local clone ${HERMES_REPO}`);
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Extract the pinned Hermes commit into a fresh <tmpdir>/aisar-hermes-test-<label>-*
 * directory — the only root shape the script's testTarget guard accepts. */
async function extractPinned(label) {
  const root = await mkdtemp(join(tmpdir(), `aisar-hermes-test-${label}-`));
  directories.push(root);
  const archive = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh',
    HERMES_REPO, PIN, root], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(archive.status, 0, `git archive extraction failed: ${archive.stderr}`);
  assert.ok(/\/aisar-hermes-test-[^/]+$/.test(root), `test root must match the testTarget regex: ${root}`);
  return root;
}

/** Black-box invocation of the script under test (never imported). */
function run(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Exactly-one-occurrence anchor splice, mirroring the patcher's own
 * replaceReviewedAnchor (drift fails loudly instead of patching silently). */
function replaceUnique(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  assert.ok(first >= 0, `pinned anchor is missing: ${JSON.stringify(anchor)}`);
  assert.equal(source.indexOf(anchor, first + anchor.length), -1,
    `pinned anchor is not unique: ${JSON.stringify(anchor)}`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

/** Item 6 contract: every reviewed shape must be present verbatim post-apply. */
async function assertPatchedShapes(root) {
  const apiServer = await readFile(join(root, 'gateway/platforms/api_server.py'), 'utf8');
  for (const shape of [
    ROUTING_MARKER,
    'provider_sort=provider_routing.get("sort"),',
    RUNTIME_MARKER,
    `"jentera_patch": "${RUNTIME_PATCH_ID}",`,
    'result.get("last_reasoning")',
    '**({\"reasoning\": reasoning} if reasoning else {}),',
  ]) {
    assert.ok(apiServer.includes(shape), `api_server.py missing: ${JSON.stringify(shape)}`);
  }
  const bootstrap = await readFile(join(root, 'agent/process_bootstrap.py'), 'utf8');
  const runAgent = await readFile(join(root, 'run_agent.py'), 'utf8');
  for (const source of [bootstrap, runAgent]) {
    assert.ok(source.includes(WIRE_ORDER_MARKER), 'wire-order marker missing from keepalive client builder');
  }
  const wireReorder = await readFile(join(root, 'agent/wire_reorder.py'), 'utf8');
  assert.ok(wireReorder.includes(`PATCH_ID = "${WIRE_ORDER_PATCH_ID}"`), 'wire_reorder.py PATCH_ID drifted');
}

/** Item 7 contract: nanoid pinned to reviewed 3.3.18 everywhere in the lock. */
async function assertNanoidPin(root) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.overrides['nanoid@^3'], '3.3.18');
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages ?? {})
    .filter(([path]) => path.endsWith('/nanoid'))
    .filter(([, pkg]) => String(pkg?.version).startsWith('3.3.'));
  assert.ok(entries.length > 0, 'expected at least one 3.3.x nanoid lock entry');
  for (const [path, pkg] of entries) {
    assert.equal(pkg.version, '3.3.18', `nanoid ${pkg.version} remains at ${path}`);
    assert.equal(pkg.resolved, 'https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz',
      `nanoid resolved URL drifted at ${path}`);
    assert.equal(pkg.integrity, 'sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w==',
      `nanoid integrity drifted at ${path}`);
    assert.notEqual(pkg.version, '3.3.17', `vulnerable nanoid 3.3.17 remains at ${path}`);
  }
}

/***************************************************************
 * TEST 1 — clean-install contract (the release gate).
 ***************************************************************/
test('clean install of the pinned Hermes commit applies and verifies (B1 release gate)', async () => {
  const root = await extractPinned('b1-ci');

  const apply = run(root);
  assert.equal(apply.status, 0, `apply failed: ${apply.stderr}`);
  assert.ok(apply.stdout.includes('pinned Hermes dependency, Jentera API-server and wire-order patches'),
    `unexpected apply stdout: ${JSON.stringify(apply.stdout)}`);

  await assertPatchedShapes(root);
  await assertNanoidPin(root);

  const verify = run(root, ['--verify']);
  assert.equal(verify.status, 0, `verify failed: ${verify.stderr}`);
  assert.ok(verify.stdout.includes('Hermes production dependency, Jentera API-server and wire-order patches verified'),
    `unexpected verify stdout: ${JSON.stringify(verify.stdout)}`);
});

/***************************************************************
 * TEST 2 — verify fails closed on an unpatched tree.
 ***************************************************************/
test('verify fails closed on an unpatched pinned tree', async () => {
  const root = await extractPinned('b1-unpatched');

  const verify = run(root, ['--verify']);
  assert.notEqual(verify.status, 0, 'verify must fail on an unpatched tree');
  assert.ok(verify.stderr.includes('Hermes API server is missing a reviewed Jentera patch'),
    `unexpected verify stderr: ${JSON.stringify(verify.stderr)}`);
});

/***************************************************************
 * TEST 3 — idempotent re-apply (upgrade-retry contract).
 ***************************************************************/
test('re-applying the patch on a patched tree changes no file bytes', async () => {
  const root = await extractPinned('b1-idem');

  const first = run(root);
  assert.equal(first.status, 0, `first apply failed: ${first.stderr}`);

  const files = [
    'package.json',
    'package-lock.json',
    'gateway/platforms/api_server.py',
    'agent/process_bootstrap.py',
    'run_agent.py',
    'agent/wire_reorder.py',
  ];
  const before = Object.fromEntries(files.map((file) => [file, sha256(join(root, file))]));

  const second = run(root);
  assert.equal(second.status, 0, `second apply failed: ${second.stderr}`);

  for (const file of files) {
    const after = sha256(join(root, file));
    assert.equal(after, before[file], `${file} changed on re-apply`);
    // sha256-identical proof line (echoed to the suite output for the record)
    process.stdout.write(`  sha256-identical ${file} ${after}\n`);
  }

  const verify = run(root, ['--verify']);
  assert.equal(verify.status, 0, `verify after re-apply failed: ${verify.stderr}`);
});

/***************************************************************
 * TEST 4 — legacy canary-era migration (previous-patched-state upgrade).
 * Simulates a sprite shipped with the canary-era hand-applied reasoning patch
 * (all three legacy lines present) and proves the B1 apply normalizes them,
 * injects the durable shapes and verifies clean.
 ***************************************************************/
test('migrates the canary-era legacy reasoning patch to the durable B1 patch', async () => {
  const root = await extractPinned('b1-legacy');
  const apiServerPath = join(root, 'gateway/platforms/api_server.py');

  let apiServer = await readFile(apiServerPath, 'utf8');
  // (i) legacy extraction line on the line after the pinned final_response line
  apiServer = replaceUnique(apiServer, FINAL_RESPONSE_LINE,
    `${FINAL_RESPONSE_LINE}\n${LEGACY_REASONING_LINE}`);
  // (ii) legacy event-dict line after "usage", inside the dict literal, before })
  apiServer = replaceUnique(apiServer, EVENT_USAGE_UNIT,
    `${USAGE_LINE}\n${LEGACY_EVENT_LINE}\n                    })`);
  // (iii) legacy status-kwarg line after the run.completed usage kwarg
  apiServer = replaceUnique(apiServer, STATUS_USAGE_UNIT,
    `${STATUS_USAGE_UNIT}${LEGACY_STATUS_LINE}\n`);
  await writeFile(apiServerPath, apiServer);

  // sanity: this is exactly the canary-era shape the patcher must recognize
  assert.ok(apiServer.includes(LEGACY_REASONING_LINE));
  assert.ok(apiServer.includes(LEGACY_EVENT_LINE));
  assert.ok(apiServer.includes(LEGACY_STATUS_LINE));

  const apply = run(root);
  assert.equal(apply.status, 0, `legacy apply failed: ${apply.stderr}`);

  const migrated = await readFile(apiServerPath, 'utf8');
  assert.ok(!migrated.includes(LEGACY_REASONING_LINE), 'legacy single-line reasoning extract survived');
  assert.ok(!migrated.includes(LEGACY_EVENT_LINE), 'legacy event reasoning key survived');
  assert.ok(!migrated.includes(LEGACY_STATUS_LINE), 'legacy status reasoning kwarg survived');
  await assertPatchedShapes(root);

  const verify = run(root, ['--verify']);
  assert.equal(verify.status, 0, `verify after legacy migration failed: ${verify.stderr}`);
});

/***************************************************************
 * TEST 5 — partial legacy fails closed.
 ***************************************************************/
test('partial legacy reasoning patch fails closed and demands review', async () => {
  const root = await extractPinned('b1-partial');
  const apiServerPath = join(root, 'gateway/platforms/api_server.py');

  let apiServer = await readFile(apiServerPath, 'utf8');
  apiServer = replaceUnique(apiServer, FINAL_RESPONSE_LINE,
    `${FINAL_RESPONSE_LINE}\n${LEGACY_REASONING_LINE}`);
  apiServer = replaceUnique(apiServer, EVENT_USAGE_UNIT,
    `${USAGE_LINE}\n${LEGACY_EVENT_LINE}\n                    })`);
  // NOTE: legacy status line deliberately NOT inserted — the drift must fail
  // closed because only a partial canary-era patch is present.
  await writeFile(apiServerPath, apiServer);

  const apply = run(root);
  assert.notEqual(apply.status, 0, 'apply must fail on a partial legacy patch');
  assert.ok(apply.stderr.includes('partial legacy Jentera reasoning patch requires review'),
    `unexpected partial-legacy stderr: ${JSON.stringify(apply.stderr)}`);
});

/***************************************************************
 * TEST 6 — testTarget path guard contract.
 ***************************************************************/
test('refuses a test root that does not match the testTarget regex', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guard-denied-'));
  directories.push(root);
  const archive = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh',
    HERMES_REPO, PIN, root], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(archive.status, 0, `git archive extraction failed: ${archive.stderr}`);
  assert.ok(!/\/aisar-hermes-test-[^/]+$/.test(root), `guard root must NOT match testTarget: ${root}`);

  const apply = run(root);
  assert.notEqual(apply.status, 0, 'apply must refuse a non-testTarget root');
  assert.ok(apply.stderr.includes('Hermes dependency patch target is not allowed'),
    `unexpected guard stderr: ${JSON.stringify(apply.stderr)}`);
});
