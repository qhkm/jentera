import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutationState, useQueries, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { Button, Card, Chip, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { AppsError } from '@/lib/apps/api';
import {
  actionErrorKey, addDays, groupByDay, mergeBookingRows, unconfirmedErrorKey, WINDOW_DAYS, type OwnRead,
} from '@/lib/apps/bookings';
import {
  bookingQuery, bookingWindowQuery, rereadBooking, useBookingAction, type BookingActionVars,
} from '@/lib/apps/queries';
import { keys, mutationKeys } from '@/lib/query/keys';
import { useRequiredBusinessId } from '@/lib/query/scope';
import { malaysiaDay } from '@/lib/daily-brief';
import type { AppsApi, Booking, BookingAction } from '@/lib/apps/types';
import BookingCard from './BookingCard';

type Filter = 'needs' | 'today' | 'upcoming' | 'date';
type BookingKey = ReturnType<typeof keys.booking>;
const POLL_MS = 10_000;
/** Upcoming reaches 90 days ahead in three windows. */
const UPCOMING_OFFSETS = [0, 31, 62];

/** A booking's own query polls while its Calendar event is still being
    written, and stops by itself once it is synced. Never in the background. */
const pollWhileSyncing = (query: { state: { data?: Booking } }) =>
  (query.state.data?.calendar.status === 'pending' ? POLL_MS : false);
/** A deep link that 404'd will not change on retry; any other failure may. */
const unlessNotFound = (query: { state: { error: unknown } }) =>
  !(query.state.error instanceof AppsError && query.state.error.status === 404);

export default function BookingsList({ api, bookingId, onConnectCalendar, now = () => new Date() }: {
  api: AppsApi;
  bookingId: string | null;
  onConnectCalendar: () => void;
  now?: () => Date;
}) {
  const { t, lang } = useI18n();
  const apps = useApps();
  const client = useQueryClient();
  const businessId = useRequiredBusinessId();
  const action = useBookingAction(api);
  const clock = useRef(now);
  clock.current = now;
  const [chosen, setChosen] = useState<Filter | null>(null);
  const filter: Filter = chosen ?? 'today';
  const [offset, setOffset] = useState(0);
  const [date, setDate] = useState(() => malaysiaDay(now()));
  const [messages, setMessages] = useState<Record<string, string>>({});
  /** Bookings confirmed, declined or cancelled here, for the window they
      were decided in (`scope`). Choosing another window starts afresh. */
  const [decided, setDecided] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const forgetDecided = () => setDecided({ scope: '', ids: [] });
  /** Bookings whose action failed and that are being read again. Still busy:
      the action has settled, but a second tap now could send it twice. */
  const [recovering, setRecovering] = useState<ReadonlySet<string>>(() => new Set());

  /* Needs you when requests wait, otherwise Today — decided once, so
     confirming the last request does not pull the view away from it. Also
     resolved (to Today) if the apps list itself failed, so this does not
     wait forever on a count that will never arrive. */
  useEffect(() => {
    if (chosen === null && (apps.pending !== null || apps.error)) {
      setChosen(apps.pending !== null && apps.pending.length > 0 ? 'needs' : 'today');
    }
  }, [chosen, apps.pending, apps.error]);

  const today = malaysiaDay(clock.current());
  const range = filter === 'upcoming' ? { from: addDays(today, offset), days: WINDOW_DAYS }
    : filter === 'date' ? { from: date, days: 1 } : { from: today, days: 1 };
  const needs = filter === 'needs';
  const scope = needs ? 'needs' : `${range.from}/${range.days}`;
  const kept = useMemo(() => new Set(decided.scope === scope ? decided.ids : []), [decided, scope]);

  /* Needs you is the shared waiting-requests query (useApps), so opening it
     never scans again; every other filter is a window query. Nothing is
     asked for until the default filter is decided. */
  const windowRead = useQuery({
    ...bookingWindowQuery(api, businessId, range.from, range.days),
    enabled: chosen !== null && !needs,
  });
  /* Nothing is shown before the default filter is decided: until then the
     window query above is Today's, and its cache is not what will open. */
  const list: Booking[] | null = chosen === null ? null : needs ? apps.pending : windowRead.data ?? null;
  const listUpdatedAt = needs
    ? client.getQueryState(keys.pendingBookings(businessId))?.dataUpdatedAt ?? 0
    : windowRead.dataUpdatedAt;

  /* Each booking decided here, and each whose Calendar is syncing, is
     watched through its own query: the action's answer and later polls land
     there. Seeded from the list, so watching starts without a request. A
     booking decided here is drawn from that query alone, so it is also read
     again when the owner comes back to the app: a change made elsewhere
     since then reaches the card. */
  const syncing = (list ?? []).filter((booking) => booking.calendar.status === 'pending').map((booking) => booking.id);
  const watched = [...new Set([...kept, ...syncing])].sort();
  const reads: UseQueryOptions<Booking, Error, Booking, BookingKey>[] = watched.map((id) => {
    const row = list?.find((booking) => booking.id === id);
    return {
      ...bookingQuery(api, businessId, id),
      initialData: row,
      initialDataUpdatedAt: row ? listUpdatedAt : undefined,
      refetchInterval: pollWhileSyncing,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: kept.has(id),
    };
  });
  const ownReads = useQueries({ queries: reads });
  const own = new Map<string, OwnRead>();
  watched.forEach((id, index) => {
    const read = ownReads[index];
    if (read?.data) own.set(id, { booking: read.data, updatedAt: read.dataUpdatedAt });
  });
  const rows = mergeBookingRows(list, listUpdatedAt, own, kept);

  /* The booking a notification opened, pinned above the list whatever the
     filter. A 404 says so and is not asked for again on return; any other
     failure is read again when the owner comes back to the app. */
  const pinned = useQuery({
    ...bookingQuery(api, businessId, bookingId ?? ''),
    enabled: bookingId !== null,
    refetchInterval: pollWhileSyncing,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: unlessNotFound,
  });
  const focused = bookingId ? pinned.data ?? null : null;
  const focusedError = bookingId && !focused && pinned.isError
    ? (pinned.error instanceof AppsError && pinned.error.status === 404 ? 'bookings.error.notFound' : 'bookings.error.load')
    : null;

  /* A read in flight after a failure shows the loading state again. */
  const failed = chosen !== null && (needs
    ? apps.error && apps.pending === null && !apps.loading
    : windowRead.isError && windowRead.data === undefined && !windowRead.isFetching);

  /* Busy per booking: whichever actions are in flight right now, and any
     being read again after a failure. */
  const busyIds = useMutationState({
    filters: { mutationKey: mutationKeys.bookingAction(businessId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as BookingActionVars | undefined)?.id ?? '',
  });
  const busy = new Set([...busyIds, ...recovering]);

  async function act(booking: Booking, kind: BookingAction) {
    if (kind === 'cancel' && !window.confirm(t('bookings.cancel.confirm', { name: booking.customerName }))) return;
    /* Kept in this window, even once a later list leaves it out: Needs
       you's pending-only scan drops a card the moment it is decided, and its
       WhatsApp link with it. Whether it is kept is judged on the rows the
       owner acted on; it is kept only once the booking's own query holds
       the server's answer (the action's, or the re-read's). Any earlier, a
       pre-decision read already in that query (a Calendar poll) would
       outrank newer list reads — and if the re-read failed too, for good. */
    const keepable = kind !== 'retry' && (rows ?? []).some((row) => row.id === booking.id);
    const keep = () => {
      if (!keepable) return;
      setDecided((current) => ({
        scope,
        ids: current.scope === scope ? [...new Set([...current.ids, booking.id])] : [booking.id],
      }));
    };
    setMessages((current) => {
      const next = { ...current };
      delete next[booking.id];
      return next;
    });
    try {
      const result = await action.mutateAsync({ id: booking.id, action: kind });
      keep();
      if (kind === 'retry' && !result.calendarQueued && result.booking.calendar.status === 'not_connected') {
        /* Retry answers "nothing to do" while no Calendar is connected; say so
           rather than let the tap look ignored. */
        setMessages((current) => ({ ...current, [booking.id]: 'bookings.calendar.stillNotConnected' }));
      }
    } catch (error) {
      const key = actionErrorKey(error);
      /* Someone else decided, or the answer was lost: show the booking as
         the server has it now. Never send the action again. */
      setRecovering((current) => new Set(current).add(booking.id));
      try {
        await rereadBooking(client, api, businessId, booking.id);
        keep();
        setMessages((current) => ({ ...current, [booking.id]: key }));
      } catch {
        /* The re-read failed too — do not claim to be showing the booking
           "as it stands" when we could not confirm what that is. */
        setMessages((current) => ({ ...current, [booking.id]: unconfirmedErrorKey(key) }));
      } finally {
        setRecovering((current) => {
          const next = new Set(current);
          next.delete(booking.id);
          return next;
        });
        /* The lists are read again only now, after the booking itself: a
           fresh Needs you scan landing first would drop a card someone else
           just decided before the truth about it arrives. */
        void apps.refresh();
      }
    }
  }

  function retry() {
    if (needs) void apps.refresh();
    else void windowRead.refetch();
  }

  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const dayTitle = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
  const card = (booking: Booking) => <BookingCard key={booking.id} booking={booking} busy={busy.has(booking.id)}
    message={messages[booking.id] ? t(messages[booking.id]) : null} now={clock.current()}
    onAct={(kind) => void act(booking, kind)} onConnectCalendar={onConnectCalendar} />;
  /* The empty text follows the loaded rows, not the rows left once the
     pinned card is taken out of them. */
  const shown = (rows ?? []).filter((booking) => booking.id !== focused?.id);
  const waiting = apps.pending?.length ?? 0;

  return <div className="bookings-list">
    <div className="bookings-filters" role="group" aria-label={t('bookings.filters')}>
      {(['needs', 'today', 'upcoming'] as const).map((option) => <Chip key={option} active={filter === option} aria-pressed={filter === option}
        onClick={() => { if (option !== filter || offset !== 0) forgetDecided(); setChosen(option); setOffset(0); }}>
        {t(`bookings.filter.${option}`)}{option === 'needs' && waiting > 0 ? ` (${waiting})` : ''}
      </Chip>)}
      <label className="bookings-date">{t('bookings.date.pick')}
        <input className="input" type="date" value={date}
          onChange={(event) => {
            if (!event.target.value) return;
            if (filter !== 'date' || event.target.value !== date) forgetDecided();
            setDate(event.target.value);
            setChosen('date');
          }} />
      </label>
    </div>
    {focused && <section className="bookings-focused" aria-labelledby="bookings-focused-title">
      <h2 id="bookings-focused-title">{t('bookings.focused')}</h2>
      {card(focused)}
    </section>}
    {focusedError && <p role="alert">{t(focusedError)}</p>}
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.error.load')}</p>
      <Button variant="outline" onClick={retry}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && rows === null && <LoadingState title={t('bookings.loading')} />}
    {rows !== null && rows.length === 0 && <p className="bookings-empty">{t(`bookings.empty.${filter}`)}</p>}
    {rows !== null && shown.length > 0 && (filter === 'upcoming'
      ? groupByDay(shown).map(([day, group]) => <section key={day} className="bookings-day-group" aria-label={dayTitle(day)}>
        <h3>{dayTitle(day)}</h3>{group.map(card)}
      </section>)
      : <div className="bookings-cards">{shown.map(card)}</div>)}
    {filter === 'upcoming' && <div className="bookings-window">
      <Button variant="ghost" disabled={offset === UPCOMING_OFFSETS[0]}
        onClick={() => { forgetDecided(); setOffset((value) => UPCOMING_OFFSETS[Math.max(0, UPCOMING_OFFSETS.indexOf(value) - 1)]); }}>{t('bookings.window.earlier')}</Button>
      <span>{t('bookings.window.range', { from: dayTitle(addDays(today, offset)), to: dayTitle(addDays(today, offset + WINDOW_DAYS - 1)) })}</span>
      <Button variant="ghost" disabled={offset === UPCOMING_OFFSETS[UPCOMING_OFFSETS.length - 1]}
        onClick={() => { forgetDecided(); setOffset((value) => UPCOMING_OFFSETS[Math.min(UPCOMING_OFFSETS.length - 1, UPCOMING_OFFSETS.indexOf(value) + 1)]); }}>{t('bookings.window.later')}</Button>
    </div>}
  </div>;
}
