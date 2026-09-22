import { beforeEach, describe, expect, it } from 'vitest';
import { handleRepo } from '../src/routes/repo';
import { botPreference } from '../src/specialists';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let users: Record<string, string>;
let cookies: Record<string, string>;
const definition = { name: 'Invoice buddy', description: 'Review invoices', instructions: 'Ask before sending', avatar: 'cat' };

beforeEach(async () => {
  await truncateAll();
  users = await asOwner(async sql => {
    await sql`insert into business (id, name, playbook_key, plan) values (${A}, 'Alpha', 'restaurant', 'team'), (${B}, 'Beta', 'restaurant', 'team')`;
    const rows = await sql`insert into app_user (email, email_verified) values ('owner@example.com', true), ('staff@example.com', true), ('other@example.com', true) returning id, email`;
    const ids = Object.fromEntries(rows.map(r => [r.email.split('@')[0], String(r.id)]));
    await sql`insert into membership (business_id, user_id, role) values (${A}, ${ids.owner}, 'owner'), (${A}, ${ids.staff}, 'staff'), (${B}, ${ids.other}, 'owner')`;
    return ids;
  });
  cookies = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([key, id]) => [key, await signIn(id)])));
});

async function call(user: string, path: string, body?: unknown) {
  const incoming = req(body === undefined ? 'GET' : 'POST', path, { cookie: cookies[user], body });
  const response = await handleRepo(incoming.request, testEnv(), incoming.url, {});
  if (!response) throw new Error('No route');
  return response;
}
async function create(user = 'owner') {
  const response = await call(user, '/api/state/specialists', definition);
  expect(response.status).toBe(200);
  return (await response.json() as { specialist: { id: string; profile: string; avatar: string } }).specialist;
}
const preference = (profile: string, avatar = 'wing') => ({ defaultBotProfile: profile, coordinatorAvatar: avatar });

describe('bot profiles and personal defaults', () => {
  it('saves avatars, preserves them for older clients, and exposes them in the snapshot', async () => {
    const bot = await create(); expect(bot.avatar).toBe('cat');
    expect((await call('owner', `/api/state/specialists/${bot.id}`, { ...definition, avatar: 'operator' })).status).toBe(204);
    const { avatar: _avatar, ...oldClient } = definition;
    expect((await call('owner', `/api/state/specialists/${bot.id}`, oldClient)).status).toBe(204);
    const snapshot = (await (await call('owner', '/api/state')).json() as { snapshot: { specialists: { avatar: string }[]; canManageBots: boolean } }).snapshot;
    expect(snapshot.specialists[0].avatar).toBe('operator'); expect(snapshot.canManageBots).toBe(true);
  });

  it('keeps preferences separate for staff and owner in the same business', async () => {
    const bot = await create();
    expect((await call('staff', '/api/state/bot-preference', preference(bot.profile))).status).toBe(204);
    expect(await asTenant(A, tx => botPreference(tx, users.staff))).toEqual(preference(bot.profile));
    expect(await asTenant(A, tx => botPreference(tx, users.owner))).toEqual(preference('default', 'original'));
    expect((await call('owner', '/api/state/bot-preference', preference('default', 'cube'))).status).toBe(204);
    expect(await asTenant(A, tx => botPreference(tx, users.staff))).toEqual(preference(bot.profile));
  });

  it('enforces owner management, allowed avatars and tenant boundaries', async () => {
    const bot = await create();
    expect((await call('staff', '/api/state/specialists', definition)).status).toBe(403);
    expect((await call('staff', `/api/state/specialists/${bot.id}`, definition)).status).toBe(403);
    expect((await call('owner', '/api/state/specialists', { ...definition, avatar: 'https://untrusted/image' })).status).toBe(400);
    expect((await call('owner', '/api/state/bot-preference', preference('default', 'invalid'))).status).toBe(400);
    expect((await call('other', '/api/state/bot-preference', preference(bot.profile))).status).toBe(400);
    expect((await call('other', `/api/state/specialists/${bot.id}`, { disable: true })).status).toBe(404);
    await call('owner', '/api/state/bot-preference', preference(bot.profile));
    expect(await asTenant(B, tx => tx`select * from bot_preference`)).toHaveLength(0);
  });

  it('resets defaults when a bot is disabled and rejects choosing it again', async () => {
    const bot = await create();
    await call('owner', '/api/state/bot-preference', preference(bot.profile, 'cat'));
    await call('staff', '/api/state/bot-preference', preference(bot.profile));
    expect((await call('owner', `/api/state/specialists/${bot.id}`, { disable: true })).status).toBe(204);
    expect(await asTenant(A, tx => botPreference(tx, users.owner))).toEqual(preference('default', 'cat'));
    expect(await asTenant(A, tx => botPreference(tx, users.staff))).toEqual(preference('default'));
    expect((await call('staff', '/api/state/bot-preference', preference(bot.profile))).status).toBe(400);
  });
});
