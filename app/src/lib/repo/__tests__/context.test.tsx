import { useState } from 'react';
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

describe('RepositoryProvider identity handling', () => {
  it('binds the repository once, ignoring later identity changes of the prop', async () => {
    let loadCalls = 0;
    class CountingRepo extends LocalRepository {
      async load() {
        loadCalls++;
        return super.load();
      }
    }

    function Parent() {
      const [, rerender] = useState(0);
      return (
        <div>
          <button onClick={() => rerender((n) => n + 1)}>rerender</button>
          <RepositoryProvider repository={new CountingRepo()}>
            <Probe />
          </RepositoryProvider>
        </div>
      );
    }

    render(<Parent />);
    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('none'));
    expect(loadCalls).toBe(1);

    await act(async () => {
      screen.getByText('rerender').click();
    });
    await act(async () => {
      screen.getByText('rerender').click();
    });

    expect(loadCalls).toBe(1);
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

/* ---- failure paths -------------------------------------------------
   LocalRepository cannot fail: storage.ts catches every accessor. A
   network-backed one fails routinely, so these describe the behaviour
   RemoteRepository will actually exercise. */

class FailingLoad extends LocalRepository {
  async load(): Promise<never> {
    throw new Error('network down');
  }
}

class FailingWrite extends LocalRepository {
  async setTheme(): Promise<never> {
    throw new Error('write rejected');
  }
}

describe('load failure', () => {
  it('surfaces an error state instead of rendering nothing forever', async () => {
    render(
      <RepositoryProvider repository={new FailingLoad()}>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('network down');
  });
});

describe('write failure', () => {
  it('rejects rather than resolving silently', async () => {
    let captured: Error | null = null;

    function WriteProbe() {
      const mutate = useMutate();
      return (
        <button
          onClick={() => {
            void mutate((r) => r.setTheme('light')).catch((e: Error) => {
              captured = e;
            });
          }}
        >
          write
        </button>
      );
    }

    render(
      <RepositoryProvider repository={new FailingWrite()}>
        <WriteProbe />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByText('write')).toBeTruthy());
    await act(async () => {
      screen.getByText('write').click();
    });
    await waitFor(() => expect(captured).not.toBeNull());
    expect((captured as unknown as Error).message).toBe('write rejected');
  });
});
