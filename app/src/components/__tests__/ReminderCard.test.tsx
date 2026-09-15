import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderCard } from '@/components/ReminderCard';
import { ReminderError, reminderRequest } from '@/lib/reminders';

vi.mock('@/i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en' }) }));
vi.mock('@/pwa/push', () => ({ usePushNotifications: () => ({ state: 'off', busy: false, enable: async () => 'denied' }) }));
vi.mock('@/lib/reminders', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reminders')>(), reminderRequest: vi.fn() }));
const request = vi.mocked(reminderRequest);
const id = '11111111-1111-4111-8111-111111111111';
const reminder = { id, message: 'Call Ali', dueAt: '2027-01-01T01:00:00.000Z', timeZone: 'Asia/Kuala_Lumpur', status: 'scheduled' as const };
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-13T00:00:00Z')); });
afterEach(() => { vi.restoreAllMocks(); });

describe('ReminderCard', () => {
  it('preserves the model timestamp through confirmation', async () => {
    request.mockRejectedValueOnce(new ReminderError('Not found', 404));
    render(<ReminderCard draft={{ id, message: 'Call Ali', dueAt: '2027-01-01T01:03:35.000Z' }} />);
    expect((await screen.findByLabelText('Date and time') as HTMLInputElement).value).toBe('2027-01-01T09:03');
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ reminder });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reminder' }));
    expect(request).toHaveBeenLastCalledWith(id, 'POST', { id, message: 'Call Ali', dueAt: '2027-01-01T01:03:35.000Z', timeZone: 'Asia/Kuala_Lumpur' });
  });
  it('does not save until confirmed, shows server receipt and allows cancellation', async () => {
    request.mockRejectedValueOnce(new ReminderError('Not found', 404));
    render(<ReminderCard draft={{ id, message: 'Call Ali' }} />);
    const date = await screen.findByLabelText('Date and time');
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.change(date, { target: { value: '2027-01-01T09:00' } });
    request.mockResolvedValueOnce({ reminder, push: 'not_enabled' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reminder' }));
    expect(await screen.findByText('Reminder scheduled')).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith(id, 'POST', { id, message: 'Call Ali', dueAt: '2027-01-01T01:00:00.000Z', timeZone: 'Asia/Kuala_Lumpur' });
    expect(screen.getByText(/still appear in Notifications/)).toBeInTheDocument();
    request.mockResolvedValueOnce({ reminder: { ...reminder, status: 'cancelled' } });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reminder' }));
    expect(await screen.findByText('Reminder cancelled')).toBeInTheDocument();
  });
  it('recovers a saved reminder on reload without posting again', async () => {
    request.mockResolvedValueOnce({ reminder });
    render(<ReminderCard draft={{ id, message: 'Call Ali' }} />);
    expect(await screen.findByText('Reminder scheduled')).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Confirm reminder' })).not.toBeInTheDocument();
  });
  it('blocks saving after an ambiguous response until status is checked', async () => {
    request.mockRejectedValueOnce(new ReminderError('Not found', 404));
    render(<ReminderCard draft={{ id, message: 'Call Ali' }} />);
    fireEvent.change(await screen.findByLabelText('Date and time'), { target: { value: '2027-01-01T09:00' } });
    request.mockRejectedValueOnce(new TypeError('Network lost'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reminder' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm reminder' })).toBeDisabled());
    request.mockResolvedValueOnce({ reminder });
    await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Reminder scheduled')).toBeInTheDocument();
    expect(request.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1);
  });
});
