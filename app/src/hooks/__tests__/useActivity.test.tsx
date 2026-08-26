/* ============================================================
   Real figures, or none — never a mix.

   This also shipped wrong. The dashboard showed three honest zeros
   directly beneath "3 handled automatically", a demo customer
   complaint in Recent Activity, and an amber badge claiming something
   was waiting on an account whose own card said nothing was. Every
   half was individually defensible; together they were incoherent.

   The rule these tests hold: `real` is true only when the figures
   belong to this business. Everything on screen keys off that single
   flag, so a screen cannot show one source above and another below.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useActivity } from '@/hooks/useActivity';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { Activity } from '@/lib/repo';

const EMPTY: Activity = {
  work: [],
  counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 },
};

function Probe() {
  const a = useActivity();
  return (
    <div>
      <span data-testid="real">{String(a.real)}</span>
      <span data-testid="loading">{String(a.loading)}</span>
      <span data-testid="handled">{a.data ? a.data.counters.handled : 'none'}</span>
    </div>
  );
}

function mount(repo: LocalRepository, signedIn: boolean) {
  return render(
    <RepositoryProvider repository={repo}>
      <SignedInProvider value={signedIn}>
        <Probe />
      </SignedInProvider>
    </RepositoryProvider>,
  );
}

describe('the anonymous demo', () => {
  it('is never treated as real', async () => {
    /* The illustration is fine for a visitor deciding whether to sign
       up. It must never be labelled as this business's own numbers. */
    mount(new LocalRepository(), false);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('real')).toHaveTextContent('false');
    expect(screen.getByTestId('handled')).toHaveTextContent('none');
  });

  it('does not call the server at all', async () => {
    let called = 0;
    const repo = new LocalRepository();
    repo.activity = async () => {
      called += 1;
      return EMPTY;
    };
    mount(repo, false);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(called).toBe(0);
  });
});

describe('a signed-in business', () => {
  it('reports its own figures as real, even when they are all zero', async () => {
    /* The case the first version got wrong. Zero handled is a true
       statement about a new account; falling back to the playbook's
       numbers because zero "looks empty" is a lie. */
    const repo = new LocalRepository();
    repo.activity = async () => EMPTY;
    mount(repo, true);

    await waitFor(() => expect(screen.getByTestId('real')).toHaveTextContent('true'));
    expect(screen.getByTestId('handled')).toHaveTextContent('0');
  });

  it('reports real figures when there are some', async () => {
    const repo = new LocalRepository();
    repo.activity = async () => ({
      work: [],
      counters: { handled: 7, needsYou: 2, minutesSaved: 30, thisWeek: 4, connections: 1 },
    });
    mount(repo, true);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('7'));
    expect(screen.getByTestId('real')).toHaveTextContent('true');
  });
});

describe('when the request fails', () => {
  it('reports not-real rather than falling back to the illustration', async () => {
    /* Falling back would put the demo's numbers in front of a
       signed-in owner and label them as theirs — the worst of the
       three outcomes. Absent figures are honest; borrowed ones are
       not. */
    const repo = new LocalRepository();
    repo.activity = async () => {
      throw new Error('offline');
    };
    mount(repo, true);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('real')).toHaveTextContent('false');
    expect(screen.getByTestId('handled')).toHaveTextContent('none');
  });
});

describe('loading', () => {
  it('starts loading when signed in, so nothing renders a number too early', async () => {
    const repo = new LocalRepository();
    repo.activity = () => new Promise<Activity>(() => {}); // never settles
    mount(repo, true);
    /* Awaited, because RepositoryProvider holds its children back until
       the snapshot arrives — nothing is in the DOM synchronously. */
    expect(await screen.findByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('real')).toHaveTextContent('false');
  });

  it('does not start loading in the demo', async () => {
    mount(new LocalRepository(), false);
    expect(await screen.findByTestId('loading')).toHaveTextContent('false');
  });

  it('asks once, not once per render', async () => {
    /* React 18 double-invokes effects in development; without the
       guard this fired two identical requests on every mount. */
    let called = 0;
    const repo = new LocalRepository();
    repo.activity = async () => {
      called += 1;
      return EMPTY;
    };
    mount(repo, true);
    await waitFor(() => expect(screen.getByTestId('real')).toHaveTextContent('true'));
    expect(called).toBe(1);
  });
});
