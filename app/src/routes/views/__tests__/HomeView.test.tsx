/* ============================================================
   The glance card contradicting itself.

   "1 handled automatically" sat directly above "No activity yet.
   Jentera will show completed work here." Two adjacent lines, one of
   them wrong, because the counter reads the run counters and the line
   beneath it read the playbook's work list — which is empty for every
   real business, so the line was unconditional for anyone signed in.

   Found by watching a real Telegram reply complete on production, not
   by a type error: both halves are individually correct.
   ============================================================ */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import HomeView from '@/routes/views/HomeView';
import { ActivityProvider } from '@/hooks/useActivity';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { useBusiness } from '@/hooks/useBusiness';
import type { Activity } from '@/lib/repo';

const NOTHING_YET: Activity = {
  counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 1 },
  work: [],
};

/** One completed reply — the state the production test ended in. */
const ONE_HANDLED: Activity = {
  counters: { handled: 1, needsYou: 0, minutesSaved: 6, thisWeek: 1, connections: 1 },
  work: [
    {
      id: 'run-1',
      runId: 'run-1',
      objective: 'Reply to qhkm on Telegram',
      outcome: 'Sent the reply.',
      status: 'completed',
      function: 'reply',
      channel: 'telegram',
      subject: 'qhkm',
      minutesSaved: 6,
      occurredAt: '2026-08-27T04:20:20.000Z',
    },
  ],
};

/* Reads its session and figures from the providers around it, which is
   what decides `mode` — nothing here needs props. */
function Harness() {
  const b = useBusiness();
  return <HomeView b={b} onNavigate={() => {}} />;
}

async function mount(signedIn: boolean, activity: Activity | null) {
  localStorage.setItem('aisar-biz-type', 'restaurant');
  localStorage.setItem('aisar-onboarded-v1', '1');
  localStorage.setItem('aisar-setup-done-v1', '1');
  const repo = new LocalRepository();
  if (activity) repo.activity = async () => activity;

  return render(
    <MemoryRouter>
      <SignedInProvider value={signedIn}>
        <RepositoryProvider repository={repo}>
          <I18nProvider>
            <ToastProvider>
              <ActivityProvider>
                <Harness />
              </ActivityProvider>
            </ToastProvider>
          </I18nProvider>
        </RepositoryProvider>
      </SignedInProvider>
    </MemoryRouter>,
  );
}

const NO_ACTIVITY = /no activity yet/i;

beforeEach(() => localStorage.clear());

describe('a business that has handled something', () => {
  it('is not also told it has no activity', async () => {
    /* The bug, in one assertion. */
    await mount(true, ONE_HANDLED);
    expect(await screen.findByText(/1 handled automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(NO_ACTIVITY)).toBeNull();
  });
});

describe('a business that has genuinely done nothing', () => {
  it('still gets told so', async () => {
    /* The line is not simply deleted — it is true here and it is the
       only thing on the card that says what to expect. */
    await mount(true, NOTHING_YET);
    expect(await screen.findByText(/0 handled automatically/i)).toBeInTheDocument();
    expect(screen.getByText(NO_ACTIVITY)).toBeInTheDocument();
  });

  it('shows one clear next action instead of making the owner search settings', async () => {
    await mount(true, NOTHING_YET);
    expect(await screen.findByText('Give Jentera something real to work from')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add business knowledge/i })).toBeInTheDocument();
  });
});

describe('while the figures are still loading', () => {
  it('does not claim there is no activity before it knows', async () => {
    /* `pending` renders the layout with nothing in it. Asserting "no
       activity yet" before the answer arrives is the same guess the
       demo flash was. */
    const never = new Promise<Activity>(() => {});
    localStorage.setItem('aisar-biz-type', 'restaurant');
    localStorage.setItem('aisar-onboarded-v1', '1');
    localStorage.setItem('aisar-setup-done-v1', '1');
    const repo = new LocalRepository();
    repo.activity = () => never;

    render(
      <MemoryRouter>
        <SignedInProvider value>
          <RepositoryProvider repository={repo}>
            <I18nProvider>
              <ToastProvider>
                <ActivityProvider>
                  <Harness />
                </ActivityProvider>
              </ToastProvider>
            </I18nProvider>
          </RepositoryProvider>
        </SignedInProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/handled automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(NO_ACTIVITY)).toBeNull();
  });
});

describe('the anonymous demo', () => {
  it('keeps the line it has always had', async () => {
    await mount(false, null);
    expect(await screen.findByText(/handled automatically/i)).toBeInTheDocument();
  });
});
