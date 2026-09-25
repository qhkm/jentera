import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import BookingsApp from '../BookingsApp';
import { LocalRepository } from '@/lib/repo/local';
import { AppsProvider } from '@/lib/apps/useApps';
import { configFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import { renderWithQuery, returnToApp } from '@/test-support/query';

async function mount(api = fakeAppsApi(), section: string | null = null, client?: QueryClient) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  const onSection = vi.fn();
  const onBack = vi.fn();
  const view = await renderWithQuery(<AppsProvider api={api}>
    <BookingsApp bookingId={null} section={section} onSection={onSection} onBack={onBack} onConnectCalendar={vi.fn()} />
  </AppsProvider>, { repository: repo, client });
  return { api, onSection, onBack, user: userEvent.setup(), client: view.client, unmount: view.unmount };
}

describe('BookingsApp', () => {
  it('shows only the setup form before Bookings is installed, then moves to the booking page', async () => {
    const api = fakeAppsApi({ bookingsConfig: vi.fn(async () => ({ installation: null, version: null, settings: null, services: [] })) });
    const { onSection, user } = await mount(api);
    expect(await screen.findByRole('heading', { name: 'Set up your booking page' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.type(screen.getByLabelText('Name'), 'Cupping class');
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Publish booking page' }));
    await waitFor(() => expect(onSection).toHaveBeenCalledWith('page'));
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('opens on the Bookings tab once installed, and switches tabs through the URL', async () => {
    const { onSection, user } = await mount();
    expect(await screen.findByRole('tab', { name: 'Bookings', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Booking page' }));
    expect(onSection).toHaveBeenCalledWith('page');
  });

  it('shows the booking page tab from the URL', async () => {
    await mount(fakeAppsApi(), 'page');
    expect(await screen.findByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
  });

  it('refreshes Home and Apps once the booking page switch is saved', async () => {
    const api = fakeAppsApi({
      saveBookingsConfig: vi.fn(async () => configFixture({ settings: { ...configFixture().settings!, accepting: false } })),
    });
    const { user } = await mount(api, 'page');
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('checkbox', { name: 'Taking bookings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ accepting: false, version: 3 }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('says so when Bookings cannot be loaded, and retries', async () => {
    const api = fakeAppsApi({ bookingsConfig: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(configFixture()) });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('tab', { name: 'Bookings' })).toBeInTheDocument();
  });

  it('shows the settings again on a revisit inside 30 s without asking the server', async () => {
    const first = await mount(fakeAppsApi(), 'page');
    expect(await screen.findByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
    first.unmount();
    await mount(first.api, 'page', first.client);
    expect(screen.getByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
    expect(first.api.bookingsConfig).toHaveBeenCalledTimes(1);
  });

  it('shows a saved switch at once from the server\'s answer, without reading the settings again', async () => {
    const api = fakeAppsApi({
      saveBookingsConfig: vi.fn(async () => configFixture({ settings: { ...configFixture().settings!, accepting: false } })),
    });
    const { user } = await mount(api, 'page');
    await user.click(await screen.findByRole('checkbox', { name: 'Taking bookings' }));
    expect(await screen.findByText(/^Paused\./)).toBeInTheDocument();
    expect(api.bookingsConfig).toHaveBeenCalledTimes(1);
  });

  /* A save from the owner's other device meanwhile, then a return to the
     app after 30 s: what they had typed here stays. Saving it is what finds
     the newer version (CONFIG_CHANGED, with Reload), not a quiet read. */
  it('keeps what the owner is typing in Settings when they come back to the app', async () => {
    let version = 3;
    const api = fakeAppsApi({ bookingsConfig: vi.fn(async () => configFixture({ version })) });
    const { client, user } = await mount(api, 'settings');
    const location = await screen.findByLabelText('Where the booking takes place');
    await user.clear(location);
    await user.type(location, 'Level 2, Wisma Kita');
    version = 4;
    await returnToApp(client);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByLabelText('Where the booking takes place')).toHaveValue('Level 2, Wisma Kita');
  });

  it('reads the settings again on a return to the app while another tab is open', async () => {
    const { api, client } = await mount(fakeAppsApi(), 'page');
    expect(await screen.findByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
    await returnToApp(client);
    await waitFor(() => expect(api.bookingsConfig).toHaveBeenCalledTimes(2));
  });
});
