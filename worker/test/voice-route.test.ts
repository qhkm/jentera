import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleVoice, VOICE_TRANSCRIBE_PATH } from '../src/routes/voice';
import { VOICE_MAX_BYTES } from '../src/voice/transcribe';
import { asOwner, signIn, testEnv, truncateAll } from './harness';
import type { Env } from '../src/env';

const A = '11111111-1111-4111-8111-111111111111';
let cookie: string;

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'A', 'restaurant')`;
    /* Staff seats count only on the team plan (migration 038). */
    await sql`update business set plan = 'team' where id = ${A}`;
    const [user] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('voice@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${user.id}, ${A}, 'staff')`;
    cookie = await signIn(user.id);
  });
});

function voiceEnv(text: unknown, overrides: Partial<Env> = {}) {
  const run = vi.fn(async () => ({ text }));
  const env = testEnv({ ...overrides });
  env.AI = { run } as unknown as Env['AI'];
  return { env, run };
}

async function post(env: Env, body: BodyInit | null, type = 'audio/webm;codecs=opus', auth = cookie) {
  const url = new URL(`https://api.test${VOICE_TRANSCRIBE_PATH}`);
  const response = (await handleVoice(new Request(url, {
    method: 'POST', headers: { Cookie: auth, 'Content-Type': type }, body,
  }), env, url, {}))!;
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const RECORDING = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

/* The app records a note, sends it here, and puts the words in the composer
   for the owner to check before sending. The audio is not kept. */
describe('turning a recording into text for the composer', () => {
  it('hears a signed-in member, staff included, in any format a browser records', async () => {
    for (const type of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/mpeg']) {
      const { env, run } = voiceEnv(' Tolong semak stok minyak. ');
      expect(await post(env, RECORDING, type)).toEqual({ status: 200, body: { ok: true, text: 'Tolong semak stok minyak.' } });
      expect(run).toHaveBeenCalledOnce();
    }
  });

  it('says so when nothing could be made out', async () => {
    const { env } = voiceEnv('Thank you.');
    expect(await post(env, RECORDING)).toMatchObject({ status: 422, body: { ok: false, code: 'UNINTELLIGIBLE' } });
  });

  it('refuses a stranger, a non-audio body, an empty one and one over the cap, before hearing anything', async () => {
    const { env, run } = voiceEnv('never');
    expect((await post(env, RECORDING, 'audio/webm', '')).status).toBe(401);
    expect((await post(env, RECORDING, 'text/plain')).status).toBe(415);
    expect((await post(env, RECORDING, 'image/png')).status).toBe(415);
    expect((await post(env, new Uint8Array(0))).status).toBe(400);
    expect((await post(env, new Uint8Array(VOICE_MAX_BYTES + 1))).status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('slows down a burst, and answers plainly when the model fails', async () => {
    const limited = voiceEnv('never', { AGENT_RUN_BURST: { limit: async () => ({ success: false }) } as unknown as Env['AGENT_RUN_BURST'] });
    expect((await post(limited.env, RECORDING)).status).toBe(429);
    expect(limited.run).not.toHaveBeenCalled();

    const broken = voiceEnv('unused');
    broken.env.AI = { run: vi.fn(async () => { throw new Error('upstream 5031 internal host 10.0.0.1'); }) } as unknown as Env['AI'];
    const failed = await post(broken.env, RECORDING);
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toMatch(/10\.0\.0\.1|5031/);
  });

  it('answers only a POST', async () => {
    const { env } = voiceEnv('x');
    const url = new URL(`https://api.test${VOICE_TRANSCRIBE_PATH}`);
    const response = await handleVoice(new Request(url, { method: 'GET', headers: { Cookie: cookie } }), env, url, {});
    expect(response?.status).toBe(405);
  });
});
