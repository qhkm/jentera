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
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 1 }], available: ['bookings' as const] })),
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

  it('keeps today\'s Home when nothing is installed', async () => {
    const api = fakeAppsApi();
    render(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":null');
    expect(api.bookings).not.toHaveBeenCalled();
  });
});
