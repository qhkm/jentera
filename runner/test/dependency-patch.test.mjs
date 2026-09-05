import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const SCRIPT = new URL('../bin/patch-hermes-dependencies.mjs', import.meta.url).pathname;
const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('narrowly updates the reviewed vulnerable override and verifies its lock', async () => {
  const root = await fixture('3.3.17', '3.3.17');
  assert.equal(run(root).status, 0);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.overrides['nanoid@^3'], '3.3.18');
  const apiServer = await readFile(join(root, 'gateway/platforms/api_server.py'), 'utf8');
  assert.ok(apiServer.includes('provider_sort=provider_routing.get("sort"),'));
  assert.ok(apiServer.includes('"jentera_patch": "jentera-runtime-2026-09-01",'));
  assert.ok(apiServer.includes('result.get("last_reasoning")'));
  assert.ok(apiServer.includes([
    '                        "usage": usage,',
    '                        **({"reasoning": reasoning} if reasoning else {}),',
    '                    })',
  ].join('\n')));
  assert.ok(apiServer.includes('**({"reasoning": reasoning} if reasoning else {}),'));
  const wireReorder = await readFile(join(root, 'agent/wire_reorder.py'), 'utf8');
  assert.ok(wireReorder.includes('PATCH_ID = "jentera-wire-order-2026-09-03"'));
  const bootstrap = await readFile(join(root, 'agent/process_bootstrap.py'), 'utf8');
  const runAgent = await readFile(join(root, 'run_agent.py'), 'utf8');
  for (const source of [bootstrap, runAgent]) {
    assert.ok(source.includes('Jentera: reorder chat.completions wire bodies'));
    assert.ok(source.includes('from agent.wire_reorder import wrap_http_client'));
  }
  assert.equal(run(root).status, 0, 'the complete patch is idempotent');
  assert.equal(run(root, '--verify').status, 0);
});

test('refuses an upstream override drift and a vulnerable lock', async () => {
  const drifted = await fixture('3.3.16', '3.3.16');
  assert.notEqual(run(drifted).status, 0);
  const vulnerable = await fixture('3.3.18', '3.3.17');
  assert.notEqual(run(vulnerable, '--verify').status, 0);
});

test('normalizes the reviewed one-off canary reasoning patch before applying the release patch', async () => {
  const root = await fixture('3.3.17', '3.3.17', true);
  assert.equal(run(root).status, 0);
  assert.equal(run(root, '--verify').status, 0);
  const apiServer = await readFile(join(root, 'gateway/platforms/api_server.py'), 'utf8');
  assert.ok(!/^\s+reasoning=reasoning,$/m.test(apiServer));
  assert.ok(apiServer.includes('**({"reasoning": reasoning} if reasoning else {}),'));
});

test('re-anchors provider-routing and runtime patches on the verbatim pinned shapes', async () => {
  const root = await pinnedFixture();
  assert.equal(run(root).status, 0);
  assert.equal(run(root, '--verify').status, 0);
  const apiServer = await readFile(join(root, 'gateway/platforms/api_server.py'), 'utf8');
  assert.ok(apiServer.includes('        provider_routing = user_config.get("provider_routing") or {}'));
  assert.ok(apiServer.includes('providers_allowed=provider_routing.get("only"),'));
  assert.ok(apiServer.includes('provider_sort=provider_routing.get("sort"),'));
  assert.ok(!apiServer.includes('agent_kwargs = {'));
  // Stage 2: the run.completed event dict must carry the bounded reasoning
  // spread (anchored on the pinned _put_event_if_active shape), and the
  // canary-era dict machinery must be absent from the patched output.
  assert.ok(apiServer.includes([
    '                        "usage": usage,',
    '                        **({"reasoning": reasoning} if reasoning else {}),',
    '                    })',
  ].join('\n')));
  assert.ok(apiServer.includes('result.get("last_reasoning")'));
  assert.ok(apiServer.includes('**({"reasoning": reasoning} if reasoning else {}),'));
  assert.ok(!apiServer.includes('pending_steer'));
  assert.ok(!apiServer.includes('completed_event'));
});

/** Stage-1 fabrication matching the pinned Hermes AIAgent() call shape:
 * gateway/platforms/api_server.py @ 111949b9750f7dafc8adaf0829de9cc108aa4236. */
const API_SERVER_STAGE1 = [
  '        user_config = _load_gateway_config()',
  '        agent = AIAgent(',
  '            model=model,',
  '            **runtime_kwargs,',
  '            quiet_mode=True,',
  '            reasoning_config=reasoning_config,',
  '            gateway_session_key=gateway_session_key,',
  '        )',
];

/** Scaffolding for the release-patch stages that touch the health handler and
 * the run.completed reporting block — pinned Hermes shape (the completed
 * event is a dict literal inside _put_event_if_active({...}) and the run
 * status is set via _set_run_status keyword arguments). */
const RUNTIME_SCAFFOLD = (legacyReasoning) => [
  '        return web.json_response({',
  '            "version": _hermes_version(),',
  '            "gateway_state": gw_state,',
  '        })',
  '                    final_response = result.get("final_response", "") if isinstance(result, dict) else ""',
  ...(legacyReasoning
    ? ['                    reasoning = result.get("last_reasoning") if isinstance(result, dict) else None']
    : []),
  '                    _put_event_if_active({',
  '                        "event": "run.completed",',
  '                        "run_id": run_id,',
  '                        "timestamp": time.time(),',
  '                        "output": final_response,',
  '                        "usage": usage,',
  ...(legacyReasoning ? ['                        "reasoning": reasoning,'] : []),
  '                    })',
  '                    self._set_run_status(',
  '                        run_id,',
  '                        "completed",',
  '                        output=final_response,',
  '                        usage=usage,',
  ...(legacyReasoning ? ['                        reasoning=reasoning,'] : []),
  '                        last_event="run.completed",',
  '                    )',
  '',
];

async function fixture(override, locked, legacyReasoning = false) {
  const root = await mkdtemp(join(tmpdir(), 'aisar-hermes-test-'));
  directories.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    overrides: { 'nanoid@^3': override, lodash: '4.18.1' },
  }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/example/node_modules/nanoid': { name: 'nanoid', version: locked } },
  }));
  await mkdir(join(root, 'gateway/platforms'), { recursive: true });
  await writeFile(join(root, 'gateway/platforms/api_server.py'),
    [...API_SERVER_STAGE1, ...RUNTIME_SCAFFOLD(legacyReasoning)].join('\n'));
  await writeKeepaliveSources(root);
  return root;
}

/** Like fixture(), but the api_server.py is a VERBATIM assembly of pinned
 * Hermes file slices (fixtures/pinned-api-server-create-agent.py): the
 * AIAgent() call shape plus the health-handler dict and the run.completed
 * reporting block, so a future Hermes pin that changes any reviewed anchor
 * fails this test loudly instead of the patch drifting silently. */
async function pinnedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'aisar-hermes-test-'));
  directories.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    overrides: { 'nanoid@^3': '3.3.17', lodash: '4.18.1' },
  }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/example/node_modules/nanoid': { name: 'nanoid', version: '3.3.17' } },
  }));
  await mkdir(join(root, 'gateway/platforms'), { recursive: true });
  const pinned = await readFile(
    new URL('./fixtures/pinned-api-server-create-agent.py', import.meta.url),
    'utf8',
  );
  await writeFile(join(root, 'gateway/platforms/api_server.py'), pinned);
  await writeKeepaliveSources(root);
  return root;
}

async function writeKeepaliveSources(root) {
  // Keepalive builders: the wire-order stage patches these exact anchors.
  await mkdir(join(root, 'agent'), { recursive: true });
  await writeFile(join(root, 'agent/process_bootstrap.py'), [
    'def build_keepalive_http_client(',
    '    base_url: str = "",',
    '    *,',
    '    async_mode: bool = False,',
    '    verify: object = True,',
    '):',
    '    """Docstring."""',
    '    try:',
    '        import httpx',
    '',
    '        limits = httpx.Limits(',
    '            max_keepalive_connections=20,',
    '            max_connections=100,',
    '            keepalive_expiry=20.0,',
    '        )',
    '        timeout = httpx.Timeout(connect=15.0, read=None, write=15.0, pool=10.0)',
    '',
    '        transport_cls = httpx.AsyncHTTPTransport if async_mode else httpx.HTTPTransport',
    '        client_cls = httpx.AsyncClient if async_mode else httpx.Client',
    '        mounts = {}',
    '        if proxy is None:',
    '            mounts = {',
    '                "http://": transport_cls(verify=verify),',
    '                "https://": transport_cls(verify=verify),',
    '            }',
    '        return client_cls(',
    '            limits=limits,',
    '            timeout=timeout,',
    '            proxy=proxy,',
    '            mounts=mounts or None,',
    '            verify=verify,',
    '        )',
    '    except Exception:',
    '        return None',
    '',
  ].join('\n'));
  await writeFile(join(root, 'run_agent.py'), [
    'class AIAgent:',
    '    @staticmethod',
    '    def _build_keepalive_http_client(base_url: str = "", *, verify: object = True):',
    '        """Docstring."""',
    '        try:',
    '            import httpx as _httpx',
    '',
    '            _proxy = None',
    '            _limits = _httpx.Limits(',
    '                max_keepalive_connections=20,',
    '                max_connections=100,',
    '                keepalive_expiry=20.0,',
    '            )',
    '            _timeout = _httpx.Timeout(',
    '                connect=15.0,',
    '                read=None,',
    '                write=15.0,',
    '                pool=10.0,',
    '            )',
    '            _mounts = {}',
    '            if _proxy is None:',
    '                _mounts = {',
    '                    "http://": _httpx.HTTPTransport(verify=verify),',
    '                    "https://": _httpx.HTTPTransport(verify=verify),',
    '                }',
    '            return _httpx.Client(',
    '                limits=_limits,',
    '                timeout=_timeout,',
    '                proxy=_proxy,',
    '                mounts=_mounts or None,',
    '                verify=verify,',
    '            )',
    '        except Exception:',
    '            return None',
    '',
  ].join('\n'));
}

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
