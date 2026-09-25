import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppsProvider, useApps, useHomeApps } from '../useApps';
import { bookingFixture, fakeAppsApi } from './fixtures';
import type { BookingsQuery } from '../types';

function Probe() {
  const apps = useApps();
  const home = useHomeApps();
  return <output>{JSON.stringify({ enabled: apps.enabled, apps: apps.list?.apps.length ?? null, pending: apps.pending?.length ?? null, home: home?.length ?? null })}</output>;
}

describe('AppsProvider', () => {
  it('stays off and silent without an API', () => {
    render(<AppsProvider api={null}><Probe /></AppsProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('{"enabled":false,"apps":null,"pending":null,"home":null}');
  });

  it('loads installed apps and pending requests, and refreshes when the app returns to the foreground', async () => {
    const api = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending: 1 }], available: ['bookings' as const] })),
      bookings: vi.fn(async ({ from }: BookingsQuery) => ({ bookings: from ? [bookingFixture({ startsAt: new Date(Date.now() + 86_400_000).toISOString() })] : [], nextCursor: null })),
    });
    render(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":1');
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('skips the waiting-request scan when the apps list already says none are waiting', async () => {
    const api = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
    });
    render(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"pending":0');
    expect(api.bookings).not.toHaveBeenCalled();
  });

  it('refreshes once each time the unread alerts count rises, and not while it is unknown or falls', async () => {
    const api = fakeAppsApi();
    const view = (unread: number | null) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { rerender } = render(view(null));
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
    render(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":null');
    expect(api.bookings).not.toHaveBeenCalled();
  });
});
