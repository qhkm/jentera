#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
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
const runtimePatchId = 'jentera-runtime-2026-09-06';
const priorRuntimePatchId = 'jentera-runtime-2026-09-01';
const bootstrapPath = join(root, 'agent/process_bootstrap.py');
const runAgentPath = join(root, 'run_agent.py');
const wireReorderPath = join(root, 'agent/wire_reorder.py');
const wireOrderMarker = '# Jentera: reorder chat.completions wire bodies (tools first, messages last).';
const wireOrderPatchId = 'jentera-wire-order-2026-09-03';
/** Reviewed dependency pins — the narrow set of fleet-shipped-around
 * advisories, each with the exact lockfile version(s) review has seen and
 * the reviewed replacement (version / resolved / integrity from the npm
 * registry). Anything else npm audit flags at high severity fails the
 * runtime bootstrap (release-blocking). The lockfile is path-identified
 * (lockfileVersion 3, most entries carry no `name`), so matching is by path
 * suffix, and only inside the reviewed major line (`scope`) — e.g. the tree
 * also carries nanoid 5.1.16 at node_modules/nanoid, which the reviewed
 * 3.3.x scope deliberately leaves to the audit gate. A lock entry inside
 * scope but in any OTHER version is unreviewed drift and fails closed. */
const REVIEWED_PINS = [
  {
    label: 'nanoid',
    key: 'nanoid@^3',
    allowed: ['3.3.17', '3.3.18'],
    target: '3.3.18',
    suffix: '/nanoid',
    scope: (v) => v.startsWith('3.3.'),
    vulnerable: (v) => v === '3.3.17',
    resolved: 'https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz',
    integrity: 'sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w==',
  },
  {
    label: 'postcss',
    key: 'postcss@^8',
    allowed: ['8.5.15', '8.5.16', '8.5.17', '8.5.18'],
    target: '8.5.18',
    suffix: '/postcss',
    scope: (v) => v.startsWith('8.'),
    vulnerable: (v) => v.startsWith('8.') && compareVersions(v, '8.5.18') < 0,
    resolved: 'https://registry.npmjs.org/postcss/-/postcss-8.5.18.tgz',
    integrity: 'sha512-xdB1oSLHbz1vRWgCDalrCqEFTWzFlhqFC5tIHLMOSUIjhm3XXQ1qrFy8S/ESr1JYRRXqM3c1QFiMZUJdUTqyMQ==',
  },
  {
    label: 'react-router',
    key: 'react-router@^7',
    allowed: ['7.18.0', '7.18.1', '7.18.2'],
    target: '7.18.2',
    suffix: '/react-router',
    scope: (v) => v.startsWith('7.'),
    vulnerable: (v) => compareVersions(v, '7.12.0') >= 0 && compareVersions(v, '7.18.2') < 0,
    resolved: 'https://registry.npmjs.org/react-router/-/react-router-7.18.2.tgz',
    integrity: 'sha512-aUVMjFm3GAPTTZL7oYr5E7ETiqfQCHRLH+B+5afnICvf0r7kkK4eR6SMuwbSTJw/7t+12khT/Kahij49fqOCIg==',
  },
  {
    label: 'react-router-dom',
    key: 'react-router-dom@^7',
    allowed: ['7.18.0', '7.18.1', '7.18.2'],
    target: '7.18.2',
    suffix: '/react-router-dom',
    scope: (v) => v.startsWith('7.'),
    vulnerable: (v) => compareVersions(v, '7.12.0') >= 0 && compareVersions(v, '7.18.2') < 0,
    resolved: 'https://registry.npmjs.org/react-router-dom/-/react-router-dom-7.18.2.tgz',
    integrity: 'sha512-AIKJ/jgGlFb3EbfCXk5Gzshiwt+l3mqbCrNjmEWMMjqQxNJ3svBa6bgzFyCC2Sw3RA0VWF1kg3uQf2OFhxb8hw==',
  },
];

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
for (const pin of REVIEWED_PINS) {
  const current = manifest?.overrides?.[pin.key];
  if (current !== undefined && !pin.allowed.includes(current)) {
    throw new Error(`unreviewed Hermes ${pin.label} override: ${String(current)}`);
  }
  manifest.overrides[pin.key] = pin.target;
}
if (!verify) {
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const pin of REVIEWED_PINS) {
    for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
      if (!path.endsWith(pin.suffix)) continue;
      if (!pin.scope(String(pkg?.version ?? ''))) continue;
      if (!pin.allowed.includes(pkg?.version)) {
        throw new Error(`unreviewed locked ${pin.label} version at ${path}: ${pkg.version}`);
      }
      if (pkg.version !== pin.target) {
        pkg.version = pin.target;
        pkg.resolved = pin.resolved;
        pkg.integrity = pin.integrity;
      }
    }
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o644 });
  await patchApiServer();
  await patchWireOrder();
  process.stdout.write('pinned Hermes dependencies, Jentera API-server and wire-order patches\n');
  process.exit(0);
}

const apiServer = await readFile(apiServerPath, 'utf8');
if (!apiServer.includes(routingMarker) ||
    !apiServer.includes('provider_sort=provider_routing.get("sort"),') ||
    !apiServer.includes(runtimeMarker) ||
    !apiServer.includes(`"jentera_patch": "${runtimePatchId}",`) ||
    !apiServer.includes('result.get("last_reasoning")') ||
    !apiServer.includes('**({"reasoning": reasoning} if reasoning else {}),')) {
  throw new Error('Hermes API server is missing a reviewed Jentera patch');
}
const bootstrap = await readFile(bootstrapPath, 'utf8');
const runAgent = await readFile(runAgentPath, 'utf8');
let wireReorder = '';
try {
  wireReorder = await readFile(wireReorderPath, 'utf8');
} catch {
  /* written by the apply path; missing fails closed below */
}
if (!bootstrap.includes(wireOrderMarker) ||
    !runAgent.includes(wireOrderMarker) ||
    !wireReorder.includes(`PATCH_ID = "${wireOrderPatchId}"`)) {
  throw new Error('Hermes wire-order patch is missing or drifted');
}
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const vulnerable = [];
for (const pin of REVIEWED_PINS) {
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path.endsWith(pin.suffix)) continue;
    const version = String(pkg?.version ?? '');
    if (!pin.scope(version)) continue;
    if (pin.vulnerable(version)) {
      vulnerable.push(`${path}@${version} (${pin.label})`);
    } else if (!pin.allowed.includes(version)) {
      vulnerable.push(`${path}@${version} (${pin.label}: unreviewed drift)`);
    }
  }
}
if (vulnerable.length > 0) {
  throw new Error(`vulnerable Hermes dependency remains at ${vulnerable.join(', ')}`);
}
process.stdout.write('Hermes production dependencies, Jentera API-server and wire-order patches verified\n');

async function patchApiServer() {
  let source = await readFile(apiServerPath, 'utf8');
  source = normalizeLegacyReasoningPatch(source);
  source = migrateRuntimePatchId(source);
  if (!source.includes(routingMarker)) {
    const configAnchor = '        agent = AIAgent(\n';
    const configPatch = [
      `        ${routingMarker}`,
      '        provider_routing = user_config.get("provider_routing") or {}',
      '        if not isinstance(provider_routing, dict):',
      '            provider_routing = {}',
      '',
      configAnchor.trimEnd(),
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
      '                        "usage": usage,',
      '                    })',
    ].join('\n');
    const eventPatch = [
      '                        "usage": usage,',
      '                        **({"reasoning": reasoning} if reasoning else {}),',
      '                    })',
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
  await writeFile(apiServerPath, source, { mode: 0o644 });
}

/** Stage 3: stabilize chat.completions wire bodies for byte-prefix-keyed
 * routers (router.fmcv.my MiniMax-M3). Reorders each outgoing body so the
 * stable fields (tools, model, …) come first and `messages` (whose tail
 * changes every turn) comes last. The module is copied into the tree and both
 * keepalive-client builders (main + auxiliary, sync + async) are wrapped. */
async function patchWireOrder() {
  const wireSrc = await readFile(new URL('./wire_reorder.py', import.meta.url), 'utf8');
  if (!wireSrc.includes(`PATCH_ID = "${wireOrderPatchId}"`)) {
    throw new Error('runner wire_reorder.py is missing its reviewed PATCH_ID');
  }
  let existing = '';
  try {
    existing = await readFile(wireReorderPath, 'utf8');
  } catch {
    /* not present yet — write below */
  }
  if (existing !== wireSrc) {
    await writeFile(wireReorderPath, wireSrc, { mode: 0o644 });
  }

  let bootstrap = await readFile(bootstrapPath, 'utf8');
  if (!bootstrap.includes(wireOrderMarker)) {
    const anchor = [
      '        return client_cls(',
      '            limits=limits,',
      '            timeout=timeout,',
      '            proxy=proxy,',
      '            mounts=mounts or None,',
      '            verify=verify,',
      '        )',
    ].join('\n');
    const replacement = [
      '        client = client_cls(',
      '            limits=limits,',
      '            timeout=timeout,',
      '            proxy=proxy,',
      '            mounts=mounts or None,',
      '            verify=verify,',
      '        )',
      `        ${wireOrderMarker}`,
      '        try:',
      '            from agent.wire_reorder import wrap_http_client',
      '',
      '            client = wrap_http_client(client, async_mode=async_mode)',
      '        except Exception:',
      '            pass',
      '        return client',
    ].join('\n');
    bootstrap = replaceReviewedAnchor(bootstrap, anchor, replacement);
    await writeFile(bootstrapPath, bootstrap, { mode: 0o644 });
  }

  let runAgent = await readFile(runAgentPath, 'utf8');
  if (!runAgent.includes(wireOrderMarker)) {
    const anchor = [
      '            return _httpx.Client(',
      '                limits=_limits,',
      '                timeout=_timeout,',
      '                proxy=_proxy,',
      '                mounts=_mounts or None,',
      '                verify=verify,',
      '            )',
    ].join('\n');
    const replacement = [
      '            _client = _httpx.Client(',
      '                limits=_limits,',
      '                timeout=_timeout,',
      '                proxy=_proxy,',
      '                mounts=_mounts or None,',
      '                verify=verify,',
      '            )',
      `            ${wireOrderMarker}`,
      '            try:',
      '                from agent.wire_reorder import wrap_http_client',
      '',
      '                _client = wrap_http_client(_client)',
      '            except Exception:',
      '                pass',
      '            return _client',
    ].join('\n');
    runAgent = replaceReviewedAnchor(runAgent, anchor, replacement);
    await writeFile(runAgentPath, runAgent, { mode: 0o644 });
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

/** Release-id migration: a tree patched by a prior reviewed release carries
 * its old id in the health attestation, so the marker-present guard alone
 * would silently keep the stale id. Rewrite a reviewed prior id to the
 * current release id; anything else (hand-edited or unreviewed ids, or a
 * marker without any attestation) fails closed instead of being touched. */
function migrateRuntimePatchId(source) {
  const attested = source.match(/"jentera_patch":\s*"([^"]+)"/);
  if (!attested && source.includes(runtimeMarker)) {
    throw new Error('unreviewed jentera_patch: runtime marker without attestation requires review');
  }
  if (!attested) return source;
  const id = attested[1];
  if (id === runtimePatchId) return source;
  if (id === priorRuntimePatchId) {
    return replaceReviewedAnchor(source,
      `"jentera_patch": "${priorRuntimePatchId}",`,
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
