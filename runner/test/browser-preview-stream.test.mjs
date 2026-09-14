import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { serveBrowserPreview } from '../src/browser-preview-stream.mjs';

function response() {
  return Object.assign(new EventEmitter(), {
    frames: [], status: null, ended: false,
    writeHead(status) { this.status = status; }, flushHeaders() {},
    write(line) { this.frames.push(JSON.parse(line)); return true; },
    end() { this.ended = true; },
  });
}
test('streams frames then terminates when the bound task finishes', async () => {
  const res = response();
  let checks = 0;
  await serveBrowserPreview(res, { preview: async () => ({ previewStatus: 'ready', image: 'YWJj' }) },
    async () => ++checks < 3, { interval: 1 });
  assert.deepEqual(res.frames.map(f => f.previewStatus), ['ready', 'inactive']);
  assert.equal(res.ended, true);
});
test('discards a capture if task changes while it is being produced', async () => {
  const res = response();
  let active = true;
  await serveBrowserPreview(res, { preview: async () => { active = false; return { image: 'secret' }; } }, () => active);
  assert.deepEqual(res.frames, [{ previewStatus: 'inactive' }]);
});
test('limits viewers and releases the slot on disconnect without stopping the task', async () => {
  const first = response();
  const browser = { preview: async () => ({ previewStatus: 'loading' }) };
  const stream = serveBrowserPreview(first, browser, () => true, { interval: 1000 });
  const second = response();
  await serveBrowserPreview(second, browser, () => true);
  assert.equal(second.status, 409);
  first.emit('close');
  await stream;
  const third = response();
  await serveBrowserPreview(third, browser, () => false);
  assert.equal(third.status, 200);
});
test('expires bounded viewer leases even if the client cannot drain', async () => {
  const res = response();
  res.write = () => false;
  await serveBrowserPreview(res, { preview: async () => ({ previewStatus: 'loading' }) }, () => true, { duration: 20 });
  assert.equal(res.ended, true);
});
