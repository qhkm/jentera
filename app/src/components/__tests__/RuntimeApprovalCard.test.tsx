import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { RuntimeApprovalCard } from '@/components/RuntimeApprovalCard';

/**
 * The card is how an owner answers a question the agent asked, and what it
 * approves is a command running on Jentera's machine. So the paths worth
 * pinning are not the rendering: they are which outcome settles the card and
 * which one leaves it answerable.
 */

function mount(approvalId = 'a1') {
  return render(
    <RepositoryProvider repository={new LocalRepository()}>
      <I18nProvider>
        <RuntimeApprovalCard approvalId={approvalId} />
      </I18nProvider>
    </RepositoryProvider>,
  );
}

const PENDING = {
  approval: { id: 'a1', tool: 'terminal', message: 'wrangler login', status: 'pending' },
};

function jsonOnce(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/**
 * A fake `fetch` carrying the real one's signature.
 *
 * `vi.fn(() => ...)` types its call tuple as `[]`, so `mock.calls[0][1]` reads
 * as `never` and every assertion about what was *sent* checks nothing. The
 * worker suite had eighty-four of those; this file nearly added three more.
 */
function fetchFake(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('answering an approval from the chat', () => {
  it('asks the API what is being approved rather than trusting the stream', async () => {
    const fetch = fetchFake(() => jsonOnce(PENDING));
    vi.stubGlobal('fetch', fetch);
    mount();

    /* The tool name and the command are model output, so they are shown as
       text. The card exists to let a person read them before deciding. */
    expect(await screen.findByText('terminal')).toBeInTheDocument();
    expect(screen.getByText('wrangler login')).toBeInTheDocument();

    /* "Approve and run" invites the wrong mental model; the report that
       started this was `wrangler login`, which on a sprite authenticates the
       sprite and opens a page the owner would never see. */
    expect(screen.getByText(/Jentera's own machine, not yours/i)).toBeInTheDocument();

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('/api/runtime/approvals/a1');
    expect(init?.credentials).toBe('include');
  });

  it('posts the decision and then settles', async () => {
    const fetch = fetchFake(() => jsonOnce(PENDING))
      .mockImplementationOnce(() => jsonOnce(PENDING))
      .mockImplementationOnce(() => jsonOnce({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText(/Approved — Jentera is carrying on/i)).toBeInTheDocument();
    });
    const [url, init] = fetch.mock.calls[1];
    expect(String(url)).toBe('/api/runtime/approvals/a1/decide');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ decision: 'approve' });
    /* Settled means settled: no second answer to a question already answered. */
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('keeps the buttons live on a 503, because that decision was released', async () => {
    /* 503 is the one retryable outcome: the claim goes back to pending, so
       the owner's answer was not recorded and asking again is correct.
       Anything else settles the card instead of inviting a double answer. */
    const fetch = fetchFake(() => jsonOnce(PENDING))
      .mockImplementationOnce(() => jsonOnce(PENDING))
      .mockImplementationOnce(() => jsonOnce({ err: 'runner unavailable' }, 503));
    vi.stubGlobal('fetch', fetch);
    mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't be reached/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('settles on a conflict, which is a question someone else already answered', async () => {
    const fetch = fetchFake(() => jsonOnce(PENDING))
      .mockImplementationOnce(() => jsonOnce(PENDING))
      .mockImplementationOnce(() => jsonOnce({ err: 'already decided' }, 409));
    vi.stubGlobal('fetch', fetch);
    mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText(/no longer waiting/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('says so plainly when the request is gone, rather than showing a dead card', async () => {
    vi.stubGlobal('fetch', fetchFake(() => jsonOnce({ err: 'not found' }, 404)));
    mount();
    expect(await screen.findByText(/no longer waiting/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
