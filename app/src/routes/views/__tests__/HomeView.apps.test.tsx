import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import HomeView from '../HomeView';
import BookingsList from '../apps/BookingsList';
import { ToastProvider } from '@/components/Toast';
import { ActivityProvider } from '@/hooks/useActivity';
import { useBusiness } from '@/hooks/useBusiness';
import { useConnections } from '@/hooks/useConnections';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { AppsProvider } from '@/lib/apps/useApps';
import { BOOKING_ID, bookingFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import { AppsError } from '@/lib/apps/api';
import type { AppsApi, Booking, BookingsQuery } from '@/lib/apps/types';
import { renderWithQuery } from '@/test-support/query';

const WA = 'https://wa.me/60123456789?text=Hi';
const installed = (pending: number, accepting = true) => vi.fn(async () => ({
  apps: [{ key: 'bookings' as const, state: 'active' as const, accepting, publicUrl: 'https://s.test/b/x', pending }], available: ['bookings' as const],
}));

function Harness({ onNavigate, onOpenApp }: { onNavigate: (...args: unknown[]) => void; onOpenApp: (app: string) => void }) {
  const b = useBusiness();
  const connections = useConnections();
  return <HomeView b={b} connections={connections} goalsEnabled={false} onNavigate={onNavigate} onOpenApp={onOpenApp} />;
}

type Screen = 'notification' | 'home' | 'bookings';

/** Home and the Bookings list in one page, over one cache, as the Dashboard
    swaps them: each screen mounts afresh when the owner moves to it. */
function Screens({ api, onNavigate, onOpenApp }: { api: AppsApi; onNavigate: (...args: unknown[]) => void; onOpenApp: (app: string) => void }) {
  const [shown, setShown] = useState<Screen>('notification');
  return <>
    <button type="button" onClick={() => setShown('home')}>Show Home</button>
    <button type="button" onClick={() => setShown('notification')}>Show the notified booking</button>
    <button type="button" onClick={() => setShown('bookings')}>Show Bookings</button>
    {shown === 'home'
      ? <Harness onNavigate={onNavigate} onOpenApp={onOpenApp} />
      : <BookingsList key={shown} api={api} bookingId={shown === 'notification' ? BOOKING_ID : null} onConnectCalendar={() => {}} />}
  </>;
}

async function mount(api: AppsApi | null, options: { activityFails?: boolean; screens?: boolean } = {}) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = options.activityFails
    ? async () => { throw new Error('activity down'); }
    : async () => ({ counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 }, work: [] });
  const onNavigate = vi.fn();
  const onOpenApp = vi.fn();
  // The repository and the apps list load on microtasks; renderWithQuery flushes them inside act.
  await renderWithQuery(<MemoryRouter><SignedInProvider value account="home-apps-test"><RepositoryProvider repository={repo}>
    <I18nProvider><ToastProvider><ActivityProvider><AppsProvider api={api}>
      {options.screens && api
        ? <Screens api={api} onNavigate={onNavigate} onOpenApp={onOpenApp} />
        : <Harness onNavigate={onNavigate} onOpenApp={onOpenApp} />}
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

  it('says Paused, not live, once the owner has stopped taking bookings', async () => {
    await mount(fakeAppsApi({ list: installed(0, false) }));
    expect(await screen.findByRole('button', { name: /Bookings.*Paused/ })).toBeInTheDocument();
    expect(screen.queryByText('Your booking page is live')).toBeNull();
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
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  /* The brief decides through the same cache as the Bookings list: the
     answer lands in every cached copy of the booking at once. After the
     decision every read of Bookings stays out, so what the owner sees there
     can only come from that write, never from a lucky refetch. */
  it('shows a request confirmed on the brief as Confirmed in Bookings, never with Confirm still on it', async () => {
    let decided = false;
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const confirmed: Booking = { ...pending, status: 'confirmed', whatsappUrl: WA };
    const unanswered = () => new Promise<never>(() => {});
    const api = fakeAppsApi({
      list: vi.fn(async () => ({
        apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending: decided ? 0 : 1 }],
        available: ['bookings' as const],
      })),
      bookings: vi.fn(async (query: BookingsQuery) => {
        if (query.status === 'pending') return { bookings: decided ? [] : [pending], nextCursor: null };
        return decided ? unanswered() : { bookings: [pending], nextCursor: null };
      }),
      booking: vi.fn(async () => (decided ? unanswered() : pending)),
      decide: vi.fn(async () => { decided = true; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { user } = await mount(api, { screens: true });
    // Opened from the notification: the booking's own query is cached, and so is Today.
    const notified = await screen.findByRole('region', { name: 'From your notification' });
    expect(await within(notified).findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    await waitFor(() => expect(api.bookings.mock.calls.filter(([query]) => query.status !== 'pending')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Show Home' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Show the notified booking' }));
    const pinned = within(await screen.findByRole('region', { name: 'From your notification' })).getByRole('article', { name: 'Aisyah' });
    expect(within(pinned).getByText('Confirmed')).toBeInTheDocument();
    expect(within(pinned).queryByText('Needs you')).toBeNull();
    expect(within(pinned).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(pinned).getByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);

    await user.click(screen.getByRole('button', { name: 'Show Bookings' }));
    // Nothing waits any more, so the list opens on Today, from the cache.
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Needs you' })).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(within(card).queryByText('Needs you')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('re-reads a request decided elsewhere and keeps it, as it stands, with its WhatsApp link', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      // Still listed as pending: the line must change because of the re-read, not a lucky refresh.
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => { throw new AppsError('ALREADY_DECIDED', 409); }),
      booking: vi.fn(async () => ({ ...pending, status: 'declined' as const, whatsappUrl: WA })),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(await screen.findByRole('link', { name: /Send decline on WhatsApp/ })).toHaveAttribute('href', WA);
    expect(screen.getByText('Already decided elsewhere. This is the booking as it stands.')).toBeInTheDocument();
    expect(api.booking).toHaveBeenCalledWith(pending.id);
    expect(screen.queryByRole('button', { name: 'Confirm Aisyah' })).toBeNull();
    expect(screen.queryByText(/no longer needs you/)).toBeNull();
    expect(screen.getByRole('button', { name: /See all requests \(0\)/ })).toBeInTheDocument();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('keeps the WhatsApp link when a confirm whose answer was lost turns out to have landed', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => { throw new AppsError('NETWORK', 0, true); }),
      booking: vi.fn(async () => ({ ...pending, status: 'confirmed' as const, whatsappUrl: WA })),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
    expect(screen.getByText('We did not hear back. This is the booking as it stands now.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm Aisyah' })).toBeNull();
    expect(screen.getByRole('button', { name: /See all requests \(0\)/ })).toBeInTheDocument();
  });

  it('takes a request whose time passed out of Needs you, and says so', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => { throw new AppsError('EXPIRED', 409); }),
      booking: vi.fn(async () => ({ ...pending, expired: true })),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(await screen.findByText(/Aisyah's request no longer needs you/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm Aisyah' })).toBeNull();
    expect(screen.getByRole('button', { name: /See all requests \(0\)/ })).toBeInTheDocument();
  });

  it('keeps a request whose answer was lost, and claims nothing it could not re-read', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => { throw new AppsError('NETWORK', 0, true); }),
      booking: vi.fn(async () => { throw new AppsError('NETWORK'); }),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/as it stands/)).toBeNull();
    expect(api.booking).toHaveBeenCalledWith(pending.id);
    expect(screen.getByRole('button', { name: 'Confirm Aisyah' })).toBeInTheDocument();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('keeps the line busy while it reads the request again after a lost answer, and reads the lists again only after that', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    let release: ((booking: Booking) => void) | null = null;
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => { throw new AppsError('NETWORK', 0, true); }),
      booking: vi.fn(() => new Promise<Booking>((resolve) => { release = resolve; })),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    await waitFor(() => expect(api.booking).toHaveBeenCalledWith(pending.id));
    // Being read again: a second tap sends nothing, and the lists wait for the booking itself.
    expect(screen.getByRole('button', { name: 'Confirm Aisyah' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Confirm Aisyah' }));
    expect(api.decide).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
    release!({ ...pending, status: 'confirmed', whatsappUrl: WA });
    expect(await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('says a lost answer left the request as it stands only once a re-read shows it', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => { throw new AppsError('NETWORK', 0, true); }),
      booking: vi.fn(async () => pending),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(await screen.findByText('We did not hear back. This is the booking as it stands now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Aisyah' })).toBeInTheDocument();
  });

  it('refreshes the waiting requests along with the rest of the brief', async () => {
    const api = fakeAppsApi({ list: installed(0) });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
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
