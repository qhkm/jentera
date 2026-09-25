import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotifications } from '../useNotifications';
import { renderWithQuery } from '@/test-support/query';

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const row = (id: string, title: string, readAt: string | null) => ({
  id, kind: 'booking_requested', title, body: 'Aisyah · Tue 6 Oct', runId: null, routineId: null, occurrenceId: null,
  url: null, readAt, createdAt: '2026-10-05T00:00:00.000Z',
});
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A server with one page of one notification that remembers reads; `read`
    replaces the answer to a read (one or all), `pages` the list. */
function serve(options: { read?: () => Promise<Response>; pages?: (cursor: string | null) => Response } = {}) {
  let read = false;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://api.test');
    if (url.pathname.endsWith('/read') || url.pathname.endsWith('/read-all')) {
      if (options.read) return options.read();
      read = true;
      return json({ ok: true });
    }
    if (options.pages) return options.pages(url.searchParams.get('cursor'));
    return json({ ok: true, notifications: [row(FIRST, 'New booking request', read ? '2026-10-05T01:00:00.000Z' : null)], unread: read ? 0 : 1, nextCursor: null });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function Bell() {
  const state = useNotifications();
  return <p>bell {state.loading ? 'loading' : state.unread}</p>;
}
function Inbox() {
  const state = useNotifications();
  return <div>
    <p>inbox {state.items.map((item) => `${item.title}:${item.readAt ? 'read' : 'unread'}`).join(', ')}</p>
    <button type="button" onClick={() => void state.markRead(FIRST).catch(() => undefined)}>open</button>
    <button type="button" onClick={() => void state.markAll().catch(() => undefined)}>read all</button>
    <button type="button" onClick={() => void state.loadMore()}>more</button>
  </div>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('useNotifications', () => {
  it('makes one request for the bell and the Alerts view together', async () => {
    const fetch = serve();
    await renderWithQuery(<><Bell /><Inbox /></>);
    expect(await screen.findByText('bell 1')).toBeInTheDocument();
    expect(screen.getByText('inbox New booking request:unread')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the list again every 60 s while the app is on screen, and not while it is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serve();
    await renderWithQuery(<Bell />);
    await screen.findByText('bell 1');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('marks one read at once, and puts it back when the server refuses', async () => {
    let refuse!: () => void;
    serve({ read: () => new Promise<Response>((resolve) => { refuse = () => resolve(json({ ok: false, err: 'down' }, 500)); }) });
    await renderWithQuery(<><Bell /><Inbox /></>);
    await screen.findByText('bell 1');
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    // Read before the server has answered.
    expect(await screen.findByText('bell 0')).toBeInTheDocument();
    expect(screen.getByText('inbox New booking request:read')).toBeInTheDocument();
    await act(async () => { refuse(); });
    expect(await screen.findByText('bell 1')).toBeInTheDocument();
    expect(screen.getByText('inbox New booking request:unread')).toBeInTheDocument();
  });

  it('marks everything read at once, and the server confirms it', async () => {
    const fetch = serve();
    await renderWithQuery(<><Bell /><Inbox /></>);
    await screen.findByText('bell 1');
    await userEvent.click(screen.getByRole('button', { name: 'read all' }));
    expect(await screen.findByText('inbox New booking request:read')).toBeInTheDocument();
    // The read, then one list read to confirm it.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(screen.getByText('bell 0')).toBeInTheDocument();
  });

  it('loads the next page after the first, keeping every row once and the newest count', async () => {
    serve({
      pages: (cursor) => (cursor === null
        ? json({ ok: true, notifications: [row(FIRST, 'First', null)], unread: 2, nextCursor: 'c1' })
        : json({ ok: true, notifications: [row(FIRST, 'First', null), row(SECOND, 'Second', null)], unread: 3, nextCursor: null })),
    });
    await renderWithQuery(<><Bell /><Inbox /></>);
    await screen.findByText('bell 2');
    await userEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(await screen.findByText('inbox First:unread, Second:unread')).toBeInTheDocument();
    expect(screen.getByText('bell 3')).toBeInTheDocument();
  });

  it('asks nothing outside a signed-in business', async () => {
    const fetch = serve();
    render(<Bell />);
    await renderWithQuery(<Inbox />, { businessId: null });
    expect(screen.getByText('bell 0')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
