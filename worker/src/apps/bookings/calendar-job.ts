import type postgres from 'postgres';

/** Record the Calendar state a booking should reach. A new revision tells a
    running executor its work is stale; a live lease is deliberately left
    alone so its result can be reconciled against the newer revision. */
export async function queueCalendarJob(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  desired: 'present' | 'absent',
  now: Date,
): Promise<void> {
  await tx`insert into booking_calendar_job (business_id, booking_id, desired, revision, attempts, next_attempt_at, updated_at)
    values (${businessId}, ${bookingId}, ${desired}, 1, 0, ${now}, ${now})
    on conflict (business_id, booking_id) do update
      set desired = excluded.desired, revision = booking_calendar_job.revision + 1, attempts = 0,
          next_attempt_at = excluded.next_attempt_at, last_error = null, updated_at = excluded.updated_at`;
}
