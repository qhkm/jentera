import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RepositoryProvider, useMutate } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { useBusiness } from '@/hooks/useBusiness';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { PLAYBOOKS } from '@/lib/data/playbooks';
import Onboard from '@/routes/Onboard';

function Probe() {
  const b = useBusiness();
  const mutate = useMutate();
  return (
    <div>
      <span data-testid="conns">{JSON.stringify(b.connections)}</span>
      <button onClick={() => void mutate((r) => r.setConnections([]))}>disconnect-all</button>
      <button onClick={() => void mutate((r) => r.setTheme('light'))}>unrelated-mutate</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('useBusiness connection seeding', () => {
  it('does not re-seed connections after an unrelated mutate once the user has disconnected everything', async () => {
    localStorage.setItem('aisar-biz-type', 'restaurant');

    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <Probe />
      </RepositoryProvider>,
    );

    // Mount seeds the playbook defaults since aisar-conns starts unset.
    await waitFor(() => {
      const seeded = JSON.parse(screen.getByTestId('conns').textContent ?? '[]') as string[];
      expect(seeded.length).toBeGreaterThan(0);
    });

    // The user disconnects down to zero.
    await act(async () => {
      screen.getByText('disconnect-all').click();
    });
    await waitFor(() => expect(screen.getByTestId('conns').textContent).toBe('[]'));

    // An unrelated mutate elsewhere in the app (theme toggle, language switch,
    // profile save, ...) must not resurrect the seeded defaults.
    await act(async () => {
      screen.getByText('unrelated-mutate').click();
    });

    expect(screen.getByTestId('conns').textContent).toBe('[]');
  });
});

function ConnectionsProbe() {
  const b = useBusiness();
  return <span data-testid="live-conns">{JSON.stringify(b.connections)}</span>;
}

describe('useBusiness connection seeding after a corrected onboarding guess', () => {
  it('seeds connections for the playbook the user confirmed, not the scan step\'s first guess', async () => {
    const onboarding = render(
      <RepositoryProvider>
        <I18nProvider>
          <ToastProvider>
            <MemoryRouter>
              <Onboard />
            </MemoryRouter>
          </ToastProvider>
        </I18nProvider>
      </RepositoryProvider>,
    );

    // Describe a bakery manually. The scan step guesses "bakery" from that text
    // and, pre-fix, eagerly seeded bakery's connections before the user ever
    // confirmed anything.
    fireEvent.click(await screen.findByText('Enter manually'));
    fireEvent.change(screen.getByPlaceholderText('e.g. I run a grocery shop in Kuala Lumpur'), {
      target: { value: 'I run a bakery' },
    });
    fireEvent.click(screen.getByText('Build my profile →'));

    // Ride out the scan animation into the confirm step.
    await waitFor(() => screen.getByText('Not quite, let me rephrase'), { timeout: 3000 });

    // Reject the guess, then explicitly pick a different playbook.
    fireEvent.click(screen.getByText('Not quite, let me rephrase'));
    fireEvent.click(await screen.findByText('Choose a business type instead'));
    fireEvent.click(screen.getByText('Salon / Beauty'));

    // Leave onboarding and mount the dashboard the way production actually
    // reaches useBusiness -- /onboard itself never calls the hook, so any
    // eager seed from the scan step can only be observed on a later mount
    // reading the same persisted store.
    onboarding.unmount();
    render(
      <RepositoryProvider>
        <ConnectionsProbe />
      </RepositoryProvider>,
    );

    const salonConns = PLAYBOOKS.salon.conns.filter((c) => c.on).map((c) => c.n);
    const bakeryConns = PLAYBOOKS.bakery.conns.filter((c) => c.on).map((c) => c.n);

    await waitFor(
      () => {
        const live = JSON.parse(screen.getByTestId('live-conns').textContent ?? '[]') as string[];
        expect(live).toEqual(salonConns);
      },
      { timeout: 3000 },
    );

    const live = JSON.parse(screen.getByTestId('live-conns').textContent ?? '[]') as string[];
    expect(live).not.toEqual(bakeryConns);
  });
});
