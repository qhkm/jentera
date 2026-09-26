import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingPage from '../BookingPage';
import { LocalRepository } from '@/lib/repo/local';
import { AppsError } from '@/lib/apps/api';
import { configFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import { keys } from '@/lib/query/keys';
import { renderWithQuery, TEST_BUSINESS_ID } from '@/test-support/query';

async function mount(api = fakeAppsApi(), config = configFixture()) {
  const onChange = vi.fn();
  const onReload = vi.fn();
  const user = userEvent.setup();
  const { client } = await renderWithQuery(<BookingPage api={api} config={config} onChange={onChange} onReload={onReload} />,
    { repository: new LocalRepository() });
  return { api, onChange, onReload, user, client };
}
afterEach(() => { Reflect.deleteProperty(navigator, 'share'); });

describe('BookingPage', () => {
  it('shows the live link, copies it, and opens it in a new tab', async () => {
    const { user } = await mount();
    expect(screen.getByText(/Taking booking requests/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe('https://sites.test/b/seido');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open page' });
    expect(open).toHaveAttribute('href', 'https://sites.test/b/seido');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Cupping class')).toBeInTheDocument();
  });

  it('offers Share only where the device can share', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('pauses with the saved version, and hands back the saved config', async () => {
    const paused = configFixture({ settings: { ...configFixture().settings!, accepting: false } });
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn(async () => paused) });
    const { client, onChange, user } = await mount(api);
    await user.click(screen.getByRole('checkbox', { name: 'Taking bookings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ version: 3, accepting: false, slug: 'seido' }));
    expect(onChange).toHaveBeenCalledWith(paused);
    // The answer is the cached config now, with no second read.
    expect(client.getQueryData(keys.bookingsConfig(TEST_BUSINESS_ID))).toEqual(paused);
    expect(api.bookingsConfig).not.toHaveBeenCalled();
  });

  it('asks for a reload when the switch meets a newer version', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('CONFIG_CHANGED', 409)) });
    const { onReload, user } = await mount(api);
    await user.click(screen.getByRole('checkbox', { name: 'Taking bookings' }));
    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });
});
