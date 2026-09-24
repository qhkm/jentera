import { ArrowsClockwise, WhatsappLogo } from '@phosphor-icons/react';
import { Button, Tag } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { bookingWhen, calendarReasonKey, calendarTag, statusTag, whatsappKey } from '@/lib/apps/bookings';
import type { Booking } from '@/lib/apps/types';

export type BookingAction = 'confirm' | 'decline' | 'cancel' | 'retry';

/* One booking as the owner acts on it. The WhatsApp link is an ordinary link
   the owner taps, so no pop-up blocker is involved, and it never claims the
   message was sent. */
export default function BookingCard({ booking, busy, message, now, onAct, onConnectCalendar }: {
  booking: Booking;
  busy: boolean;
  message: string | null;
  now: Date;
  onAct: (action: BookingAction) => void;
  onConnectCalendar: () => void;
}) {
  const { t, lang } = useI18n();
  const status = statusTag(booking);
  const calendar = calendarTag(booking);
  const whatsapp = whatsappKey(booking);
  const future = Date.parse(booking.startsAt) > now.getTime();
  const titleId = `booking-${booking.id}`;
  return <article className="booking-card card" aria-labelledby={titleId}>
    <header className="booking-card-header">
      <h3 id={titleId}>{booking.customerName}</h3>
      <Tag tone={status.tone}>{t(status.key)}</Tag>
    </header>
    <p className="booking-card-when">
      {bookingWhen(booking.startsAt, lang)} · {booking.serviceName} · {t('bookings.party', { n: booking.partySize })}
    </p>
    {booking.note && <p className="booking-card-note">{booking.note}</p>}
    <p className="booking-card-meta">{t('bookings.reference', { reference: booking.reference })}</p>
    {calendar && <div className="booking-card-calendar">
      <Tag tone={calendar.tone}>{t(calendar.key)}</Tag>
      {booking.calendar.status === 'failed' && <span>
        {t(calendarReasonKey(booking.calendar.reason), { account: booking.calendar.account ?? t('bookings.calendar.sameAccount') })}
      </span>}
      {booking.calendar.status === 'not_connected' && booking.status === 'confirmed' && <Button variant="ghost" onClick={onConnectCalendar}>
        {t('bookings.calendar.connect')}
      </Button>}
      {booking.calendar.canRetry && <Button variant="ghost" disabled={busy} onClick={() => onAct('retry')}>
        <ArrowsClockwise size={16} aria-hidden="true" />{t('bookings.calendar.retry')}
      </Button>}
    </div>}
    {message && <p className="booking-card-message" role="alert">{message}</p>}
    <div className="booking-card-actions">
      {booking.status === 'pending' && !booking.expired && <>
        <Button variant="outline" disabled={busy} onClick={() => onAct('decline')}>{t('bookings.decline')}</Button>
        <Button disabled={busy} onClick={() => onAct('confirm')}>{t('bookings.confirm')}</Button>
      </>}
      {booking.status === 'confirmed' && future && <Button variant="ghost" disabled={busy} onClick={() => onAct('cancel')}>
        {t('bookings.cancel')}
      </Button>}
      {whatsapp && booking.whatsappUrl && <a className="btn btn-outline booking-card-whatsapp" href={booking.whatsappUrl} target="_blank" rel="noopener noreferrer">
        <WhatsappLogo size={17} aria-hidden="true" />{t(whatsapp)}
      </a>}
    </div>
  </article>;
}
