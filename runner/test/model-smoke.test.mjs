import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const MODEL_SMOKE = new URL('../bin/model-smoke.py', import.meta.url).pathname;

function localBranch(source) {
  // The --local implementation lives between the smoke_local definition and
  // the entry point; the provider-direct main() stays above it untouched.
  const start = source.indexOf('def smoke_local');
  const end = source.indexOf('if __name__');
  assert.notEqual(start, -1, 'model-smoke.py must define smoke_local()');
  assert.notEqual(end, -1, 'model-smoke.py must keep its __main__ entry point');
  return source.slice(start, end);
}

test('model-smoke --local smokes routing through the Hermes /v1/runs contract', async () => {
  const source = await readFile(MODEL_SMOKE, 'utf8');
  const local = localBranch(source);

  // The --local branch must exist as an argument branch...
  assert.match(source, /--local/);
  assert.match(source, /sys\.argv\[1\]\s*==\s*["']--local["']/);

  // ...and must exercise the staged API server, never the provider directly.
  assert.doesNotMatch(local, /chat\/completions/);
  assert.match(local, /\/v1\/runs/);
  assert.match(local, /\/v1\/runs\/\{run_id\}/);

  // Poll loop until the run completes.
  assert.match(local, /status\s*==\s*["']completed["']/);

  // Completed runs must echo the requested model id, and deep runs must
  // carry reasoning (the B1a patch proof) — see api_server.py _set_run_status.
  assert.match(local, /status\.get\(["']model["']\)|\.get\(["']model["']\)\s*!=\s*requested/);
  assert.match(local, /["']reasoning["']\s+in\s+status|status\.get\(["']reasoning["']\)/);
});

test('model-smoke keeps the provider-direct no-arg path for bootstrap-time provisioning', async () => {
  const source = await readFile(MODEL_SMOKE, 'utf8');
  // bootstrap-runtime.sh:258 invokes model-smoke.py with no arguments during
  // provisioning — that path must remain the pinned provider-direct POST.
  assert.match(source, /\/chat\/completions/);
  assert.match(source, /else:\s*\n\s+main\(\)/);
});

test('model-smoke --local fails fast without an API server key', async () => {
  const source = await readFile(MODEL_SMOKE, 'utf8');
  const local = localBranch(source);
  assert.match(local, /API_SERVER_KEY/);
  assert.match(local, /SystemExit\(/);
});

/* A business at its monthly model cap gets HTTP 429 budget_exceeded from our
   own proxy on every call, including the bootstrap's smoke. That refusal is
   the proxy authenticating the runtime's token and applying policy, so the
   endpoint and credential are proven; treating it as broken inference left
   a capped tenant unable to take a runtime release (2026-09-09). */
test('model-smoke treats our proxy\'s budget_exceeded 429 as proven-but-capped, and nothing else', () => {
  const decide = (args) => {
    const result = spawnSync('python3', ['-c', [
      'import importlib.util, sys',
      `spec = importlib.util.spec_from_file_location('model_smoke', ${JSON.stringify(MODEL_SMOKE)})`,
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      `print(module.capped_by_proxy(${args}))`,
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const proxy = '"https://api.jentera.ai/v1/model"';
  const capped = `b'{"error":{"message":"monthly model budget exhausted","type":"budget_exceeded","code":429}}'`;
  assert.equal(decide(`${proxy}, 429, ${capped}`), 'True');
  // an upstream rate limit relayed with the same status is still a failure
  assert.equal(decide(`${proxy}, 429, b'{"error":{"message":"rate limited","type":"rate_limit_error","code":429}}'`), 'False');
  // only our proxy applies our budget policy; another endpoint's 429 proves nothing
  assert.equal(decide(`"https://router.fmcv.my", 429, ${capped}`), 'False');
  // any other status is never a pass, whatever the body says
  assert.equal(decide(`${proxy}, 401, ${capped}`), 'False');
  // garbage bodies do not crash the decision
  assert.equal(decide(`${proxy}, 429, b'not json'`), 'False');
});
