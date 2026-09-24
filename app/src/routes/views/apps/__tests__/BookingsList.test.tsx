import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingsList from '../BookingsList';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { AppsProvider } from '@/lib/apps/useApps';
import { AppsError } from '@/lib/apps/api';
import { BOOKING_ID, bookingFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import type { Booking, BookingsQuery } from '@/lib/apps/types';

const NOW = new Date('2026-10-05T00:00:00Z');   // Monday 08:00 in Malaysia
const WA = 'https://wa.me/60123456789?text=Hi';
const calendar = (status: Booking['calendar']['status'], over: Partial<Booking['calendar']> = {}) =>
  ({ status, error: null, reason: null, canRetry: false, account: null, ...over });
const installed = (pending: number) => vi.fn(async () => ({
  apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending }], available: ['bookings' as const],
}));
/** Pending requests on `status: 'pending'` queries, `window` on everything else. */
const serve = (pending: Booking[], window: Booking[] = []) =>
  vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? pending : window, nextCursor: null }));

/* The real I18nProvider calls useSnapshot(), which throws without a
   RepositoryProvider above it — so every mount needs one, and
   LocalRepository.load() resolves on a microtask that must be flushed
   before the first assertion. */
async function mount(api: ReturnType<typeof fakeAppsApi>, bookingId: string | null = null) {
  const onConnectCalendar = vi.fn();
  const user = userEvent.setup();
  render(<RepositoryProvider repository={new LocalRepository()}><I18nProvider><AppsProvider api={api}>
    <BookingsList api={api} bookingId={bookingId} onConnectCalendar={onConnectCalendar} now={() => NOW} />
  </AppsProvider></I18nProvider></RepositoryProvider>);
  await act(async () => {});
  return { onConnectCalendar, user };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('BookingsList', () => {
  it('opens on Needs you, and a confirm shows the WhatsApp link and Syncing at once', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: WA, calendarQueued: true })),
    });
    const { user } = await mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Needs you')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(api.decide).toHaveBeenCalledWith(BOOKING_ID, 'confirm');
    const after = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(after).getByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA));
    expect(within(after).getByText('Syncing')).toBeInTheDocument();
    expect(within(after).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('shows the booking as it stands when another device decided first', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('ALREADY_DECIDED', 409)),
      booking: vi.fn(async () => bookingFixture({ status: 'declined', whatsappUrl: WA })),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Declined')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('Already decided on another device');
    expect(within(card).getByRole('link', { name: /Send decline on WhatsApp/ })).toBeInTheDocument();
  });

  it('recovers from a lost answer by reading the booking again', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
      booking: vi.fn(async () => bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') })),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Added to Google Calendar')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('We did not hear back');
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('says when the time has passed', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('EXPIRED', 409)),
      booking: vi.fn(async () => bookingFixture({ expired: true })),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/This time has passed/)).toBeInTheDocument();
  });

  it('asks before cancelling, and shows cleanup still running afterwards', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') });
    const cancelled = bookingFixture({ status: 'cancelled', whatsappUrl: WA, calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(0), bookings: serve([], [confirmed]),
      cancel: vi.fn(async () => ({ booking: cancelled, whatsappUrl: WA, calendarQueued: true })),
    });
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user } = await mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await user.click(within(card).getByRole('button', { name: 'Cancel booking' }));
    expect(api.cancel).not.toHaveBeenCalled();
    await user.click(within(card).getByRole('button', { name: 'Cancel booking' }));
    expect(ask).toHaveBeenCalledTimes(2);
    const after = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(after).getByText('Cancelled')).toBeInTheDocument());
    expect(within(after).getByText('Removing from Google Calendar')).toBeInTheDocument();
    expect(within(after).queryByText('Removed from Google Calendar')).toBeNull();
    expect(within(after).getByRole('link', { name: /Send cancellation on WhatsApp/ })).toBeInTheDocument();
  });

  it('explains a Calendar failure, retries it, and offers Connect when nothing is connected', async () => {
    const failed = bookingFixture({ status: 'confirmed', calendar: calendar('failed', { reason: 'reconnect', canRetry: true, account: 'owner@example.com' }) });
    const waiting = bookingFixture({ id: '11111111-1111-4111-8111-00000000000e', customerName: 'Aina', status: 'confirmed', calendar: calendar('not_connected', { canRetry: true }) });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [failed, waiting]) });
    const { onConnectCalendar, user } = await mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Reconnect owner@example.com in Connections, then retry.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(api.retryCalendar).toHaveBeenCalledWith(BOOKING_ID);
    await user.click(within(screen.getByRole('article', { name: 'Aina' })).getByRole('button', { name: 'Connect Google Calendar' }));
    expect(onConnectCalendar).toHaveBeenCalled();
  });

  it('pins the booking a notification opened, whatever the filter', async () => {
    const far = bookingFixture({ startsAt: '2026-12-04T02:00:00.000Z' });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []), booking: vi.fn(async () => far) });
    await mount(api, BOOKING_ID);
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    expect(within(pinned).getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(api.booking).toHaveBeenCalledWith(BOOKING_ID);
  });

  it('pages Upcoming in 31-day windows from today', async () => {
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []) });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Upcoming' }));
    await waitFor(() => expect(api.bookings).toHaveBeenCalledWith({ from: '2026-10-05', days: 31 }));
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(api.bookings).toHaveBeenCalledWith({ from: '2026-11-05', days: 31 }));
  });

  it('polls quietly while Calendar is syncing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [syncing]) });
    await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    const before = api.bookings.mock.calls.filter(([q]) => q.status !== 'pending').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(api.bookings.mock.calls.filter(([q]) => q.status !== 'pending').length).toBeGreaterThan(before));
  });
});
