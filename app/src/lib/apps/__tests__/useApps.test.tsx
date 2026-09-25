import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppsProvider, useApps, useHomeApps } from '../useApps';
import { bookingFixture, fakeAppsApi } from './fixtures';
import { keys } from '@/lib/query/keys';
import { renderWithQuery, returnToApp, TEST_BUSINESS_ID } from '@/test-support/query';
import type { AppsApi, AppsList, BookingsQuery } from '../types';

function Probe() {
  const apps = useApps();
  const home = useHomeApps();
  return <output>{JSON.stringify({ enabled: apps.enabled, apps: apps.list?.apps.length ?? null, pending: apps.pending?.length ?? null, home: home?.length ?? null })}</output>;
}
const bookingsApp = (pending: number) => ({ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending });
const installed = (pending: number) => vi.fn(async (): Promise<AppsList> => ({ apps: [bookingsApp(pending)], available: ['bookings'] }));
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

afterEach(() => { vi.useRealTimers(); });

describe('AppsProvider', () => {
  it('stays off and silent without an API', () => {
    render(<AppsProvider api={null}><Probe /></AppsProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('{"enabled":false,"apps":null,"pending":null,"home":null}');
  });

  it('stays off without a signed-in business to key the cache by', async () => {
    const api = fakeAppsApi({ list: installed(1) });
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>, { businessId: null });
    expect(screen.getByRole('status')).toHaveTextContent('"enabled":false');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('loads installed apps and pending requests, and reads them again when the owner returns after 30 s', async () => {
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async ({ from }: BookingsQuery) => ({ bookings: from ? [bookingFixture({ startsAt: tomorrow() })] : [], nextCursor: null })),
    });
    const { client } = await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":1');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"pending":1'));
    expect(api.list).toHaveBeenCalledTimes(1);
    await returnToApp(client);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('skips the waiting-request scan when the apps list already says none are waiting', async () => {
    const api = fakeAppsApi({ list: installed(0) });
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"pending":0');
    expect(api.bookings).not.toHaveBeenCalled();
  });

  it('refreshes once each time the unread alerts count rises, and not while it is unknown or falls', async () => {
    const api = fakeAppsApi();
    const view = (unread: number | null) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { rerender } = await renderWithQuery(view(null));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    // The first known count is what the mount-time load already covered.
    await act(async () => { rerender(view(2)); });
    await act(async () => { rerender(view(2)); });
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => { rerender(view(3)); });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    // A poll in flight reads as unknown; the same count after it is no rise.
    await act(async () => { rerender(view(null)); });
    await act(async () => { rerender(view(3)); });
    await act(async () => { rerender(view(1)); });
    expect(api.list).toHaveBeenCalledTimes(2);
    await act(async () => { rerender(view(2)); });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  });

  it('keeps today\'s Home when nothing is installed', async () => {
    const api = fakeAppsApi();
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":null');
    expect(api.bookings).not.toHaveBeenCalled();
  });

  it('shows the apps again on a revisit inside 30 s without asking the server', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    const api = fakeAppsApi({ list: installed(0) });
    const first = await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    first.unmount();
    vi.setSystemTime(new Date('2026-10-05T00:00:29Z'));
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>, { client: first.client });
    expect(screen.getByRole('status')).toHaveTextContent('"apps":1');
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('shows cached apps at once after 30 s, while one background request refreshes them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    let answer!: (list: AppsList) => void;
    const list = vi.fn<AppsApi['list']>()
      .mockResolvedValueOnce({ apps: [bookingsApp(0)], available: ['bookings'] })
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const api = fakeAppsApi({ list });
    const first = await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    first.unmount();
    vi.setSystemTime(new Date('2026-10-05T00:00:31Z'));
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>, { client: first.client });
    // The cached list is on screen while the refresh is still in flight.
    expect(screen.getByRole('status')).toHaveTextContent('"apps":1');
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { answer({ apps: [], available: ['bookings'] }); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('never draws one business\'s apps under another', async () => {
    const a = fakeAppsApi({ list: installed(2) });
    const first = await renderWithQuery(<AppsProvider api={a}><Probe /></AppsProvider>, { businessId: 'biz-a' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    first.unmount();
    let answer!: (list: AppsList) => void;
    const b = fakeAppsApi({ list: vi.fn<AppsApi['list']>(() => new Promise((resolve) => { answer = resolve; })) });
    await renderWithQuery(<AppsProvider api={b}><Probe /></AppsProvider>, { client: first.client, businessId: 'biz-b' });
    // Business B has nothing yet, not business A's list.
    expect(screen.getByRole('status')).toHaveTextContent('"apps":null');
    await act(async () => { answer({ apps: [], available: ['bookings'] }); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
  });

  it('stops counting requests once the list says none wait, whatever an earlier scan left cached', async () => {
    let waiting = 1;
    const api = fakeAppsApi({
      list: vi.fn(async (): Promise<AppsList> => ({ apps: [bookingsApp(waiting)], available: ['bookings'] })),
      bookings: vi.fn(async () => ({ bookings: [bookingFixture({ startsAt: tomorrow() })], nextCursor: null })),
    });
    const view = (unread: number) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { client, rerender } = await renderWithQuery(view(0));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"pending":1'));
    // Decided elsewhere; a new alert makes the provider read the list again.
    waiting = 0;
    await act(async () => { rerender(view(1)); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"pending":0'));
    expect(client.getQueryData(keys.pendingBookings(TEST_BUSINESS_ID))).toHaveLength(1);
    expect(api.bookings).toHaveBeenCalledTimes(1);
  });

  it('marks every cached Bookings window stale on a refresh, so a decision made on Home shows there', async () => {
    const api = fakeAppsApi({ list: installed(0) });
    const view = (unread: number) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { client, rerender } = await renderWithQuery(view(0));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    client.setQueryData(keys.bookingWindow(TEST_BUSINESS_ID, '2026-10-05', 1), [bookingFixture()]);
    await act(async () => { rerender(view(1)); });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(keys.bookingWindow(TEST_BUSINESS_ID, '2026-10-05', 1))?.isInvalidated).toBe(true);
  });
});
