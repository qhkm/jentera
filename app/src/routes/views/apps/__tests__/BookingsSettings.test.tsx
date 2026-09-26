import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import BookingsSettings, { slugFrom } from '../BookingsSettings';
import { LocalRepository } from '@/lib/repo/local';
import { AppsError } from '@/lib/apps/api';
import { configFixture, fakeAppsApi, SERVICE_ID } from '@/lib/apps/__tests__/fixtures';
import type { BookingsConfig } from '@/lib/apps/types';
import { createQueryClient } from '@/lib/query/client';
import { renderWithQuery } from '@/test-support/query';

const NEW: BookingsConfig = { installation: null, version: null, settings: null, services: [], blocks: [],
  calendarProtection: { connected: false, account: null, syncedAt: null, lastError: null } };

async function mount(config: BookingsConfig, api = fakeAppsApi(), client?: QueryClient) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  const onSaved = vi.fn();
  const onReload = vi.fn();
  // The repository loads asynchronously (LocalRepository.load() resolves on
  // a microtask); renderWithQuery flushes it, so every test's first
  // assertion, not only one that happens to use findBy*, sees the form.
  await renderWithQuery(<BookingsSettings api={api} config={config} onSaved={onSaved} onReload={onReload} />, { repository: repo, client });
  return { api, onSaved, onReload, user: userEvent.setup() };
}

describe('slugFrom', () => {
  it('makes a link name from a business name, or nothing when it cannot', () => {
    expect(slugFrom('Kedai Kita')).toBe('kedai-kita');
    expect(slugFrom('Café Ümmi & Co.')).toBe('cafe-ummi-co');
    expect(slugFrom('!!')).toBe('');
    expect(slugFrom('App')).toBe('');
  });
});

describe('BookingsSettings', () => {
  it('publishes a first service with weekday hours and the business link name', async () => {
    const { api, onSaved, user } = await mount(NEW);
    expect(screen.getByRole('heading', { name: 'Set up your booking page' })).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Name'), 'Cupping class');
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Publish booking page' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith({
      version: null, slug: 'kedai-kita', accepting: true, minNoticeMinutes: 120, changeCutoffMinutes: 360, horizonDays: 30, location: null, brandColor: '#4aebb5', pageTheme: 'dark', welcomeTitle: null, welcomeMessage: null,
      acknowledgeAvailabilityLimits: true,
      services: [{ id: null, name: 'Cupping class', description: null, durationMinutes: 60, capacity: 1, priceLabel: null, active: true,
        hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '09:00', closes: '17:00' })) }],
      blocks: [],
    });
    expect(onSaved).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add another service' })).toBeNull();
  });

  it('saves customer-facing service and location details', async () => {
    const { api, user } = await mount(configFixture());
    const description = screen.getByLabelText('Description (optional)');
    await user.clear(description);
    await user.type(description, 'A focused session with our team.');
    await user.click(screen.getByRole('button', { name: 'Booking page' }));
    await user.type(screen.getByLabelText('Heading (optional)'), 'Make time for yourself');
    await user.type(screen.getByLabelText('Introduction (optional)'), 'Choose the treatment that feels right today.');
    const location = screen.getByLabelText('Where the booking takes place');
    await user.clear(location);
    await user.type(location, 'Online · Link shared after confirmation');
    expect(screen.getByLabelText('Customer preview')).toHaveTextContent('Online · Link shared after confirmation');
    expect(screen.getByLabelText('Customer preview')).toHaveTextContent('Make time for yourself');
    expect(screen.getByLabelText('Customer preview')).toHaveTextContent('Choose the treatment that feels right today.');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({
      location: 'Online · Link shared after confirmation', brandColor: '#4aebb5',
      welcomeTitle: 'Make time for yourself', welcomeMessage: 'Choose the treatment that feels right today.',
      services: [expect.objectContaining({ description: 'A focused session with our team.' })],
    }));
  });

  it('saves an accent and uploads a validated logo from the booking page panel', async () => {
    const api = fakeAppsApi();
    const { onSaved, user } = await mount(configFixture(), api);
    await user.click(screen.getByRole('button', { name: 'Booking page' }));
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    const preview = screen.getByLabelText('Customer preview');
    expect(preview).toHaveTextContent('Cupping class');
    expect(preview.querySelector('.bookings-preview-calendar')).toBeInTheDocument();
    expect(preview.querySelector('.bookings-preview-times')).toBeInTheDocument();
    expect(preview.querySelector('.bookings-preview-progress')).toBeNull();
    await user.click(screen.getByRole('button', { name: '#62a8ff' }));
    expect(screen.getByLabelText('Customer preview')).toHaveStyle({ '--booking-preview-accent': '#62a8ff' });
    await user.click(screen.getByRole('button', { name: 'Light' }));
    expect(screen.getByLabelText('Customer preview').querySelector('.bookings-preview-frame')).toHaveClass('is-light');
    const logo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Add logo'), logo);
    expect(api.uploadBookingsLogo).toHaveBeenCalledWith(logo);
    expect(onSaved).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ brandColor: '#62a8ff', pageTheme: 'light' }));
  });

  it('previews service selection when more than one active service is available', async () => {
    const first = configFixture().services[0];
    const config = configFixture({ services: [first, { ...first, id: '22222222-2222-4222-8222-222222222222', name: 'Follow-up session' }] });
    const { user } = await mount(config);
    await user.click(screen.getByRole('button', { name: 'Booking page' }));
    const preview = screen.getByLabelText('Customer preview');
    expect(preview.querySelector('.bookings-preview-calendar')).toBeNull();
    expect(preview.querySelectorAll('.bookings-preview-services > div')).toHaveLength(2);
    expect(preview).toHaveTextContent('Choose a service');
    expect(preview).toHaveTextContent('Follow-up session');
  });

  it('saves the customer change deadline and explains reminder delivery accurately', async () => {
    const { api, user } = await mount(configFixture());
    await user.click(screen.getByRole('button', { name: 'Rules & reminders' }));
    await user.selectOptions(screen.getByLabelText('Customer change deadline'), '720');
    expect(screen.getByText(/does not send it automatically yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ changeCutoffMinutes: 720 }));
  });

  it('shows Calendar protection and saves a manual closure in Malaysia time', async () => {
    const { api, user } = await mount(configFixture());
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByText(/Active for owner@example.com/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Closures' }));
    await user.click(screen.getByRole('button', { name: 'Add blocked time' }));
    await user.type(screen.getByLabelText('Reason'), 'Team retreat');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-12T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-12T17:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({
      blocks: [{
        id: null,
        label: 'Team retreat',
        startsAt: '2026-10-12T01:00:00.000Z',
        endsAt: '2026-10-12T09:00:00.000Z',
      }],
    }));
  });

  it('will not publish until availability is acknowledged', async () => {
    const { api, user } = await mount(NEW);
    await user.type(await screen.findByLabelText('Name'), 'Cupping class');
    await user.click(screen.getByRole('button', { name: 'Publish booking page' }));
    expect(screen.getByText('Please confirm you understand how availability works.')).toBeInTheDocument();
    expect(api.saveBookingsConfig).not.toHaveBeenCalled();
  });

  it('points at a closing time before the opening time', async () => {
    const { api, user } = await mount(configFixture());
    await user.click(screen.getByRole('button', { name: 'Hours' }));
    fireEvent.change(screen.getByLabelText('Tuesday closes'), { target: { value: '09:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Closing time must be after opening time.')).toBeInTheDocument();
    expect(api.saveBookingsConfig).not.toHaveBeenCalled();
  });

  it('asks for a reload when the settings changed elsewhere', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('CONFIG_CHANGED', 409)) });
    const { onReload, user } = await mount(configFixture(), api);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('explains a link name that is taken and places below what is booked', async () => {
    const taken = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('SLUG_TAKEN', 409)) });
    const first = await mount(configFixture(), taken);
    await first.user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('That link name is taken. Try another.')).toBeInTheDocument();
  });

  it('marks the service whose places are below what is already booked', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('CAPACITY_BELOW_RESERVED', 409, false, SERVICE_ID)) });
    const { user } = await mount(configFixture(), api);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/already hold more places/)).toBeInTheDocument();
  });

  it('keeps a second opening range on the same day as it was saved', async () => {
    const config = configFixture({ services: [{ ...configFixture().services[0], hours: [
      { weekday: 1, opens: '09:00', closes: '12:00' }, { weekday: 1, opens: '14:00', closes: '17:00' },
    ] }] });
    const { api, user } = await mount(config);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig.mock.calls[0][0].services[0].hours).toEqual([
      { weekday: 1, opens: '09:00', closes: '12:00' }, { weekday: 1, opens: '14:00', closes: '17:00' },
    ]);
  });

  it('says before saving that existing bookings are kept, but not while setting up', async () => {
    const kept = 'Existing bookings are kept. Changing hours or turning a service off affects new requests only.';
    await mount(configFixture());
    expect(screen.getByText(kept)).toBeInTheDocument();
    cleanup();
    await mount(NEW);
    expect(screen.queryByText(kept)).toBeNull();
  });

  it('does not show a link as if it were live before the page is published', async () => {
    const { user } = await mount(NEW);
    await user.click(screen.getByRole('button', { name: 'Booking page' }));
    expect(screen.getByText('Once published, your link will end in /b/kedai-kita')).toBeInTheDocument();
    expect(screen.queryByText('…/b/kedai-kita')).toBeNull();
  });

  it('still renders when the saved link is not a full address', async () => {
    const config = configFixture({ installation: { slug: 'seido', state: 'active', publicUrl: '/b/seido' } });
    const { user } = await mount(config);
    await user.click(screen.getByRole('button', { name: 'Booking page' }));
    expect(screen.getByText('…/b/seido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument();
  });

  it('switches focused sections through the secondary settings navigation', async () => {
    const { user } = await mount(configFixture());
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    const navigation = screen.getByRole('navigation', { name: 'Booking settings sections' });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Services' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Booking page' }));
    expect(screen.getByRole('button', { name: 'Booking page' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByLabelText('Description (optional)')).toBeNull();
    expect(screen.getByText('https://sites.test/b/seido')).toBeInTheDocument();
    expect(screen.getByLabelText('Where the booking takes place')).toBeInTheDocument();
  });

  it('never sends a save twice, even when its answer was lost', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)) });
    // The production client: only its no-retry rule for writes is under test.
    const { user } = await mount(configFixture(), api, createQueryClient());
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('We could not confirm the save. Reload to check what was saved.')).toBeInTheDocument();
    expect(api.saveBookingsConfig).toHaveBeenCalledTimes(1);
  });
});
