import { createHmac, randomUUID } from 'node:crypto';

const required = ['AISAR_BUSINESS_ID', 'AISAR_RUNNER_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const taskId = randomUUID();
const now = Math.floor(Date.now() / 1000);
const grantPayload = Buffer.from(JSON.stringify({
  version: 1,
  businessId: process.env.AISAR_BUSINESS_ID,
  taskId,
  operations: [],
  issuedAt: now,
  expiresAt: now + 300,
  nonce: randomUUID(),
})).toString('base64url');
const toolGrant = `${grantPayload}.${createHmac('sha256', process.env.AISAR_RUNNER_KEY)
  .update(grantPayload).digest('base64url')}`;
const headers = {
  'Content-Type': 'application/json',
  'X-Aisar-Runner-Key': process.env.AISAR_RUNNER_KEY,
};
const payload = JSON.stringify({
  businessId: process.env.AISAR_BUSINESS_ID,
  taskId,
  leaseToken: randomUUID(),
  sessionId: `vrs-smoke-${taskId}`,
  input: 'Reply with exactly: AISAR VRS OK. Do not use tools.',
  instructions: 'This is a model connectivity check. Do not call tools or perform actions.',
  toolGrant,
});
const start = () => fetch('http://127.0.0.1:8080/v1/tasks', {
  method: 'POST',
  headers,
  body: payload,
});
const started = await start();
const startBody = await started.json();
if (started.status !== 202) throw new Error(`runner refused smoke task (${started.status})`);

const terminal = new Set(['completed', 'failed', 'cancelled', 'stopped']);
let result;
for (let attempt = 0; attempt < 120; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const response = await fetch(`http://127.0.0.1:8080/v1/tasks/${taskId}`, { headers });
  result = await response.json();
  if (!response.ok) throw new Error(`runner status failed (${response.status})`);
  if (terminal.has(result.status)) break;
}
if (!result || !terminal.has(result.status)) throw new Error('VRS smoke task timed out');

const duplicateResponse = await start();
const duplicate = await duplicateResponse.json();
if (duplicateResponse.status !== 200 || duplicate.duplicate !== true ||
    duplicate.hermesRunId !== startBody.hermesRunId) {
  throw new Error('runner did not deduplicate the completed task');
}

const text = String(result.output ?? result.result ?? result.response ?? result.error ?? '');
process.stdout.write(JSON.stringify({
  ok: result.status === 'completed',
  taskId,
  hermesRunId: startBody.hermesRunId,
  status: result.status,
  duplicate: duplicate.duplicate,
  output: text.slice(0, 500),
}) + '\n');
if (result.status !== 'completed') process.exitCode = 1;
