/* ============================================================
   The third state, and why a boolean was not enough.

   `real` had to answer "are these this business's figures?" with
   `false` while the request was still in flight, and every screen read
   `false` as "show the playbook illustration". So a signed-in owner
   got someone else's dashboard on every load — 82% handled, twelve
   conversations, an approval waiting for them — until the real answer
   arrived and it was all taken away. The approval row disappearing is
   what shoved the page down; the user reported it as a layout shift,
   and it was the same lie as the last two bugs, told for 400ms.

   `pending` is the missing answer. These tests hold the distinction
   and the single shared fetch, because two fetches meant two moments
   of flipping and the sidebar could settle before the cards.
   ============================================================ */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ActivityProvider, useActivity } from '@/hooks/useActivity';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import type { Activity } from '@/lib/repo';

const EMPTY: Activity = {
  counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 },
  work: [],
};

/**
 * A repository that answers `activity()` only when told to.
 *
 * Being signed in is a context, not a property of the repository —
 * `useSignedIn` reads `SignedInProvider`, so the wrappers below are
 * what make these sessions server-backed.
 */
function serverRepo() {
  const repo = new LocalRepository();
  let release: ((a: Activity) => void) | null = null;
  const calls = { activity: 0 };

  repo.activity = () => {
    calls.activity += 1;
    return new Promise<Activity>((resolve) => {
      release = resolve;
    });
  };

  return { repo, calls, answer: (a: Activity = EMPTY) => release?.(a) };
}

function Probe({ id = 'mode' }: { id?: string }) {
  const a = useActivity();
  return <span data-testid={id}>{a.mode}</span>;
}

beforeEach(() => localStorage.clear());

describe('what mode says while the answer is in flight', () => {
  it('is pending, not demo, for a signed-in owner', async () => {
    const { repo, answer } = serverRepo();
    render(
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>
          <ActivityProvider>
            <Probe />
          </ActivityProvider>
        </RepositoryProvider>
      </SignedInProvider>,
    );

    /* The whole bug in one assertion. `demo` here is what put a
       stranger's numbers on the screen. */
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('pending'));
    expect(screen.getByTestId('mode')).not.toHaveTextContent('demo');

    answer();
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('real'));
  });

  it('becomes a recoverable error when the request fails outright', async () => {
    /* A failed fetch is still not permission to show the illustration.
       It reads as real to the person looking at it either way. */
    const repo = new LocalRepository();
    repo.activity = async () => {
      throw new Error('offline');
    };

    render(
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>
          <ActivityProvider>
            <Probe />
          </ActivityProvider>
        </RepositoryProvider>
      </SignedInProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('mode')).toHaveTextContent('error');
  });

  it('is demo when nobody is signed in', async () => {
    render(
      <SignedInProvider value={false}>
        <RepositoryProvider repository={new LocalRepository()}>
          <ActivityProvider>
            <Probe />
          </ActivityProvider>
        </RepositoryProvider>
      </SignedInProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('demo'));
  });
});

describe('one fetch for the whole dashboard', () => {
  it('does not ask twice when two screens read it', async () => {
    /* Dashboard and Home both called the hook. Two requests, and two
       independent moments of flipping out of the illustration. */
    const { repo, calls, answer } = serverRepo();
    render(
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>
          <ActivityProvider>
            <Probe id="one" />
            <Probe id="two" />
          </ActivityProvider>
        </RepositoryProvider>
      </SignedInProvider>,
    );

    /* Wait on the request, not on `pending`. `pending` is already true
       on the first render — before the effect fires — so waiting for it
       proved nothing and the count assertion below raced the fetch. */
    await waitFor(() => expect(calls.activity).toBe(1));
    expect(screen.getByTestId('one')).toHaveTextContent('pending');
    expect(screen.getByTestId('two')).toHaveTextContent('pending');

    answer();
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('real'));
    /* Both settle on the same value from the same fetch — the sidebar
       cannot be real while the cards are still pending. */
    expect(screen.getByTestId('two')).toHaveTextContent('real');
    expect(calls.activity).toBe(1);
  });

  it('still works for a consumer mounted outside the provider', async () => {
    /* A missing provider should cost a duplicate request, not a blank
       screen or a thrown error. */
    const { repo, calls, answer } = serverRepo();
    render(
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>
          <Probe />
        </RepositoryProvider>
      </SignedInProvider>,
    );

    await waitFor(() => expect(calls.activity).toBe(1));
    expect(screen.getByTestId('mode')).toHaveTextContent('pending');
    answer();
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('real'));
  });
});
