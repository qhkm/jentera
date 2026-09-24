import { useState } from 'react';
import { ArrowRight, WhatsappLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { actionErrorKey, bookingWhen } from '@/lib/apps/bookings';
import type { Booking } from '@/lib/apps/types';

const SHOWN = 3;

/** Booking requests waiting on the owner, inside the daily brief. */
export function BookingsNeedsYou({ items, onConfirm, onOpenAll }: {
  items: Booking[];
  onConfirm: (id: string) => Promise<Booking>;
  onOpenAll: () => void;
}) {
  const { t, lang } = useI18n();
  /* A confirmed request leaves the pending list on the next refresh; keep it
     here for this visit so its WhatsApp link stays one tap away. */
  const [done, setDone] = useState<Booking[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; key: string } | null>(null);
  const shown = [...done, ...items.filter((item) => !done.some((booking) => booking.id === item.id))].slice(0, SHOWN);
  if (shown.length === 0) return null;

  async function confirm(id: string) {
    setBusy(id);
    setProblem(null);
    try {
      const booking = await onConfirm(id);
      setDone((list) => [booking, ...list.filter((item) => item.id !== id)]);
    } catch (error) {
      setProblem({ id, key: actionErrorKey(error) });
    } finally {
      setBusy(null);
    }
  }

  return <section className="brief-bookings" aria-labelledby="brief-bookings-title">
    <h3 id="brief-bookings-title">{t('brief.bookings.title')}</h3>
    <ul>
      {shown.map((booking) => <li key={booking.id}>
        <span className="brief-booking-line">{booking.customerName} · {bookingWhen(booking.startsAt, lang)} · {booking.serviceName}</span>
        {booking.status === 'pending'
          ? <Button variant="outline" disabled={busy === booking.id} onClick={() => void confirm(booking.id)}
            aria-label={t('brief.bookings.confirm', { name: booking.customerName })}>{t('bookings.confirm')}</Button>
          : booking.whatsappUrl && <a className="btn btn-outline" href={booking.whatsappUrl} target="_blank" rel="noopener noreferrer">
            <WhatsappLogo size={16} aria-hidden="true" />{t('bookings.whatsapp.confirm')}
          </a>}
        {problem?.id === booking.id && <p role="alert" className="field-error">{t(problem.key)}</p>}
      </li>)}
    </ul>
    <button type="button" className="brief-all" onClick={onOpenAll}>
      {t('brief.bookings.all', { n: items.length })}<ArrowRight size={16} aria-hidden="true" />
    </button>
  </section>;
}
