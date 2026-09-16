import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';
import { VaultApprovalCard } from '@/components/VaultApprovalCard';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

const PENDING = {
  approval: {
    id: 'a1',
    reason: 'Send invoice 104 to the customer',
    resource: 'https://api.stripe.com',
    operations: ['send'],
    status: 'pending',
    requestedAt: '2026-09-16T01:00:00.000Z',
    expiresAt: '2026-09-16T01:10:00.000Z',
    decidedAt: null,
  },
};

function fetchFake(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function mount() {
  return render(
    <RepositoryProvider repository={new LocalRepository()}>
      <I18nProvider><VaultApprovalCard approvalId="a1" /></I18nProvider>
    </RepositoryProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('secure credential approval in chat', () => {
  it('shows the exact action, destination and single-use boundary', async () => {
    const fetch = fetchFake(() => response(PENDING));
    vi.stubGlobal('fetch', fetch);
    mount();

    expect(await screen.findByText('Send invoice 104 to the customer')).toBeInTheDocument();
    expect(screen.getByText('api.stripe.com')).toBeInTheDocument();
    expect(screen.getByText(/exact task and can be used only once/i)).toBeInTheDocument();
    expect(String(fetch.mock.calls[0][0])).toBe('/api/vault/approvals/a1');
  });

  it('sends only the decision and settles after approval', async () => {
    const fetch = fetchFake(() => response(PENDING))
      .mockImplementationOnce(() => response(PENDING))
      .mockImplementationOnce(() => response({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText(/Approved — Jentera is carrying on/i)).toBeInTheDocument());
    const [url, init] = fetch.mock.calls[1];
    expect(String(url)).toBe('/api/vault/approvals/a1/decide');
    expect(JSON.parse(String(init?.body))).toEqual({ decision: 'approve' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('fails closed but keeps a transient service failure retryable', async () => {
    const fetch = fetchFake(() => response(PENDING))
      .mockImplementationOnce(() => response(PENDING))
      .mockImplementationOnce(() => response({ err: 'unavailable' }, 503));
    vi.stubGlobal('fetch', fetch);
    mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText(/couldn't be reached/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});
