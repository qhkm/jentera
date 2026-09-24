import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppsError, RemoteAppsApi } from '../api';

const ID = '11111111-1111-4111-8111-111111111111';
const BOOKING = {
  id: ID, reference: 'K7Q2MP', serviceId: '22222222-2222-4222-8222-222222222222', serviceName: 'Cupping class',
  startsAt: '2026-10-06T02:00:00.000Z', endsAt: '2026-10-06T03:00:00.000Z', partySize: 2, customerName: 'Aisyah',
  customerPhone: '60123456789', note: null, status: 'confirmed', expired: false, decidedAt: '2026-10-05T00:00:00.000Z',
  cancelledAt: null, calendar: { status: 'pending', error: null, reason: null, canRetry: false, account: null },
  whatsappUrl: 'https://wa.me/60123456789?text=Hi', createdAt: '2026-10-04T00:00:00.000Z',
};

function answer(status: number, body: unknown) {
  const fake = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fake);
  return fake;
}
afterEach(() => vi.unstubAllGlobals());

describe('RemoteAppsApi', () => {
  it('lists installed and available apps', async () => {
    answer(200, { ok: true, apps: [{ key: 'bookings', state: 'active', accepting: false, publicUrl: 'https://s.test/b/seido', pending: 2 }], available: ['bookings'] });
    expect(await new RemoteAppsApi().list()).toEqual({
      apps: [{ key: 'bookings', state: 'active', accepting: false, publicUrl: 'https://s.test/b/seido', pending: 2 }], available: ['bookings'],
    });
  });

  it('reads a list from a Worker that does not say whether bookings are taken as taking them', async () => {
    answer(200, { ok: true, apps: [{ key: 'bookings', state: 'active', publicUrl: 'https://s.test/b/seido', pending: 0 }], available: ['bookings'] });
    expect((await new RemoteAppsApi().list()).apps[0].accepting).toBe(true);
  });

  it('skips an app or a state it does not know yet, keeping the rest of the list', async () => {
    answer(200, { ok: true, apps: [
      { key: 'invoices', state: 'active', accepting: true, publicUrl: 'https://s.test/i/x', pending: 0 },
      { key: 'bookings', state: 'suspended', accepting: true, publicUrl: 'https://s.test/b/y', pending: 0 },
      { key: 'bookings', state: 'active', accepting: true, publicUrl: 'https://s.test/b/seido', pending: 1 },
    ], available: ['bookings', 'invoices'] });
    expect(await new RemoteAppsApi().list()).toEqual({
      apps: [{ key: 'bookings', state: 'active', accepting: true, publicUrl: 'https://s.test/b/seido', pending: 1 }],
      available: ['bookings'],
    });
  });

  it('rejects an installed app that is not what the Worker promises', async () => {
    answer(200, { ok: true, apps: [{ key: 'bookings', state: 'active', accepting: 'no', publicUrl: 'https://s.test/b/seido', pending: 0 }], available: ['bookings'] });
    await expect(new RemoteAppsApi().list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('asks for a window of bookings with the filters in the query', async () => {
    const fake = answer(200, { ok: true, bookings: [BOOKING], nextCursor: 'next' });
    const page = await new RemoteAppsApi().bookings({ from: '2026-10-06', days: 31, status: 'pending', cursor: 'abc' });
    expect(page).toEqual({ bookings: [BOOKING], nextCursor: 'next' });
    const url = new URL(String(fake.mock.calls[0][0]), 'https://x.test');
    expect(url.pathname).toBe('/api/apps/bookings/bookings');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-10-06', days: '31', limit: '50', status: 'pending', cursor: 'abc' });
    expect(fake.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('decides with a JSON body and says whether Calendar work was queued', async () => {
    const fake = answer(200, { ok: true, booking: BOOKING, whatsappUrl: BOOKING.whatsappUrl, calendarQueued: true });
    const result = await new RemoteAppsApi().decide(ID, 'confirm');
    expect(result).toEqual({ booking: BOOKING, whatsappUrl: BOOKING.whatsappUrl, calendarQueued: true });
    expect(String(fake.mock.calls[0][0])).toContain(`/api/apps/bookings/bookings/${ID}/decide`);
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"decision":"confirm"}' });
  });

  it('keeps the Worker code of a refusal', async () => {
    answer(409, { ok: false, code: 'ALREADY_DECIDED' });
    await expect(new RemoteAppsApi().decide(ID, 'decline'))
      .rejects.toMatchObject({ name: 'AppsError', code: 'ALREADY_DECIDED', status: 409, uncertain: false });
  });

  it('carries the service a config refusal is about', async () => {
    answer(409, { ok: false, code: 'CAPACITY_BELOW_RESERVED', serviceId: 's-1' });
    await expect(new RemoteAppsApi().saveBookingsConfig({
      version: 3, slug: 'seido', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
      acknowledgeAvailabilityLimits: true, services: [],
    })).rejects.toMatchObject({ code: 'CAPACITY_BELOW_RESERVED', serviceId: 's-1' });
  });

  it('marks a write that got no answer as uncertain, and a read as certain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(new RemoteAppsApi().cancel(ID)).rejects.toMatchObject({ code: 'NETWORK', uncertain: true });
    await expect(new RemoteAppsApi().list()).rejects.toMatchObject({ code: 'NETWORK', uncertain: false });
  });

  it('marks a successful write whose answer cannot be read as uncertain: it may have happened', async () => {
    const garbled = () => vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":tr', { status: 200 })));
    garbled();
    await expect(new RemoteAppsApi().saveBookingsConfig({
      version: 3, slug: 'seido', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
      acknowledgeAvailabilityLimits: true, services: [],
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, uncertain: true });
    await expect(new RemoteAppsApi().decide(ID, 'confirm')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', uncertain: true });
    await expect(new RemoteAppsApi().list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', uncertain: false });
    // A refusal that says so is still a refusal, whatever its status.
    answer(200, { ok: false, code: 'CONFIG_CHANGED' });
    await expect(new RemoteAppsApi().decide(ID, 'confirm')).rejects.toMatchObject({ code: 'CONFIG_CHANGED', uncertain: false });
  });

  it('refuses a malformed id without calling the server', async () => {
    const fake = answer(200, { ok: true });
    await expect(new RemoteAppsApi().booking('not-an-id')).rejects.toBeInstanceOf(AppsError);
    expect(fake).not.toHaveBeenCalled();
  });

  it('rejects a booking that is not what the Worker promises', async () => {
    answer(200, { ok: true, booking: { ...BOOKING, whatsappUrl: 'https://evil.test/' } });
    await expect(new RemoteAppsApi().booking(ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
