import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bookingListsFilter, keys, mutationKeys } from '../keys';

const BIZ = 'biz-1';
const ID = '11111111-1111-4111-8111-111111111111';

describe('query keys', () => {
  it('start with the business, for every key there is', () => {
    const all = [
      keys.business(BIZ), keys.appsList(BIZ), keys.bookings(BIZ), keys.pendingBookings(BIZ), keys.bookingWindows(BIZ),
      keys.bookingWindow(BIZ, '2026-10-05', 1), keys.bookingsConfig(BIZ), keys.booking(BIZ, ID), keys.notifications(BIZ),
      mutationKeys.bookingAction(BIZ),
    ];
    for (const key of all) expect(key.slice(0, 2)).toEqual(['biz', BIZ]);
  });

  it('reach the lists of bookings without the config that shares their prefix, and nothing of another business', () => {
    const client = new QueryClient();
    for (const key of [
      keys.pendingBookings(BIZ), keys.bookingWindow(BIZ, '2026-10-05', 1), keys.bookingWindow(BIZ, '2026-11-05', 31),
      keys.bookingsConfig(BIZ), keys.booking(BIZ, ID), keys.appsList(BIZ), keys.pendingBookings('biz-2'),
    ]) client.setQueryData(key, []);
    const found = client.getQueryCache().findAll(bookingListsFilter(BIZ)).map((query) => query.queryKey);
    expect(found).toHaveLength(3);
    expect(found).toEqual(expect.arrayContaining([
      keys.pendingBookings(BIZ), keys.bookingWindow(BIZ, '2026-10-05', 1), keys.bookingWindow(BIZ, '2026-11-05', 31),
    ]));
  });
});
