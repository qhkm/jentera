import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ActivityView from '@/routes/views/ActivityView';
import { ActivityProvider } from '@/hooks/useActivity';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import { useBusiness } from '@/hooks/useBusiness';
import type { Activity, WorkSummary } from '@/lib/repo';

const done = (over: Partial<WorkSummary>): WorkSummary => ({
  id: 'w', runId: null, objective: 'Work', outcome: 'Done.', status: 'completed', function: 'reply',
  channel: 'app', subject: null, minutesSaved: 3, outcomeQuality: null, qualityAt: null,
  occurredAt: '2026-09-12T04:20:20.000Z', kind: 'work', ...over,
});

function Harness({ onOpenTask }: { onOpenTask: (runId: string) => void }) {
  const b = useBusiness();
  return <ActivityView b={b} onOpenTask={onOpenTask} />;
}

async function mount(activity: Activity) {
  localStorage.setItem('aisar-biz-type', 'restaurant');
  localStorage.setItem('aisar-onboarded-v1', '1');
  localStorage.setItem('aisar-setup-done-v1', '1');
  const repo = new LocalRepository();
  repo.activity = async () => activity;
  const onOpenTask = vi.fn();
  render(
    <MemoryRouter>
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>
          <I18nProvider>
            <ToastProvider>
              <ActivityProvider>
                <Harness onOpenTask={onOpenTask} />
              </ActivityProvider>
            </ToastProvider>
          </I18nProvider>
        </RepositoryProvider>
      </SignedInProvider>
    </MemoryRouter>,
  );
  return onOpenTask;
}

describe('a colleague\'s private chat in Activity', () => {
  it('shows the outcome without a way to open the conversation', async () => {
    await mount({
      counters: { handled: 2, needsYou: 0, minutesSaved: 6, thisWeek: 2, connections: 1 },
      work: [
        done({ id: 'mine', runId: '11111111-1111-4111-8111-111111111111', objective: 'My digest', canOpen: true }),
        done({ id: 'theirs', runId: '22222222-2222-4222-8222-222222222222', objective: 'Their supplier list', canOpen: false }),
      ],
    });
    await screen.findByText('Their supplier list');
    expect(screen.getByText('My digest')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /View task/ })).toHaveLength(1);
  });
});
