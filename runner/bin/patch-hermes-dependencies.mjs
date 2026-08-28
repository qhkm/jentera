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
const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
const current = manifest?.overrides?.['nanoid@^3'];
if (!['3.3.17', '3.3.18'].includes(current)) {
  throw new Error(`unreviewed Hermes nanoid override: ${String(current)}`);
}
manifest.overrides['nanoid@^3'] = '3.3.18';
if (!verify) {
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path.endsWith('/nanoid') || !String(pkg?.version).startsWith('3.3.')) continue;
    if (!['3.3.17', '3.3.18'].includes(pkg.version)) {
      throw new Error(`unreviewed locked nanoid version at ${path}: ${pkg.version}`);
    }
    pkg.version = '3.3.18';
    pkg.resolved = 'https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz';
    pkg.integrity = 'sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w==';
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o644 });
  await patchApiServerRouting();
  process.stdout.write('pinned Hermes dependency and API routing patches\n');
  process.exit(0);
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const vulnerable = Object.entries(lock.packages ?? {})
  .filter(([path, pkg]) => path.endsWith('/nanoid') || pkg?.name === 'nanoid')
  .filter(([, pkg]) => pkg?.version === '3.3.17');
if (vulnerable.length > 0) {
  throw new Error(`vulnerable nanoid remains at ${vulnerable.map(([path]) => path).join(', ')}`);
}
const apiServer = await readFile(apiServerPath, 'utf8');
if (!apiServer.includes(routingMarker) ||
    !apiServer.includes('"provider_sort": provider_routing.get("sort"),')) {
  throw new Error('Hermes API server is missing Jentera provider routing');
}
process.stdout.write('Hermes production dependency and API routing patches verified\n');

async function patchApiServerRouting() {
  let source = await readFile(apiServerPath, 'utf8');
  if (source.includes(routingMarker)) return;

  const configAnchor = '        agent_kwargs = {\n';
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
    '            "reasoning_config": reasoning_config,',
    '            "gateway_session_key": gateway_session_key,',
  ].join('\n');
  const kwargsPatch = [
    '            "reasoning_config": reasoning_config,',
    '            "providers_allowed": provider_routing.get("only"),',
    '            "providers_ignored": provider_routing.get("ignore"),',
    '            "providers_order": provider_routing.get("order"),',
    '            "provider_sort": provider_routing.get("sort"),',
    '            "provider_require_parameters": provider_routing.get("require_parameters", False),',
    '            "provider_data_collection": provider_routing.get("data_collection"),',
    '            "gateway_session_key": gateway_session_key,',
  ].join('\n');
  source = replaceReviewedAnchor(source, kwargsAnchor, kwargsPatch);
  await writeFile(apiServerPath, source, { mode: 0o644 });
}

function replaceReviewedAnchor(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`reviewed Hermes API anchor drifted: ${JSON.stringify(anchor)}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}
