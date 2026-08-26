/* ============================================================
   Advanced mode, shared.

   This shipped broken. The first version was a plain hook holding
   local state, so the header and the traces below it each kept their
   own copy: the toggle flipped and nothing else moved. It was found by
   clicking it, not by anything in this suite — which is why the suite
   now contains it.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailLevelProvider, useDetailLevel } from '@/hooks/useDetailLevel';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';

/* Two consumers, deliberately siblings rather than parent and child.
   The bug was that separate call sites disagreed, so a test with one
   consumer would have passed against the broken version. */
function Toggle() {
  const d = useDetailLevel();
  return (
    <button onClick={() => d.set(d.advanced ? 'beginner' : 'advanced')}>
      {d.advanced ? 'SIMPLE' : 'DETAIL'}
    </button>
  );
}

function Reader() {
  const d = useDetailLevel();
  return <span data-testid="reader">{d.advanced ? 'trace shown' : 'trace hidden'}</span>;
}

/** A repository that reports being signed in and remembers the level. */
function serverRepo(initial: 'beginner' | 'advanced' = 'beginner') {
  const repo = new LocalRepository();
  let level = initial;
  const writes: string[] = [];
  repo.detailLevel = async () => level;
  repo.setDetailLevel = async (l: 'beginner' | 'advanced') => {
    writes.push(l);
    level = l;
  };
  return { repo, writes };
}

/* signedIn: true, because DetailLevelProvider only asks the server
   what this person chose when there is a server. Arranged explicitly
   rather than inherited from RepositoryGate, so the test says which
   case it is exercising. */
function mount(repo: LocalRepository) {
  return render(
    <RepositoryProvider repository={repo}>
      <SignedInProvider value>
        <DetailLevelProvider>
          <Toggle />
          <Reader />
        </DetailLevelProvider>
      </SignedInProvider>
    </RepositoryProvider>,
  );
}

describe('one value, however many components read it', () => {
  it('moves both consumers together', async () => {
    /* The regression. Under the old per-hook state this passed for the
       toggle and failed for the reader. */
    const { repo } = serverRepo();
    mount(repo);
    await screen.findByText('DETAIL');
    expect(screen.getByTestId('reader')).toHaveTextContent('trace hidden');

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByTestId('reader')).toHaveTextContent('trace shown'));
    expect(screen.getByRole('button')).toHaveTextContent('SIMPLE');
  });

  it('moves them back again', async () => {
    const { repo } = serverRepo('advanced');
    mount(repo);
    await waitFor(() => expect(screen.getByTestId('reader')).toHaveTextContent('trace shown'));

    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('reader')).toHaveTextContent('trace hidden'));
  });
});

describe('persistence', () => {
  it('starts from what the person chose last time', async () => {
    const { repo } = serverRepo('advanced');
    mount(repo);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('SIMPLE'));
  });

  it('writes the change through, once', async () => {
    const { repo, writes } = serverRepo();
    mount(repo);
    await screen.findByText('DETAIL');
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(writes).toEqual(['advanced']));
  });

  it('flips immediately rather than waiting for the write', async () => {
    /* Optimistic on purpose: a toggle that pauses on a round trip
       feels broken, and a failed write is corrected on next load. */
    const repo = new LocalRepository();
    repo.detailLevel = async () => 'beginner';
    repo.setDetailLevel = () => new Promise<void>(() => {}); // never settles
    mount(repo);
    await screen.findByText('DETAIL');
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('reader')).toHaveTextContent('trace shown'));
  });
});

describe('the anonymous demo', () => {
  it('is beginner, and cannot change', async () => {
    /* LocalRepository throws on setDetailLevel and there is no trace to
       reveal, so the control must not be offered — a toggle promising
       something it cannot deliver is worse than its absence. */
    function CanChange() {
      const d = useDetailLevel();
      return <span data-testid="can">{String(d.canChange)}</span>;
    }
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <DetailLevelProvider>
          <CanChange />
          <Reader />
        </DetailLevelProvider>
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('can')).toHaveTextContent('false'));
    expect(screen.getByTestId('reader')).toHaveTextContent('trace hidden');
  });
});

describe('when the server will not say', () => {
  it('falls back to beginner rather than guessing advanced', async () => {
    /* Showing less than someone asked for is a mild annoyance. Showing
       raw traces to someone who did not ask is a confusing product. */
    const repo = new LocalRepository();
    repo.detailLevel = async () => {
      throw new Error('offline');
    };
    mount(repo);
    await waitFor(() => expect(screen.getByTestId('reader')).toHaveTextContent('trace hidden'));
  });
});
