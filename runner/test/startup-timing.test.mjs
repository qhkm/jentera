import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { STARTUP_HELPER } from '../bin/hermes-startup-timing.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const PRELUDE = `
import asyncio, json, logging, sys
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import jentera_startup as timing
rows = []
class Capture(logging.Handler):
    def emit(self, record):
        message = record.getMessage()
        assert message.startswith("[hermes-startup] ")
        rows.append(json.loads(message[len("[hermes-startup] "):]))
timing._logger.setLevel(logging.INFO)
timing._logger.propagate = False
timing._logger.handlers = [Capture()]
RUN = "run_" + "a" * 32
`;

async function check(code) {
  const root = await mkdtemp(join(tmpdir(), 'aisar-startup-test-'));
  directories.push(root);
  await writeFile(join(root, 'jentera_startup.py'), STARTUP_HELPER);
  const result = spawnSync('python3', ['-c', PRELUDE + code, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('startup timing isolates a 22-second step using a monotonic clock', async () => {
  await check(`
with patch.object(timing.time, "monotonic_ns", side_effect=[0, 0, 22_000_000_000, 22_100_000_000]):
    with timing.trace_startup(RUN):
        timing.startup_mark("api.runtime_credentials")
assert [r["stage"] for r in rows] == ["start", "api.runtime_credentials", "complete"]
assert rows[1]["stageMs"] == 22000
assert rows[1]["elapsedMs"] == 22000
assert rows[2]["stageMs"] == 100
assert rows[2]["elapsedMs"] == 22100
assert timing._current.get() is None
`);
});

test('missing IDs, unsafe IDs, unknown stages and customer content never become logs', async () => {
  await check(`
secret = "private prompt password credential@example.test"
for run_id in [None, "", secret, RUN + "\\n" + secret]:
    with timing.trace_startup(run_id):
        timing.startup_mark("api.imports")
assert rows == []
with timing.trace_startup(RUN):
    timing.startup_mark(secret)
    timing.startup_mark({"prompt": secret})
    timing.startup_mark("init.certificates")
assert [r["stage"] for r in rows] == ["start", "init.certificates", "complete"]
assert secret not in json.dumps(rows)
assert all(set(r) == {"runtimeRunId", "stage", "stageMs", "elapsedMs"} for r in rows)
`);
});

test('constructor failures keep their original exception and reset the trace', async () => {
  await check(`
original = RuntimeError("private secret failure details")
try:
    with timing.trace_startup(RUN):
        timing.startup_mark("init.client_options")
        raise original
except RuntimeError as error:
    assert error is original
else:
    raise AssertionError("original error was swallowed")
assert [r["stage"] for r in rows] == ["start", "init.client_options", "failed"]
assert str(original) not in json.dumps(rows)
assert timing._current.get() is None
count = len(rows)
timing.startup_mark("init.context_engine")
assert len(rows) == count
`);
});

test('a broken log sink never fails initialization or replaces its exception', async () => {
  await check(`
original = RuntimeError("original failure")
with patch.object(timing._logger, "info", side_effect=RuntimeError("log sink failed")):
    with timing.trace_startup(RUN):
        timing.startup_mark("init.client_ready")
        result = "agent is ready"
    assert result == "agent is ready"
    try:
        with timing.trace_startup(RUN):
            raise original
    except RuntimeError as error:
        assert error is original
assert timing._current.get() is None
`);
});

test('concurrent tasks and threads retain their own run correlation', async () => {
  await check(`
def identity(i):
    return "run_" + format(i, "032x")
async def worker(i):
    with timing.trace_startup(identity(i)):
        await asyncio.sleep(0)
        timing.startup_mark("api.gateway_config")
        await asyncio.sleep(0)
async def main():
    await asyncio.gather(*(worker(i) for i in range(1, 11)))
asyncio.run(main())
def threaded(i):
    with timing.trace_startup(identity(i)):
        timing.startup_mark("api.gateway_config")
with ThreadPoolExecutor(max_workers=4) as executor:
    list(executor.map(threaded, range(11, 21)))
assert len(rows) == 60
for i in range(1, 21):
    own = [r["stage"] for r in rows if r["runtimeRunId"] == identity(i)]
    assert own == ["start", "api.gateway_config", "complete"], own
assert timing._current.get() is None
`);
});

test('an untraced nested caller cannot accidentally log under its parent run', async () => {
  await check(`
with timing.trace_startup(RUN):
    with timing.trace_startup(None):
        timing.startup_mark("init.tool_definitions")
    timing.startup_mark("api.agent_constructed")
assert [r["stage"] for r in rows] == ["start", "api.agent_constructed", "complete"]
assert timing._current.get() is None
`);
});
