import type { QueryFilters } from '@tanstack/react-query';

/* Every query key starts with the business it belongs to, so data read for
   one business can never be drawn under another. Build keys here only. */

export const keys = {
  business: (businessId: string) => ['biz', businessId] as const,
  appsList: (businessId: string) => ['biz', businessId, 'apps', 'list'] as const,
  /** Prefix of every Bookings list AND the Bookings config: use
      `bookingListsFilter` to reach the lists alone. */
  bookings: (businessId: string) => ['biz', businessId, 'apps', 'bookings'] as const,
  pendingBookings: (businessId: string) => ['biz', businessId, 'apps', 'bookings', 'pending'] as const,
  /** Prefix of every window (Today, Upcoming, a picked date). */
  bookingWindows: (businessId: string) => ['biz', businessId, 'apps', 'bookings', 'window'] as const,
  bookingWindow: (businessId: string, from: string, days: number) =>
    ['biz', businessId, 'apps', 'bookings', 'window', from, days] as const,
  bookingsConfig: (businessId: string) => ['biz', businessId, 'apps', 'bookings', 'config'] as const,
  booking: (businessId: string, bookingId: string) => ['biz', businessId, 'apps', 'booking', bookingId] as const,
  notifications: (businessId: string) => ['biz', businessId, 'notifications'] as const,
  goals: (businessId: string) => ['biz', businessId, 'goals'] as const,
  activity: (businessId: string) => ['biz', businessId, 'activity'] as const,
  connections: (businessId: string) => ['biz', businessId, 'connections'] as const,
};

/** Mutation keys live apart from query keys, scoped the same way. */
export const mutationKeys = {
  bookingAction: (businessId: string) => ['biz', businessId, 'apps', 'booking-action'] as const,
};

/** Every cached list of bookings (the waiting requests and each window),
    and not the config that shares their prefix. */
export function bookingListsFilter(businessId: string): QueryFilters {
  return {
    queryKey: keys.bookings(businessId),
    predicate: (query) => query.queryKey[4] === 'pending' || query.queryKey[4] === 'window',
  };
}
