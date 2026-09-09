import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteRoutinesApi, RoutineError } from '../api';
import { validSchedule } from '../types';
import { routineDate, occurrenceStatus } from '../format';
import { ROUTINE_ID, RUN_ID, historyFixture, listFixture, occurrenceFixture, routineFixture } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('Routines v1 client', () => {
  it('reads credentialed, uncached data and never calls a demo scheduler', async () => {
    const fetch = vi.fn().mockResolvedValue(json(listFixture()));
    vi.stubGlobal('fetch', fetch);
    expect(await new RemoteRoutinesApi().list()).toEqual(listFixture());
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/routines$/);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include', cache: 'no-store' });
  });

  it('uses POST-only mutations and preserves the request body on retry', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(json({ ok: true, apiVersion: 1, occurrence: occurrenceFixture() }, 202));
    vi.stubGlobal('fetch', fetch);
    const api = new RemoteRoutinesApi();
    const action = { kind: 'run' as const, id: ROUTINE_ID, body: { requestId: crypto.randomUUID(), expectedRevision: 1 } };
    await expect(api.execute(action)).rejects.toMatchObject({ uncertain: true });
    expect(await api.execute(action)).toEqual({ occurrence: occurrenceFixture() });
    expect(fetch.mock.calls[0][1]).toEqual(fetch.mock.calls[1][1]);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
  });

  it.each([401, 403, 404, 409, 429, 503])('keeps HTTP %s refusals distinct from empty/unsupported data', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ err: 'guard refusal', code: 'RUN_ALREADY_ACTIVE', runId: RUN_ID }, status, { 'Retry-After': '7' })));
    await expect(new RemoteRoutinesApi().execute({ kind: 'run', id: ROUTINE_ID, body: { requestId: crypto.randomUUID(), expectedRevision: 1 } }))
      .rejects.toMatchObject({ status, code: 'RUN_ALREADY_ACTIVE', runId: RUN_ID, retryAfter: 7, uncertain: status >= 500 });
  });

  it.each([{}, { ...listFixture(), apiVersion: 2 }, { ...listFixture(), capabilities: {} }, { ...listFixture(), routines: [routineFixture({ nextRunAt: 'bad' })] }])('rejects malformed list data', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(payload)));
    await expect(new RemoteRoutinesApi().list()).rejects.toBeInstanceOf(RoutineError);
  });

  it('keeps malformed successful writes uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, apiVersion: 1 })));
    await expect(new RemoteRoutinesApi().execute({ kind: 'run', id: ROUTINE_ID, body: { requestId: crypto.randomUUID(), expectedRevision: 1 } })).rejects.toMatchObject({ uncertain: true });
  });

  it('validates IDs before fetching and rejects mismatched tenant record responses', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ ok: true, apiVersion: 1, routine: routineFixture({ id: RUN_ID }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(new RemoteRoutinesApi().read('../wrong')).rejects.toMatchObject({ status: 404 });
    expect(fetch).not.toHaveBeenCalled();
    await expect(new RemoteRoutinesApi().read(ROUTINE_ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('encodes pagination cursors and preserves skipped/unknown status honestly', async () => {
    const fetch = vi.fn().mockResolvedValue(json(historyFixture([
      occurrenceFixture({ status: 'skipped', runId: null, reason: 'nothing_pending' }),
      occurrenceFixture({ id: RUN_ID, status: 'future_status' }),
    ])));
    vi.stubGlobal('fetch', fetch);
    const page = await new RemoteRoutinesApi().occurrences(ROUTINE_ID, 'opaque+&?/');
    expect(new URL(fetch.mock.calls[0][0], 'https://example.test').searchParams.get('cursor')).toBe('opaque+&?/');
    expect(page.occurrences[0].runId).toBeNull();
    expect(occurrenceStatus(page.occurrences[1].status)).toBe('routines.status.unknown');
  });
});

describe('wall-clock schedules', () => {
  it('formats server instants in Malaysia, independent of the browser zone', () => {
    expect(routineDate('2026-09-08T17:00:00.000Z', 'en')).toMatch(/9 Sept 2026.*1:00 am/);
  });
  it.each(['00:00', '23:59', '08:00'])('allows %s', (time) => {
    expect(validSchedule({ time, timeZone: 'Asia/Kuala_Lumpur', frequency: 'daily' })).toBe(true);
  });
  it.each(['24:00', '8:00', '08:60', '', '08:00:00'])('rejects %s', (time) => {
    expect(validSchedule({ time, timeZone: 'Asia/Kuala_Lumpur', frequency: 'daily' })).toBe(false);
  });
  it('requires an ISO weekday only for a weekly schedule', () => {
    expect(validSchedule({ time: '08:00', timeZone: 'Asia/Kuala_Lumpur', frequency: 'weekly', weekday: 7 })).toBe(true);
    expect(validSchedule({ time: '08:00', timeZone: 'Asia/Kuala_Lumpur', frequency: 'weekly', weekday: 0 })).toBe(false);
    expect(validSchedule({ time: '08:00', timeZone: 'Asia/Kuala_Lumpur', frequency: 'daily', weekday: 1 } as never)).toBe(false);
  });
});
