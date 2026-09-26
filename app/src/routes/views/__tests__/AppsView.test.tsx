import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppsView from '../AppsView';
import { LocalRepository } from '@/lib/repo/local';
import { AppsProvider } from '@/lib/apps/useApps';
import { fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import { renderWithQuery } from '@/test-support/query';

async function mount(api = fakeAppsApi()) {
  const onOpen = vi.fn();
  await renderWithQuery(<AppsProvider api={api}>
    <AppsView app={null} bookingId={null} section={null} onOpen={onOpen} onConnectCalendar={vi.fn()} />
  </AppsProvider>, { repository: new LocalRepository() });
  return { api, onOpen, user: userEvent.setup() };
}

describe('AppsView', () => {
  it('offers Bookings to set up when nothing is installed', async () => {
    const { onOpen, user } = await mount();
    await user.click(await screen.findByRole('button', { name: /Set up/ }));
    expect(onOpen).toHaveBeenCalledWith({ app: 'bookings' });
    expect(screen.queryByRole('heading', { name: 'Your apps' })).toBeNull();
  });

  it('lists an installed app with its waiting requests, and does not offer it again', async () => {
    const api = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending: 2 }], available: ['bookings' as const] })),
    });
    const { onOpen, user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: /Bookings.*2 waiting/ }));
    expect(onOpen).toHaveBeenCalledWith({ app: 'bookings' });
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull();
    expect(screen.getByText('Every available app is set up.')).toBeInTheDocument();
  });

  it('says Paused, not live, once the owner has stopped taking bookings', async () => {
    await mount(fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: false, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
    }));
    expect(await screen.findByRole('button', { name: /Bookings.*Paused/ })).toBeInTheDocument();
    expect(screen.queryByText('Your booking page is live')).toBeNull();
  });

  it('says so when the apps cannot be loaded, and retries', async () => {
    const api = fakeAppsApi({ list: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ apps: [], available: ['bookings'] }) });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
