import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const SCRIPT = new URL('../bin/bootstrap-runtime.sh', import.meta.url).pathname;
const CONFIGURE = new URL('../bin/configure-model-provider.py', import.meta.url).pathname;
const HERMES_SERVICE = new URL('../bin/hermes-service.sh', import.meta.url).pathname;
const RUNNER_SERVICE = new URL('../bin/runner-service.sh', import.meta.url).pathname;
const PROVISION = new URL('../bin/provision-sprite.sh', import.meta.url).pathname;
const DISPLAY_SERVICE = new URL('../bin/display-service.sh', import.meta.url).pathname;
const directories = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('bootstrap reports an unknown transfer field and carries on', async () => {
  /* It used to exit 1 here. That turned "the control plane is one deploy
     ahead of the bundle it pins" — an ordinary moment in any rollout — into
     a sprite that would not boot: on 2026-09-10 every runtime rejected
     EXTRACT_BASE_B64 and upgrade tasks retried to exhaustion. The value has
     already passed the base64 check, so an unknown name is inert data. It
     is reported, not obeyed, and not fatal.

     Reaching a *later* failure is the assertion: it proves the unknown
     field did not stop the run. */
  const transfer = await tempTransfer(`SURPRISE_B64=YWJj\n${fields()}`);
  const result = run(transfer);
  assert.match(result.stderr, /ignoring unknown field SURPRISE_B64/);
  assert.doesNotMatch(result.stderr, /transfer contains an unknown field/);
});

test('bootstrap still refuses a transfer value that is not base64', async () => {
  /* The relaxation above is only for unknown *names*. A value that is not
     base64 is still refused, because that is what keeps the transfer data
     rather than something that could become shell. */
  const transfer = await tempTransfer('BUSINESS_ID_B64=not$(id)base64\n');
  const result = run(transfer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid base64/);
});

test('bootstrap still refuses a transfer missing a required field', async () => {
  /* Surplus is tolerated; absence is not. A missing runner key must fail as
     loudly as it ever did. */
  const transfer = await tempTransfer('BUSINESS_ID_B64=YWJj\n');
  const result = run(transfer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing/);
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
  // The Worker model proxy (B3): runtimes face api.jentera.ai/v1/model with
  // a minted jentera-runtime-key token, never the upstream directly.
  assert.match(source, /https:\/\/api\.jentera\.ai\/v1\/model/);
  assert.match(source, /OPENROUTER_BASE_URL=%q.*\$model_base/);
  assert.match(source, /AISAR_MODEL_NAME=%q.*\$model_name/);
  assert.match(source, /AISAR_DEEP_MODEL_NAME=%q.*\$deep_model_name/);
  const configure = await readFile(CONFIGURE, 'utf8');
  assert.match(configure, /https:\/\/router\.fmcv\.my/);
  assert.match(configure, /https:\/\/api\.jentera\.ai\/v1\/model/);
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

test('bootstrap writes mode-0600 consumer-scoped credential files', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  const runtime = writerBlock(source, "printf 'AISAR_BUSINESS_ID=%q", '} > "$runtime_tmp"');
  const runner = writerBlock(source, "printf 'AISAR_RUNNER_KEY=%q", '} > "$runner_tmp"');
  const hermes = writerBlock(source, "{\n  printf 'HERMES_API_KEY=%q", '} > "$hermes_tmp"');

  assert.doesNotMatch(runtime, /AISAR_RUNNER_KEY|AISAR_EDGE_TOKEN|HERMES_API_KEY|API_SERVER_KEY|OPENROUTER_API_KEY/);
  assert.match(runner, /AISAR_RUNNER_KEY/);
  assert.match(runner, /AISAR_EDGE_TOKEN/);
  assert.match(runner, /HERMES_API_KEY/);
  assert.doesNotMatch(runner, /API_SERVER_KEY|OPENROUTER_API_KEY/);
  assert.match(hermes, /HERMES_API_KEY/);
  assert.match(hermes, /API_SERVER_KEY/);
  assert.match(hermes, /OPENROUTER_API_KEY/);
  assert.doesNotMatch(hermes, /AISAR_RUNNER_KEY|AISAR_EDGE_TOKEN/);
  assert.match(source, /chmod 600 "\$runtime_tmp" "\$runner_tmp" "\$hermes_tmp"/);
  assert.match(source, /mv "\$runner_tmp" "\$runner_env"/);
  assert.match(source, /mv "\$hermes_tmp" "\$hermes_env"/);

  const hermesService = await readFile(HERMES_SERVICE, 'utf8');
  assert.match(hermesService, /AISAR_HERMES_ENV_FILE/);
  assert.match(hermesService, /source "\$runtime_env"\nsource "\$hermes_env"/);
  const runnerService = await readFile(RUNNER_SERVICE, 'utf8');
  assert.match(runnerService, /AISAR_RUNNER_ENV_FILE/);
  assert.match(runnerService, /source "\$runtime_env"\nsource "\$runner_env"/);
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
  assert.ok(source.includes('e6a44c55366aa676b281c7e75a4decc0834b9ca73daeb996e3eab0b404f097f4'));
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

test('bootstrap routes candidate models beside quick and deep', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /CANDIDATE_MODEL_NAMES_B64\) CANDIDATE_MODEL_NAMES_B64="\$value" ;;/);
  assert.match(source, /AISAR_CANDIDATE_MODEL_NAMES=%q.*\$candidate_model_names/);
  assert.match(
    source,
    /configure-model-provider\.py \\\n\s+"\$model_provider" "\$model_base" "\$model_name" OPENROUTER_API_KEY "\$cua_enabled" \\\n\s+"\$deep_model_name" "\$candidate_model_names"/,
  );
});

test('bootstrap refuses an invalid candidate model id before installing anything', async () => {
  const transfer = await tempTransfer(fields({ candidateModelNames: 'MiniMax-M2.7-highspeed,bad model' }));
  const result = run(transfer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /candidate model id is invalid/);
});

test('configure pins a route and reasoning override for each candidate model', async () => {
  const primary = 'MiniMax-M3';
  const deep = 'deepseek-v4-flash';
  const candidate = 'MiniMax-M2.7-highspeed';
  const { status, stderr, configPath } = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', primary, 'OPENROUTER_API_KEY', '0', deep, candidate],
    { platform_toolsets: { api_server: ['hermes-api-server'] } },
  );
  assert.equal(status, 0, stderr);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepStrictEqual(config.gateway.api_server.extra.model_routes[candidate], {
    model: candidate,
    provider: 'openrouter',
    base_url: 'https://router.fmcv.my',
    api_key: '${OPENROUTER_API_KEY}',
  });
  assert.equal(config.agent.reasoning_overrides[candidate], 'high');
  assert.equal(config.model.default, primary);

  const invalid = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', primary, 'OPENROUTER_API_KEY', '0', deep, 'bad model'],
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /candidate model id is invalid/);
});

test('configure disables the post-run skill review on every provision', async () => {
  /* Hermes forks a "review the conversation and update the skill library"
     turn after runs (auxiliary.background_review, default on): a full-context
     model call producing skills the product never exposes. Pinned off. */
  const { status, stderr, configPath } = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', 'MiniMax-M3', 'OPENROUTER_API_KEY', '0', 'deepseek-v4-flash'],
    { auxiliary: { background_review: { enabled: true, keep: 'me' } } },
  );
  assert.equal(status, 0, stderr);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.auxiliary.background_review.enabled, false);
  assert.equal(config.auxiliary.background_review.keep, 'me');
});

test('configure creates one isolated persistent profile for every business specialist', async () => {
  const { status, stderr, configPath } = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', 'MiniMax-M3', 'OPENROUTER_API_KEY', '0', 'deepseek-v4-flash'],
  );
  assert.equal(status, 0, stderr);
  const home = join(configPath, '..');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.gateway.multiplex_profiles, true);

  for (const profile of ['operations', 'customers', 'growth', 'records']) {
    const root = join(home, 'profiles', profile);
    const soul = await readFile(join(root, 'SOUL.md'), 'utf8');
    assert.match(soul, /persistent .* specialist/i);
    assert.match(soul, /owner speaks to one Jentera Chief of Staff/i);
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'config.yaml'), 'utf8')),
      config,
    );
    assert.equal((await readFile(join(root, '.no-bundled-skills'), 'utf8')).length > 0, true);
  }
  assert.match(await readFile(join(home, 'SOUL.md'), 'utf8'), /persistent private Chief of Staff/i);
});

test('the agent is told how it reads pages, and only where it can', async () => {
  /* An owner asked "can u use firecrawl i think we have it installed". The
     agent ran `which firecrawl`, found nothing, and reported the capability
     missing — twenty minutes after web_extract had read 8,290 characters of
     a page on that same sprite. A hosted service reached through a library
     leaves no trace on the filesystem, so the filesystem is the one place
     that cannot answer the question. Tell it so, in the only file it always
     reads, and only where the claim is actually true. */
  const extract = {
    FIRECRAWL_API_URL: 'https://extract.example.com',
    FIRECRAWL_API_KEY: 'k'.repeat(40),
  };
  const configured = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', 'MiniMax-M3', 'OPENROUTER_API_KEY', '0', 'deepseek-v4-flash'],
    {},
    extract,
  );
  assert.equal(configured.status, 0, configured.stderr);
  const home = join(configured.configPath, '..');
  const config = JSON.parse(await readFile(configured.configPath, 'utf8'));
  assert.equal(config.web.extract_backend, 'firecrawl');

  /* The Chief of Staff is who the owner actually asked, and a specialist
     doing research is exactly who would go looking on disk. */
  for (const soulPath of [
    join(home, 'SOUL.md'),
    join(home, 'profiles', 'operations', 'SOUL.md'),
  ]) {
    const soul = await readFile(soulPath, 'utf8');
    assert.match(soul, /web_extract/);
    /* Named, because the owner asks for it by name. A note that only said
       "web_extract" left the agent unable to connect the question "can u use
       firecrawl" to the tool that answers it, and it went looking on disk. */
    assert.match(soul, /Firecrawl/);
    assert.match(soul, /no `firecrawl` command/);
    assert.match(soul, /never by searching this filesystem/i);
  }

  /* Without an endpoint every word of that would be false, and the note has
     to disappear with the backend it describes — one predicate decides both. */
  const bare = await runConfigure(
    ['openrouter', 'https://router.fmcv.my', 'MiniMax-M3', 'OPENROUTER_API_KEY', '0', 'deepseek-v4-flash'],
  );
  assert.equal(bare.status, 0, bare.stderr);
  const bareHome = join(bare.configPath, '..');
  const bareConfig = JSON.parse(await readFile(bare.configPath, 'utf8'));
  assert.equal(bareConfig.web.extract_backend, undefined);
  for (const soulPath of [
    join(bareHome, 'SOUL.md'),
    join(bareHome, 'profiles', 'operations', 'SOUL.md'),
  ]) {
    assert.equal(/web_extract/.test(await readFile(soulPath, 'utf8')), false);
  }
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
    hermesTag: 'v2026.9.8',
    hermesCommit: 'ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413',
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
  let extra = '';
  if (input.cuaEnabled) {
    extra += `CUA_ENABLED_B64=${Buffer.from(String(input.cuaEnabled)).toString('base64')}\n`;
  }
  if (input.candidateModelNames) {
    extra += `CANDIDATE_MODEL_NAMES_B64=${Buffer.from(input.candidateModelNames).toString('base64')}\n`;
  }
  return body + extra;
}

// Spawn configure-model-provider.py against a hermetic stand-in for the pinned
// Hermes install: a fabricated config file plus minimal hermes_cli/toolsets
// modules on PYTHONPATH. load_config/save_config read and write JSON so the
// test can assert on the exact bytes the script provisions, including the
// gateway.api_server.extra.model_routes block it must emit.
async function runConfigure(argv, preexisting = {}, extraEnv = {}) {
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
  const configPath = join(directory, 'config.yaml');
  await writeFile(configPath, JSON.stringify(preexisting));
  const result = spawnSync('python3', [CONFIGURE, ...argv], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: directory,
      HERMES_HOME: directory,
      AISAR_TEST_CONFIG: configPath,
      ...extraEnv,
    },
  });
  return { ...result, configPath };
}

function writerBlock(source, startMarker, endMarker) {
  const start = source.lastIndexOf('{', source.indexOf(startMarker));
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing writer start for ${startMarker}`);
  assert.notEqual(end, -1, `missing writer end for ${endMarker}`);
  return source.slice(start, end + endMarker.length);
}
