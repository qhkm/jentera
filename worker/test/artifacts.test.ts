import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { claimRuntime } from '../src/agent-runtime';
import { handleArtifacts, RUNTIME_ARTIFACTS_PATH } from '../src/routes/artifacts';
import { handleRuns } from '../src/routes/runs';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import { startRun } from '../src/runs';
import { asOwner, asTenant, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RID_A = 'aisar-b-aaaaaaaaaaaaaaaaaaaa';
const CONTROL_SECRET = 'fmcv-control-secret-'.padEnd(48, 's');

/** Just enough of R2 for the routes: bytes and http metadata by key. */
class FakeBucket {
  objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
      : value instanceof Uint8Array ? value
        : value instanceof ArrayBuffer ? new Uint8Array(value)
          : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
    return { key, size: bytes.byteLength };
  }

  async get(key: string) {
    const found = this.objects.get(key);
    if (!found) return null;
    return {
      key,
      size: found.bytes.byteLength,
      body: new Response(found.bytes).body,
      httpMetadata: { contentType: found.contentType },
      writeHttpMetadata(headers: Headers) {
        if (found.contentType) headers.set('Content-Type', found.contentType);
      },
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

let cookieA: string;
let cookieB: string;
let runId: string;
let taskId: string;
let bucket: FakeBucket;
let runnerKey: string;

function artifactsEnv(over: Record<string, unknown> = {}): Env {
  return testEnv({ AISAR_MODEL_KEY: CONTROL_SECRET, ARTIFACTS: bucket, API_ORIGIN: 'https://api.test', ...over });
}

beforeEach(async () => {
  await truncateAll();
  let userA = '';
  let userB = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`;
    const [a] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('b@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner')`;
    userA = a.id;
    userB = b.id;
  });
  cookieA = await signIn(userA);
  cookieB = await signIn(userB);
  bucket = new FakeBucket();
  const env = artifactsEnv();
  await asTenant(A, (tx) => claimRuntime(env, tx, A, {
    provider: 'fly-sprite', providerName: RID_A, release: '2026.09.12-1', runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
  }));
  const run = await asTenant(A, (tx) => startRun(tx, A, {
    kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'deepseek',
  }));
  runId = run.id;
  const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
    kind: 'run', runId, dedupeKey: `artifacts:${runId}`,
    payload: { input: 'Write me the digest as a file', model: 'deepseek', responseMode: 'deep' },
  }));
  taskId = task.id;
  runnerKey = (await deriveJenteraRuntimeCredential(CONTROL_SECRET, RID_A)).key;
});

async function upload(
  name: string,
  body: string | Uint8Array,
  over: { token?: string | null; task?: string; contentType?: string; env?: Env } = {},
) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const headers: Record<string, string> = {
    'X-Aisar-Task-Id': over.task ?? taskId,
    'X-Aisar-Artifact-Name': name,
    'Content-Type': over.contentType ?? 'text/markdown',
    'Content-Length': String(bytes.byteLength),
  };
  if (over.token !== null) headers.Authorization = `Bearer ${over.token ?? runnerKey}`;
  const request = new Request(`https://api.test${RUNTIME_ARTIFACTS_PATH}`, { method: 'POST', headers, body: bytes });
  const response = await handleArtifacts(request, over.env ?? artifactsEnv(), new URL(request.url), {});
  if (!response) throw new Error('artifacts route did not match');
  return response;
}

async function call(method: string, path: string, cookie?: string) {
  const incoming = req(method, path, { cookie });
  const response = await handleArtifacts(incoming.request, artifactsEnv(), incoming.url, {});
  if (!response) throw new Error('artifacts route did not match');
  return response;
}

describe('artifacts: files the agent hands the owner', () => {
  it('stores a file the runner uploads for a task, under the tenant, keyed to the run', async () => {
    const response = await upload('tech-digest.md', '# Digest\n\nThree things.');
    expect(response.status).toBe(201);
    const body = await jsonOf<{ ok: boolean; artifact: { id: string; name: string; size: number; contentType: string } }>(response);
    expect(body.artifact).toMatchObject({ name: 'tech-digest.md', size: 23, contentType: 'text/markdown' });

    const rows = await asTenant(A, (tx) => tx<{ run_id: string; name: string; size_bytes: number; r2_key: string }[]>`
      select run_id, name, size_bytes::int as size_bytes, r2_key from artifact`);
    expect(rows).toEqual([expect.objectContaining({ run_id: runId, name: 'tech-digest.md', size_bytes: 23 })]);
    expect(rows[0].r2_key).toBe(`${A}/${runId}/${body.artifact.id}/tech-digest.md`);
    expect(bucket.objects.has(rows[0].r2_key)).toBe(true);
    /* RLS: the other tenant sees nothing. */
    expect(await asTenant(B, (tx) => tx`select id from artifact`)).toHaveLength(0);
  });

  it('refuses uploads without a runtime credential, for a task that is not this runtime\'s, or with a bad name', async () => {
    expect((await upload('x.md', 'x', { token: null })).status).toBe(401);
    expect((await upload('x.md', 'x', { token: 'sk-jentera-v1.bad.bad' })).status).toBe(401);
    expect((await upload('x.md', 'x', { task: '99999999-9999-4999-8999-999999999999' })).status).toBe(404);
    for (const name of ['../secrets.md', 'a/b.md', '', 'x'.repeat(130), 'bad name']) {
      expect((await upload(name, 'x')).status).toBe(400);
    }
    expect(await asTenant(A, (tx) => tx`select id from artifact`)).toHaveLength(0);
  });

  it('caps a file at 20 MB and a run at 20 files', async () => {
    const huge = new Request(`https://api.test${RUNTIME_ARTIFACTS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runnerKey}`,
        'X-Aisar-Task-Id': taskId,
        'X-Aisar-Artifact-Name': 'big.bin',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(21 * 1024 * 1024),
      },
      body: 'tiny body, declared huge',
    });
    expect((await handleArtifacts(huge, artifactsEnv(), new URL(huge.url), {}))?.status).toBe(413);
    for (let i = 0; i < 20; i += 1) {
      expect((await upload(`part-${i}.txt`, 'x', { contentType: 'text/plain' })).status).toBe(201);
    }
    expect((await upload('one-too-many.txt', 'x', { contentType: 'text/plain' })).status).toBe(409);
  });

  it('answers 503, not a stack trace, when no bucket is bound', async () => {
    expect((await upload('x.md', 'x', { env: artifactsEnv({ ARTIFACTS: undefined }) })).status).toBe(503);
  });

  it('lists the owner\'s files newest first, by run or altogether, and never another tenant\'s', async () => {
    await upload('first.md', 'one');
    await upload('second.csv', 'a,b', { contentType: 'text/csv' });
    const byRun = await call('GET', `/api/artifacts?runId=${runId}`, cookieA);
    expect(byRun.status).toBe(200);
    const list = await jsonOf<{ ok: boolean; artifacts: { name: string; runId: string; contentType: string; size: number }[] }>(byRun);
    expect(list.artifacts.map((a) => a.name)).toEqual(['second.csv', 'first.md']);
    expect(list.artifacts[0]).toMatchObject({ runId, contentType: 'text/csv', size: 3 });
    const all = await jsonOf<{ artifacts: unknown[] }>(await call('GET', '/api/artifacts', cookieA));
    expect(all.artifacts).toHaveLength(2);
    expect((await jsonOf<{ artifacts: unknown[] }>(await call('GET', '/api/artifacts', cookieB))).artifacts).toEqual([]);
    expect((await call('GET', '/api/artifacts')).status).toBe(401);
  });

  it('downloads a file as an attachment to its owner only', async () => {
    const { artifact } = await jsonOf<{ artifact: { id: string } }>(await upload('tech-digest.md', '# Digest'));
    const own = await call('GET', `/api/artifacts/${artifact.id}`, cookieA);
    expect(own.status).toBe(200);
    expect(own.headers.get('Content-Type')).toBe('text/markdown');
    expect(own.headers.get('Content-Disposition')).toBe("attachment; filename=\"tech-digest.md\"; filename*=UTF-8''tech-digest.md");
    expect(own.headers.get('Cache-Control')).toBe('private, no-store');
    expect(own.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await own.text()).toBe('# Digest');
    expect((await call('GET', `/api/artifacts/${artifact.id}`, cookieB)).status).toBe(404);
    expect((await call('GET', `/api/artifacts/${artifact.id}`)).status).toBe(401);
  });

  it('shows up on the completed run so the chat and the task page can offer it', async () => {
    const { artifact } = await jsonOf<{ artifact: { id: string } }>(await upload('tech-digest.md', '# Digest'));
    await asOwner(async (sql) => {
      await sql`update runtime_task set status = 'completed', result = ${sql.json({ text: 'Here is your digest.' })} where id = ${taskId}`;
      await sql`update run set status = 'completed', ended_at = now() where id = ${runId}`;
    });
    const incoming = req('GET', `/api/runs/${runId}`, { cookie: cookieA });
    const response = await handleRuns(incoming.request, artifactsEnv(), incoming.url, {});
    expect(await jsonOf<{ artifacts: unknown[] }>(response!)).toMatchObject({
      status: 'completed',
      text: 'Here is your digest.',
      artifacts: [expect.objectContaining({ id: artifact.id, name: 'tech-digest.md', contentType: 'text/markdown', size: 8 })],
    });
  });
});
