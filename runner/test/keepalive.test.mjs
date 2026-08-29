import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { SpriteKeepalive } from '../src/server.mjs';

const TASK_NAME = 'jentera-always-on';

let directory;
let socketPath;
let tasksServer;
let requests; // { method, url, body }[] in arrival order
let createStatus; // status the fake API returns for POST /v1/tasks

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body ?? {}));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aisar-keepalive-'));
  socketPath = join(directory, 'tasks.sock');
  requests = [];
  createStatus = 200;
  tasksServer = createServer(async (req, res) => {
    let body = null;
    for await (const chunk of req) body = (body ?? '') + chunk;
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    if (req.method === 'POST' && req.url === '/v1/tasks') {
      return json(res, createStatus, { name: TASK_NAME, status: 'active' });
    }
    if ((req.method === 'PUT' || req.method === 'DELETE') && req.url === `/v1/tasks/${TASK_NAME}`) {
      return json(res, 200, { name: TASK_NAME, status: 'active' });
    }
    return json(res, 404, { error: 'not found' });
  });
  await new Promise((resolve) => tasksServer.listen(socketPath, resolve));
});

afterEach(async () => {
  tasksServer.close();
  await rm(directory, { recursive: true, force: true });
});

function futureIso(ms = 3_600_000) {
  return new Date(Date.now() + ms).toISOString();
}

test('arm with a future instant creates the hold task', async () => {
  const keepalive = new SpriteKeepalive(socketPath);
  await keepalive.arm(futureIso());

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/v1/tasks');
  assert.equal(requests[0].body.name, TASK_NAME);
  assert.equal(requests[0].body.expire, '1h');
  assert.equal(keepalive.status().held, true);
  assert.ok(keepalive.status().until);
});

test('a second arm for the same window refreshes via PUT when create 409s', async () => {
  const keepalive = new SpriteKeepalive(socketPath);
  keepalive.arm(futureIso());
  await keepalive.tick();
  assert.equal(keepalive.status().held, true);

  createStatus = 409; // first task still active; create rejected
  await keepalive.arm(futureIso(7_200_000));

  const put = requests.find((r) => r.method === 'PUT' && r.url === `/v1/tasks/${TASK_NAME}`);
  assert.ok(put, 'expected a PUT refresh after 409');
  assert.equal(put.body.expire, '1h');
  assert.equal(keepalive.status().held, true);
});

test('when the hold instant passes, the task is deleted and released', async () => {
  const keepalive = new SpriteKeepalive(socketPath);
  await keepalive.arm(futureIso(40)); // hold for 40ms only
  assert.equal(keepalive.status().held, true);

  await new Promise((resolve) => setTimeout(resolve, 80)); // deadline now passed
  await keepalive.tick();

  const del = requests.find((r) => r.method === 'DELETE' && r.url === `/v1/tasks/${TASK_NAME}`);
  assert.ok(del, 'expected a DELETE after the hold window expired');
  assert.equal(keepalive.status().held, false);
  assert.equal(keepalive.status().until, null);
});

test('without a management socket the keepalive no-ops and stays released', async () => {
  const keepalive = new SpriteKeepalive(join(directory, 'missing.sock'));
  keepalive.arm(futureIso());
  await keepalive.tick();

  assert.equal(requests.length, 0);
  assert.equal(keepalive.status().held, false);
});

test('invalid, missing, or already-past keepaliveUntil never arms the hold', async () => {
  const keepalive = new SpriteKeepalive(socketPath);
  keepalive.arm(undefined);
  keepalive.arm('not-an-instant');
  keepalive.arm('2020-01-01T00:00:00Z'); // valid but already past
  await keepalive.tick();

  assert.equal(requests.length, 0);
  assert.equal(keepalive.status().held, false);
  assert.equal(keepalive.status().until, null);
});
