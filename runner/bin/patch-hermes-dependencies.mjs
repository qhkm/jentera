#!/usr/bin/env node

import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
const verify = process.argv.includes('--verify');
const testTarget = process.env.NODE_ENV === 'test' &&
  /\/aisar-hermes-test-[^/]+$/.test(root ?? '');
if (!root?.startsWith('/home/sprite/.hermes/hermes-agent') && !testTarget) {
  throw new Error('Hermes dependency patch target is not allowed');
}

const packagePath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const apiServerPath = join(root, 'gateway/platforms/api_server.py');
const routingMarker = '# Jentera: apply reviewed OpenRouter routing to API-server agents.';
const runtimeMarker = '# Jentera: expose bounded final reasoning and attest this runtime patch.';
const iterationMarker = '# Jentera: expose real Hermes iteration progress to the run SSE.';
const runtimePatchId = 'jentera-runtime-2026-09-07';
const priorRuntimePatchId = 'jentera-runtime-2026-09-06';
const legacyRuntimePatchIds = new Set([
  'jentera-runtime-2026-09-01',
  'jentera-runtime-2026-09-04',
]);
const bootstrapPath = join(root, 'agent/process_bootstrap.py');
const runAgentPath = join(root, 'run_agent.py');
/* Retired stage. jentera-wire-order-2026-09-03 reordered chat.completions
   bodies for byte-prefix-keyed router caches; hit rates measured identical
   with and without it (2026-09-08). Trees it touched are unpatched in place
   below, since a sprite's Hermes checkout survives re-bootstrap as-is. */
const retiredWireReorderPath = join(root, 'agent/wire_reorder.py');
const retiredWireOrderMarker = '# Jentera: reorder chat.completions wire bodies (tools first, messages last).';
const retiredWireOrderShapes = [
  [bootstrapPath, [
    '        return client_cls(',
    '            limits=limits,',
    '            timeout=timeout,',
    '            proxy=proxy,',
    '            mounts=mounts or None,',
    '            verify=verify,',
    '        )',
  ].join('\n'), [
    '        client = client_cls(',
    '            limits=limits,',
    '            timeout=timeout,',
    '            proxy=proxy,',
    '            mounts=mounts or None,',
    '            verify=verify,',
    '        )',
    `        ${retiredWireOrderMarker}`,
    '        try:',
    '            from agent.wire_reorder import wrap_http_client',
    '',
    '            client = wrap_http_client(client, async_mode=async_mode)',
    '        except Exception:',
    '            pass',
    '        return client',
  ].join('\n')],
  [runAgentPath, [
    '            return _httpx.Client(',
    '                limits=_limits,',
    '                timeout=_timeout,',
    '                proxy=_proxy,',
    '                mounts=_mounts or None,',
    '                verify=verify,',
    '            )',
  ].join('\n'), [
    '            _client = _httpx.Client(',
    '                limits=_limits,',
    '                timeout=_timeout,',
    '                proxy=_proxy,',
    '                mounts=_mounts or None,',
    '                verify=verify,',
    '            )',
    `            ${retiredWireOrderMarker}`,
    '            try:',
    '                from agent.wire_reorder import wrap_http_client',
    '',
    '                _client = wrap_http_client(_client)',
    '            except Exception:',
    '                pass',
    '            return _client',
  ].join('\n')],
];
const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
// Reviewed vulnerability floors (2026): a locked version below its floor
// fails the bootstrap audit gate on the sprite (npm audit --omit=dev
// --audit-level=high), so pin deterministically per major line.
//   undici        — GHSA-m8rv-5g2x-5cg5 (CRLF injection via blob-like body
//                    'type'), GHSA-v3r7-h72x-cjcm (cookie attribute injection)
//   postcss       — GHSA-/GHSA-…: sourcemap path traversal + .map disclosure
//                    (8.5.15 affected; fixed ≥8.5.23)
//   react-router  — RSC-mode CSRF bypass (7.18.0 affected; fixed 7.18.2)
//   sanitize-html — 2.17.5 affected; fixed 2.17.7
//   dompurify     — 3.4.11 affected; fixed 3.4.14
//   mermaid       — 11.16.0 affected; fixed 11.16.1
const PACKAGE_PINS = {
  undici: { '^6': '6.28.0', '^7': '7.29.0', '^8': '8.9.0' },
  postcss: { '^8': '8.5.23' },
  'react-router': { '^7': '7.18.2' },
  'react-router-dom': { '^7': '7.18.2' },
  'sanitize-html': { '^2': '2.17.7' },
  dompurify: { '^3': '3.4.14' },
  mermaid: { '^11': '11.16.1' },
};
const PACKAGE_INTEGRITY = {
  undici: {
    '6.28.0': 'sha512-LIY910g9TI13YS95lrMFrs8Rm/u/irgHeTWoKCoteeJ04CUJ92eEfj0rVn+7VKMPBpUPiUoBKfhNyLI23EE/KA==',
    '7.29.0': 'sha512-IDxfleLmmbSskfWSUATiN1nfn2rDuvnMOqb5CWR92iIfojA0Ud+ulOAAEQ57LPr9rWmsreUyf5lwyao+7GNNVw==',
    '8.9.0': 'sha512-aWZpUj7XoGonMClx4gdDRfgBjqeA+F473aDmROQQbM9n6PRfK/u1q/a0X4wMTgcHfT8H6fpbt98PFuDUwFg2YA==',
  },
  postcss: {
    '8.5.23': 'sha512-g50586zr4bZmwFiTlflMu8E0bDTb5I5gertgwAKmsdUlTQIhZtunzUlD1WSzwcVWPoAVpsrA6vlfCD7oXvRwgg==',
  },
  'react-router': {
    '7.18.2': 'sha512-aUVMjFm3GAPTTZL7oYr5E7ETiqfQCHRLH+B+5afnICvf0r7kkK4eR6SMuwbSTJw/7t+12khT/Kahij49fqOCIg==',
  },
  'react-router-dom': {
    '7.18.2': 'sha512-AIKJ/jgGlFb3EbfCXk5Gzshiwt+l3mqbCrNjmEWMMjqQxNJ3svBa6bgzFyCC2Sw3RA0VWF1kg3uQf2OFhxb8hw==',
  },
  'sanitize-html': {
    '2.17.7': 'sha512-PGtEkc9cbnedU3s9TmzDbpsZ8w086g/0Q8k8/oIO1NLNU3i5k9yn835CrjJSajp1KMmkisbO1qPXxNKO3welAg==',
  },
  dompurify: {
    '3.4.14': 'sha512-dVoH9z+MY+C9IilgGCk3YfFqjLi3fChm2OiKJMzh6axrJ5qwxqWaZamgmHrpv22CN/KdbZJuGEGgfQoL00LTdg==',
  },
  mermaid: {
    '11.16.1': 'sha512-TQsq6u22fAn3rek5VOubrhKPo1g5hwC3FXUN9hiyupTckcYiGuuKGkNQrKYwGJkXUxZdojwRG46gsSCFZMDp4g==',
  },
};
const packageNameOf = (path, pkg) => {
  const name = typeof pkg?.name === 'string' && pkg.name
    ? pkg.name
    : String(path ?? '').split('/').pop();
  return Object.hasOwn(PACKAGE_PINS, name) ? name : null;
};
const pinFor = (name, version) => {
  const major = `^${String(version ?? '').split('.')[0]}`;
  const pin = PACKAGE_PINS[name]?.[major];
  if (!pin) throw new Error(`unreviewed ${name} version: ${String(version)}`);
  return pin;
};
const current = manifest?.overrides?.['nanoid@^3'];
if (!['3.3.17', '3.3.18'].includes(current)) {
  throw new Error(`unreviewed Hermes nanoid override: ${String(current)}`);
}
manifest.overrides['nanoid@^3'] = '3.3.18';
for (const [name, ranges] of Object.entries(PACKAGE_PINS)) {
  for (const [range, pinned] of Object.entries(ranges)) {
    const key = `${name}@${range}`;
    const existing = manifest?.overrides?.[key];
    if (existing !== undefined && existing !== pinned) {
      throw new Error(`unreviewed Hermes ${name} override ${key}: ${String(existing)}`);
    }
    manifest.overrides[key] = pinned;
  }
}
if (!verify) {
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if ((path.endsWith('/nanoid') || pkg?.name === 'nanoid') && String(pkg?.version).startsWith('3.3.')) {
      if (!['3.3.17', '3.3.18'].includes(pkg.version)) {
        throw new Error(`unreviewed locked nanoid version at ${path}: ${pkg.version}`);
      }
      pkg.version = '3.3.18';
      pkg.resolved = 'https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz';
      pkg.integrity = 'sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w==';
    }
    const pinnedName = packageNameOf(path, pkg);
    if (pinnedName && pkg?.version) {
      const pinned = pinFor(pinnedName, pkg.version);
      // Write version/resolved/integrity unconditionally (idempotent):
      // a version that already matches its pin may still carry a stale
      // integrity on re-runs, so never skip on version equality alone.
      pkg.version = pinned;
      pkg.resolved = `https://registry.npmjs.org/${pinnedName}/-/${pinnedName}-${pinned}.tgz`;
      pkg.integrity = PACKAGE_INTEGRITY[pinnedName][pinned];
    }
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o644 });
  await patchApiServer();
  await removeRetiredWireOrder();
  process.stdout.write('pinned Hermes dependencies (nanoid, undici, postcss, react-router, react-router-dom, sanitize-html, dompurify, mermaid) and Jentera API-server patches\n');
  process.exit(0);
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const vulnerable = Object.entries(lock.packages ?? {})
  .filter(([path, pkg]) => path.endsWith('/nanoid') || pkg?.name === 'nanoid')
  .filter(([, pkg]) => pkg?.version === '3.3.17');
if (vulnerable.length > 0) {
  throw new Error(`vulnerable nanoid remains at ${vulnerable.map(([path]) => path).join(', ')}`);
}
const vulnerablePinned = Object.entries(lock.packages ?? {})
  .map(([path, pkg]) => [path, pkg, packageNameOf(path, pkg)])
  .filter(([, pkg, name]) => name && pkg?.version && pkg.version !== pinFor(name, pkg.version));
if (vulnerablePinned.length > 0) {
  throw new Error(`vulnerable pinned dependency remains at ${vulnerablePinned.map(([path]) => path).join(', ')}`);
}
const apiServer = await readFile(apiServerPath, 'utf8');
if (!apiServer.includes(routingMarker) ||
    !apiServer.includes('provider_sort=provider_routing.get("sort"),') ||
    !apiServer.includes(runtimeMarker) ||
    !apiServer.includes(`"jentera_patch": "${runtimePatchId}",`) ||
    !apiServer.includes('result.get("last_reasoning")') ||
    !apiServer.includes('**({"reasoning": reasoning} if reasoning else {}),') ||
    !apiServer.includes(iterationMarker) ||
    !apiServer.includes('step_callback=_step_cb,') ||
    !apiServer.includes('"event": "iteration.started",')) {
  throw new Error('Hermes API server is missing a reviewed Jentera patch');
}
const bootstrap = await readFile(bootstrapPath, 'utf8');
const runAgent = await readFile(runAgentPath, 'utf8');
if (bootstrap.includes(retiredWireOrderMarker) ||
    runAgent.includes(retiredWireOrderMarker) ||
    await present(retiredWireReorderPath)) {
  throw new Error('retired Hermes wire-order patch is still present; apply removes it');
}
process.stdout.write('Hermes production dependency and Jentera API-server patches verified\n');

async function patchApiServer() {
  let source = await readFile(apiServerPath, 'utf8');
  source = normalizeLegacyReasoningPatch(source);
  source = migrateRuntimePatchId(source);
  if (!source.includes(routingMarker)) {
    const configAnchor = '        agent = AIAgent(\n            model=model,\n';
    const configPatch = [
      `        ${routingMarker}`,
      '        provider_routing = user_config.get("provider_routing") or {}',
      '        if not isinstance(provider_routing, dict):',
      '            provider_routing = {}',
      '',
      '        agent = AIAgent(',
      '            model=model,',
    ].join('\n') + '\n';
    source = replaceReviewedAnchor(source, configAnchor, configPatch);

    const kwargsAnchor = [
      '            reasoning_config=reasoning_config,',
      '            gateway_session_key=gateway_session_key,',
    ].join('\n');
    const kwargsPatch = [
      '            reasoning_config=reasoning_config,',
      '            providers_allowed=provider_routing.get("only"),',
      '            providers_ignored=provider_routing.get("ignore"),',
      '            providers_order=provider_routing.get("order"),',
      '            provider_sort=provider_routing.get("sort"),',
      '            provider_require_parameters=provider_routing.get("require_parameters", False),',
      '            provider_data_collection=provider_routing.get("data_collection"),',
      '            gateway_session_key=gateway_session_key,',
    ].join('\n');
    source = replaceReviewedAnchor(source, kwargsAnchor, kwargsPatch);
  }

  if (!source.includes(runtimeMarker)) {
    const healthAnchor = [
      '            "version": _hermes_version(),',
      '            "gateway_state": gw_state,',
    ].join('\n');
    const healthPatch = [
      `            ${runtimeMarker}`,
      '            "version": _hermes_version(),',
      `            "jentera_patch": "${runtimePatchId}",`,
      '            "gateway_state": gw_state,',
    ].join('\n');
    source = replaceReviewedAnchor(source, healthAnchor, healthPatch);

    const resultAnchor =
      '                    final_response = result.get("final_response", "") if isinstance(result, dict) else ""\n';
    const resultPatch = [
      resultAnchor.trimEnd(),
      '                    reasoning = (',
      '                        result.get("last_reasoning")',
      '                        if isinstance(result, dict)',
      '                        and isinstance(result.get("last_reasoning"), str)',
      '                        else None',
      '                    )',
    ].join('\n') + '\n';
    source = replaceReviewedAnchor(source, resultAnchor, resultPatch);

    const eventAnchor = [
      '                        "event": "run.completed",',
      '                        "run_id": run_id,',
      '                        "timestamp": time.time(),',
      '                        "output": final_response,',
      '                        "usage": usage,',
    ].join('\n');
    const eventPatch = [
      '                        "event": "run.completed",',
      '                        "run_id": run_id,',
      '                        "timestamp": time.time(),',
      '                        "output": final_response,',
      '                        "usage": usage,',
      '                        **({"reasoning": reasoning} if reasoning else {}),',
    ].join('\n');
    source = replaceReviewedAnchor(source, eventAnchor, eventPatch);

    const statusAnchor = [
      '                        output=final_response,',
      '                        usage=usage,',
      '                        last_event="run.completed",',
    ].join('\n');
    const statusPatch = [
      '                        output=final_response,',
      '                        usage=usage,',
      '                        **({"reasoning": reasoning} if reasoning else {}),',
      '                        last_event="run.completed",',
    ].join('\n');
    source = replaceReviewedAnchor(source, statusAnchor, statusPatch);
  }

  if (!source.includes(iterationMarker)) {
    const signatureAnchor = [
      '    def _create_agent(',
      '        self,',
      '        ephemeral_system_prompt: Optional[str] = None,',
      '        session_id: Optional[str] = None,',
      '        stream_delta_callback=None,',
      '        tool_progress_callback=None,',
      '        tool_start_callback=None,',
    ].join('\n');
    const signaturePatch = [
      '    def _create_agent(',
      '        self,',
      '        ephemeral_system_prompt: Optional[str] = None,',
      '        session_id: Optional[str] = None,',
      '        stream_delta_callback=None,',
      '        tool_progress_callback=None,',
      '        step_callback=None,',
      '        tool_start_callback=None,',
    ].join('\n');
    source = replaceReviewedAnchor(source, signatureAnchor, signaturePatch);

    const agentCallbackAnchor = [
      '            tool_progress_callback=tool_progress_callback,',
      '            tool_start_callback=tool_start_callback,',
    ].join('\n');
    const agentCallbackPatch = [
      '            tool_progress_callback=tool_progress_callback,',
      '            step_callback=step_callback,',
      '            tool_start_callback=tool_start_callback,',
    ].join('\n');
    source = replaceReviewedAnchor(source, agentCallbackAnchor, agentCallbackPatch);

    const callbackAnchor = [
      '            ts = time.time()',
      '            if event_type == "tool.started":',
    ].join('\n');
    const callbackPatch = [
      '            ts = time.time()',
      `            ${iterationMarker}`,
      '            if event_type == "iteration.started":',
      '                try:',
      '                    iteration = int(kwargs.get("iteration", 0))',
      '                    max_iterations = int(kwargs.get("max_iterations", 0))',
      '                except (TypeError, ValueError):',
      '                    return',
      '                if not (1 <= iteration <= max_iterations <= 10000):',
      '                    return',
      '                _push({',
      '                    "event": "iteration.started",',
      '                    "run_id": run_id,',
      '                    "timestamp": ts,',
      '                    "iteration": iteration,',
      '                    "max_iterations": max_iterations,',
      '                })',
      '            elif event_type == "tool.started":',
    ].join('\n');
    source = replaceReviewedAnchor(source, callbackAnchor, callbackPatch);

    const eventCallbackAnchor =
      '        event_cb = self._make_run_event_callback(run_id, loop)\n';
    const eventCallbackPatch = [
      eventCallbackAnchor.trimEnd(),
      '        agent_ref = {}',
      '',
      '        def _step_cb(iteration, _previous_tools=None):',
      '            agent = agent_ref.get("agent")',
      '            event_cb(',
      '                "iteration.started",',
      '                iteration=iteration,',
      '                max_iterations=getattr(agent, "max_iterations", 0),',
      '            )',
    ].join('\n') + '\n';
    source = replaceReviewedAnchor(source, eventCallbackAnchor, eventCallbackPatch);

    const createAgentAnchor = [
      '                        stream_delta_callback=_text_cb,',
      '                        tool_progress_callback=event_cb,',
      '                        gateway_session_key=gateway_session_key,',
    ].join('\n');
    const createAgentPatch = [
      '                        stream_delta_callback=_text_cb,',
      '                        tool_progress_callback=event_cb,',
      '                        step_callback=_step_cb,',
      '                        gateway_session_key=gateway_session_key,',
    ].join('\n');
    source = replaceReviewedAnchor(source, createAgentAnchor, createAgentPatch);

    const activeAgentAnchor =
      '                self._active_run_agents[run_id] = agent\n';
    const activeAgentPatch = [
      '                agent_ref["agent"] = agent',
      activeAgentAnchor.trimEnd(),
    ].join('\n') + '\n';
    source = replaceReviewedAnchor(source, activeAgentAnchor, activeAgentPatch);
  }
  await writeFile(apiServerPath, source, { mode: 0o644 });
}

/** Give a tree patched by the retired wire-order stage its pinned upstream
 * keepalive-client builders back and drop the module. Idempotent: a tree
 * without the marker is left untouched, so the unchanged-bytes contract on
 * re-apply holds; a tree with the marker but a drifted block fails closed. */
async function removeRetiredWireOrder() {
  for (const [path, anchor, wired] of retiredWireOrderShapes) {
    const source = await readFile(path, 'utf8');
    if (!source.includes(retiredWireOrderMarker)) continue;
    await writeFile(path, replaceReviewedAnchor(source, wired, anchor), { mode: 0o644 });
  }
  await rm(retiredWireReorderPath, { force: true });
}

async function present(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The first canary carried a hand-applied version of the reasoning patch.
 * Normalize that one reviewed shape back to the pinned upstream anchors, then
 * apply the durable patch below. Anything else still fails closed as drift. */
function normalizeLegacyReasoningPatch(source) {
  if (source.includes(runtimeMarker)) return source;
  const legacy = [
    '                    reasoning = result.get("last_reasoning") if isinstance(result, dict) else None\n',
    '                        "reasoning": reasoning,\n',
    '                        reasoning=reasoning,\n',
  ];
  const present = legacy.map((line) => source.includes(line));
  if (!present.some(Boolean)) return source;
  if (!present.every(Boolean)) {
    throw new Error('partial legacy Jentera reasoning patch requires review');
  }
  for (const line of legacy) source = replaceReviewedAnchor(source, line, '');
  return source;
}

/**
 * Release-id migration: a tree patched by a prior reviewed release carries
 * its old id in the health attestation, so the marker-present guard alone
 * would silently keep the stale id. Rewrite a reviewed prior id to the
 * current release id; anything else (hand-edited or unreviewed ids, or a
 * marker without any attestation) fails closed instead of being touched.
 */
function migrateRuntimePatchId(source) {
  const attested = source.match(/"jentera_patch":\s*"([^"]+)"/);
  if (!attested && source.includes(runtimeMarker)) {
    throw new Error('unreviewed jentera_patch: runtime marker without attestation requires review');
  }
  if (!attested) return source;
  const id = attested[1];
  if (id === runtimePatchId) return source;
  if (id === priorRuntimePatchId || legacyRuntimePatchIds.has(id)) {
    return replaceReviewedAnchor(source,
      `"jentera_patch": "${id}",`,
      `"jentera_patch": "${runtimePatchId}",`);
  }
  throw new Error(`unreviewed jentera_patch ${JSON.stringify(id)} requires review`);
}

function replaceReviewedAnchor(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`reviewed Hermes API anchor drifted: ${JSON.stringify(anchor)}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}
