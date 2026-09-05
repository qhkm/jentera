import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('configured model routes pin provider, base_url and env key for quick and deep models', async () => {
  const primary = 'deepseek/deepseek-v4-flash-0731';
  const deep = 'deepseek/deepseek-v4-0401';
  const { status, stderr, configPath } = await runConfigure([
    'openrouter',
    'https://openrouter.ai/api/v1/', // trailing slash must be stripped for routes too
    primary,
    'OPENROUTER_API_KEY',
    '0',
    deep,
  ]);
  assert.equal(status, 0, stderr);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  // The worker sends the raw model ids (not "quick"/"deep" aliases), so route
  // keys are the model ids themselves and each route pins the full runtime
  // contract: model, provider, allowlisted base_url (no trailing slash) and
  // the key as an env placeholder.
  assert.deepStrictEqual(config.gateway.api_server.extra.model_routes, {
    [primary]: {
      model: primary,
      provider: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: '${OPENROUTER_API_KEY}',
    },
    [deep]: {
      model: deep,
      provider: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: '${OPENROUTER_API_KEY}',
    },
  });
  // No literal key material may ever reach the written config file.
  assert.doesNotMatch(JSON.stringify(config), /sk-[A-Za-z0-9]+/);
});

test('model routes collapse to the single primary route when the deep model is absent or identical', async () => {
  const primary = 'deepseek/deepseek-v4-flash-0731';
  const expected = {
    [primary]: {
      model: primary,
      provider: 'openrouter',
      base_url: 'https://router.fmcv.my',
      api_key: '${OPENROUTER_API_KEY}',
    },
  };
  for (const argv of [
    ['openrouter', 'https://router.fmcv.my', primary, 'OPENROUTER_API_KEY', '0'],
    ['openrouter', 'https://router.fmcv.my', primary, 'OPENROUTER_API_KEY', '0', primary],
  ]) {
    const { status, stderr, configPath } = await runConfigure(argv);
    assert.equal(status, 0, stderr);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepStrictEqual(config.gateway.api_server.extra.model_routes, expected);
  }
});

test('model routes merge with, and never clobber, existing api_server settings', async () => {
  const primary = 'deepseek/deepseek-v4-flash-0731';
  const deep = 'deepseek/deepseek-v4-0401';
  const existing = {
    gateway: {
      api_server: {
        max_concurrent_runs: 4,
        other: 'preserved',
        extra: {
          keep: 'me',
          model_routes: {
            'existing/route': {
              model: 'existing/route',
              provider: 'openrouter',
              base_url: 'https://openrouter.ai/api/v1',
              api_key: '${OPENROUTER_API_KEY}',
            },
          },
        },
      },
    },
    platform_toolsets: { api_server: ['hermes-api-server'] },
  };
  const { status, stderr, configPath } = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', primary, 'OPENROUTER_API_KEY', '1', deep],
    existing,
  );
  assert.equal(status, 0, stderr);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepStrictEqual(config.gateway.api_server.extra.model_routes, {
    'existing/route': {
      model: 'existing/route',
      provider: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: '${OPENROUTER_API_KEY}',
    },
    [primary]: {
      model: primary,
      provider: 'openrouter',
      base_url: 'https://router.fmcv.my',
      api_key: '${OPENROUTER_API_KEY}',
    },
    [deep]: {
      model: deep,
      provider: 'openrouter',
      base_url: 'https://router.fmcv.my',
      api_key: '${OPENROUTER_API_KEY}',
    },
  });
  assert.equal(config.gateway.api_server.max_concurrent_runs, 1);
  assert.equal(config.gateway.api_server.other, 'preserved');
  assert.equal(config.gateway.api_server.extra.keep, 'me');
});

test('bootstrap hands the deep model to the provider configure step', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(
    source,
    /configure-model-provider\.py \\\n\s+"\$model_provider" "\$model_base" "\$model_name" OPENROUTER_API_KEY "\$cua_enabled" \\\n\s+"\$deep_model_name"/,
  );
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

// Spawn configure-model-provider.py against a hermetic stand-in for the pinned
// Hermes install: a fabricated config file plus minimal hermes_cli/toolsets
// modules on PYTHONPATH. load_config/save_config read and write JSON so the
// test can assert on the exact bytes the script provisions, including the
// gateway.api_server.extra.model_routes block it must emit.
async function runConfigure(argv, preexisting = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aisar-configure-test-'));
  directories.push(directory);
  const fakePackage = join(directory, 'hermes_cli');
  await mkdir(fakePackage);
  await writeFile(join(fakePackage, '__init__.py'), '');
  await writeFile(
    join(fakePackage, 'config.py'),
    [
      'import json, os',
      'from pathlib import Path',
      '',
      'def _cfg_path():',
      '    return Path(os.environ["AISAR_TEST_CONFIG"])',
      '',
      'def load_config():',
      '    path = _cfg_path()',
      '    return json.loads(path.read_text()) if path.exists() else {}',
      '',
      'def save_config(config):',
      '    _cfg_path().write_text(json.dumps(config, indent=2))',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(fakePackage, 'tools_config.py'),
    [
      'def _get_platform_tools(config, platform):',
      '    names = (config.get("platform_toolsets") or {}).get(platform) or []',
      '    return set(names)',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(directory, 'toolsets.py'),
    'def resolve_toolset(name):\n    return {name, "fake-inference-tool"}\n',
  );
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify(preexisting));
  const result = spawnSync('python3', [CONFIGURE, ...argv], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: directory, AISAR_TEST_CONFIG: configPath },
  });
  return { ...result, configPath };
}
