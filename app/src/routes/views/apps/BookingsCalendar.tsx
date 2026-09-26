import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { addDays, statusTag } from '@/lib/apps/bookings';
import { malaysiaDay } from '@/lib/daily-brief';
import type { Booking, BookingBlock, BookingsConfig } from '@/lib/apps/types';

export type CalendarSpan = 'day' | 'week';

export function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const distance = (date.getUTCDay() + 6) % 7;
  return addDays(day, -distance);
}

function dayBounds(day: string): [number, number] {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return [start, start + 24 * 60 * 60 * 1000];
}

function blocksForDay(blocks: BookingBlock[], day: string): BookingBlock[] {
  const [start, end] = dayBounds(day);
  return blocks.filter((block) => Date.parse(block.startsAt) < end && Date.parse(block.endsAt) > start);
}

function statusClass(booking: Booking): string {
  if (booking.status === 'pending') return booking.expired ? 'expired' : 'pending';
  return booking.status;
}

export default function BookingsCalendar({
  anchor, span, today, rows, blocks, calendarProtection, selectedId, onSelect, onNavigate, onToday, onSpan,
}: {
  anchor: string;
  span: CalendarSpan;
  today: string;
  rows: Booking[];
  blocks: BookingBlock[];
  calendarProtection: BookingsConfig['calendarProtection'] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNavigate: (direction: -1 | 1) => void;
  onToday: () => void;
  onSpan: (span: CalendarSpan) => void;
}) {
  const { t, lang } = useI18n();
  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const start = span === 'week' ? mondayOf(anchor) : anchor;
  const days = Array.from({ length: span === 'week' ? 7 : 1 }, (_, index) => addDays(start, index));
  const time = (iso: string) => new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(iso));
  const dayName = (day: string) => new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
  const rangeTitle = span === 'day'
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${start}T00:00:00Z`))
    : t('bookings.calendarView.range', { from: dayName(start), to: dayName(addDays(start, 6)) });

  const blockTime = (block: BookingBlock, day: string) => {
    const [dayStart, dayEnd] = dayBounds(day);
    const startAt = Date.parse(block.startsAt);
    const endAt = Date.parse(block.endsAt);
    if (startAt <= dayStart && endAt >= dayEnd) return t('bookings.calendarView.allDay');
    return `${time(new Date(Math.max(startAt, dayStart)).toISOString())}–${time(new Date(Math.min(endAt, dayEnd)).toISOString())}`;
  };

  return <section className="bookings-calendar" aria-label={t('bookings.calendarView.label')}>
    <header className="bookings-calendar-toolbar">
      <div className="bookings-calendar-period">
        <Button variant="ghost" aria-label={t('bookings.calendarView.previous')} onClick={() => onNavigate(-1)}>
          <CaretLeft size={17} aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={onToday}>{t('bookings.calendarView.today')}</Button>
        <Button variant="ghost" aria-label={t('bookings.calendarView.next')} onClick={() => onNavigate(1)}>
          <CaretRight size={17} aria-hidden="true" />
        </Button>
        <strong>{rangeTitle}</strong>
      </div>
      <div className="bookings-calendar-span" role="group" aria-label={t('bookings.calendarView.period')}>
        {(['day', 'week'] as const).map((option) => <button key={option} type="button" className={span === option ? 'active' : ''}
          aria-pressed={span === option} onClick={() => onSpan(option)}>{t(`bookings.calendarView.${option}`)}</button>)}
      </div>
    </header>
    {calendarProtection?.connected && <p className={`bookings-calendar-protection${calendarProtection.lastError ? ' warning' : ''}`}>
      <span aria-hidden="true" />
      {calendarProtection.lastError
        ? t('bookings.calendarView.protectionProblem')
        : t('bookings.calendarView.protected', { account: calendarProtection.account ?? t('bookings.settings.calendarProtection.calendar') })}
    </p>}
    <div className={`bookings-calendar-grid ${span === 'day' ? 'is-day' : ''}`}>
      {days.map((day) => {
        const dayBookings = rows.filter((booking) => malaysiaDay(new Date(booking.startsAt)) === day);
        const dayBlocks = blocksForDay(blocks, day);
        return <section key={day} className={`bookings-calendar-day${day === today ? ' is-today' : ''}`} aria-label={dayName(day)}>
          <header>
            <span>{new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))}</span>
            <strong>{Number(day.slice(-2))}</strong>
          </header>
          <div className="bookings-calendar-items">
            {dayBlocks.map((block) => <div className="bookings-calendar-block" key={`${day}-${block.id}`}>
              <small>{blockTime(block, day)}</small><span>{block.label}</span>
            </div>)}
            {dayBookings.map((booking) => {
              const status = statusTag(booking);
              return <button type="button" key={booking.id}
                className={`bookings-calendar-event ${statusClass(booking)}${selectedId === booking.id ? ' selected' : ''}`}
                aria-pressed={selectedId === booking.id} onClick={() => onSelect(booking.id)}>
                <small>{time(booking.startsAt)}–{time(booking.endsAt)}</small>
                <strong>{booking.customerName}</strong>
                <span>{booking.serviceName}</span>
                <i>{t(status.key)}</i>
              </button>;
            })}
            {dayBookings.length === 0 && dayBlocks.length === 0 && <p className="bookings-calendar-free">{t('bookings.calendarView.open')}</p>}
          </div>
        </section>;
      })}
    </div>
  </section>;
}
