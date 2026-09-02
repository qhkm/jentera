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
import type { Activity, Connection } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';

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
      outcomeQuality: null,
      qualityAt: null,
      occurredAt: '2026-08-27T04:20:20.000Z',
    },
  ],
};

/* Reads business and activity from providers. Connection state is explicit
   because Home now distinguishes a saved bot from a paired owner chat. */
function connectionState(rows: Connection[], real = true): ConnectionsState {
  return {
    rows,
    mode: real ? 'real' : 'demo',
    real,
    error: null,
    retry: () => {},
    setRows: () => {},
  };
}

function Harness({ connections = connectionState([]) }: { connections?: ConnectionsState }) {
  const b = useBusiness();
  return <HomeView b={b} connections={connections} onNavigate={() => {}} />;
}

async function mount(signedIn: boolean, activity: Activity | null, rows: Connection[] = []) {
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
                <Harness connections={connectionState(rows, signedIn)} />
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
    expect(screen.getByText(/connect Telegram to chat with Jentera from your phone/i))
      .toBeInTheDocument();
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

describe('Telegram readiness', () => {
  const unpaired: Connection = {
    id: '11111111-1111-4111-8111-111111111111',
    connector: 'telegram',
    method: 'bot_token',
    status: 'connected',
    displayName: '@owner_bot',
    externalId: '123456789',
    connectedAt: '2026-09-01T00:00:00.000Z',
    lastOkAt: '2026-09-01T00:00:00.000Z',
    lastError: null,
    paired: false,
    pairingUrl: 'https://t.me/owner_bot?start=secure-code',
  };

  it('puts the remaining Start action directly on Home', async () => {
    await mount(true, NOTHING_YET, [unpaired]);

    expect(await screen.findByText('Finish connecting Telegram')).toBeInTheDocument();
    expect(screen.getByText(/will not deliver your messages until/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open Telegram and press Start/i })).toHaveAttribute(
      'href',
      unpaired.pairingUrl,
    );
  });

  it('removes the notice once the private owner chat is paired', async () => {
    await mount(true, NOTHING_YET, [{ ...unpaired, paired: true, pairingUrl: null }]);

    await screen.findByText(/0 handled automatically/i);
    expect(screen.queryByText('Finish connecting Telegram')).toBeNull();
    expect(screen.queryByText(/connect Telegram to chat with Jentera from your phone/i)).toBeNull();
  });
});
