import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { sendMagicLink, sendNotice } from '../src/email';

const address = 'private-owner@example.com';
const link = 'https://jentera.ai/api/auth/consume?token=fictional-private-token';
const env = { RESEND_API_KEY: 'fictional-provider-credential' } as Env;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function logs() {
  return JSON.stringify([vi.mocked(console.log).mock.calls,
    vi.mocked(console.warn).mock.calls, vi.mocked(console.error).mock.calls]);
}

describe('email diagnostics keep private material out of logs', () => {
  it('never logs an authentication link or address when delivery is not configured', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await sendMagicLink({} as Env, address, link);
    expect(fetch).not.toHaveBeenCalled();
    expect(logs()).toContain('provider not configured');
    expect(logs()).not.toContain(address);
    expect(logs()).not.toContain(link);
    expect(logs()).not.toContain('fictional-private-token');
  });
  it('never logs a notice recipient, subject or body when delivery is not configured', async () => {
    expect(await sendNotice({} as Env, address, 'Private subject', 'Private notice')).toBe(false);
    expect(logs()).not.toMatch(/private-owner|Private subject|Private notice/);
  });
  it.each(['authentication', 'notice'] as const)('logs only status for refused %s delivery', async kind => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${address} ${link} ${env.RESEND_API_KEY} Private provider error`, { status: 403 })));
    if (kind === 'authentication') await sendMagicLink(env, address, link);
    else expect(await sendNotice(env, address, 'Private subject', 'Private notice')).toBe(false);
    expect(logs()).toContain('status=403');
    expect(logs()).not.toMatch(/private-owner|fictional-private-token|fictional-provider-credential|Private/);
  });
  it('keeps unsubscribe and reply-to headers in the email without logging them', async () => {
    const fetch = vi.fn(async (_input: unknown, _init?: RequestInit) => Response.json({ id: 'fictional-email' }));
    vi.stubGlobal('fetch', fetch);
    const headers = { 'List-Unsubscribe': '<mailto:hello@jentera.ai?subject=unsubscribe>' };
    expect(await sendNotice(env, address, 'Launch update', 'Your update', headers, 'hello@jentera.ai')).toBe(true);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      to: [address], headers, reply_to: 'hello@jentera.ai',
    });
    expect(logs()).toBe('[[],[],[]]');
  });
});
