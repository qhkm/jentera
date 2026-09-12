import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createRunner, forgetAgentMemory, memoryForgetProblem, readAgentMemory } from '../src/server.mjs';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const RUNNER_KEY = 'r'.repeat(32);
const HERMES_KEY = 'hermes-secret';
const SEP = '\n§\n';

let directory;
let runnerServer;
let hermesServer;
let runnerOrigin;
let config;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aisar-memory-'));
  const memories = join(directory, 'memories');
  const profiles = join(directory, 'profiles');
  await mkdir(memories, { recursive: true });
  await mkdir(join(profiles, 'growth', 'memories'), { recursive: true });
  await mkdir(join(profiles, 'records'), { recursive: true });
  await writeFile(join(memories, 'MEMORY.md'), `Sprite env: pdftotext absent.${SEP}Terminal consent gate times out; keep curl simple.\n`);
  await writeFile(join(memories, 'USER.md'), `qhkm prefers English replies.${SEP}favourite colour: teal\n`);
  await writeFile(join(profiles, 'growth', 'memories', 'MEMORY.md'), 'Cron delivery has no platform in this deployment.\n');
  hermesServer = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  const hermesOrigin = await listen(hermesServer);
  config = {
    businessId: BUSINESS, runnerKey: RUNNER_KEY, hermesKey: HERMES_KEY, hermesOrigin,
    release: '2026.09.12-2', toolMode: 'full-tools', webSearchBackend: 'ddgs', capabilities: [],
    modelName: 'MiniMax-M3', deepModelName: 'deepseek-v4-flash', candidateModelNames: [],
    stateFile: join(directory, 'state.json'),
    hermesMemoriesDir: memories, hermesProfilesDir: profiles,
  };
  runnerServer = createRunner(config);
  runnerOrigin = await listen(runnerServer);
});

afterEach(async () => {
  await close(runnerServer);
  await close(hermesServer);
  await rm(directory, { recursive: true, force: true });
});

const call = (path, init = {}) => fetch(`${runnerOrigin}${path}`, {
  ...init, headers: { 'X-Aisar-Runner-Key': RUNNER_KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

test('reads every profile\'s memory as §-delimited entries, skipping profiles with nothing and files that do not exist', async () => {
  const profiles = await readAgentMemory(config);
  assert.deepEqual(profiles.map((p) => p.profile), ['default', 'growth']);
  const main = profiles[0];
  assert.deepEqual(main.files.map((f) => [f.file, f.entries.map((e) => e.text)]), [
    ['MEMORY.md', ['Sprite env: pdftotext absent.', 'Terminal consent gate times out; keep curl simple.']],
    ['USER.md', ['qhkm prefers English replies.', 'favourite colour: teal']],
  ]);
  assert.deepEqual(profiles[1].files.find((f) => f.file === 'USER.md').entries, []);
  const response = await call('/v1/memory');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).profiles.length, 2);
});

test('the endpoints need the runner key', async () => {
  const response = await fetch(`${runnerOrigin}/v1/memory`);
  assert.equal(response.status, 401);
});

test('concurrent deletions preserve both changes to the same file', async () => {
  const result = await Promise.all([
    forgetAgentMemory(config, { profile: 'default', file: 'USER.md', text: 'qhkm prefers English replies.' }),
    forgetAgentMemory(config, { profile: 'default', file: 'USER.md', text: 'favourite colour: teal' }),
  ]);
  assert.deepEqual(result, [true, true]);
  assert.equal(await readFile(join(directory, 'memories', 'USER.md'), 'utf8'), '');
});

test('forgets exactly one entry, rewriting the file whole, and says so when nothing matched', async () => {
  const response = await call('/v1/memory/forget', {
    method: 'POST', body: JSON.stringify({ profile: 'default', file: 'USER.md', text: 'favourite colour: teal' }),
  });
  assert.equal(response.status, 200);
  assert.equal(await readFile(join(directory, 'memories', 'USER.md'), 'utf8'), 'qhkm prefers English replies.\n');
  const again = await call('/v1/memory/forget', {
    method: 'POST', body: JSON.stringify({ profile: 'default', file: 'USER.md', text: 'favourite colour: teal' }),
  });
  assert.equal(again.status, 404);
  assert.equal(await forgetAgentMemory(config, { profile: 'growth', file: 'MEMORY.md', text: 'Cron delivery has no platform in this deployment.' }), true);
  assert.equal(await readFile(join(directory, 'profiles', 'growth', 'memories', 'MEMORY.md'), 'utf8'), '');
});

test('refuses a bad profile, file or text before touching anything', async () => {
  assert.equal(memoryForgetProblem({ profile: '../etc', file: 'USER.md', text: 'x' }), 'invalid_profile');
  assert.equal(memoryForgetProblem({ profile: 'default', file: 'SOUL.md', text: 'x' }), 'invalid_file');
  assert.equal(memoryForgetProblem({ profile: 'default', file: 'USER.md', text: '   ' }), 'invalid_text');
  assert.equal(memoryForgetProblem({ profile: 'default', file: 'USER.md', text: 'ok' }), null);
  const response = await call('/v1/memory/forget', { method: 'POST', body: JSON.stringify({ profile: 'default', file: 'SOUL.md', text: 'x' }) });
  assert.equal(response.status, 400);
});
