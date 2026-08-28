import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PermissionsPanel from '@/routes/views/PermissionsPanel';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

async function mount() {
  render(
    <RepositoryProvider repository={new LocalRepository()}>
      <I18nProvider>
        <ToastProvider>
          <PermissionsPanel />
        </ToastProvider>
      </I18nProvider>
    </RepositoryProvider>,
  );
  await userEvent.click(await screen.findByText('Customise individual actions'));
}

beforeEach(() => localStorage.clear());

describe('private agent action controls', () => {
  it('offers only actions the private assistant can use today', async () => {
    await mount();

    for (const name of [
      'Read business information',
      'Review business records',
      'Prepare an export',
      'Update business memory',
    ]) {
      expect(screen.getByRole('radiogroup', { name })).toBeInTheDocument();
    }

    for (const name of [
      'Create a booking',
      'Message a customer',
      'Cancel a booking',
      'Issue a refund',
      'Make a payment',
    ]) {
      expect(screen.queryByRole('radiogroup', { name })).toBeNull();
    }
  });

  it('explains when customer and transaction actions will appear', async () => {
    await mount();
    expect(screen.getByText('Unavailable for now')).toBeInTheDocument();
    expect(screen.getByText(/working and you connect a supported account/i)).toBeInTheDocument();
  });
});
