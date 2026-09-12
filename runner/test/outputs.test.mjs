import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  OUTPUT_LIMITS,
  collectOutputs,
  contentTypeFor,
  outputsDirFor,
  outputsInstruction,
  uploadOutputs,
} from '../src/server.mjs';

const TASK = '11111111-1111-4111-8111-111111111111';
let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aisar-outputs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('the output folder is per task, and a task id that is not a uuid gets no folder', () => {
  assert.equal(outputsDirFor(root, TASK), join(root, TASK));
  assert.throws(() => outputsDirFor(root, '../escape'), /task id/);
  assert.throws(() => outputsDirFor(root, ''), /task id/);
});

test('the instruction tells the model where a file for the owner goes, and not to paste it', () => {
  const text = outputsInstruction('/home/sprite/aisar/outputs/abc');
  assert.match(text, /\/home\/sprite\/aisar\/outputs\/abc/);
  assert.match(text, /attached to your reply/i);
  assert.match(text, /do not paste/i);
});

test('content types come from the extension, with opaque bytes as the fallback', () => {
  assert.equal(contentTypeFor('digest.md'), 'text/markdown');
  assert.equal(contentTypeFor('sales.csv'), 'text/csv');
  assert.equal(contentTypeFor('Report.PDF'), 'application/pdf');
  assert.equal(contentTypeFor('sheet.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(contentTypeFor('photo.jpeg'), 'image/jpeg');
  assert.equal(contentTypeFor('mystery.bin'), 'application/octet-stream');
  assert.equal(contentTypeFor('noext'), 'application/octet-stream');
});

test('collecting outputs takes regular files by name, skips dotfiles, folders, links and oversize files, and stops at the cap', async () => {
  const dir = join(root, TASK);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'b-report.md'), '# hi');
  await writeFile(join(dir, 'a-data.csv'), 'x,y\n1,2\n');
  await writeFile(join(dir, '.scratch'), 'hidden');
  await mkdir(join(dir, 'nested'));
  await writeFile(join(dir, 'nested', 'deep.txt'), 'no');
  await symlink('/etc/hostname', join(dir, 'link.txt'));
  await writeFile(join(dir, 'too-big.bin'), Buffer.alloc(64));
  await writeFile(join(dir, 'bad name.txt'), 'space');

  const files = await collectOutputs(dir, { ...OUTPUT_LIMITS, maxFileBytes: 32 });
  assert.deepEqual(files.map((f) => f.name), ['a-data.csv', 'b-report.md']);
  assert.equal(files[0].contentType, 'text/csv');
  assert.equal(files[0].size, 8);
  assert.equal(files[1].path, join(dir, 'b-report.md'));

  const capped = await collectOutputs(dir, { ...OUTPUT_LIMITS, maxFiles: 1 });
  assert.equal(capped.length, 1);

  assert.deepEqual(await collectOutputs(join(root, 'missing'), OUTPUT_LIMITS), []);
});

test('uploading posts each file to the worker with the runtime credential and the task id, and reports what did not land', async () => {
  const dir = join(root, TASK);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'digest.md'), '# Digest');
  await writeFile(join(dir, 'fails.csv'), 'a,b');
  const files = await collectOutputs(dir, OUTPUT_LIMITS);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(init.headers['X-Aisar-Artifact-Name']) === 'fails.csv') {
      return new Response(JSON.stringify({ ok: false, err: 'nope' }), { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true, artifact: { id: 'art-1', name: 'digest.md', size: 8, contentType: 'text/markdown' } }), { status: 201 });
  };

  const result = await uploadOutputs({
    configUrl: 'https://api.test/v1/runtime/config', configKey: 'sk-jentera-v1.k.s', taskId: TASK, files, fetch: fetchImpl,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.test/v1/runtime/artifacts');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-jentera-v1.k.s');
  assert.equal(calls[0].init.headers['X-Aisar-Task-Id'], TASK);
  assert.equal(calls[0].init.headers['X-Aisar-Artifact-Name'], 'digest.md');
  assert.equal(calls[0].init.headers['Content-Type'], 'text/markdown');
  assert.equal(calls[0].init.headers['Content-Length'], '8');
  assert.equal(Buffer.from(calls[0].init.body).toString(), '# Digest');
  assert.deepEqual(result.uploaded.map((a) => a.name), ['digest.md']);
  assert.deepEqual(result.failed.map((f) => f.name), ['fails.csv']);
  assert.match(result.failed[0].error, /503/);
});

test('uploading with no config channel is a no-op that says so', async () => {
  const result = await uploadOutputs({ configUrl: undefined, configKey: undefined, taskId: TASK, files: [{ name: 'x', path: '/nope', size: 1, contentType: 'text/plain' }], fetch: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(result, { uploaded: [], failed: [], skipped: 'not-configured' });
});
