import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleCalendarError,
  calendarEventId,
  calendarSecret,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  exchangeGoogleCalendarCode,
  googleCalendarAuthorizeUrl,
  listGoogleCalendarBusy,
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

  it('reads only busy ranges, follows pages, and ignores transparent and Jentera events', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-secret' }))
      .mockResolvedValueOnce(Response.json({
        nextPageToken: 'next',
        items: [
          { id: 'external-1', status: 'confirmed', start: { dateTime: '2026-09-17T10:00:00+08:00' }, end: { dateTime: '2026-09-17T10:30:00+08:00' } },
          { id: 'transparent', transparency: 'transparent', start: { dateTime: '2026-09-17T11:00:00+08:00' }, end: { dateTime: '2026-09-17T12:00:00+08:00' } },
          { id: 'jentera1234', start: { dateTime: '2026-09-17T12:00:00+08:00' }, end: { dateTime: '2026-09-17T13:00:00+08:00' } },
        ],
      }))
      .mockResolvedValueOnce(Response.json({
        items: [{ id: 'all-day', start: { date: '2026-09-18' }, end: { date: '2026-09-19' } }],
      }));
    const ranges = await listGoogleCalendarBusy(env, calendarSecret(profile), {
      timeMin: '2026-09-17T00:00:00+08:00',
      timeMax: '2026-09-20T00:00:00+08:00',
    }, fetcher);
    expect(ranges.map((range) => ({
      eventKey: range.eventKey,
      startsAt: range.startsAt.toISOString(),
      endsAt: range.endsAt.toISOString(),
    }))).toEqual([
      { eventKey: 'external-1', startsAt: '2026-09-17T02:00:00.000Z', endsAt: '2026-09-17T02:30:00.000Z' },
      { eventKey: 'all-day', startsAt: '2026-09-17T16:00:00.000Z', endsAt: '2026-09-18T16:00:00.000Z' },
    ]);
    const first = new URL(String(fetcher.mock.calls[1][0]));
    expect(first.searchParams.get('fields')).toBe('nextPageToken,items(id,status,transparency,start(date,dateTime),end(date,dateTime))');
    expect(first.searchParams.has('q')).toBe(false);
    expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('pageToken')).toBe('next');
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

describe('Google Calendar budget and removal', () => {
  const secret = calendarSecret(profile);
  const event = {
    requestId: '0f4c9b7e-1111-4111-8111-111111111111',
    summary: 'Cupping class · Aisyah (2)',
    start: '2026-10-06T10:00:00+08:00',
    end: '2026-10-06T11:00:00+08:00',
    timeZone: 'Asia/Kuala_Lumpur',
  };

  function google(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access' });
      return answer(url, init);
    });
    return { fetcher, calls };
  }

  it('addresses one event per request id, for create and delete alike', async () => {
    const { fetcher, calls } = google(() => Response.json({ id: calendarEventId(event.requestId), status: 'confirmed' }));
    await createGoogleCalendarEvent(env, secret, event, fetcher);
    expect(JSON.parse(String(calls[1].init?.body)).id).toBe(calendarEventId(event.requestId));
    expect(calendarEventId(event.requestId)).toMatch(/^jentera[0-9a-f]+$/);
  });

  it('passes one budget signal to the token refresh, the create and the read-back', async () => {
    const { fetcher, calls } = google((url, init) => (init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : Response.json({ id: calendarEventId(event.requestId), status: 'confirmed' })));
    const signal = AbortSignal.timeout(5_000);
    await createGoogleCalendarEvent(env, secret, event, fetcher, signal);
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.init?.signal).toBe(signal);
  });

  it('gives up when the budget runs out instead of waiting on Google', async () => {
    const { fetcher } = google((_url, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    await expect(createGoogleCalendarEvent(env, secret, event, fetcher, AbortSignal.timeout(20))).rejects.toThrow();
  });

  it('reports a read-back of a deleted event as cancelled, for the caller to refuse', async () => {
    const { fetcher } = google((_url, init) => (init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : Response.json({ id: calendarEventId(event.requestId), status: 'cancelled' })));
    expect((await createGoogleCalendarEvent(env, secret, event, fetcher)).status).toBe('cancelled');
  });

  it('removes the event, and treats an event that is already gone as removed', async () => {
    const removed = google(() => new Response(null, { status: 204 }));
    expect(await deleteGoogleCalendarEvent(env, secret, event.requestId, removed.fetcher)).toBe('deleted');
    expect(removed.calls[1].url).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId(event.requestId)}?sendUpdates=none`);
    expect(removed.calls[1].init?.method).toBe('DELETE');
    for (const status of [404, 410]) {
      const gone = google(() => new Response('{}', { status }));
      expect(await deleteGoogleCalendarEvent(env, secret, event.requestId, gone.fetcher)).toBe('already_absent');
    }
  });

  it('reads only a refused grant at the token endpoint as a reconnect', async () => {
    const token = (status: number) => vi.fn<typeof fetch>(async () => new Response('{}', { status }));
    for (const status of [400, 401]) {
      await expect(createGoogleCalendarEvent(env, secret, event, token(status))).rejects.toMatchObject({
        auth: true, message: 'Google Calendar access expired. Reconnect it to continue.',
      });
    }
    // Google down or throttling us is not the owner's grant going bad.
    for (const status of [429, 500, 503]) {
      await expect(createGoogleCalendarEvent(env, secret, event, token(status))).rejects.toMatchObject({
        auth: false, message: 'Google Calendar could not be reached.',
      });
    }
  });

  it('reads a rate-limit 403 as busy and any other 403 as a reconnect', async () => {
    const refused = (reason: string) => google(() => Response.json(
      { error: { code: 403, message: 'secret detail from Google', errors: [{ reason }] } }, { status: 403 }));
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']) {
      const error = await createGoogleCalendarEvent(env, secret, event, refused(reason).fetcher).catch((e: unknown) => e);
      expect(error).toMatchObject({ auth: false, message: 'Google Calendar is busy. Jentera will try again.' });
    }
    const denied = await createGoogleCalendarEvent(env, secret, event, refused('insufficientPermissions').fetcher)
      .catch((e: unknown) => e);
    expect(denied).toMatchObject({ auth: true, message: 'Google Calendar access expired. Reconnect it to continue.' });
    // A body that is not JSON, or carries no reason, is a plain refusal.
    const blank = google(() => new Response('forbidden', { status: 403 }));
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, blank.fetcher)).rejects.toMatchObject({ auth: true });
    // The same reading applies to the read-back after a 409 and to a delete.
    const readBack = google((_url, init) => (init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : Response.json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 403 })));
    await expect(createGoogleCalendarEvent(env, secret, event, readBack.fetcher)).rejects.toMatchObject({ auth: false });
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, refused('quotaExceeded').fetcher))
      .rejects.toMatchObject({ auth: false });
    // Never the provider's own words.
    expect(String((denied as Error).message)).not.toContain('secret detail');
  });

  it('reads a daily quota 403 as busy too', async () => {
    const daily = google(() => Response.json({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } }, { status: 403 }));
    await expect(createGoogleCalendarEvent(env, secret, event, daily.fetcher))
      .rejects.toMatchObject({ auth: false, message: 'Google Calendar is busy. Jentera will try again.' });
  });

  it('turns other delete failures into errors the caller can act on', async () => {
    const broken = google(() => new Response('{}', { status: 500 }));
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, broken.fetcher))
      .rejects.toMatchObject({ auth: false });
    const refused = google(() => new Response('{}', { status: 401 }));
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, refused.fetcher))
      .rejects.toBeInstanceOf(GoogleCalendarError);
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, refused.fetcher))
      .rejects.toMatchObject({ auth: true });
  });
});
