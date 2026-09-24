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
async function mount(api: ReturnType<typeof fakeAppsApi>, bookingId: string | null = null, options: { delay?: number | null } = {}) {
  const onConnectCalendar = vi.fn();
  /* `delay: null` when a test needs to click under fake timers — userEvent's
     default pacing waits on real setTimeout, which fake timers never fire
     unless explicitly advanced, and this file only fakes time to drive this
     component's own poll. */
  const user = userEvent.setup(options.delay !== undefined ? { delay: options.delay } : undefined);
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

  /* Fix round 1, item 1 (bullet 1): the poll must re-read syncing bookings
     one at a time, never re-run the filtered list query — a quiet Needs you
     reload would otherwise come back without the booking the owner just
     confirmed (it is no longer pending) and drop its card. This replaces the
     previous version of this test, which asserted on `api.bookings` being
     called again on each tick — that assertion encoded the bug: it required
     the very re-run-the-filter behaviour item 1 removes. */
  it('polls quietly while Calendar is syncing, by re-reading the booking, not the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [syncing]) });
    await mount(api, null, { delay: null });
    await screen.findByRole('article', { name: 'Aisyah' });
    expect(api.booking).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(api.booking).toHaveBeenCalledWith(BOOKING_ID));
  });

  /* Fix round 1, item 1 (both bullets): confirming a request must not lose
     the card (and its WhatsApp link) the moment a quiet reload runs — the
     poll (calendar syncing) and the foreground/visibility reload are the two
     ways a quiet reload happens. */
  it('keeps a confirmed card in Needs you through a Calendar poll', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: WA, calendarQueued: true })),
      booking: vi.fn(async () => confirmed),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = await mount(api, null, { delay: null });
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(api.booking).toHaveBeenCalledWith(BOOKING_ID));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
    expect(screen.queryByText('No requests are waiting for you.')).toBeNull();
  });

  it('keeps a confirmed card in Needs you after a foreground reload', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') });
    let decided = false;
    const bookings = vi.fn(async (query: BookingsQuery) => ({
      bookings: query.status === 'pending' ? (decided ? [] : [bookingFixture()]) : [],
      nextCursor: null,
    }));
    const api = fakeAppsApi({
      list: installed(1), bookings,
      decide: vi.fn(async () => { decided = true; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Confirmed')).toBeInTheDocument());
    expect(within(card).getByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
    expect(screen.queryByText('No requests are waiting for you.')).toBeNull();
  });

  /* Fix round 1, item 2: with the notified request the only one waiting,
     `rows` (raw, before the pinned booking is filtered out) has it, so the
     empty state must not show underneath the pinned card. */
  it('does not show the empty state when the pinned booking is the only one loaded', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]), booking: vi.fn(async () => bookingFixture()),
    });
    await mount(api, BOOKING_ID);
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    expect(within(pinned).getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(screen.queryAllByRole('article', { name: 'Aisyah' })).toHaveLength(1);
    expect(screen.queryByText('No requests are waiting for you.')).toBeNull();
  });

  /* Fix round 1, item 3: a reload that read before the action's write
     commits must not overwrite the action's result when it finally resolves
     — it must be discarded, and (since nothing is acting by then) retried
     once so the view is not left stale. */
  it('does not let a stale reload undo a fresh decision', async () => {
    let current = bookingFixture();
    let releaseStale: (() => void) | null = null;
    let calls = 0;
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      calls += 1;
      const snapshot = current;
      if (calls === 2) await new Promise<void>((resolve) => { releaseStale = resolve; });
      return { bookings: [snapshot], nextCursor: null };
    });
    const api = fakeAppsApi({
      list: installed(0), bookings,
      decide: vi.fn(async () => { current = confirmed; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { user } = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });

    // A quiet reload starts and its read is held open, before the write.
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // `calls` counts only the window fetches this test cares about — the
    // pending-status scan (fired on both mount and this same visibilitychange,
    // by AppsProvider's own listener) goes through the early-return branch
    // above and is excluded, same as the old `polls quietly` test excluded it.
    await waitFor(() => expect(calls).toBe(2));

    // The action resolves while that reload is still in flight.
    await user.click(within(screen.getByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });

    // Now the stale reload resolves with the pre-confirm snapshot.
    releaseStale!();
    await waitFor(() => expect(calls).toBe(3));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Confirmed')).toBeInTheDocument());
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  /* Fix round 1, item 5: when the action fails and the recovery re-read
     also fails, the message must not claim to show the booking "as it
     stands" — that would be false, since the re-read that would confirm it
     never came back. */
  it('does not claim to show the current state when the recovery read also fails', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('ALREADY_DECIDED', 409)),
      booking: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByRole('alert')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(within(card).queryByText(/as it stands/)).toBeNull();
  });

  /* Fix round 1, item 6: a deep-link fetch failure keeps its own message
     (not `messages[bookingId]`, which the list cards also read), and only a
     404 gets the "could not be found" wording. */
  it('tells a deep-link 404 apart from any other fetch failure', async () => {
    const notFound = fakeAppsApi({ booking: vi.fn().mockRejectedValue(new AppsError('NOT_FOUND', 404)) });
    await mount(notFound, BOOKING_ID);
    expect(await screen.findByText('This booking could not be found.')).toBeInTheDocument();

    const offline = fakeAppsApi({ booking: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)) });
    await mount(offline, BOOKING_ID);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();
  });

  /* Fix round 1, item 8: while the default filter (Needs you vs Today) is
     still undecided, no list request goes out — only the loading state
     shows. Stops a Today fetch firing and then getting thrown away the
     instant Needs you takes over. */
  it('does not fetch Today before the default filter is decided', async () => {
    type ListResult = { apps: { key: 'bookings'; state: 'active'; publicUrl: string; pending: number }[]; available: ['bookings'] };
    let resolveList!: (value: ListResult) => void;
    const list = vi.fn(() => new Promise<ListResult>((resolve) => { resolveList = resolve; }));
    const bookings = serve([], []);
    const api = fakeAppsApi({ list, bookings });
    const onConnectCalendar = vi.fn();
    render(<RepositoryProvider repository={new LocalRepository()}><I18nProvider><AppsProvider api={api}>
      <BookingsList api={api} bookingId={null} onConnectCalendar={onConnectCalendar} now={() => NOW} />
    </AppsProvider></I18nProvider></RepositoryProvider>);
    await act(async () => {});
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(bookings).not.toHaveBeenCalled();
    // The app must actually be installed for `apps.pending` to resolve at
    // all — otherwise it stays null forever (that is how "not installed" is
    // represented), which is a different case from "still deciding".
    await act(async () => {
      resolveList({ apps: [{ key: 'bookings', state: 'active', publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings'] });
    });
    await waitFor(() => expect(bookings).toHaveBeenCalled());
  });

  /* Fix round 1, item 9: a poll tick is skipped while the tab is hidden,
     rather than spending a request nobody can see the result of. */
  it('skips a poll tick while the tab is hidden', async () => {
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [syncing]) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount(api, null, { delay: null });
    await screen.findByRole('article', { name: 'Aisyah' });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(api.booking).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(api.booking).toHaveBeenCalledWith(BOOKING_ID));
  });

  /* Fix round 1, item 10: a quiet load that fails while rows is still null
     (here, a foreground reload that overtakes an initial load still in
     flight) must show the failed state rather than leave the spinner
     forever — the bug was that only a non-quiet failure ever set it. */
  it('shows the failed state, not a forever spinner, when a quiet reload is first to fail', async () => {
    let releaseInitial: (() => void) | null = null;
    let calls = 0;
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { releaseInitial = resolve; });
        return { bookings: [], nextCursor: null };
      }
      throw new AppsError('NETWORK', 0, false);
    });
    const api = fakeAppsApi({ list: installed(0), bookings });
    await mount(api);
    await waitFor(() => expect(calls).toBe(1));

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();
    releaseInitial!();
  });
});
