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
  assert.match(apiServer, /provider_sort.*provider_routing\.get\("sort"\)/);
  assert.match(apiServer, /jentera_patch.*jentera-runtime-2026-09-01/);
  assert.match(apiServer, /result\.get\("last_reasoning"\)/);
  assert.match(apiServer, /completed_event\["reasoning"\] = reasoning/);
  assert.match(apiServer, /\*\*\(\{"reasoning": reasoning\} if reasoning else \{\}\)/);
  assert.equal(run(root).status, 0, 'the complete patch is idempotent');
  assert.equal(run(root, '--verify').status, 0);
});

test('refuses an upstream override drift and a vulnerable lock', async () => {
  const drifted = await fixture('3.3.16', '3.3.16');
  assert.notEqual(run(drifted).status, 0);
  const vulnerable = await fixture('3.3.18', '3.3.17');
  assert.notEqual(run(vulnerable, '--verify').status, 0);
});

async function fixture(override, locked) {
  const root = await mkdtemp(join(tmpdir(), 'aisar-hermes-test-'));
  directories.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    overrides: { 'nanoid@^3': override, lodash: '4.18.1' },
  }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/example/node_modules/nanoid': { name: 'nanoid', version: locked } },
  }));
  await mkdir(join(root, 'gateway/platforms'), { recursive: true });
  await writeFile(join(root, 'gateway/platforms/api_server.py'), [
    '        user_config = _load_gateway_config()',
    '        agent_kwargs = {',
    '            "reasoning_config": reasoning_config,',
    '            "gateway_session_key": gateway_session_key,',
    '        }',
    '        return web.json_response({',
    '            "version": _hermes_version(),',
    '            "gateway_state": gw_state,',
    '        })',
    '                    final_response = result.get("final_response", "") if isinstance(result, dict) else ""',
    '                    pending_steer = result.get("pending_steer") if isinstance(result, dict) else None',
    '                    completed_event = {',
    '                        "event": "run.completed",',
    '                        "usage": usage,',
    '                    }',
    '                    if pending_steer:',
    '                        completed_event["pending_steer"] = pending_steer',
    '                    self._set_run_status(',
    '                        run_id,',
    '                        "completed",',
    '                        output=final_response,',
    '                        usage=usage,',
    '                        last_event="run.completed",',
    '                    )',
    '',
  ].join('\n'));
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
