import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { AppsError } from '@/lib/apps/api';
import {
  actionErrorKey, addDays, groupByDay, loadPendingBookings, loadWindow, unconfirmedErrorKey, WINDOW_DAYS,
} from '@/lib/apps/bookings';
import { malaysiaDay } from '@/lib/daily-brief';
import type { AppsApi, Booking } from '@/lib/apps/types';
import BookingCard, { type BookingAction } from './BookingCard';

type Filter = 'needs' | 'today' | 'upcoming' | 'date';
const POLL_MS = 10_000;
/** Upcoming reaches 90 days ahead in three windows. */
const UPCOMING_OFFSETS = [0, 31, 62];

export default function BookingsList({ api, bookingId, onConnectCalendar, now = () => new Date() }: {
  api: AppsApi;
  bookingId: string | null;
  onConnectCalendar: () => void;
  now?: () => Date;
}) {
  const { t, lang } = useI18n();
  const apps = useApps();
  const clock = useRef(now);
  clock.current = now;
  const [chosen, setChosen] = useState<Filter | null>(null);
  const filter: Filter = chosen ?? 'today';
  const [offset, setOffset] = useState(0);
  const [date, setDate] = useState(() => malaysiaDay(now()));
  const [rows, setRows] = useState<Booking[] | null>(null);
  const rowsRef = useRef<Booking[] | null>(null);
  rowsRef.current = rows;
  const [focused, setFocused] = useState<Booking | null>(null);
  const focusedRef = useRef<Booking | null>(null);
  focusedRef.current = focused;
  const [focusedError, setFocusedError] = useState<string | null>(null);
  const focusedErrorRef = useRef<string | null>(null);
  focusedErrorRef.current = focusedError;
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const generation = useRef(0);
  /** ids confirmed/declined/cancelled while this view has been open. Kept
      across a quiet reload even once they drop out of a status-scoped fetch
      — Needs you's pending-only scan is the case that otherwise drops a
      card (and its WhatsApp link) the moment it is decided. */
  const decidedHere = useRef<Set<string>>(new Set());
  /** Bumped when an action starts, and again when it settles, so a load
      already in flight can tell a stale read from a trustworthy one. */
  const actionEpoch = useRef(0);
  const actionsInFlight = useRef(0);
  /** Set when a load (or the pinned card's re-read) is discarded as stale
      while an action is still in flight — there is no other trigger left to
      pick it up, since the action that raced it does not itself reload.
      `act`'s `finally` consumes these once nothing is acting any more. */
  const reloadOwed = useRef(false);
  const refetchFocusedOwed = useRef(false);
  /** The waiting requests the shared scan just found, when they are what
      chose Needs you. The first Needs you load shows them instead of running
      the same three-window scan again straight after; every later load
      (a chip, a poll, a return to the app) reads fresh. */
  const seed = useRef<Booking[] | null>(null);

  /* Needs you when requests wait, otherwise Today — decided once, so
     confirming the last request does not pull the view away from it. Also
     resolved (to Today) if the apps list itself failed, so this does not
     wait forever on a count that will never arrive. */
  useEffect(() => {
    if (chosen === null && (apps.pending !== null || apps.error)) {
      const needs = apps.pending !== null && apps.pending.length > 0;
      if (needs) seed.current = apps.pending;
      setChosen(needs ? 'needs' : 'today');
    }
  }, [chosen, apps.pending, apps.error]);

  const load = useCallback(async (quiet = false) => {
    const mine = ++generation.current;
    const epoch = actionEpoch.current;
    if (!quiet) {
      setRows(null);
      setFailed(false);
      decidedHere.current.clear();
    }
    try {
      const today = malaysiaDay(clock.current());
      const seeded = filter === 'needs' && !quiet ? seed.current : null;
      seed.current = null;
      const next = seeded ? seeded
        : filter === 'needs' ? await loadPendingBookings(api, clock.current())
        : filter === 'today' ? await loadWindow(api, { from: today, days: 1 })
          : filter === 'upcoming' ? await loadWindow(api, { from: addDays(today, offset), days: WINDOW_DAYS })
            : await loadWindow(api, { from: date, days: 1 });
      if (mine !== generation.current) return;
      if (epoch !== actionEpoch.current) {
        /* An action started or settled while this fetch was in flight, so it
           may already be stale relative to what the owner just did. Drop it
           rather than risk overwriting a fresher result. If nothing is
           acting right now, ask again immediately (through the ref, so a
           filter/offset/date change since this call started is not lost);
           otherwise nothing else will retry this once the action settles
           except `act`'s own `finally`, so mark it owed. */
        if (actionsInFlight.current === 0) void loadRef.current(true);
        else reloadOwed.current = true;
        return;
      }
      reloadOwed.current = false;
      setFailed(false);
      setRows((current) => {
        const byId = new Map((current ?? []).map((booking) => [booking.id, booking] as const));
        const freshIds = new Set(next.map((booking) => booking.id));
        const kept = [...decidedHere.current]
          .filter((id) => !freshIds.has(id) && byId.has(id))
          .map((id) => byId.get(id)!);
        return [...next, ...kept].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      });
    } catch {
      if (mine === generation.current && (!quiet || rowsRef.current === null)) setFailed(true);
    }
  }, [api, filter, offset, date]);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    /* Nothing to fetch yet: the default filter (Needs you vs Today) is
       still undecided. Gate on `chosen` alone — the effect above already
       resolves it to a real filter exactly once `apps.pending`/`apps.error`
       are known, so re-checking those here either let a Today request
       through the moment they were already resolved at mount, or fired a
       second, identical Today request when the default landed on Today
       anyway (same value as the pre-decision fallback, but a different
       `chosen`). Also deliberately not watching `apps.pending`/`apps.error`
       directly — refresh() (run after every action) hands back a new array
       each time even when nothing about the count changed, and watching it
       would re-run this load on every action instead of only once. */
    if (chosen === null) return;
    void load();
  }, [load, chosen]);

  useEffect(() => {
    setFocusedError(null);
    if (!bookingId) {
      setFocused(null);
      return;
    }
    let live = true;
    api.booking(bookingId).then(
      (booking) => { if (live) setFocused(booking); },
      (error) => {
        if (!live) return;
        setFocusedError(error instanceof AppsError && error.status === 404 ? 'bookings.error.notFound' : 'bookings.error.load');
      },
    );
    return () => { live = false; };
  }, [api, bookingId]);

  /* Re-reads one booking without trusting the result if an action started
     or settled meanwhile — or if, by the time it resolves, that id is no
     longer the row (row or pinned card) it was fetched for. A discarded
     re-read of the pinned card specifically has nowhere else to be retried
     from (unlike a row's poll, which just tries again next tick), so it is
     marked owed when that happens while an action is in flight. */
  const refetch = useCallback(async (id: string) => {
    const epoch = actionEpoch.current;
    try {
      const fresh = await api.booking(id);
      if (epoch !== actionEpoch.current) {
        if (id === focusedRef.current?.id) {
          if (actionsInFlight.current === 0) void refetch(id);
          else refetchFocusedOwed.current = true;
        }
        return;
      }
      setRows((list) => list?.map((booking) => (booking.id === fresh.id ? fresh : booking)) ?? list);
      setFocused((booking) => (booking?.id === fresh.id ? fresh : booking));
    } catch {
      /* Keep the last known row; the next poll tick tries again. */
    }
  }, [api]);

  const syncingIds = new Set<string>();
  for (const booking of rows ?? []) if (booking.calendar.status === 'pending') syncingIds.add(booking.id);
  if (focused && focused.calendar.status === 'pending') syncingIds.add(focused.id);
  /* A stable key (not the Set itself, recreated every render) so the
     interval below is only torn down and rearmed when the syncing ids
     actually change. */
  const syncingKey = [...syncingIds].sort().join(',');
  useEffect(() => {
    if (!syncingKey) return;
    const ids = syncingKey.split(',');
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      for (const id of ids) void refetch(id);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [syncingKey, refetch]);

  useEffect(() => {
    let live = true;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
      if (focusedRef.current) {
        void refetch(focusedRef.current.id);
      } else if (bookingId && focusedErrorRef.current && focusedErrorRef.current !== 'bookings.error.notFound') {
        /* The deep link failed for a reason that might not still hold —
           unlike a 404, which will not change on retry — so try it again. */
        api.booking(bookingId).then(
          (booking) => { if (live) { setFocused(booking); setFocusedError(null); } },
          (error) => { if (live) setFocusedError(error instanceof AppsError && error.status === 404 ? 'bookings.error.notFound' : 'bookings.error.load'); },
        );
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [load, refetch, api, bookingId]);

  function replace(next: Booking) {
    setRows((list) => list?.map((booking) => (booking.id === next.id ? next : booking)) ?? list);
    setFocused((booking) => (booking?.id === next.id ? next : booking));
  }

  async function act(booking: Booking, action: BookingAction) {
    if (action === 'cancel' && !window.confirm(t('bookings.cancel.confirm', { name: booking.customerName }))) return;
    if (action !== 'retry') decidedHere.current.add(booking.id);
    actionsInFlight.current += 1;
    actionEpoch.current += 1;
    setBusy((current) => new Set(current).add(booking.id));
    setMessages((current) => {
      const next = { ...current };
      delete next[booking.id];
      return next;
    });
    try {
      const result = action === 'confirm' || action === 'decline' ? await api.decide(booking.id, action)
        : action === 'cancel' ? await api.cancel(booking.id) : await api.retryCalendar(booking.id);
      replace(result.booking);
      if (action === 'retry' && !result.calendarQueued && result.booking.calendar.status === 'not_connected') {
        /* Retry answers "nothing to do" while no Calendar is connected; say so
           rather than let the tap look ignored. */
        setMessages((current) => ({ ...current, [booking.id]: 'bookings.calendar.stillNotConnected' }));
      }
    } catch (error) {
      const key = actionErrorKey(error);
      /* Someone else decided, or the answer was lost: show the booking as the server has it now. */
      try {
        const fresh = await api.booking(booking.id);
        replace(fresh);
        setMessages((current) => ({ ...current, [booking.id]: key }));
      } catch {
        /* The re-read failed too — do not claim to be showing the booking
           "as it stands" when we could not confirm what that is. */
        setMessages((current) => ({ ...current, [booking.id]: unconfirmedErrorKey(key) }));
      }
    } finally {
      actionsInFlight.current -= 1;
      actionEpoch.current += 1;
      setBusy((current) => {
        const next = new Set(current);
        next.delete(booking.id);
        return next;
      });
      if (actionsInFlight.current === 0) {
        /* Pick up whatever a discarded load or pinned-card re-read left
           owed while this (or another overlapping) action was in flight —
           nothing else was going to retry either of them. */
        if (reloadOwed.current) {
          reloadOwed.current = false;
          void loadRef.current(true);
        }
        if (refetchFocusedOwed.current) {
          refetchFocusedOwed.current = false;
          if (focusedRef.current) void refetch(focusedRef.current.id);
        }
      }
      void apps.refresh();
    }
  }

  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const dayTitle = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
  const card = (booking: Booking) => <BookingCard key={booking.id} booking={booking} busy={busy.has(booking.id)}
    message={messages[booking.id] ? t(messages[booking.id]) : null} now={clock.current()}
    onAct={(action) => void act(booking, action)} onConnectCalendar={onConnectCalendar} />;
  const shown = (rows ?? []).filter((booking) => booking.id !== focused?.id);
  const today = malaysiaDay(clock.current());
  const waiting = apps.pending?.length ?? 0;

  return <div className="bookings-list">
    <div className="bookings-filters" role="group" aria-label={t('bookings.filters')}>
      {(['needs', 'today', 'upcoming'] as const).map((option) => <Chip key={option} active={filter === option} aria-pressed={filter === option}
        onClick={() => { setChosen(option); setOffset(0); }}>
        {t(`bookings.filter.${option}`)}{option === 'needs' && waiting > 0 ? ` (${waiting})` : ''}
      </Chip>)}
      <label className="bookings-date">{t('bookings.date.pick')}
        <input className="input" type="date" value={date}
          onChange={(event) => { if (event.target.value) { setDate(event.target.value); setChosen('date'); } }} />
      </label>
    </div>
    {focused && <section className="bookings-focused" aria-labelledby="bookings-focused-title">
      <h2 id="bookings-focused-title">{t('bookings.focused')}</h2>
      {card(focused)}
    </section>}
    {!focused && bookingId && focusedError && <p role="alert">{t(focusedError)}</p>}
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.error.load')}</p>
      <Button variant="outline" onClick={() => void load()}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && rows === null && <LoadingState title={t('bookings.loading')} />}
    {rows !== null && rows.length === 0 && <p className="bookings-empty">{t(`bookings.empty.${filter}`)}</p>}
    {rows !== null && shown.length > 0 && (filter === 'upcoming'
      ? groupByDay(shown).map(([day, list]) => <section key={day} className="bookings-day-group" aria-label={dayTitle(day)}>
        <h3>{dayTitle(day)}</h3>{list.map(card)}
      </section>)
      : <div className="bookings-cards">{shown.map(card)}</div>)}
    {filter === 'upcoming' && <div className="bookings-window">
      <Button variant="ghost" disabled={offset === UPCOMING_OFFSETS[0]}
        onClick={() => setOffset((value) => UPCOMING_OFFSETS[Math.max(0, UPCOMING_OFFSETS.indexOf(value) - 1)])}>{t('bookings.window.earlier')}</Button>
      <span>{t('bookings.window.range', { from: dayTitle(addDays(today, offset)), to: dayTitle(addDays(today, offset + WINDOW_DAYS - 1)) })}</span>
      <Button variant="ghost" disabled={offset === UPCOMING_OFFSETS[UPCOMING_OFFSETS.length - 1]}
        onClick={() => setOffset((value) => UPCOMING_OFFSETS[Math.min(UPCOMING_OFFSETS.length - 1, UPCOMING_OFFSETS.indexOf(value) + 1)])}>{t('bookings.window.later')}</Button>
    </div>}
  </div>;
}
