import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureProviderRuntime, handleRuntimeQueueMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask, leaseRuntimeTask } from '../src/runtime/tasks';
import { saveConnection } from '../src/connections';
import { markRuntimeReady } from '../src/agent-runtime';
import { VOICE_REPLIES } from '../src/connectors/telegram';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let sent: string[];
let transcribe: ReturnType<typeof vi.fn>;

async function setup(transcript: string) {
  transcribe = vi.fn(async () => ({ text: transcript }));
  const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1', AISAR_MODEL_NAME: 'MiniMax-M3' });
  env.AI = { run: transcribe } as unknown as typeof env.AI;
  const provider = new LocalRuntimeProvider();
  await ensureProviderRuntime(env, A, { provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64) });
  await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
  const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
    insert into app_user (email, email_verified) values ('voice-owner@example.com', true) returning id`);
  const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
    connector: 'telegram', method: 'bot_token', externalId: '123456789',
    displayName: '@voice_bot', secret: '123456789:AAtoken', connectedBy: owner.id,
  }));
  /* Hold the runtime busy so admission commits and the task waits: this test
     is about what admission records, not about the run. */
  const active = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, { kind: 'provision', dedupeKey: 'voice:active' }));
  await asTenant(A, (tx) => leaseRuntimeTask(tx, A, active.id, 'active-owner', 300));
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/getFile')) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/file_1.oga', file_size: 4 } }));
    }
    if (url.includes('/file/bot')) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
    if (url.endsWith('/sendMessage')) sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 90 } }));
  }));
  const intake = (messageId: number, caption = '') => ({
    version: 2 as const, kind: 'telegram_intake' as const, businessId: A, connectionId: connection.id,
    requestedAtMs: Date.now(),
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

  it('asks the owner to type a note it could not make out, and starts no run', async () => {
    const { env, provider, intake } = await setup('Thank you.');
    await expect(handleRuntimeQueueMessage(env, intake(8), { provider }))
      .resolves.toMatchObject({ action: 'ack' });
    expect(sent).toEqual([VOICE_REPLIES.unintelligible]);
    expect(await asOwner((sql) => sql`select id from run where business_id = ${A}`)).toHaveLength(0);
  });

  /* Approvals are buttons. Words that say "approve" are an ordinary request. */
  it('approves nothing on a transcript that says approve', async () => {
    const { env, provider, intake } = await setup('Approve it. Yes, approve everything.');
    await asOwner((sql) => sql`
      insert into approval (business_id, connector, op, args, risk)
      values (${A}, 'google', 'create_event', ${sql.json({ requestId: 'voice-approval' })}, 'medium')`);
    await handleRuntimeQueueMessage(env, intake(9), { provider });
    const [row] = await asOwner((sql) => sql<{ status: string }[]>`select status from approval where business_id = ${A}`);
    expect(row.status).toBe('pending');
  });

  it('shows the transcript once when two paths hear the same note', async () => {
    const { env, provider, intake } = await setup('Semak invois Kedai Seri Murni.');
    let first = true;
    env.TELEGRAM_ALBUM_REPLY = {
      limit: async () => { const ok = first; first = false; return { success: ok }; },
    } as typeof env.TELEGRAM_ALBUM_REPLY;
    /* Both paths get past the "already admitted" check before either commits. */
    await Promise.all([
      handleRuntimeQueueMessage(env, intake(10), { provider }),
      handleRuntimeQueueMessage(env, intake(10), { provider }),
    ]);
    expect(sent.filter((text) => text.startsWith('🎤'))).toHaveLength(1);
  });
});
