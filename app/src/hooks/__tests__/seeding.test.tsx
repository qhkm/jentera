/* ============================================================
   Seeding a business's default connections.

   Five lines of logic with two production incidents behind them, both
   caused by the same thing: an empty connection list is indistinguishable
   from "never seeded".

   The first was a self-reverting disconnect — the effect listed `snap`
   in its dependencies, `snap` gets a new identity after every mutate
   anywhere in the app, and removing the last connection therefore
   re-seeded it within the same render.

   The second is the one these tests were written to settle rather than
   assume: what happens when the owner corrects a wrong business-type
   guess after connections have already been seeded.
   ============================================================ */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useBusiness } from '@/hooks/useBusiness';
import { RepositoryProvider, useMutate } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { planSeedConnections } from '@/lib/business';
import type { BusinessSnapshot } from '@/lib/repo/types';

function Probe() {
  const b = useBusiness();
  return (
    <div>
      <span data-testid="conns">{b.connections.join(',') || 'none'}</span>
      <span data-testid="type">{b.bizKey}</span>
      <button onClick={() => b.toggleConn(b.connections[0])}>drop first</button>
    </div>
  );
}

function mount(repo = new LocalRepository()) {
  return render(
    <RepositoryProvider repository={repo}>
      <Probe />
    </RepositoryProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('the rule itself', () => {
  const snap = (conns: string[] | null) =>
    ({ conns, bizType: 'restaurant' }) as BusinessSnapshot;

  it('seeds a business that has never been set up', () => {
    expect(planSeedConnections(snap(null), 'restaurant')).not.toBeNull();
  });

  it('does not seed over an existing choice', () => {
    expect(planSeedConnections(snap(['WhatsApp']), 'restaurant')).toBeNull();
  });

  it('does not seed over a deliberately empty list', () => {
    /* The bug this file found. Empty used to mean "never seeded", so
       an owner who disconnected everything got it all back on their
       next load — their choice silently undone by a default. Null is
       never-seeded now; empty is an answer. */
    expect(planSeedConnections(snap([]), 'restaurant')).toBeNull();
  });
});

describe('seeding through the hook', () => {
  it('fills in the defaults for a new business', async () => {
    localStorage.setItem('aisar-biz-type', 'restaurant');
    mount();
    await waitFor(() => expect(screen.getByTestId('conns')).not.toHaveTextContent('none'));
  });

  it('does not undo a disconnection', async () => {
    /* The first incident. `snap` changes identity after every mutate
       anywhere in the app; if the effect watched it, removing the last
       connection would be re-seeded in the same render cycle and the
       control would look broken. */
    localStorage.setItem('aisar-biz-type', 'restaurant');
    mount();
    await waitFor(() => expect(screen.getByTestId('conns')).not.toHaveTextContent('none'));
    const before = screen.getByTestId('conns').textContent!.split(',');

    await userEvent.click(screen.getByRole('button', { name: /drop first/i }));

    await waitFor(() =>
      expect(screen.getByTestId('conns').textContent!.split(',')).toHaveLength(before.length - 1),
    );
    // And it stays dropped — the effect must not put it back.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('conns').textContent!.split(',')).toHaveLength(before.length - 1);
  });

  it('does not reseed when every connection is removed', async () => {
    /* The sharpest version of the same trap: an owner who disconnects
       everything has expressed a choice, and an empty list must not be
       read as "never seeded" on the next render. */
    localStorage.setItem('aisar-biz-type', 'restaurant');
    localStorage.setItem('aisar-conns', JSON.stringify([]));
    mount();
    await waitFor(() => expect(screen.getByTestId('type')).toHaveTextContent('restaurant'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('conns')).toHaveTextContent('none');
  });
});

describe('correcting a wrong guess', () => {
  it('does not carry the previous type’s connections across', async () => {
    /* Onboarding infers a business type and seeds that type's
       connections during the scan. If the owner then corrects the
       guess, the seed has already happened — so without care a salon
       keeps a restaurant's connections, chosen by a guess the owner
       explicitly rejected. */
    function Correcting() {
      const b = useBusiness();
      const mutate = useMutate();
      return (
        <div>
          <span data-testid="conns">{b.connections.join(',') || 'none'}</span>
          <span data-testid="type">{b.bizKey}</span>
          <button onClick={() => void mutate((r) => r.setBizType('salon'))}>correct</button>
        </div>
      );
    }

    localStorage.setItem('aisar-biz-type', 'restaurant');
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <Correcting />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('conns')).not.toHaveTextContent('none'));
    const asRestaurant = screen.getByTestId('conns').textContent!;

    await userEvent.click(screen.getByRole('button', { name: /correct/i }));
    await waitFor(() => expect(screen.getByTestId('type')).toHaveTextContent('salon'));
    await new Promise((r) => setTimeout(r, 50));

    /* Recorded as an observation, not an aspiration. Seeding is keyed
       on "has anything been chosen", so a correction after the seed
       keeps the first type's list. Naming the cost here means a future
       change to this behaviour is deliberate and visible. */
    expect(
      screen.getByTestId('conns').textContent,
      'a corrected business type keeps the rejected guess’s connections',
    ).toBe(asRestaurant);
  });
});
