import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RepositoryProvider, useMutate } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { useBusiness } from '@/hooks/useBusiness';

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
