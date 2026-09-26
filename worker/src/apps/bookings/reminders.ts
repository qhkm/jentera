import type postgres from 'postgres';
import { connect, withTenant } from '../../db';
import type { Env } from '../../env';
import { createNotification } from '../../notifications/store';
import { ownersOf } from '../../notifications/recipients';
import { appsEnabledFor } from '../gating';
import { whenText, type Lang } from './messages';

export const BOOKING_REMINDER_OFFSETS = [1440, 120] as const;

export async function scheduleBookingReminders(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  startsAt: Date,
  now: Date,
): Promise<void> {
  for (const offset of BOOKING_REMINDER_OFFSETS) {
    const due = new Date(startsAt.getTime() - offset * 60_000);
    // A late confirmation must not produce two immediate, misleading nudges.
    if (due.getTime() <= now.getTime()) continue;
    await tx`insert into booking_reminder
      (business_id, booking_id, offset_minutes, due_at, status, created_at, updated_at)
      values (${businessId}, ${bookingId}, ${offset}, ${due}, 'pending', ${now}, ${now})
      on conflict (business_id, booking_id, offset_minutes) do update
        set due_at = excluded.due_at, status = 'pending', notified_at = null, updated_at = excluded.updated_at`;
  }
}

export async function cancelBookingReminders(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  now: Date,
): Promise<void> {
  await tx`update booking_reminder set status = 'cancelled', updated_at = ${now}
    where business_id = ${businessId} and booking_id = ${bookingId} and status = 'pending'`;
}

function words(lang: Lang, offset: number, name: string, service: string, startsAt: Date) {
  const when = whenText(startsAt, lang);
  if (lang === 'bm') return {
    title: offset === 1440 ? 'Peringatan WhatsApp esok' : 'Peringatan WhatsApp dalam 2 jam',
    body: `${name} · ${when} · ${service}. Buka untuk menghantar peringatan.`,
  };
  return {
    title: offset === 1440 ? 'WhatsApp reminder due tomorrow' : 'WhatsApp reminder due in 2 hours',
    body: `${name} · ${when} · ${service}. Open to send the reminder.`,
  };
}

export interface BookingReminderSummary { notified: number; skipped: number; errors: number }

/** The minute cron creates an owner notification, not a customer delivery.
    The booking card has the wa.me link the owner explicitly opens. */
export async function dispatchBookingReminders(
  env: Env,
  options: { now?: Date; limit?: number } = {},
): Promise<BookingReminderSummary> {
  const summary = { notified: 0, skipped: 0, errors: 0 };
  if (env.APPS_ENABLED !== 'true') return summary;
  const now = options.now ?? new Date();
  const sql = connect(env);
  let due: { business_id: string; booking_id: string; offset_minutes: number }[];
  try {
    due = await sql<{ business_id: string; booking_id: string; offset_minutes: number }[]>`
      select business_id, booking_id, offset_minutes
        from public.booking_reminders_due(${now.toISOString()}::timestamptz, ${options.limit ?? 100})`;
  } finally {
    await sql.end();
  }
  for (const item of due) {
    if (!appsEnabledFor(env, item.business_id)) { summary.skipped += 1; continue; }
    try {
      const sent = await withTenant(env, item.business_id, async (tx) => {
        const [reminder] = await tx<{ status: string; due_at: Date }[]>`select status, due_at from booking_reminder
          where business_id = ${item.business_id} and booking_id = ${item.booking_id}
            and offset_minutes = ${item.offset_minutes} for update`;
        if (!reminder || reminder.status !== 'pending' || reminder.due_at.getTime() > now.getTime()) return false;
        const [booking] = await tx<{ customer_name: string; service_name: string; starts_at: Date; status: string }[]>`
          select customer_name, service_name, starts_at, status from booking
           where business_id = ${item.business_id} and id = ${item.booking_id} for update`;
        if (!booking || booking.status !== 'confirmed' || booking.starts_at.getTime() <= now.getTime()) {
          await tx`update booking_reminder set status = 'cancelled', updated_at = ${now}
            where business_id = ${item.business_id} and booking_id = ${item.booking_id}
              and offset_minutes = ${item.offset_minutes}`;
          return false;
        }
        const [business] = await tx<{ lang: Lang }[]>`select lang from business where id = ${item.business_id}`;
        const lang: Lang = business?.lang === 'bm' ? 'bm' : 'en';
        const copy = words(lang, item.offset_minutes, booking.customer_name, booking.service_name, booking.starts_at);
        for (const owner of await ownersOf(tx, item.business_id)) {
          await createNotification(tx, item.business_id, {
            recipientUserId: owner, kind: 'booking_requested', title: copy.title, body: copy.body,
            sourceKey: `booking-reminder:${item.booking_id}:${item.offset_minutes}`,
            url: `/app?view=apps&app=bookings&booking=${item.booking_id}`,
          });
        }
        await tx`update booking_reminder set status = 'notified', notified_at = ${now}, updated_at = ${now}
          where business_id = ${item.business_id} and booking_id = ${item.booking_id}
            and offset_minutes = ${item.offset_minutes}`;
        return true;
      });
      if (sent) summary.notified += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`[bookings-reminders] business=${item.business_id} booking=${item.booking_id} ${error instanceof Error ? error.name : 'error'}`);
    }
  }
  return summary;
}
