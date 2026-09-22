import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createProcedureRecorder, procedureRecorderInternals } from '../src/procedure-recorder.mjs';

function fixture() {
  let clock = 1000;
  const page = new EventEmitter();
  let url = 'https://books.example.test/invoices/123456?token=secret&view=open';
  let binding;
  page.url = () => url;
  page.mainFrame = () => page;
  page.exposeBinding = async (_name, callback) => { binding = callback; };
  page.evaluate = async () => {};
  const context = new EventEmitter();
  context.pages = () => [page];
  return {
    recorder: createProcedureRecorder({ now: () => clock }), page, context,
    advance: value => { clock += value; },
    navigate: value => { url = value; page.emit('framenavigated', page); },
    dom: event => binding({}, event),
  };
}

test('records semantic browser actions and request shapes without values or payloads', async () => {
  const f = fixture();
  await f.recorder.start(f.context, 'Match a payment to its invoice');
  f.dom({ kind: 'click', target: { tag: 'button', name: 'Find invoice' } });
  f.dom({ kind: 'input', target: { tag: 'input', type: 'text', name: 'Invoice number', value: 'INV-0192' } });
  f.dom({ kind: 'input', target: { tag: 'input', type: 'password', name: 'Password', value: 'secret' } });
  f.page.emit('request', {
    resourceType: () => 'fetch', method: () => 'POST',
    url: () => 'https://books.example.test/api/invoices/550e8400-e29b-41d4-a716-446655440000/apply?csrf=secret',
    postData: () => 'never captured', headers: () => ({ authorization: 'never captured' }),
  });
  f.navigate('https://books.example.test/invoices/987654?customer=private');
  f.advance(50);
  const draft = f.recorder.stop();

  assert.equal(draft.objective, 'Match a payment to its invoice');
  assert.equal(draft.version, 1);
  assert.equal(draft.safety.capturedValues, false);
  assert.equal(draft.steps.some(step => step.target?.name === 'Password'), false);
  assert.equal(draft.steps.some(step => step.label.includes('Invoice number')), true);
  assert.deepEqual(draft.connectorCandidates[0], {
    method: 'POST', origin: 'https://books.example.test', path: '/api/invoices/:id/apply',
    queryKeys: ['csrf'], resourceType: 'fetch', evidence: 'event-4',
  });
  const serialized = JSON.stringify(draft);
  for (const secret of ['INV-0192', 'secret', 'private', 'never captured', 'authorization']) assert.ok(!serialized.includes(secret));
});

test('normalizes identifiers and never returns query values', () => {
  assert.deepEqual(procedureRecorderInternals.safeLocation('https://example.com/jobs/123456/abcdefghijklmnopqrstuvwxyz012345?q=private&mode=full'), {
    origin: 'https://example.com', path: '/jobs/:number/:value', queryKeys: ['q', 'mode'],
  });
  assert.equal(procedureRecorderInternals.safeLocation('http://example.com/private'), null);
  assert.equal(procedureRecorderInternals.safeLocation('https://user:pass@example.com/'), null);
});

test('requires an explicit session and rejects overlapping recordings', async () => {
  const f = fixture();
  assert.throws(() => f.recorder.stop(), /procedure_recording_inactive/);
  await f.recorder.start(f.context, 'First');
  await assert.rejects(f.recorder.start(f.context, 'Second'), /procedure_recording_active/);
  f.recorder.cancel();
  assert.deepEqual(f.recorder.status(), { recording: false });
});
