import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const SCRIPT = new URL('../bin/patch-hermes-dependencies.mjs', import.meta.url).pathname;
const directories = [];

/* The wire-order stage (jentera-wire-order-2026-09-03) was retired: prefix
   cache hit rates were identical with and without it. Sprites patched by an
   earlier release still carry it in place, so these are the exact shapes the
   old stage wrote and the pinned upstream anchors it must give back. */
const WIRE_ORDER_MARKER = '# Jentera: reorder chat.completions wire bodies (tools first, messages last).';
const BOOTSTRAP_ANCHOR = [
  '        return client_cls(',
  '            limits=limits,',
  '            timeout=timeout,',
  '            proxy=proxy,',
  '            mounts=mounts or None,',
  '            verify=verify,',
  '        )',
].join('\n');
const BOOTSTRAP_WIRED = [
  '        client = client_cls(',
  '            limits=limits,',
  '            timeout=timeout,',
  '            proxy=proxy,',
  '            mounts=mounts or None,',
  '            verify=verify,',
  '        )',
  `        ${WIRE_ORDER_MARKER}`,
  '        try:',
  '            from agent.wire_reorder import wrap_http_client',
  '',
  '            client = wrap_http_client(client, async_mode=async_mode)',
  '        except Exception:',
  '            pass',
  '        return client',
].join('\n');
const RUN_AGENT_ANCHOR = [
  '            return _httpx.Client(',
  '                limits=_limits,',
  '                timeout=_timeout,',
  '                proxy=_proxy,',
  '                mounts=_mounts or None,',
  '                verify=verify,',
  '            )',
].join('\n');
const RUN_AGENT_WIRED = [
  '            _client = _httpx.Client(',
  '                limits=_limits,',
  '                timeout=_timeout,',
  '                proxy=_proxy,',
  '                mounts=_mounts or None,',
  '                verify=verify,',
  '            )',
  `            ${WIRE_ORDER_MARKER}`,
  '            try:',
  '                from agent.wire_reorder import wrap_http_client',
  '',
  '                _client = wrap_http_client(_client)',
  '            except Exception:',
  '                pass',
  '            return _client',
].join('\n');

async function missing(path) {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('narrowly updates the reviewed vulnerable dependencies and verifies the lock', async () => {
  const root = await fixture('3.3.17', '3.3.17');
  assert.equal(run(root).status, 0);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.overrides['nanoid@^3'], '3.3.18');
  assert.equal(manifest.overrides['undici@^6'], '6.28.0');
  assert.equal(manifest.overrides['undici@^7'], '7.29.0');
  assert.equal(manifest.overrides['undici@^8'], '8.9.0');
  assert.equal(manifest.overrides['postcss@^8'], '8.5.23');
  assert.equal(manifest.overrides['react-router@^7'], '7.18.2');
  assert.equal(manifest.overrides['react-router-dom@^7'], '7.18.2');
  assert.equal(manifest.overrides['sanitize-html@^2'], '2.17.7');
  assert.equal(manifest.overrides['dompurify@^3'], '3.4.14');
  assert.equal(manifest.overrides['mermaid@^11'], '11.16.1');
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/undici'].version, '6.28.0');
  assert.equal(lock.packages['node_modules/jsdom/node_modules/undici'].version, '7.29.0');
  assert.equal(lock.packages['node_modules/postcss'].version, '8.5.23');
  assert.equal(lock.packages['node_modules/react-router'].version, '7.18.2');
  assert.equal(lock.packages['node_modules/react-router-dom'].version, '7.18.2');
  assert.equal(lock.packages['node_modules/sanitize-html'].version, '2.17.7');
  assert.equal(lock.packages['node_modules/dompurify'].version, '3.4.14');
  assert.equal(lock.packages['node_modules/mermaid'].version, '11.16.1');
  const apiServer = await readFile(join(root, 'gateway/platforms/api_server.py'), 'utf8');
  assert.ok(apiServer.includes('provider_sort=provider_routing.get("sort"),'));
  assert.ok(apiServer.includes('"jentera_patch": "jentera-runtime-2026-09-07",'));
  assert.ok(apiServer.includes('result.get("last_reasoning")'));
  assert.equal(
    apiServer.match(/\*\*\(\{"reasoning": reasoning\} if reasoning else \{}\),/g)?.length,
    2,
  );
  assert.ok(apiServer.includes('"event": "iteration.started",'));
  assert.ok(apiServer.includes('step_callback=step_callback,'));
  assert.ok(apiServer.includes('step_callback=_step_cb,'));
  const bootstrap = await readFile(join(root, 'agent/process_bootstrap.py'), 'utf8');
  const runAgent = await readFile(join(root, 'run_agent.py'), 'utf8');
  for (const source of [bootstrap, runAgent]) {
    assert.ok(!source.includes(WIRE_ORDER_MARKER), 'retired wire-order stage must not be applied');
  }
  assert.ok(await missing(join(root, 'agent/wire_reorder.py')));
  assert.equal(run(root).status, 0, 'the complete patch is idempotent');
  assert.equal(run(root, '--verify').status, 0);
});

test('removes the retired wire-order patch from a tree that still carries it', async () => {
  const root = await fixture('3.3.17', '3.3.17', false, true);
  const apply = run(root);
  assert.equal(apply.status, 0, apply.stderr);
  assert.ok(!apply.stdout.includes('wire-order'), apply.stdout);
  const bootstrap = await readFile(join(root, 'agent/process_bootstrap.py'), 'utf8');
  const runAgent = await readFile(join(root, 'run_agent.py'), 'utf8');
  assert.ok(bootstrap.includes(BOOTSTRAP_ANCHOR), 'process_bootstrap.py anchor not restored');
  assert.ok(runAgent.includes(RUN_AGENT_ANCHOR), 'run_agent.py anchor not restored');
  for (const source of [bootstrap, runAgent]) {
    assert.ok(!source.includes(WIRE_ORDER_MARKER));
    assert.ok(!source.includes('wire_reorder'));
  }
  assert.ok(await missing(join(root, 'agent/wire_reorder.py')), 'wire_reorder.py must be deleted');
  assert.equal(run(root).status, 0, 'removal is idempotent');
  const verify = run(root, '--verify');
  assert.equal(verify.status, 0, verify.stderr);
  assert.ok(!verify.stdout.includes('wire-order'), verify.stdout);
});

test('verify fails closed while the retired wire-order patch is still present', async () => {
  // A sprite patched by the retiring release: everything else current, the
  // wire stage still in place because nothing has run apply since.
  const root = await fixture('3.3.17', '3.3.17');
  assert.equal(run(root).status, 0);
  const bootstrapPath = join(root, 'agent/process_bootstrap.py');
  const runAgentPath = join(root, 'run_agent.py');
  await writeFile(bootstrapPath,
    (await readFile(bootstrapPath, 'utf8')).replace(BOOTSTRAP_ANCHOR, BOOTSTRAP_WIRED));
  await writeFile(runAgentPath,
    (await readFile(runAgentPath, 'utf8')).replace(RUN_AGENT_ANCHOR, RUN_AGENT_WIRED));
  await writeFile(join(root, 'agent/wire_reorder.py'), 'PATCH_ID = "jentera-wire-order-2026-09-03"\n');
  const verify = run(root, '--verify');
  assert.notEqual(verify.status, 0, 'verify must refuse a tree that still carries the retired patch');
  assert.match(verify.stderr, /wire-order/);
  assert.equal(run(root).status, 0, 'apply heals it');
  assert.equal(run(root, '--verify').status, 0);
});

test('a successful extraction stops being reported as a failed one', async () => {
  /* web_extract_tool set "error": r.get("error") unconditionally, so a page
     that came back perfectly still carried "error": null — and
     _detect_tool_failure ends in a substring scan of the first 500 characters
     for "error", which matches. Every successful extraction was logged as a
     tool error and handed to the model tagged as a failure. */
  const root = await fixture('3.3.17', '3.3.17');
  assert.equal(run(root).status, 0);
  const webTools = await readFile(join(root, 'tools/web_tools.py'), 'utf8');
  assert.ok(webTools.includes('**({"error": r["error"]} if r.get("error") else {}),'));
  assert.ok(!webTools.includes('"error": r.get("error"),'));
  /* The policy key beside it is untouched: this narrows one field, not the
     shape of the result. */
  assert.ok(webTools.includes('"blocked_by_policy"'));

  /* Re-applying is a no-op rather than a second patch or a hard failure. */
  const before = await readFile(join(root, 'tools/web_tools.py'), 'utf8');
  assert.equal(run(root).status, 0);
  assert.equal(await readFile(join(root, 'tools/web_tools.py'), 'utf8'), before);
});

test('refuses an upstream override drift and a vulnerable lock', async () => {
  const drifted = await fixture('3.3.16', '3.3.16');
  assert.notEqual(run(drifted).status, 0);
  const vulnerable = await fixture('3.3.18', '3.3.17');
  assert.notEqual(run(vulnerable, '--verify').status, 0);
  const vulnerableUndici = await fixture('3.3.18', '3.3.18');
  assert.notEqual(run(vulnerableUndici, '--verify').status, 0);
});

test('normalizes the reviewed one-off canary reasoning patch before applying the release patch', async () => {
  const root = await fixture('3.3.17', '3.3.17', true);
  assert.equal(run(root).status, 0);
  assert.equal(run(root, '--verify').status, 0);
  const apiServer = await readFile(join(root, 'gateway/platforms/api_server.py'), 'utf8');
  assert.ok(!/^\s+reasoning=reasoning,$/m.test(apiServer));
  assert.ok(apiServer.includes('**({"reasoning": reasoning} if reasoning else {}),'));
});

async function fixture(override, locked, legacyReasoning = false, wiredOrder = false) {
  const root = await mkdtemp(join(tmpdir(), 'aisar-hermes-test-'));
  directories.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    overrides: { 'nanoid@^3': override, lodash: '4.18.1' },
  }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({
    packages: {
      'node_modules/example/node_modules/nanoid': { name: 'nanoid', version: locked },
      'node_modules/undici': { version: '6.27.0' },
      'node_modules/jsdom/node_modules/undici': { version: '7.28.0' },
      'node_modules/postcss': { version: '8.5.15' },
      'node_modules/react-router': { version: '7.18.0' },
      'node_modules/react-router-dom': { version: '7.18.0' },
      'node_modules/sanitize-html': { version: '2.17.5' },
      'node_modules/dompurify': { version: '3.4.11' },
      'node_modules/mermaid': { version: '11.16.0' },
    },
  }));
  await mkdir(join(root, 'tools'), { recursive: true });
  await writeFile(join(root, 'tools/web_tools.py'), [
    '        # Trim output to minimal fields per entry: title, content, error',
    '        trimmed_results = [',
    '            {',
    '                "url": r.get("url", ""),',
    '                "title": r.get("title", ""),',
    '                "content": r.get("content", ""),',
    '                "error": r.get("error"),',
    '                **({  "blocked_by_policy": r["blocked_by_policy"]} if "blocked_by_policy" in r else {}),',
    '            }',
    '            for r in response.get("results", [])',
    '        ]',
    '',
  ].join('\n'));
  await mkdir(join(root, 'gateway/platforms'), { recursive: true });
  await writeFile(join(root, 'gateway/platforms/api_server.py'), [
    '    def _create_agent(',
    '        self,',
    '        ephemeral_system_prompt: Optional[str] = None,',
    '        session_id: Optional[str] = None,',
    '        stream_delta_callback=None,',
    '        tool_progress_callback=None,',
    '        tool_start_callback=None,',
    '    ):',
    '        user_config = _load_gateway_config()',
    '        agent = AIAgent(',
    '            model=model,',
    '            **runtime_kwargs,',
    '            tool_progress_callback=tool_progress_callback,',
    '            tool_start_callback=tool_start_callback,',
    '            reasoning_config=reasoning_config,',
    '            gateway_session_key=gateway_session_key,',
    '        )',
    '        def _callback(event_type: str, tool_name: str = None, preview: str = None, args=None, **kwargs):',
    '            ts = time.time()',
    '            if event_type == "tool.started":',
    '                pass',
    '        event_cb = self._make_run_event_callback(run_id, loop)',
    '                agent = self._create_agent(',
    '                        stream_delta_callback=_text_cb,',
    '                        tool_progress_callback=event_cb,',
    '                        gateway_session_key=gateway_session_key,',
    '                )',
    '                self._active_run_agents[run_id] = agent',
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
  ].join('\n'));
  // Keepalive builders: the retired wire-order stage patched these exact
  // anchors; a wiredOrder fixture carries its output in place.
  await mkdir(join(root, 'agent'), { recursive: true });
  const bootstrapSrc = [
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
  ].join('\n');
  const runAgentSrc = [
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
  ].join('\n');
  await writeFile(join(root, 'agent/process_bootstrap.py'),
    wiredOrder ? bootstrapSrc.replace(BOOTSTRAP_ANCHOR, BOOTSTRAP_WIRED) : bootstrapSrc);
  await writeFile(join(root, 'run_agent.py'),
    wiredOrder ? runAgentSrc.replace(RUN_AGENT_ANCHOR, RUN_AGENT_WIRED) : runAgentSrc);
  if (wiredOrder) {
    await writeFile(join(root, 'agent/wire_reorder.py'),
      '# Jentera: reviewed wire-order stabilization for fmcv router prefix caches.\n' +
      'PATCH_ID = "jentera-wire-order-2026-09-03"\n');
  }
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
