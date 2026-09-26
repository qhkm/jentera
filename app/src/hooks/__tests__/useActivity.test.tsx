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

import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { useActivity } from '@/hooks/useActivity';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { Activity } from '@/lib/repo';
import { renderWithQuery, returnToApp } from '@/test-support/query';

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
      <span data-testid="updated">{a.updatedAt ?? 'none'}</span>
      <button onClick={a.reload}>Refresh activity</button>
    </div>
  );
}

/** The page as the gate builds it: a signed-in page always has a cache. */
function mount(repo: LocalRepository, signedIn: boolean, client?: QueryClient) {
  return renderWithQuery(<SignedInProvider value={signedIn}><Probe /></SignedInProvider>, { repository: repo, client });
}

/** A repository whose answers the test releases one at a time. */
function heldRepo() {
  const repo = new LocalRepository();
  const waiting: ((a: Activity) => void)[] = [];
  let calls = 0;
  repo.activity = () => { calls += 1; return new Promise<Activity>((resolve) => { waiting.push(resolve); }); };
  const figures = (handled: number): Activity => ({ ...EMPTY, counters: { ...EMPTY.counters, handled } });
  return { repo, calls: () => calls, answer: (handled: number) => waiting.shift()?.(figures(handled)) };
}

describe('the anonymous demo', () => {
  it('is never treated as real', async () => {
    /* The illustration is fine for a visitor deciding whether to sign
       up. It must never be labelled as this business's own numbers. */
    await mount(new LocalRepository(), false);
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
    await mount(repo, false);
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
    await mount(repo, true);

    await waitFor(() => expect(screen.getByTestId('real')).toHaveTextContent('true'));
    expect(screen.getByTestId('handled')).toHaveTextContent('0');
  });

  it('reports real figures when there are some', async () => {
    const repo = new LocalRepository();
    repo.activity = async () => ({
      work: [],
      counters: { handled: 7, needsYou: 2, minutesSaved: 30, thisWeek: 4, connections: 1 },
    });
    await mount(repo, true);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('7'));
    expect(screen.getByTestId('real')).toHaveTextContent('true');
  });
});

describe('when the request fails', () => {
  /* Until 26 September a failed refresh emptied the figures and their time,
     and the brief dropped to its error card over numbers that were still
     true a moment before. They stay, with the time they were last read. */
  it('keeps the figures and the time they were read when a refresh fails', async () => {
    const repo = new LocalRepository();
    repo.activity = vi.fn().mockResolvedValueOnce(EMPTY).mockRejectedValueOnce(new Error('offline'));
    await mount(repo, true);
    await waitFor(() => expect(screen.getByTestId('real')).toHaveTextContent('true'));
    const updated = Number(screen.getByTestId('updated').textContent);
    expect(updated).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
    await waitFor(() => expect(repo.activity).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('real')).toHaveTextContent('true');
    expect(screen.getByTestId('handled')).toHaveTextContent('0');
    expect(Number(screen.getByTestId('updated').textContent)).toBe(updated);
  });

  it('reports not-real rather than falling back to the illustration', async () => {
    /* Falling back would put the demo's numbers in front of a
       signed-in owner and label them as theirs — the worst of the
       three outcomes. Absent figures are honest; borrowed ones are
       not. */
    const repo = new LocalRepository();
    repo.activity = async () => {
      throw new Error('offline');
    };
    await mount(repo, true);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('real')).toHaveTextContent('false');
    expect(screen.getByTestId('handled')).toHaveTextContent('none');
  });
});

describe('loading', () => {
  it('starts loading when signed in, so nothing renders a number too early', async () => {
    const repo = new LocalRepository();
    repo.activity = () => new Promise<Activity>(() => {}); // never settles
    await mount(repo, true);
    /* Awaited, because RepositoryProvider holds its children back until
       the snapshot arrives — nothing is in the DOM synchronously. */
    expect(await screen.findByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('real')).toHaveTextContent('false');
  });

  it('does not start loading in the demo', async () => {
    await mount(new LocalRepository(), false);
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
    await mount(repo, true);
    await waitFor(() => expect(screen.getByTestId('real')).toHaveTextContent('true'));
    expect(called).toBe(1);
  });
});

describe('staying current without blanking', () => {
  it('reads again when the owner comes back to the app, keeping the figures meanwhile', async () => {
    const { repo, calls, answer } = heldRepo();
    const { client } = await mount(repo, true);
    answer(7);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('7'));
    await returnToApp(client);
    await waitFor(() => expect(calls()).toBe(2));
    expect(screen.getByTestId('handled')).toHaveTextContent('7');
    expect(screen.getByTestId('real')).toHaveTextContent('true');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    answer(9);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('9'));
  });

  /* Refresh runs after every chat answer, approval and review; it used to
     empty the brief and the Activity list until the answer came back. */
  it('refreshes in place, the figures staying on screen until the new ones land', async () => {
    const { repo, calls, answer } = heldRepo();
    await mount(repo, true);
    answer(7);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('7'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
    await waitFor(() => expect(calls()).toBe(2));
    expect(screen.getByTestId('handled')).toHaveTextContent('7');
    expect(screen.getByTestId('real')).toHaveTextContent('true');
    answer(8);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('8'));
  });

  it('shows the figures again on a return inside 30 s without asking', async () => {
    const { repo, calls, answer } = heldRepo();
    const first = await mount(repo, true);
    answer(7);
    await waitFor(() => expect(screen.getByTestId('handled')).toHaveTextContent('7'));
    first.unmount();
    await mount(repo, true, first.client);
    expect(screen.getByTestId('handled')).toHaveTextContent('7');
    expect(calls()).toBe(1);
  });
});
