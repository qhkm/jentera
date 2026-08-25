import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RepositoryProvider, useMutate, useSnapshot } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

function Probe() {
  const snap = useSnapshot();
  const mutate = useMutate();
  return (
    <div>
      <span data-testid="type">{snap.bizType || 'none'}</span>
      <button onClick={() => void mutate((r) => r.setBizType('clinic'))}>set</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('RepositoryProvider', () => {
  it('exposes the loaded snapshot', async () => {
    localStorage.setItem('aisar-biz-type', 'restaurant');
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('restaurant'));
  });

  it('refreshes the snapshot after a write', async () => {
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('none'));

    await act(async () => {
      screen.getByText('set').click();
    });

    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('clinic'));
  });
});

describe('useSnapshot outside a provider', () => {
  it('throws a message that names the fix', () => {
    function Bare() {
      useSnapshot();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/RepositoryProvider/);
  });
});
