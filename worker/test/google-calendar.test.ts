import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import {
  GOOGLE_CALENDAR_SCOPES,
  calendarSecret,
  createGoogleCalendarEvent,
  exchangeGoogleCalendarCode,
  googleCalendarAuthorizeUrl,
  listGoogleCalendarEvents,
  normaliseCalendarEvent,
  normaliseCalendarRange,
} from '../src/connectors/google-calendar';

const env = {
  API_ORIGIN: 'https://api.jentera.ai',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
} as Env;

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

const profile = {
  subject: 'account-1',
  email: 'owner@example.com',
  name: 'Owner',
  refreshToken: 'refresh-secret',
  scopes: [...GOOGLE_CALENDAR_SCOPES],
};

describe('Google Calendar OAuth', () => {
  it('asks for offline Calendar-only access with PKCE', () => {
    const url = new URL(googleCalendarAuthorizeUrl(env, { state: 'state', codeChallenge: 'challenge' }));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...GOOGLE_CALENDAR_SCOPES]);
    expect(url.searchParams.get('scope')).not.toContain('gmail');
    expect(url.searchParams.get('scope')).not.toContain('drive');
  });

  it('keeps the refresh token in the encrypted-secret payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id_token: jwt({
        aud: 'google-client',
        sub: 'account-1',
        email: 'OWNER@example.com',
        email_verified: true,
        name: 'Owner',
      }),
      refresh_token: 'refresh-secret',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    })));
    const exchanged = await exchangeGoogleCalendarCode(env, 'code', 'verifier', fetcher);
    expect(exchanged).toEqual(profile);
    expect(JSON.parse(calendarSecret(exchanged!))).toMatchObject({
      v: 1,
      refreshToken: 'refresh-secret',
    });
  });
});

describe('Google Calendar operations', () => {
  it('validates event duration, timezone, and RFC3339 offsets', () => {
    expect(normaliseCalendarEvent({
      requestId: 'request_123',
      summary: 'Supplier call',
      start: '2026-09-17T10:00:00+08:00',
      end: '2026-09-17T10:30:00+08:00',
      timeZone: 'Asia/Kuala_Lumpur',
    })).toMatchObject({ summary: 'Supplier call' });
    expect(() => normaliseCalendarEvent({
      requestId: 'request_123', summary: 'Bad', start: '2026-09-17T10:00:00',
      end: '2026-09-17T10:30:00', timeZone: 'Asia/Kuala_Lumpur',
    })).toThrow(/UTC offset/);
    expect(() => normaliseCalendarRange(new URL(
      'https://api.test/events?timeMin=2026-09-01T00%3A00%3A00Z&timeMax=2026-11-01T00%3A00%3A00Z',
    ))).toThrow(/31 days/);
  });

  it('refreshes server-side and returns a bounded event projection', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-secret' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        id: 'event-1', summary: 'Private title', status: 'confirmed',
        start: { dateTime: '2026-09-17T10:00:00+08:00' },
        end: { dateTime: '2026-09-17T10:30:00+08:00' },
      }] })));
    const events = await listGoogleCalendarEvents(env, calendarSecret(profile), {
      timeMin: '2026-09-17T00:00:00+08:00',
      timeMax: '2026-09-18T00:00:00+08:00',
    }, fetcher);
    expect(events).toEqual([expect.objectContaining({ id: 'event-1', summary: 'Private title' })]);
    expect(String(fetcher.mock.calls[1][0])).toContain('maxResults=50');
    expect((fetcher.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe('Bearer access-secret');
  });

  it('uses a stable provider event id when an approved creation is retried', async () => {
    const ids: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (String(_url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'access-secret' }));
      }
      if (init?.method === 'POST') {
        ids.push((JSON.parse(String(init.body)) as { id: string }).id);
        if (ids.length === 2) return new Response(null, { status: 409 });
      }
      return new Response(JSON.stringify({
        id: ids.at(-1) ?? ids[0], summary: 'Supplier call', status: 'confirmed',
        start: { dateTime: '2026-09-17T10:00:00+08:00' },
        end: { dateTime: '2026-09-17T10:30:00+08:00' },
      }));
    });
    const event = normaliseCalendarEvent({
      requestId: 'request_123', summary: 'Supplier call',
      start: '2026-09-17T10:00:00+08:00', end: '2026-09-17T10:30:00+08:00',
      timeZone: 'Asia/Kuala_Lumpur',
    });
    await createGoogleCalendarEvent(env, calendarSecret(profile), event, fetcher);
    const retried = await createGoogleCalendarEvent(env, calendarSecret(profile), event, fetcher);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^jentera[a-f0-9]+$/);
    expect(retried.id).toBe(ids[0]);
  });
});
