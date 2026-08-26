/* ============================================================
   The two writes that decide which screen you land on.

   `onboarded` gates whether /app bounces back to /onboard, and
   `setupDone` gates which stage of the command centre appears. Both
   are written at the end of a flow and immediately followed by a
   navigation, so both are races the moment writes cross a network —
   harmless against localStorage, which is exactly why they would have
   survived local testing and failed in production.

   These tests hold the ordering: the write lands, then the navigation.
   They also hold what each flow collects, because a flow that
   navigates correctly while dropping the owner's answers is no better.
   ============================================================ */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import Setup from '@/routes/Setup';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';

/** Records the order of writes and navigations as one sequence. */
function tracked() {
  const order: string[] = [];
  const repo = new LocalRepository();
  const realSetupDone = repo.setSetupDone.bind(repo);
  let release: (() => void) | null = null;

  repo.setSetupDone = async (v: boolean) => {
    /* Held open so the test can prove the navigation waits rather than
       merely happening to come second. */
    if (release === null) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    order.push('write');
    return realSetupDone(v);
  };

  return { repo, order, releaseWrite: () => release?.() };
}

function mount(repo: LocalRepository, order: string[]) {
  function Landed() {
    order.push('navigated');
    return <div data-testid="landed">app</div>;
  }
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <ToastProvider>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/app" element={<Landed />} />
            </Routes>
          </ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());

describe('finishing setup', () => {
  it('records that setup is done', async () => {
    const repo = new LocalRepository();
    mount(repo, []);
    const finish = await screen.findByRole('button', { name: /open my dashboard|skip for now/i });
    await userEvent.click(finish);

    await waitFor(() => expect(localStorage.getItem('aisar-setup-done-v1')).toBe('1'));
  });

  it('lands on the command centre', async () => {
    const repo = new LocalRepository();
    const order: string[] = [];
    mount(repo, order);
    await userEvent.click(
      await screen.findByRole('button', { name: /open my dashboard|skip for now/i }),
    );
    await screen.findByTestId('landed');
  });

  it('waits for the write before navigating', async () => {
    /* The ordering that matters. setSetupDone decides which stage of
       the command centre renders; arriving first shows the wrong one.
       The stubbed write is held open, so a navigation that did not
       await would be recorded before it. */
    const { repo, order, releaseWrite } = tracked();
    mount(repo, order);
    await userEvent.click(
      await screen.findByRole('button', { name: /open my dashboard|skip for now/i }),
    );

    // Still on /setup: the write has not resolved.
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual([]);
    expect(screen.queryByTestId('landed')).toBeNull();

    releaseWrite();
    await screen.findByTestId('landed');
    expect(order).toEqual(['write', 'navigated']);
  });

  it('still navigates when the write fails', async () => {
    /* Deliberate: trapping someone on a screen whose only action just
       failed is worse than letting them through to a dashboard that
       shows an earlier stage. The provider surfaces the error. */
    const repo = new LocalRepository();
    repo.setSetupDone = async () => {
      throw new Error('offline');
    };
    mount(repo, []);
    await userEvent.click(
      await screen.findByRole('button', { name: /open my dashboard|skip for now/i }),
    );
    await screen.findByTestId('landed');
  });
});

describe('what onboarding writes', () => {
  /* Driven through the repository rather than the six-step UI: the
     ordering guarantee lives in activate(), and the flow's screens are
     covered by the characterization suite. What matters here is that
     the three writes a completed onboarding makes are the three the
     rest of the app reads. */
  it('sets the three values the app gates on', async () => {
    const repo = new LocalRepository();
    await repo.setChannels(['WhatsApp']);
    await repo.setBizType('salon');
    await repo.setOnboarded(true);

    const snap = await repo.load();
    expect(snap.channels).toEqual(['WhatsApp']);
    expect(snap.bizType).toBe('salon');
    expect(snap.onboarded).toBe(true);
  });

  it('leaves a half-finished onboarding un-onboarded', async () => {
    /* Someone who abandons the flow must land back in it, not in a
       command centre configured from a guess they never confirmed. */
    const repo = new LocalRepository();
    await repo.setBizType('salon');
    const snap = await repo.load();
    expect(snap.bizType).toBe('salon');
    expect(snap.onboarded).toBe(false);
  });

  it('collapses an empty channel choice back to unanswered', async () => {
    /* Recorded as it is, not as it ought to be. `channels` folds an
       explicit empty selection into null, exactly the conflation that
       had to be undone for connections — but here it costs only a
       re-prompt, because nothing seeds defaults from it. Worth knowing
       if that ever changes; not worth a schema change today. */
    const repo = new LocalRepository();
    expect((await repo.load()).channels).toBeNull();
    await repo.setChannels([]);
    expect((await repo.load()).channels).toBeNull();
  });
});
