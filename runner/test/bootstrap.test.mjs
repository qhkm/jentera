import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const SCRIPT = new URL('../bin/bootstrap-runtime.sh', import.meta.url).pathname;
const CONFIGURE = new URL('../bin/configure-model-provider.py', import.meta.url).pathname;
const HERMES_SERVICE = new URL('../bin/hermes-service.sh', import.meta.url).pathname;
const PROVISION = new URL('../bin/provision-sprite.sh', import.meta.url).pathname;
const DISPLAY_SERVICE = new URL('../bin/display-service.sh', import.meta.url).pathname;
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
  assert.match(source, /OPENROUTER_BASE_URL=%q.*\$model_base/);
  assert.match(source, /AISAR_MODEL_NAME=%q.*\$model_name/);
  assert.match(source, /AISAR_DEEP_MODEL_NAME=%q.*\$deep_model_name/);
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

test('runtime readiness requires live inference from every configured model', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /model-smoke\.py/);
  assert.match(source, /smoke_models=\("\$model_name"\)/);
  assert.match(source, /smoke_models\+\=\("\$deep_model_name"\)/);
  assert.match(source, /model inference did not pass its live smoke test/);
});

test('runtime readiness binds the release to the runner bytes loaded by the process', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /sha256sum \/home\/sprite\/aisar\/runner\/server\.mjs/);
  assert.match(source, /AISAR_RUNNER_SOURCE_SHA256=%q/);
});

test('Hermes service replaces only a verified stale gateway process', async () => {
  const source = await readFile(HERMES_SERVICE, 'utf8');
  assert.match(source, /gateway_pid_file=.*gateway\.pid/);
  assert.match(source, /\/proc\/\$existing_pid\/cmdline/);
  assert.match(source, /refusing to terminate unrecognised gateway pid/);
  assert.match(source, /gateway run --replace/);
});

test('Hermes installer bytes come from the reviewed Hermes commit (qhkm fork)', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.ok(
    source.includes('raw.githubusercontent.com/qhkm/hermes-agent/${hermes_commit}/scripts/install.sh'),
    'bootstrap fetches the installer from the qhkm fork at the pinned commit',
  );
  assert.ok(source.includes('682f302f4084febf323558cf1a87ab8d311cba01e1e6088e4898d579871d10bf'));
  assert.ok(!source.includes('raw.githubusercontent.com/NousResearch/hermes-agent'));
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

test('computer use is gated, pinned, and proven before the runtime attests it', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  // The transfer field is optional and defaults to disabled; only `1` enables
  // the capability on this sprite.
  assert.match(source, /CUA_ENABLED_B64\) CUA_ENABLED_B64="\$value" ;;/
  );
  assert.match(source, /\$\{CUA_ENABLED_B64:-\}/);
  assert.match(source, /\[\[ "\$cua_enabled" =~ \^\(0\|1\)\?\$ \]\]/);

  // Stack + driver are pinned and verified, never fetched from a script.
  assert.match(source, /cua-driver-rs-v0\.23\.2/);
  assert.match(source, /01bf8339ec129cc00f4b4b2c6056ef1a7c5b52df39ff83ad17c9b16818aec500/);
  assert.match(source, /be22768a207796a4bc1de50c52f32f9ef680b5e86e58c059e02eec2caba2e7bb/);
  assert.match(source, /cua-driver checksum changed; release review required/);
  assert.match(source, /xvfb openbox dbus at-spi2-core/);
  assert.match(source, /hermes" computer-use doctor/);
  assert.match(source, /cua_doctor_ready/);

  // The capability is attested only after the doctor passes on the same run,
  // and the display service is created only when enabled.
  assert.match(source, /AISAR_CUA_ENABLED=%q\\n' '1' >> "\$runtime_env"/);
  assert.match(source, /services create x11-display/);
  assert.match(source, /hermes_needs=\(--needs x11-display\)/);

  // The operator handoff exposes the gate.
  const provision = await readFile(PROVISION, 'utf8');
  assert.match(provision, /AISAR_CUA_ENABLED:=0/);
  assert.match(provision, /CUA_ENABLED_B64=%s/);

  // The display supervisor that keeps Xvfb/openbox/dbus alive for the gateway
  // is shipped with the runtime and refuses to publish an empty contract.
  const display = await readFile(DISPLAY_SERVICE, 'utf8');
  assert.match(display, /Xvfb/);
  assert.match(display, /openbox/);
  assert.match(display, /DBUS_SESSION_BUS_ADDRESS/);
});

test('bootstrap refuses an invalid computer-use gate before touching the runtime', async () => {
  const transfer = await tempTransfer(fields({ cuaEnabled: '2' }));
  const result = run(transfer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CUA_ENABLED_B64/);
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
  const body = [
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
  if (input.cuaEnabled) {
    return body + `CUA_ENABLED_B64=${Buffer.from(String(input.cuaEnabled)).toString('base64')}\n`;
  }
  return body;
}
