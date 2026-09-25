import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import BookingsList from '../BookingsList';
import { LocalRepository } from '@/lib/repo/local';
import { AppsProvider } from '@/lib/apps/useApps';
import { AppsError } from '@/lib/apps/api';
import { BOOKING_ID, bookingFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import type { Booking, BookingsQuery } from '@/lib/apps/types';
import { createQueryClient } from '@/lib/query/client';
import { focusApp, renderWithQuery, returnToApp } from '@/test-support/query';

const NOW = new Date('2026-10-05T00:00:00Z');   // Monday 08:00 in Malaysia
const WA = 'https://wa.me/60123456789?text=Hi';
const calendar = (status: Booking['calendar']['status'], over: Partial<Booking['calendar']> = {}) =>
  ({ status, error: null, reason: null, canRetry: false, account: null, ...over });
const installed = (pending: number) => vi.fn(async () => ({
  apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending }], available: ['bookings' as const],
}));
/** Pending requests on `status: 'pending'` queries, `window` on everything else. */
const serve = (pending: Booking[], window: Booking[] = []) =>
  vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? pending : window, nextCursor: null }));

/* The real I18nProvider calls useSnapshot(), which throws without a
   RepositoryProvider above it — so every mount passes a repository, and
   renderWithQuery flushes LocalRepository.load()'s microtask before the
   first assertion. Pass `client` to mount again over the same cache. */
async function mount(api: ReturnType<typeof fakeAppsApi>, bookingId: string | null = null, options: { delay?: number | null; client?: QueryClient } = {}) {
  const onConnectCalendar = vi.fn();
  /* `delay: null` when a test needs to click under fake timers — userEvent's
     default pacing waits on real setTimeout, which fake timers never fire
     unless explicitly advanced, and this file only fakes time to drive this
     component's own poll. */
  const user = userEvent.setup(options.delay !== undefined ? { delay: options.delay } : undefined);
  const view = await renderWithQuery(<AppsProvider api={api}>
    <BookingsList api={api} bookingId={bookingId} onConnectCalendar={onConnectCalendar} now={() => NOW} />
  </AppsProvider>, { repository: new LocalRepository(), client: options.client });
  return { onConnectCalendar, user, client: view.client, unmount: view.unmount };
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

  it('opens Needs you on the scan that decided it, without scanning again', async () => {
    const api = fakeAppsApi({ list: installed(1), bookings: serve([bookingFixture()]) });
    await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    const pendingScans = () => api.bookings.mock.calls.filter(([query]) => query.status === 'pending').length;
    // One scan (one request since the API takes the 91-day horizon at once), not two.
    expect(pendingScans()).toBe(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    await user.click(screen.getByRole('button', { name: /^Needs you/ }));
    await screen.findByRole('article', { name: 'Aisyah' });
    // Back inside 30 s: Needs you is the shared scan's answer, not a new scan.
    expect(pendingScans()).toBe(1);
  });

  it('shows Needs you at once after 30 s, while one background scan refreshes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const api = fakeAppsApi({ list: installed(1), bookings: serve([bookingFixture()]) });
    const { user } = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    const pendingScans = () => api.bookings.mock.calls.filter(([query]) => query.status === 'pending').length;
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    await screen.findByText('No bookings today.');
    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    await user.click(screen.getByRole('button', { name: /^Needs you/ }));
    expect(screen.getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    await waitFor(() => expect(pendingScans()).toBe(2));
    await act(async () => {});
    expect(pendingScans()).toBe(2);
    expect(screen.getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
  });

  it('shows the booking as it stands when it was decided elsewhere first', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('ALREADY_DECIDED', 409)),
      booking: vi.fn(async () => bookingFixture({ status: 'declined', whatsappUrl: WA })),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Declined')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('Already decided elsewhere. This is the booking as it stands.');
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
    expect(await screen.findByText('The booking time has passed, so it can no longer be changed.')).toBeInTheDocument();
  });

  it('says a cancel came too late without talking about confirming', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', startsAt: '2026-10-05T00:30:00.000Z' });
    const api = fakeAppsApi({
      list: installed(0), bookings: serve([], [confirmed]),
      cancel: vi.fn().mockRejectedValue(new AppsError('EXPIRED', 409)),
      booking: vi.fn(async () => confirmed),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Cancel booking' }));
    const alert = await within(screen.getByRole('article', { name: 'Aisyah' })).findByRole('alert');
    expect(alert).toHaveTextContent('The booking time has passed, so it can no longer be changed.');
    expect(alert.textContent).not.toMatch(/confirm/i);
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

  it('says why a retry changed nothing while no Calendar is connected', async () => {
    const waiting = bookingFixture({ status: 'confirmed', calendar: calendar('not_connected', { canRetry: true }) });
    const api = fakeAppsApi({
      list: installed(0), bookings: serve([], [waiting]),
      retryCalendar: vi.fn(async () => ({ booking: waiting, whatsappUrl: null, calendarQueued: false })),
    });
    const { user } = await mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await user.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Google Calendar is not connected yet. Connect it, then retry.');
  });

  it('does not promise a retry for a Calendar disconnected with no account on record', async () => {
    const lost = bookingFixture({ status: 'confirmed', calendar: calendar('failed', { reason: 'disconnected', canRetry: false, account: null }) });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [lost]) });
    const { onConnectCalendar, user } = await mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText(/Connect Google Calendar to sync new decisions/)).toBeInTheDocument();
    expect(within(card).queryByText(/then retry/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Connect Google Calendar' }));
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
    const listCallsBefore = api.bookings.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(api.booking).toHaveBeenCalledWith(BOOKING_ID));
    // Fix round 2, item D: prove the list itself was not re-queried by the
    // poll — the previous version of this test asserted only that
    // `api.booking` was called, never that `api.bookings` (the list) wasn't.
    expect(api.bookings).toHaveBeenCalledTimes(listCallsBefore);
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
      // A card decided here reads its booking again on return; the server has it confirmed.
      booking: vi.fn(async () => (decided ? confirmed : bookingFixture())),
    });
    const { client, user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    await returnToApp(client);
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

  /* A read that began before a decision never lands after it: the action
     cancels the reads already out. The pinned card is drawn from the
     booking's own query alone, whatever the list holds, so a held re-read
     of it landing late would put Confirm back on the card. */
  it('does not let a stale reload undo a fresh decision', async () => {
    let current = bookingFixture();
    let releaseStale: (() => void) | null = null;
    let releasePinned: (() => void) | null = null;
    let calls = 0;
    let reads = 0;
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      calls += 1;
      const snapshot = current;
      if (calls === 2) await new Promise<void>((resolve) => { releaseStale = resolve; });
      return { bookings: [snapshot], nextCursor: null };
    });
    const booking = vi.fn(async () => {
      reads += 1;
      const snapshot = current;
      if (reads === 2) await new Promise<void>((resolve) => { releasePinned = resolve; });
      return snapshot;
    });
    const api = fakeAppsApi({
      list: installed(0), bookings, booking,
      decide: vi.fn(async () => { current = confirmed; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { client, user } = await mount(api, BOOKING_ID);
    await screen.findByRole('region', { name: 'From your notification' });
    await waitFor(() => expect(calls).toBe(1));

    // A quiet reload starts and its reads are held open, before the write:
    // the list's, and the pinned card's own.
    await returnToApp(client);
    // `calls` counts only the window reads this test cares about; a
    // pending-status scan goes through the early-return branch above.
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(reads).toBe(2));

    // The action resolves while that reload is still in flight.
    await user.click(within(screen.getByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });

    // Now the stale reads resolve with the pre-confirm snapshot.
    releaseStale!();
    releasePinned!();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
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
    type ListResult = { apps: { key: 'bookings'; state: 'active'; accepting: boolean; publicUrl: string; pending: number }[]; available: ['bookings'] };
    let resolveList!: (value: ListResult) => void;
    const list = vi.fn(() => new Promise<ListResult>((resolve) => { resolveList = resolve; }));
    const bookings = serve([], []);
    const api = fakeAppsApi({ list, bookings });
    await mount(api);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(bookings).not.toHaveBeenCalled();
    // The app must actually be installed for `apps.pending` to resolve at
    // all — otherwise it stays null forever (that is how "not installed" is
    // represented), which is a different case from "still deciding".
    await act(async () => {
      resolveList({ apps: [{ key: 'bookings', state: 'active', accepting: true, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings'] });
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

  /* Fix round 1, item 10: a load that fails before any rows arrived must
     show the failed state rather than leave the spinner forever. (The old
     trigger, a foreground reload overtaking the first load, cannot happen
     any more: the cache joins a second read to the one in flight.) */
  it('shows the failed state, not a forever spinner, when the list cannot be read', async () => {
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      throw new AppsError('NETWORK', 0, false);
    });
    const api = fakeAppsApi({ list: installed(0), bookings });
    await mount(api);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();
    expect(screen.queryByText('Loading bookings…')).toBeNull();
  });

  /* Owner path: open a notification, the pinned card arrives before the
     list finishes loading, and Confirm is tapped on it. The action cancels
     the list read still out; once the answer lands the list is read again,
     so it is not left loading forever. */
  it('does not leave the list loading forever when an action outlives a discarded reload', async () => {
    let releaseList: (() => void) | null = null;
    let listCalls = 0;
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      listCalls += 1;
      if (listCalls === 1) await new Promise<void>((resolve) => { releaseList = resolve; });
      return { bookings: [], nextCursor: null };
    });
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    let releaseAction: ((value: { booking: Booking; whatsappUrl: string | null; calendarQueued: boolean }) => void) | null = null;
    const api = fakeAppsApi({
      list: installed(0), bookings,
      booking: vi.fn(async () => bookingFixture()),
      decide: vi.fn(() => new Promise((resolve) => { releaseAction = resolve; })),
    });
    const { user } = await mount(api, BOOKING_ID);
    // The pinned card resolves quickly; the Today list load is still in
    // flight (held open), so its own section is still showing the spinner.
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    await waitFor(() => expect(listCalls).toBe(1));

    // Confirm the pinned card while the list load is still in flight (the
    // action itself is held open too, so the button stays present —
    // disabled — rather than disappearing).
    await user.click(within(pinned).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(within(pinned).getByRole('button', { name: 'Confirm' })).toBeDisabled());

    // The cancelled list read resolves while the action is still in flight:
    // it does not land, and nothing reads the list again yet. A macrotask
    // boundary (not just a microtask flush) lets the whole await chain the
    // mock's release triggers fully settle.
    releaseList!();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(listCalls).toBe(1);

    // Now the answer lands, and the list is read again.
    releaseAction!({ booking: confirmed, whatsappUrl: WA, calendarQueued: false });
    await waitFor(() => expect(listCalls).toBe(2));
    expect(await screen.findByText('No bookings today.')).toBeInTheDocument();
    expect(screen.queryByText('Loading bookings…')).toBeNull();
  });

  /* The other order: the list read the action cancelled outlives the
     action. The read after the answer is what fills the list. */
  it('still recovers immediately when a stale reload outlives the action, with a pinned card too', async () => {
    let releaseList: (() => void) | null = null;
    let listCalls = 0;
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      listCalls += 1;
      if (listCalls === 1) await new Promise<void>((resolve) => { releaseList = resolve; });
      return { bookings: [], nextCursor: null };
    });
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    const api = fakeAppsApi({
      list: installed(0), bookings,
      booking: vi.fn(async () => bookingFixture()),
      decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: WA, calendarQueued: false })),
    });
    const { user } = await mount(api, BOOKING_ID);
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    await waitFor(() => expect(listCalls).toBe(1));

    // The action starts and fully settles while the list load is still held open.
    await user.click(within(pinned).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(within(pinned).getByText('Confirmed')).toBeInTheDocument());

    // Now the cancelled read resolves; it does not land, and the list is
    // the read that followed the answer.
    releaseList!();
    await waitFor(() => expect(listCalls).toBe(2));
    expect(await screen.findByText('No bookings today.')).toBeInTheDocument();
  });

  /* A failed list read shows the failed card; a later read that succeeds
     must take it away again, not leave it over the loaded list. */
  it('clears the failed state once a later read succeeds', async () => {
    let calls = 0;
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      calls += 1;
      if (calls === 1) throw new AppsError('NETWORK', 0, false);
      return { bookings: [], nextCursor: null };
    });
    const api = fakeAppsApi({ list: installed(0), bookings });
    const { client } = await mount(api);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();

    // The owner comes back to the app and the read succeeds: the failed card goes away.
    await returnToApp(client);
    await waitFor(() => expect(screen.queryByText('Could not load bookings.')).toBeNull());
    expect(await screen.findByText('No bookings today.')).toBeInTheDocument();
  });

  /* Fix round 2, item E: a deep-link fetch that failed for a reason other
     than 404 (which would not change on retry) is retried on the next
     foreground return. */
  it('retries a non-404 deep-link failure on a foreground reload', async () => {
    let calls = 0;
    const booking = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new AppsError('NETWORK', 0, true);
      return bookingFixture();
    });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []), booking });
    const { client } = await mount(api, BOOKING_ID);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();

    await returnToApp(client);
    await waitFor(() => expect(screen.getByRole('region', { name: 'From your notification' })).toBeInTheDocument());
    expect(screen.queryByText('Could not load bookings.')).toBeNull();
  });

  it('shows the Bookings tab again on a revisit inside 30 s without asking the server', async () => {
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [bookingFixture({ status: 'confirmed' })]) });
    const first = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    first.unmount();
    await mount(api, null, { client: first.client });
    expect(await screen.findByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.bookings).toHaveBeenCalledTimes(1);
  });

  it('reads nothing again when the owner comes back inside 30 s, and what is on screen once past it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const confirmed = bookingFixture({ status: 'confirmed' });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [confirmed]), booking: vi.fn(async () => confirmed) });
    await mount(api, BOOKING_ID);
    await screen.findByRole('region', { name: 'From your notification' });
    await waitFor(() => expect(api.bookings).toHaveBeenCalledTimes(1));
    // The apps list, Today and the notified booking.
    const requests = () => api.list.mock.calls.length + api.bookings.mock.calls.length + api.booking.mock.calls.length;
    expect(requests()).toBe(3);
    vi.setSystemTime(new Date(NOW.getTime() + 29_000));
    await focusApp();
    expect(requests()).toBe(3);
    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    await focusApp();
    await waitFor(() => expect(requests()).toBe(6));
  });

  it('never sends a confirm twice, and shows the booking as it stands', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
      booking: vi.fn(async () => bookingFixture({ status: 'confirmed', whatsappUrl: WA })),
    });
    // The production client: only its no-retry rule for writes is under test.
    const { user } = await mount(api, null, { client: createQueryClient() });
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('We did not hear back'));
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  /* In a lift with no signal: the tap fails at once with the message it
     always gave, and is never sent later when the signal comes back — by
     then no one may be there to send the customer the WhatsApp message. */
  it('fails a tap made offline at once, and never sends it later', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
      booking: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, false)),
    });
    const { user } = await mount(api, null, { client: createQueryClient() });
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    act(() => { onlineManager.setOnline(false); });
    try {
      await user.click(within(card).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(within(screen.getByRole('article', { name: 'Aisyah' })).getByRole('alert'))
        .toHaveTextContent('Something went wrong. Try again.'));
      expect(api.decide).toHaveBeenCalledTimes(1);
      expect(within(screen.getByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' })).toBeEnabled();
    } finally {
      act(() => { onlineManager.setOnline(true); });
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('says it could not load, not a forever spinner, when opened offline', async () => {
    const offline = () => { throw new AppsError('NETWORK', 0, false); };
    const api = fakeAppsApi({ list: vi.fn(async () => offline()), bookings: vi.fn(async () => offline()) });
    act(() => { onlineManager.setOnline(false); });
    try {
      await mount(api);
      expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(screen.queryByText('Loading bookings…')).toBeNull();
    } finally {
      act(() => { onlineManager.setOnline(true); });
    }
  });

  it('stops polling once Calendar has synced', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(0), bookings: serve([], [syncing]),
      booking: vi.fn(async () => bookingFixture({ status: 'confirmed', calendar: calendar('created') })),
    });
    await mount(api, null, { delay: null });
    await screen.findByRole('article', { name: 'Aisyah' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(screen.getByText('Added to Google Calendar')).toBeInTheDocument());
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(api.booking).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the list is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [syncing]) });
    const { unmount } = await mount(api, null, { delay: null });
    await screen.findByRole('article', { name: 'Aisyah' });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(api.booking).not.toHaveBeenCalled();
  });

  it('does not ask again for a booking that could not be found when the owner returns', async () => {
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []), booking: vi.fn().mockRejectedValue(new AppsError('NOT_FOUND', 404)) });
    const { client } = await mount(api, BOOKING_ID);
    expect(await screen.findByText('This booking could not be found.')).toBeInTheDocument();
    await returnToApp(client);
    await screen.findByText('No bookings today.');
    expect(api.booking).toHaveBeenCalledTimes(1);
    expect(screen.getByText('This booking could not be found.')).toBeInTheDocument();
  });

  it('shows a decision in every cached list at once, not only the one it was made in', async () => {
    let decided = false;
    let holdToday: (() => void) | null = null;
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: decided ? [] : [bookingFixture()], nextCursor: null };
      // Today's second read (after the decision) is held, so the card below comes from the cache.
      if (decided) await new Promise<void>((resolve) => { holdToday = resolve; });
      return { bookings: [decided ? confirmed : bookingFixture()], nextCursor: null };
    });
    const api = fakeAppsApi({
      list: installed(1), bookings,
      decide: vi.fn(async () => { decided = true; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { user } = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    // Today is read once and cached, with the request still waiting.
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    expect(within(await screen.findByRole('article', { name: 'Aisyah' })).getByText('Needs you')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Needs you/ }));
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    // Back to Today: decided at once, while its own read is still in flight.
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    await waitFor(() => expect(holdToday).not.toBeNull());
    await act(async () => { holdToday!(); });
  });

  it('keeps the card busy while it reads the booking again after a lost answer, so a second tap sends nothing', async () => {
    let release: ((value: Booking) => void) | null = null;
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
      booking: vi.fn(() => new Promise<Booking>((resolve) => { release = resolve; })),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.booking).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // The answer was lost and the booking is being read again: nothing on the card can be sent.
    const card = screen.getByRole('article', { name: 'Aisyah' });
    expect(within(card).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Decline' })).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(api.decide).toHaveBeenCalledTimes(1);
    await act(async () => { release!(bookingFixture({ status: 'confirmed', whatsappUrl: WA })); });
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Aisyah' })).getByText('Confirmed')).toBeInTheDocument());
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('shows a later change made elsewhere on a card decided here, once the owner returns', async () => {
    let current = bookingFixture();
    const api = fakeAppsApi({
      list: installed(0),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [] : [current], nextCursor: null })),
      decide: vi.fn(async () => {
        current = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') });
        return { booking: current, whatsappUrl: WA, calendarQueued: false };
      }),
      booking: vi.fn(async () => current),
    });
    const { client, user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    // A colleague cancels it; the owner comes back to the app after 30 s.
    current = bookingFixture({ status: 'cancelled', whatsappUrl: WA, calendar: calendar('removed') });
    await returnToApp(client);
    const card = screen.getByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Cancelled')).toBeInTheDocument());
    expect(within(card).getByRole('link', { name: /Send cancellation on WhatsApp/ })).toBeInTheDocument();
    expect(within(card).queryByText('Confirmed')).toBeNull();
  });

  it('starts afresh when the owner leaves Needs you and comes back', async () => {
    let decided = false;
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' && !decided ? [bookingFixture()] : [], nextCursor: null })),
      decide: vi.fn(async () => { decided = true; return { booking: bookingFixture({ status: 'confirmed', whatsappUrl: WA }), whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    await screen.findByText('No bookings today.');
    await user.click(screen.getByRole('button', { name: /^Needs you/ }));
    expect(await screen.findByText('No requests are waiting for you.')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Aisyah' })).toBeNull();
  });

  it('keeps the card in Needs you until the re-read after a failed action lands', async () => {
    let release: ((value: Booking) => void) | null = null;
    let decidedElsewhere = false;
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' && !decidedElsewhere ? [bookingFixture()] : [], nextCursor: null })),
      decide: vi.fn(async () => { decidedElsewhere = true; throw new AppsError('ALREADY_DECIDED', 409); }),
      booking: vi.fn(() => new Promise<Booking>((resolve) => { release = resolve; })),
    });
    const { user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.booking).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    // Nothing reads the lists again while the booking itself is being read: the card stays.
    expect(screen.queryByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(screen.queryByText('No requests are waiting for you.')).toBeNull();
    expect(api.bookings).toHaveBeenCalledTimes(1);
    await act(async () => { release!(bookingFixture({ status: 'declined', whatsappUrl: WA })); });
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Declined')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('Already decided elsewhere. This is the booking as it stands.');
    // Then the lists are read again, and the decided card stays.
    await waitFor(() => expect(api.bookings).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole('article', { name: 'Aisyah' })).getByText('Declined')).toBeInTheDocument();
  });
});
