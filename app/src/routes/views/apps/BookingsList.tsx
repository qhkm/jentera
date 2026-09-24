import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { actionErrorKey, addDays, groupByDay, loadPendingBookings, loadWindow, WINDOW_DAYS } from '@/lib/apps/bookings';
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
  const [focused, setFocused] = useState<Booking | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const generation = useRef(0);

  /* Needs you when requests wait, otherwise Today — decided once, so
     confirming the last request does not pull the view away from it. */
  useEffect(() => {
    if (chosen === null && apps.pending !== null) setChosen(apps.pending.length > 0 ? 'needs' : 'today');
  }, [chosen, apps.pending]);

  const load = useCallback(async (quiet = false) => {
    const mine = ++generation.current;
    if (!quiet) {
      setRows(null);
      setFailed(false);
    }
    try {
      const today = malaysiaDay(clock.current());
      const next = filter === 'needs' ? await loadPendingBookings(api, clock.current())
        : filter === 'today' ? await loadWindow(api, { from: today, days: 1 })
          : filter === 'upcoming' ? await loadWindow(api, { from: addDays(today, offset), days: WINDOW_DAYS })
            : await loadWindow(api, { from: date, days: 1 });
      if (mine === generation.current) setRows(next);
    } catch {
      if (mine === generation.current && !quiet) setFailed(true);
    }
  }, [api, filter, offset, date]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!bookingId) {
      setFocused(null);
      return;
    }
    let live = true;
    api.booking(bookingId).then(
      (booking) => { if (live) setFocused(booking); },
      () => { if (live) setMessages((current) => ({ ...current, [bookingId]: 'bookings.error.notFound' })); },
    );
    return () => { live = false; };
  }, [api, bookingId]);

  const syncing = [...(rows ?? []), ...(focused ? [focused] : [])].some((booking) => booking.calendar.status === 'pending');
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => {
      void load(true);
      if (focused) void api.booking(focused.id).then(setFocused, () => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [syncing, load, api, focused]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  function replace(next: Booking) {
    setRows((list) => list?.map((booking) => (booking.id === next.id ? next : booking)) ?? list);
    setFocused((booking) => (booking?.id === next.id ? next : booking));
  }

  async function act(booking: Booking, action: BookingAction) {
    if (action === 'cancel' && !window.confirm(t('bookings.cancel.confirm', { name: booking.customerName }))) return;
    setBusy(booking.id);
    setMessages((current) => {
      const next = { ...current };
      delete next[booking.id];
      return next;
    });
    try {
      const result = action === 'confirm' || action === 'decline' ? await api.decide(booking.id, action)
        : action === 'cancel' ? await api.cancel(booking.id) : await api.retryCalendar(booking.id);
      replace(result.booking);
    } catch (error) {
      setMessages((current) => ({ ...current, [booking.id]: actionErrorKey(error) }));
      /* Someone else decided, or the answer was lost: show the booking as the server has it now. */
      try {
        replace(await api.booking(booking.id));
      } catch {
        /* The message stands. */
      }
    } finally {
      setBusy(null);
      void apps.refresh();
    }
  }

  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const dayTitle = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
  const card = (booking: Booking) => <BookingCard key={booking.id} booking={booking} busy={busy === booking.id}
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
    {!focused && bookingId && messages[bookingId] && <p role="alert">{t(messages[bookingId])}</p>}
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.error.load')}</p>
      <Button variant="outline" onClick={() => void load()}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && rows === null && <LoadingState title={t('bookings.loading')} />}
    {rows !== null && shown.length === 0 && <p className="bookings-empty">{t(`bookings.empty.${filter}`)}</p>}
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
