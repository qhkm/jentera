import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import Setup from '@/routes/Setup';
import { LocalRepository } from '@/lib/repo/local';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { RuntimeOverview } from '@/lib/repo';

class ReadyRepository extends LocalRepository {
  provisionCalls = 0;

  override async provisionRuntime(): Promise<void> {
    this.provisionCalls += 1;
  }

  override async runtimeStatus(): Promise<RuntimeOverview> {
    return {
      runtime: {
        status: 'ready' as const,
        desiredRelease: '2026.08.28-8',
        observedRelease: '2026.08.28-8',
        lastReadyAt: new Date().toISOString(),
        lastError: null,
      },
    };
  }
}

class ProvisioningRepository extends ReadyRepository {
  override async runtimeStatus(): Promise<RuntimeOverview> {
    return {
      runtime: {
        status: 'provisioning' as const,
        desiredRelease: '2026.08.28-8',
        observedRelease: null,
        lastReadyAt: null,
        lastError: null,
      },
    };
  }
}

function mount(repo: LocalRepository) {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>
          <I18nProvider>
            <ToastProvider>
              <Routes>
                <Route path="/setup" element={<Setup />} />
                <Route path="/app" element={<div data-testid="dashboard">dashboard</div>} />
              </Routes>
            </ToastProvider>
          </I18nProvider>
        </RepositoryProvider>
      </SignedInProvider>
    </MemoryRouter>,
  );
}

describe('signed-in setup', () => {
  it('shows a clear live indicator while the private runtime is provisioning', async () => {
    const repo = new ProvisioningRepository();
    await repo.setOnboarded(true);
    mount(repo);

    const indicator = (await screen.findByText('Creating your private workspace…'))
      .closest('[role="status"]');
    expect(indicator).not.toBeNull();
    expect(indicator).toHaveTextContent('Creating your private workspace…');
    expect(indicator).toHaveTextContent('checks automatically every 3 seconds');
    expect(indicator).toHaveTextContent('there is no need to refresh');
    expect(indicator).toHaveTextContent('Safe to connect Telegram or continue');
  });

  it('shows verified runtime state and re-signals provisioning idempotently', async () => {
    const repo = new ReadyRepository();
    await repo.setOnboarded(true);
    mount(repo);

    expect(await screen.findByText('installed and verified')).toBeInTheDocument();
    expect(repo.provisionCalls).toBe(1);
    expect(screen.getByText('connect Telegram below')).toBeInTheDocument();
  });

  it('persists setup completion before opening the dashboard', async () => {
    const repo = new ReadyRepository();
    await repo.setOnboarded(true);
    mount(repo);

    await userEvent.click(await screen.findByRole('button', { name: /open my dashboard/i }));
    await screen.findByTestId('dashboard');
    await waitFor(async () => expect((await repo.load()).setupDone).toBe(true));
  });
});
