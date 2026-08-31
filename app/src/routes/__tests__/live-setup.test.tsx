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
import type { Connection, RuntimeOverview } from '@/lib/repo';

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

class RegionRepository extends ReadyRepository {
  override async runtimeStatus(): Promise<RuntimeOverview> {
    const current = await super.runtimeStatus();
    return {
      runtime: current.runtime ? {
        ...current.runtime,
        observedRegion: 'fra',
        expectedRegion: 'sin',
        regionStatus: 'different',
      } : null,
    };
  }
}

class PairedRepository extends ReadyRepository {
  override async connections(): Promise<Connection[]> {
    return [{
      id: '11111111-1111-4111-8111-111111111111',
      connector: 'telegram',
      method: 'bot_token',
      status: 'connected',
      displayName: '@owner_bot',
      externalId: '123456789',
      connectedAt: new Date().toISOString(),
      lastOkAt: new Date().toISOString(),
      lastError: null,
      paired: true,
      pairingUrl: null,
    }];
  }
}

class WaitingForStartRepository extends ReadyRepository {
  override async connections(): Promise<Connection[]> {
    return [{
      id: '11111111-1111-4111-8111-111111111111',
      connector: 'telegram',
      method: 'bot_token',
      status: 'connected',
      displayName: '@owner_bot',
      externalId: '123456789',
      connectedAt: new Date().toISOString(),
      lastOkAt: new Date().toISOString(),
      lastError: null,
      paired: false,
      pairingUrl: 'https://t.me/owner_bot?start=secure-code',
    }];
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
    expect(indicator).toHaveTextContent('Safe to connect Telegram or continue to web chat');
  });

  it('shows verified runtime state and re-signals provisioning idempotently', async () => {
    const repo = new ReadyRepository();
    await repo.setOnboarded(true);
    mount(repo);

    expect(await screen.findByText('installed and verified')).toBeInTheDocument();
    expect(repo.provisionCalls).toBe(1);
    expect(screen.getByText(/optional — connect Telegram below/)).toBeInTheDocument();
    expect(screen.getByText('Jentera app')).toBeInTheDocument();
    expect(screen.getByText('coming soon')).toBeInTheDocument();
  });

  it('shows the observed region without treating a placement difference as broken', async () => {
    const repo = new RegionRepository();
    await repo.setOnboarded(true);
    mount(repo);

    expect(await screen.findByText(
      'installed and verified in Frankfurt (FRA); Singapore (SIN) is preferred',
    )).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('allows the built-in web chat without requiring Telegram', async () => {
    const repo = new ReadyRepository();
    await repo.setOnboarded(true);
    mount(repo);

    await userEvent.click(await screen.findByRole('button', { name: /open my dashboard/i }));
    await screen.findByTestId('dashboard');
    await waitFor(async () => expect((await repo.load()).setupDone).toBe(true));
  });

  it('makes the required Telegram Start step unmistakable after the bot is saved', async () => {
    const repo = new WaitingForStartRepository();
    await repo.setOnboarded(true);
    mount(repo);

    expect(await screen.findByText('bot saved — open Telegram and press Start below'))
      .toBeInTheDocument();
    expect(screen.getByText('Finish connecting Telegram')).toBeInTheDocument();
    expect(screen.getByText(/will not deliver your messages yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open Telegram and press Start/i })).toHaveAttribute(
      'href',
      'https://t.me/owner_bot?start=secure-code',
    );
  });

  it('persists setup completion before opening the dashboard after pairing', async () => {
    const repo = new PairedRepository();
    await repo.setOnboarded(true);
    mount(repo);

    await userEvent.click(await screen.findByRole('button', { name: /open my dashboard/i }));
    await screen.findByTestId('dashboard');
    await waitFor(async () => expect((await repo.load()).setupDone).toBe(true));
  });
});
