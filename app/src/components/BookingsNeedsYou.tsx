import { useState } from 'react';
import { ArrowRight, WhatsappLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { actionErrorKey, bookingWhen, unconfirmedErrorKey, whatsappKey } from '@/lib/apps/bookings';
import type { Booking } from '@/lib/apps/types';

const SHOWN = 3;

/** Booking requests waiting on the owner, inside the daily brief. */
export function BookingsNeedsYou({ items, onConfirm, onReread, onOpenAll }: {
  items: Booking[];
  onConfirm: (id: string) => Promise<Booking>;
  /** The booking as the server has it now, after a confirm that failed or got no answer. */
  onReread: (id: string) => Promise<Booking>;
  onOpenAll: () => void;
}) {
  const { t, lang } = useI18n();
  /* A confirmed request leaves the pending list on the next refresh; keep it
     here for this visit so its WhatsApp link stays one tap away. */
  const [done, setDone] = useState<Booking[]>([]);
  /* Requests a re-read showed no longer wait on the owner (decided, or their
     time has passed). They stop counting as waiting at once rather than at
     the next refresh, which could fail and leave a Confirm that only 409s;
     a decided one stays shown through `done`, an expired one leaves. */
  const [gone, setGone] = useState<string[]>([]);
  const [moved, setMoved] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; key: string } | null>(null);
  const waiting = items.filter((item) => !gone.includes(item.id));
  const shown = [...done, ...waiting.filter((item) => !done.some((booking) => booking.id === item.id))].slice(0, SHOWN);
  if (shown.length === 0 && !moved) return null;

  async function confirm(booking: Booking) {
    setBusy(booking.id);
    setProblem(null);
    setMoved(null);
    try {
      const confirmed = await onConfirm(booking.id);
      setDone((list) => [confirmed, ...list.filter((item) => item.id !== booking.id)]);
    } catch (error) {
      const key = actionErrorKey(error);
      /* Someone else decided, or the answer was lost: say so only against
         the booking as the server has it now. */
      try {
        const fresh = await onReread(booking.id);
        if (fresh.status === 'pending' && !fresh.expired) setProblem({ id: booking.id, key });
        else if (fresh.status !== 'pending') {
          /* Decided — by this confirm whose answer was lost, or elsewhere.
             Either way the customer may not have been told yet, so keep the
             line as it now stands, with its WhatsApp link, like a success. */
          setDone((list) => [fresh, ...list.filter((item) => item.id !== booking.id)]);
          setGone((list) => [...list, booking.id]);
          setProblem({ id: booking.id, key });
        } else {
          /* Its time has passed: nothing left to decide or send. */
          setGone((list) => [...list, booking.id]);
          setMoved(booking.customerName);
        }
      } catch {
        setProblem({ id: booking.id, key: unconfirmedErrorKey(key) });
      }
    } finally {
      setBusy(null);
    }
  }

  return <section className="brief-bookings" aria-labelledby="brief-bookings-title">
    <h3 id="brief-bookings-title">{t('brief.bookings.title')}</h3>
    {shown.length > 0 && <ul>
      {shown.map((booking) => {
        const link = whatsappKey(booking);
        return <li key={booking.id}>
          <span className="brief-booking-line">{booking.customerName} · {bookingWhen(booking.startsAt, lang)} · {booking.serviceName}</span>
          {booking.status === 'pending' && !booking.expired
            ? <Button variant="outline" disabled={busy === booking.id} onClick={() => void confirm(booking)}
              aria-label={t('brief.bookings.confirm', { name: booking.customerName })}>{t('bookings.confirm')}</Button>
            : link && booking.whatsappUrl && <a className="btn btn-outline" href={booking.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <WhatsappLogo size={16} aria-hidden="true" />{t(link)}
            </a>}
          {problem?.id === booking.id && <p role="alert" className="field-error">{t(problem.key)}</p>}
        </li>;
      })}
    </ul>}
    {moved && <p role="status" className="brief-bookings-note">{t('brief.bookings.moved', { name: moved })}</p>}
    <button type="button" className="brief-all" onClick={onOpenAll}>
      {t('brief.bookings.all', { n: waiting.length })}<ArrowRight size={16} aria-hidden="true" />
    </button>
  </section>;
}
