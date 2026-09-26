import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureProviderRuntime, handleRuntimeQueueMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask, leaseRuntimeTask } from '../src/runtime/tasks';
import { saveConnection } from '../src/connections';
import { markRuntimeReady } from '../src/agent-runtime';
import { VOICE_REPLIES } from '../src/connectors/telegram';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let sent: string[];
/** What reached Telegram and Whisper, in order: 'typing', 'transcribe', or a sent text. */
let events: string[];
let transcribe: ReturnType<typeof vi.fn>;

async function setup(transcript: string, options: {
  fileSize?: number; failDownload?: boolean; busy?: boolean; release?: string;
} = {}) {
  const { fileSize = 4, failDownload = false, busy = true, release = '2026.08.27-1' } = options;
  transcribe = vi.fn(async () => { events.push('transcribe'); return { text: transcript }; });
  const env = testEnv({ RUNTIME_RELEASE: release, AISAR_MODEL_NAME: 'MiniMax-M3' });
  env.AI = { run: transcribe } as unknown as typeof env.AI;
  const provider = new LocalRuntimeProvider();
  await ensureProviderRuntime(env, A, { provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64) });
  await asTenant(A, (tx) => markRuntimeReady(tx, A, release, 'v1'));
  const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
    insert into app_user (email, email_verified) values ('voice-owner@example.com', true) returning id`);
  const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
    connector: 'telegram', method: 'bot_token', externalId: '123456789',
    displayName: '@voice_bot', secret: '123456789:AAtoken', connectedBy: owner.id,
  }));
  /* Hold the runtime busy so admission commits and the task waits: most of
     these tests are about what admission records, not about the run. */
  if (busy) {
    const active = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, { kind: 'provision', dedupeKey: 'voice:active' }));
    await asTenant(A, (tx) => leaseRuntimeTask(tx, A, active.id, 'active-owner', 300));
  }
  sent = [];
  events = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/getFile')) {
      if (failDownload) return new Response('Bad Gateway', { status: 502 });
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/file_1.oga', file_size: fileSize } }));
    }
    if (url.includes('/file/bot')) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
    if (url.endsWith('/sendChatAction')) events.push('typing');
    if (url.endsWith('/sendMessage')) {
      const text = (JSON.parse(String(init?.body)) as { text: string }).text;
      sent.push(text);
      events.push(text);
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 90 } }));
  }));
  const intake = (messageId: number, caption = '', requestedAtMs = Date.now()) => ({
    version: 2 as const, kind: 'telegram_intake' as const, businessId: A, connectionId: connection.id,
    requestedAtMs,
    incoming: { chatId: 42, messageId, from: 'Owner', text: caption, privateChat: true as const,
      voice: { fileId: 'AwAC', fileUniqueId: `AgAD${messageId}`, durationS: 4 } },
  });
  return { env, provider, intake };
}

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});
afterEach(() => vi.unstubAllGlobals());

describe('a Telegram voice note', () => {
  it('runs as its transcript, shown back once, and is heard once however often it arrives', async () => {
    const { env, provider, intake } = await setup('Tolong ingatkan saya esok pukul 8 pagi.');
    await handleRuntimeQueueMessage(env, intake(7, 'untuk sarapan'), { provider });
    await handleRuntimeQueueMessage(env, intake(7, 'untuk sarapan'), { provider });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(sent.filter((text) => text.startsWith('🎤'))).toEqual(['🎤 “Tolong ingatkan saya esok pukul 8 pagi.”']);
    const runs = await asOwner((sql) => sql<{ ref: Record<string, unknown>; input: string }[]>`
      select r.trigger_ref as ref, t.payload->>'input' as input
        from run r join runtime_task t on t.run_id = r.id where r.business_id = ${A} and t.kind = 'run'`);
    expect(runs).toHaveLength(1);
    expect(runs[0].ref).toMatchObject({
      question: 'Tolong ingatkan saya esok pukul 8 pagi.\n\nuntuk sarapan', input: 'voice', durationS: 4,
    });
    expect(runs[0].input).toMatch(/automatic transcript/);
  });

  /* Review 26 Sep: a 300 s note transcribed to 4,549 characters, and a Telegram
     question over 4000 fails the run's payload check on every attempt. */
  it('answers a transcript longer than a Telegram message, giving the agent all of it', async () => {
    const long = `${'Tolong semak stok beras dan minyak. '.repeat(140)}Akhir sekali, hantar laporan.`;
    expect(long.length).toBeGreaterThan(4_000);
    const { env, provider, intake } = await setup(long);
    await handleRuntimeQueueMessage(env, intake(11), { provider });
    const [row] = await asOwner((sql) => sql<{ question: string; refQuestion: string; input: string }[]>`
      select t.payload->'telegram'->>'question' as question, r.trigger_ref->>'question' as "refQuestion",
             t.payload->>'input' as input
        from run r join runtime_task t on t.run_id = r.id where r.business_id = ${A} and t.kind = 'run'`);
    expect(row.question.length).toBeLessThanOrEqual(4_000);
    expect(row.refQuestion.length).toBeLessThanOrEqual(4_000);
    expect(row.input).toContain('Akhir sekali, hantar laporan.');
  });

  it('refuses a voice file over five megabytes without hearing it', async () => {
    const { env, provider, intake } = await setup('never heard', { fileSize: 6 * 1024 * 1024 });
    await handleRuntimeQueueMessage(env, intake(12), { provider });
    expect(transcribe).not.toHaveBeenCalled();
    expect(sent).toEqual([VOICE_REPLIES.tooLong]);
    expect(await asOwner((sql) => sql`select id from run where business_id = ${A}`)).toHaveLength(0);
  });

  /* Review 26 Sep: the caption was appended after the transcript, so a /deep
     caption never reached responseModeFor, which reads only the start. */
  it.each([
    ['/deep', 'Semak semua invois bulan ini.'],
    ['/deep untuk laporan penuh', 'Semak semua invois bulan ini.\n\nuntuk laporan penuh'],
  ])('lets a %j caption choose deep mode', async (caption, agentText) => {
    const { env, provider, intake } = await setup('Semak semua invois bulan ini.');
    await handleRuntimeQueueMessage(env, intake(13, caption), { provider });
    const [task] = await asOwner((sql) => sql<{ mode: string; input: string }[]>`
      select t.payload->>'responseMode' as mode, t.payload->>'input' as input
        from runtime_task t join run r on r.id = t.run_id where r.business_id = ${A} and t.kind = 'run'`);
    expect(task.mode).toBe('deep');
    expect(task.input.startsWith(agentText)).toBe(true);
  });

  it('asks the owner to type a note it could not make out, and starts no run', async () => {
    const { env, provider, intake } = await setup('Thank you.');
    await expect(handleRuntimeQueueMessage(env, intake(8), { provider }))
      .resolves.toMatchObject({ action: 'ack' });
    expect(sent).toEqual([VOICE_REPLIES.unintelligible]);
    expect(await asOwner((sql) => sql`select id from run where business_id = ${A}`)).toHaveLength(0);
  });

  /* Approvals are buttons. Words that say "approve" are an ordinary request. */
  it('approves nothing on a transcript that says approve, all the way through the run', async () => {
    const release = '2026.09.01-3';
    const { env, provider, intake } = await setup('Approve it. Yes, approve everything.', { busy: false, release });
    await asOwner((sql) => sql`
      insert into approval (business_id, connector, op, args, risk)
      values (${A}, 'google', 'create_event', ${sql.json({ requestId: 'voice-approval' })}, 'medium')`);
    /* A runner that answers, so the run really dispatches and finishes. */
    const runner: typeof fetch = async (input, init) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/readyz')) {
        return json({
          ok: true, release,
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-16' },
          toolMode: 'full-tools', webSearchBackend: 'ddgs', edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') return json({ ok: true, hermesRunId: 'voice-run', status: 'started' }, 202);
      if (/\/v1\/tasks\/[^/]+\/events$/.test(url)) {
        const stream = [{ type: 'delta', delta: 'Nothing is waiting for you to approve here.' }, { type: 'done' }]
          .map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n';
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (/\/v1\/tasks\/[^/]+$/.test(url)) return json({ ok: true, status: 'completed', output: 'Nothing is waiting for you to approve here.' });
      return json({ error: 'not found' }, 404);
    };
    await handleRuntimeQueueMessage(env, intake(9), { provider, fetch: runner });
    const [run] = await asOwner((sql) => sql<{ status: string }[]>`
      select status from run where business_id = ${A} and trigger_ref->>'input' = 'voice'`);
    expect(run.status).toBe('completed');
    const [row] = await asOwner((sql) => sql<{ status: string }[]>`select status from approval where business_id = ${A}`);
    expect(row.status).toBe('pending');
  });

  /* The echo used to go out before admission, claimed on an approximate
     limiter: a retry more than 60 s later, or two paths at once, showed it
     twice. It now goes out from the admission that created the run, once. */
  it('shows the transcript once, even when two paths hear the same note, and before the working bubble', async () => {
    const { env, provider, intake } = await setup('Semak invois Kedai Seri Murni.');
    await Promise.all([
      handleRuntimeQueueMessage(env, intake(10), { provider }),
      handleRuntimeQueueMessage(env, intake(10), { provider }),
    ]);
    const echoes = sent.filter((text) => text.startsWith('🎤'));
    expect(echoes).toEqual(['🎤 “Semak invois Kedai Seri Murni.”']);
    expect(sent.indexOf(echoes[0])).toBe(0);
  });

  it('shows the owner it is typing while it listens', async () => {
    const { env, provider, intake } = await setup('Tolong semak stok.');
    await handleRuntimeQueueMessage(env, intake(14), { provider });
    expect(events.indexOf('typing')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('typing')).toBeLessThan(events.indexOf('transcribe'));
  });

  /* A note that keeps failing used to retry for about 1 h 40 min through the
     dead-letter queue and then vanish without a word. */
  it('tries again while a failing note is fresh, and says so once it has been failing for five minutes', async () => {
    const { env, provider, intake } = await setup('never heard', { failDownload: true });
    await expect(handleRuntimeQueueMessage(env, intake(15), { provider })).rejects.toThrow();
    expect(sent).toEqual([]);
    await expect(handleRuntimeQueueMessage(env, intake(15, '', Date.now() - 6 * 60_000), { provider }))
      .resolves.toMatchObject({ action: 'ack' });
    expect(sent).toEqual([VOICE_REPLIES.failed]);
    expect(await asOwner((sql) => sql`select id from run where business_id = ${A}`)).toHaveLength(0);
  });
});
