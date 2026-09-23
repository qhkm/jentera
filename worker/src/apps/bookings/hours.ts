import type postgres from 'postgres';

/* A service's weekly opening hours, read once and grouped per service.
   Shared by the owner's config read (config.ts) and the public page
   (public.ts) so the query and the grouping live in exactly one place. */

export interface HoursRow { service_id: string; weekday: number; opens: string; closes: string }

/** All of a business's booking_hours rows, ordered by weekday then opening
    time; `serviceId` narrows to one service's rows for the same order. */
export async function readHours(tx: postgres.TransactionSql, businessId: string, serviceId?: string): Promise<HoursRow[]> {
  return tx<HoursRow[]>`
    select service_id, weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
      from booking_hours where business_id = ${businessId}
      ${serviceId ? tx`and service_id = ${serviceId}` : tx``}
     order by weekday, opens`;
}

/** One service's ranges out of a set of rows, in the shape callers store on a service. */
export function hoursFor(rows: HoursRow[], serviceId: string): { weekday: number; opens: string; closes: string }[] {
  return rows.filter((h) => h.service_id === serviceId).map(({ weekday, opens, closes }) => ({ weekday, opens, closes }));
}
