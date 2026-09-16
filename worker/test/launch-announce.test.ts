/* ============================================================
   The waitlist hears from us once per announcement, never twice.
   ============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asApp, asOwner, fetchFake, jsonOf, signIn, testEnv, truncateAll } from './harness';
import { handleLaunchAdmin } from '../src/routes/launch-admin';

const OWNER = 'qhkmdev90@gmail.com';
let admin: string;
let other: string;
let fetchMock: ReturnType<typeof fetchFake>;

beforeEach(async () => {
  await truncateAll();
  await asOwner(sql => sql`truncate platform_access,trial_redemption,trial_invite,waitlist_entry cascade`);
  const users = await asOwner(sql => sql`
    insert into app_user (email,email_verified) values (${OWNER},true),('visitor@example.com',true) returning id,email`);
  admin = await signIn(users.find(u => u.email === OWNER)!.id);
  other = await signIn(users.find(u => u.email === 'visitor@example.com')!.id);
  await asOwner(sql => sql`insert into waitlist_entry (email,created_at) values
    ('one@example.com', now() - interval '2 days'),
    ('two@example.com', now() - interval '1 day')`);
  fetchMock = fetchFake(() => new Response(JSON.stringify({ id: 'resend-id' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function env(over: Record<string, unknown> = {}) {
  return testEnv({ RESEND_API_KEY: 'resend-test-key', APP_ORIGIN: 'https://jentera.ai', ...over });
}

async function announce(cookie: string | undefined, body: unknown, over: Record<string, unknown> = {}) {
  const url = new URL('http://localhost:8787/api/admin/launch/announce');
  return (await handleLaunchAdmin(
    new Request(url, {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env(over), url, {},
  ))!;
}

/** Every Resend send, as { to, subject, text, headers }. */
const sent = () => fetchMock.mock.calls
  .filter(([input]) => String(input).includes('api.resend.com'))
  .map(([, init]) => JSON.parse(String(init?.body)) as
    { to: string[]; subject: string; text: string; reply_to?: string; headers?: Record<string, string> });

const message = { key: 'launch-week', subject: 'Jentera is open', text: 'We are open for business.' };

describe('waitlist announcement', () => {
  it('allows the application to append delivery evidence but not edit or delete it', async () => {
    await asApp(sql => sql`insert into waitlist_notice (email,notice_key) values ('one@example.com','permission-check')`);
    expect(await asApp(sql => sql`select email from waitlist_notice where notice_key='permission-check'`))
      .toEqual([{ email: 'one@example.com' }]);
    await expect(asApp(sql => sql`update waitlist_notice set notice_key='edited' where notice_key='permission-check'`))
      .rejects.toMatchObject({ code: '42501' });
    await expect(asApp(sql => sql`delete from waitlist_notice where notice_key='permission-check'`))
      .rejects.toMatchObject({ code: '42501' });
  });
  it('is invisible to visitors and to ordinary accounts', async () => {
    for (const cookie of [undefined, other]) expect((await announce(cookie, message)).status).toBe(404);
    expect(sent()).toHaveLength(0);
  });

  it('counts the recipients without sending anything when asked to preview', async () => {
    const res = await announce(admin, { ...message, dryRun: true });
    expect(res.status).toBe(200);
    expect(await jsonOf<{ recipients: number; sent: number }>(res)).toMatchObject({ recipients: 2, sent: 0 });
    expect(sent()).toHaveLength(0);
    expect(await asOwner(sql => sql`select email from waitlist_notice`)).toHaveLength(0);
  });

  it('sends the announcement once per address and never repeats it', async () => {
    const first = await jsonOf<{ sent: number; failed: number; remaining: number }>(await announce(admin, message));
    expect(first).toMatchObject({ sent: 2, failed: 0, remaining: 0 });
    expect(sent().map(mail => mail.to[0]).sort()).toEqual(['one@example.com', 'two@example.com']);
    expect(sent()[0].subject).toBe('Jentera is open');
    expect(sent()[0].text).toContain('We are open for business.');

    const second = await jsonOf<{ sent: number }>(await announce(admin, message));
    expect(second.sent).toBe(0);
    expect(sent()).toHaveLength(2);
    expect(await asOwner(sql => sql`select email from waitlist_notice where notice_key='launch-week'`)).toHaveLength(2);
  });

  it('carries an unsubscribe header so marketing mail cannot damage the sign-in domain', async () => {
    await announce(admin, message);
    expect(sent()[0].headers?.['List-Unsubscribe']).toContain('mailto:');
  });

  it('points replies at an inbox that receives, since the sending domain has no MX', async () => {
    await announce(admin, message, { WAITLIST_UNSUBSCRIBE_TO: 'inbox@example.com' });
    expect(sent()[0].reply_to).toBe('inbox@example.com');
    expect(sent()[0].headers?.['List-Unsubscribe']).toBe('<mailto:inbox@example.com?subject=unsubscribe>');
  });

  it('keeps a refused address unmarked so the next run reaches it', async () => {
    fetchMock.mockImplementation(async (_input, init) =>
      String(init?.body).includes('two@example.com')
        ? new Response('rejected', { status: 422 })
        : new Response(JSON.stringify({ id: 'resend-id' }), { status: 200 }));
    const first = await jsonOf<{ sent: number; failed: number }>(await announce(admin, message));
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    expect(await asOwner(sql => sql`select email from waitlist_notice`)).toEqual([{ email: 'one@example.com' }]);

    fetchMock.mockImplementation(() => new Response(JSON.stringify({ id: 'resend-id' }), { status: 200 }));
    const second = await jsonOf<{ sent: number }>(await announce(admin, message));
    expect(second.sent).toBe(1);
    expect(sent().at(-1)!.to).toEqual(['two@example.com']);
  });

  it('refuses a message with no key, no subject or no body', async () => {
    for (const bad of [{ ...message, key: 'Launch Week!' }, { ...message, subject: '' }, { ...message, text: '' }]) {
      expect((await announce(admin, bad)).status).toBe(400);
    }
    expect(sent()).toHaveLength(0);
  });

  it('sends nothing when the mailer is unconfigured', async () => {
    const res = await announce(admin, message, { RESEND_API_KEY: '' });
    expect(res.status).toBe(503);
    expect(sent()).toHaveLength(0);
    expect(await asOwner(sql => sql`select email from waitlist_notice`)).toHaveLength(0);
  });
});
