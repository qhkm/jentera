import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import HomeView from '../HomeView';
import { ToastProvider } from '@/components/Toast';
import { ActivityProvider } from '@/hooks/useActivity';
import { useBusiness } from '@/hooks/useBusiness';
import { useConnections } from '@/hooks/useConnections';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { AppsProvider } from '@/lib/apps/useApps';
import { bookingFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import type { AppsApi, BookingsQuery } from '@/lib/apps/types';

const WA = 'https://wa.me/60123456789?text=Hi';
const installed = (pending: number) => vi.fn(async () => ({
  apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending }], available: ['bookings' as const],
}));

function Harness({ onNavigate, onOpenApp }: { onNavigate: (...args: unknown[]) => void; onOpenApp: (app: string) => void }) {
  const b = useBusiness();
  const connections = useConnections();
  return <HomeView b={b} connections={connections} goalsEnabled={false} onNavigate={onNavigate} onOpenApp={onOpenApp} />;
}

async function mount(api: AppsApi | null, options: { activityFails?: boolean } = {}) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = options.activityFails
    ? async () => { throw new Error('activity down'); }
    : async () => ({ counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 }, work: [] });
  const onNavigate = vi.fn();
  const onOpenApp = vi.fn();
  render(<MemoryRouter><SignedInProvider value account="home-apps-test"><RepositoryProvider repository={repo}>
    <I18nProvider><ToastProvider><ActivityProvider><AppsProvider api={api}>
      <Harness onNavigate={onNavigate} onOpenApp={onOpenApp} />
    </AppsProvider></ActivityProvider></ToastProvider></I18nProvider>
  </RepositoryProvider></SignedInProvider></MemoryRouter>);
  return { onNavigate, onOpenApp, user: userEvent.setup() };
}

describe('Home with apps', () => {
  it('keeps today\'s four tiles when apps are off', async () => {
    await mount(null);
    await waitFor(() => expect(document.querySelectorAll('.home-action')).toHaveLength(4));
    expect(document.querySelector('.home-action-alerts')).not.toBeNull();
  });

  it('keeps today\'s four tiles when apps are on but nothing is installed', async () => {
    const api = fakeAppsApi();
    await mount(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(document.querySelectorAll('.home-action')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Add app/ })).toBeNull();
  });

  it('shows installed apps with their count, and Add app, in place of the four tiles', async () => {
    const { onNavigate, onOpenApp, user } = await mount(fakeAppsApi({ list: installed(2) }));
    await user.click(await screen.findByRole('button', { name: /Bookings.*2 waiting/ }));
    expect(onOpenApp).toHaveBeenCalledWith('bookings');
    expect(document.querySelector('.home-action-alerts')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Add app/ }));
    expect(onNavigate).toHaveBeenCalledWith('apps');
  });

  it('lists waiting requests in the daily brief and confirms one there', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => ({ booking: { ...pending, status: 'confirmed' as const, whatsappUrl: WA }, whatsappUrl: WA, calendarQueued: false })),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(api.decide).toHaveBeenCalledWith(pending.id, 'confirm');
    expect(await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
  });

  it('keeps the waiting requests when the rest of the brief fails to load', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
    });
    await mount(api, { activityFails: true });
    expect(await screen.findByRole('button', { name: 'Confirm Aisyah' })).toBeInTheDocument();
  });
});
