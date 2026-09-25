import type postgres from 'postgres';

export interface BlockedInterval { startsAt: Date; endsAt: Date }

/** Manual closures plus the latest cached Google busy ranges. Calendar
    titles never enter this table; the public Worker sees times only. */
export async function blockedIntervalsFor(
  tx: postgres.TransactionSql,
  businessId: string,
  from: Date,
  to: Date,
): Promise<BlockedInterval[]> {
  const rows = await tx<{ starts_at: Date; ends_at: Date }[]>`
    select starts_at, ends_at from booking_block
     where business_id = ${businessId} and starts_at < ${to} and ends_at > ${from}
    union all
    select b.starts_at, b.ends_at from booking_calendar_busy b
      join connection c on c.id = b.connection_id and c.business_id = b.business_id
     where b.business_id = ${businessId} and c.connector = 'google' and c.status = 'connected'
       and b.starts_at < ${to} and b.ends_at > ${from}`;
  return rows.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at }));
}

export async function hasAvailabilityConflict(
  tx: postgres.TransactionSql,
  businessId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<boolean> {
  const [row] = await tx`
    select 1 from (
      select starts_at, ends_at from booking_block where business_id = ${businessId}
      union all
      select b.starts_at, b.ends_at from booking_calendar_busy b
        join connection c on c.id = b.connection_id and c.business_id = b.business_id
       where b.business_id = ${businessId} and c.connector = 'google' and c.status = 'connected'
    ) blocked
    where blocked.starts_at < ${endsAt} and blocked.ends_at > ${startsAt}
    limit 1`;
  return Boolean(row);
}
