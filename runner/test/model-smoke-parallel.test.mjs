/* The model smoke used to run one alias after another, so a sprite with three
   aliases paid three live round trips end to end. It now runs them together.
   The property that must not move is fail-closed: every alias passes or the
   bootstrap exits non-zero and never attests readiness.

   These tests execute the real block lifted out of bootstrap-runtime.sh, with
   a stubbed interpreter, rather than asserting on its source text -- a source
   match would have passed unchanged when the parallelism was introduced. */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const SCRIPT = new URL('../bin/bootstrap-runtime.sh', import.meta.url).pathname;
const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

/** The parallel smoke block exactly as it ships. */
async function smokeBlock() {
  const source = await readFile(SCRIPT, 'utf8');
  const start = source.indexOf('smoke_pids=()');
  const endMarker = `  echo "model inference did not pass its live smoke test: \${smoke_failed[*]}" >&2\n  exit 1\nfi`;
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'missing smoke block start');
  assert.notEqual(end, -1, 'missing smoke block end');
  return source.slice(start, end + endMarker.length);
}

/** Run the block with `failing` aliases made to fail; returns status + timing. */
async function runSmokes(models, failing = []) {
  const dir = await mkdtemp(join(tmpdir(), 'smoke-'));
  directories.push(dir);
  const stub = join(dir, 'python');
  // Each call sleeps, so serial execution is measurably slower than parallel.
  await writeFile(stub, [
    '#!/usr/bin/env bash',
    `echo "attempt:$AISAR_MODEL_NAME" >> "${dir}/attempts"`,
    'sleep 0.5',
    `case " ${failing.join(' ')} " in`,
    '  *" $AISAR_MODEL_NAME "*) echo "boom $AISAR_MODEL_NAME" >&2; exit 1 ;;',
    'esac',
    'exit 0',
  ].join('\n'));
  await chmod(stub, 0o755);

  const script = join(dir, 'run.sh');
  await writeFile(script, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `smoke_models=(${models.map((m) => `"${m}"`).join(' ')})`,
    'model_base=http://stub', 'model_key=stub-key',
    `hermes_python="${stub}"`,
    await smokeBlock(),
  ].join('\n'));
  await chmod(script, 0o755);

  const began = Date.now();
  const proc = spawnSync('bash', [script], { encoding: 'utf8' });
  const attempts = await readFile(join(dir, 'attempts'), 'utf8').catch(() => '');
  return { proc, ms: Date.now() - began, attempts: attempts.trim().split('\n').filter(Boolean) };
}

test('every alias is smoked, and they run together rather than in turn', async () => {
  const models = ['alpha', 'beta', 'gamma'];
  const { proc, ms, attempts } = await runSmokes(models);

  assert.equal(proc.status, 0, proc.stderr);
  for (const model of models) {
    assert.ok(attempts.includes(`attempt:${model}`), `${model} was never smoked`);
  }
  // Serial would be >= 1.5s for three 0.5s calls; parallel stays near one.
  assert.ok(ms < 1300, `three aliases took ${ms}ms, which looks serial`);
});

test('one failing alias fails the bootstrap and is named', async () => {
  const { proc } = await runSmokes(['alpha', 'beta', 'gamma'], ['beta']);

  assert.equal(proc.status, 1, 'a failing alias must fail the bootstrap');
  assert.match(proc.stderr, /model inference did not pass its live smoke test: .*beta/);
  assert.match(proc.stderr, /boom beta/, "the failing alias's own output must survive");
});

test('a failing alias is retried three times before it is believed', async () => {
  const { attempts } = await runSmokes(['alpha'], ['alpha']);
  const tries = attempts.filter((l) => l === 'attempt:alpha').length;
  assert.equal(tries, 3, `expected 3 attempts, saw ${tries}`);
});

test('all aliases failing names all of them', async () => {
  const models = ['alpha', 'beta'];
  const { proc } = await runSmokes(models, models);
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /alpha/);
  assert.match(proc.stderr, /beta/);
});
