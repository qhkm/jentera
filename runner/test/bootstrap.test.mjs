import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const SCRIPT = new URL('../bin/bootstrap-runtime.sh', import.meta.url).pathname;
const CONFIGURE = new URL('../bin/configure-model-provider.py', import.meta.url).pathname;
const directories = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('bootstrap treats its transfer as data, not shell code', async () => {
  const transfer = await tempTransfer('SURPRISE_B64=YWJj\n');
  const result = run(transfer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown field/);
});

test('bootstrap refuses an unreviewed model endpoint before installing anything', async () => {
  const transfer = await tempTransfer(fields({ modelBase: 'https://model.internal/v1' }));
  const result = run(transfer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /base URL is not pinned/);
});

test('bootstrap and model config pin the reviewed plus customer-router endpoints', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(source, /https:\/\/router\.fmcv\.my/);
  const configure = await readFile(CONFIGURE, 'utf8');
  assert.match(configure, /https:\/\/router\.fmcv\.my/);
});

test('production runtime pins and proves its keyless search backend', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /AISAR_WEB_SEARCH_BACKEND=%q.*ddgs/);
  assert.match(source, /'ddgs==9\.16\.0'/);
  assert.match(source, /hermes_uv=\/home\/sprite\/\.hermes\/bin\/uv/);
  assert.match(source, /pip install.*\\\n\s+--python "\$install_dir\/venv\/bin\/python"/);
  assert.match(source, /pip check --python "\$install_dir\/venv\/bin\/python"/);
  assert.doesNotMatch(source, /venv\/bin\/python" -m pip/);
  assert.match(source, /web-search-smoke\.py/);
  assert.match(source, /web_search_ready/);
});

test('Hermes installer bytes come from the reviewed Hermes commit', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(
    source,
    /raw\.githubusercontent\.com\/NousResearch\/hermes-agent\/\$\{hermes_commit\}\/scripts\/install\.sh/,
  );
  assert.match(source, /0582d9b1562efcb6e0ac62f4451021667830b830a72ce7d91eaea9fee8b6c09b/);
  assert.doesNotMatch(source, /hermes-agent\.nousresearch\.com\/install\.sh/);
});

test('model configuration favors DS4 agent quality and tool compatibility', async () => {
  const source = await readFile(CONFIGURE, 'utf8');
  assert.match(source, /provider_routing\.pop\("sort", None\)/);
  assert.match(source, /provider_routing\["order"\] = \["morph"\]/);
  assert.match(source, /provider_routing\["allow_fallbacks"\] = True/);
  assert.match(source, /provider_routing\["require_parameters"\] = True/);
  assert.match(source, /web\["search_backend"\] = "ddgs"/);
  assert.match(source, /reasoning_overrides\[model_name\] = "high"/);
  assert.doesNotMatch(source, /provider_routing\["sort"\] = "latency"/);
});

function run(transfer) {
  return spawnSync('bash', [SCRIPT, transfer], {
    encoding: 'utf8',
    env: process.env,
  });
}

async function tempTransfer(body) {
  const directory = await mkdtemp(join(tmpdir(), 'aisar-bootstrap-test-'));
  directories.push(directory);
  const transfer = join(directory, 'bootstrap.env.in');
  await writeFile(transfer, body, { mode: 0o600 });
  return transfer;
}

function fields(overrides = {}) {
  const input = {
    businessId: '11111111-1111-4111-8111-111111111111',
    runtimeRelease: '2026.08.27-1',
    runnerKey: 'r'.repeat(64),
    hermesKey: 'h'.repeat(64),
    modelProvider: 'openrouter',
    modelBase: 'https://openrouter.ai/api/v1',
    modelKey: 'o'.repeat(64),
    modelName: 'deepseek/deepseek-v4-flash-0731',
    hermesTag: 'v2026.8.19',
    hermesCommit: 'fcbd1076a93841fa88855acce810e342a5b78101',
    ...overrides,
  };
  return [
    ['BUSINESS_ID_B64', input.businessId],
    ['RUNTIME_RELEASE_B64', input.runtimeRelease],
    ['RUNNER_KEY_B64', input.runnerKey],
    ['HERMES_KEY_B64', input.hermesKey],
    ['MODEL_PROVIDER_B64', input.modelProvider],
    ['MODEL_BASE_B64', input.modelBase],
    ['MODEL_KEY_B64', input.modelKey],
    ['MODEL_NAME_B64', input.modelName],
    ['HERMES_TAG_B64', input.hermesTag],
    ['HERMES_COMMIT_B64', input.hermesCommit],
  ].map(([key, value]) => `${key}=${Buffer.from(value).toString('base64')}`).join('\n') + '\n';
}
