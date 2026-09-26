/* ============================================================
   The connections a business actually has, versus the ones a playbook
   guessed it would have.

   Three things on the Connections tab were reading the seeded list:
   the tab badge, the channel chips, and each card's "· linked"
   subtitle. All three told an account whose single connection was a
   Telegram bot that it had four connections — and drew the Telegram
   chip dark while lighting WhatsApp and Instagram.

   These tests pin the two functions that decide what is real.
   ============================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectedNames } from '@/hooks/useConnections';
import { withoutLinkClaim } from '@/lib/live-connectors';
import type { Connection } from '@/lib/repo';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const row = (connector: string, status: Connection['status'] = 'connected'): Connection => ({
  id: `id-${connector}`,
  connector,
  method: 'bss',
  status,
  displayName: `@${connector}_bot`,
  externalId: null,
  connectedAt: '2026-08-26T00:00:00.000Z',
  lastOkAt: null,
  lastError: null,
  paired: connector === 'telegram' ? true : undefined,
});

describe('which connectors count as connected', () => {
  it('names nothing when nothing is connected', () => {
    expect(connectedNames([])).toEqual(new Set());
  });

  it('treats an unknown answer as no claim either way', () => {
    /* Null is "the request failed", not "there are none". Reporting
       zero would show a disconnected screen over a working bot. */
    expect(connectedNames(null)).toEqual(new Set());
  });

  it('uses the connector’s own spelling, not a capitalised slug', () => {
    /* The chips and the catalogue are written 'WhatsApp'. Upper-casing
       the first letter of the slug gives 'Whatsapp', which matches
       neither, so the chip for a real connection would stay dark. */
    expect(connectedNames([row('whatsapp')])).toEqual(new Set(['WhatsApp']));
    expect(connectedNames([row('telegram')])).toEqual(new Set(['Telegram']));
  });

  it('does not count a connection that is not working', () => {
    /* A bot whose webhook is erroring is not a channel Jentera can
       reach anyone on, and lighting its chip green says it is. */
    expect(connectedNames([row('telegram', 'error')])).toEqual(new Set());
    expect(connectedNames([row('telegram', 'revoked')])).toEqual(new Set());
    expect(connectedNames([row('telegram', 'expired')])).toEqual(new Set());
  });

  it('does not call a Telegram bot usable before the owner chat is paired', () => {
    expect(connectedNames([{ ...row('telegram'), paired: false }])).toEqual(new Set());
  });

  it('counts each connector once, however many rows it has', () => {
    expect(connectedNames([row('telegram'), { ...row('telegram'), id: 'second' }])).toEqual(
      new Set(['Telegram']),
    );
  });

  it('falls back to the slug for a connector the catalogue has never heard of', () => {
    expect(connectedNames([row('carrier-pigeon')])).toEqual(new Set(['carrier-pigeon']));
  });
});

describe('stripping the subtitle’s connection claim', () => {
  it('keeps the part that is a fact', () => {
    expect(withoutLinkClaim('Business API · linked')).toBe('Business API');
    expect(withoutLinkClaim('DM · linked')).toBe('DM');
  });

  it('returns nothing when the claim is the whole subtitle', () => {
    expect(withoutLinkClaim('linked')).toBe('');
    expect(withoutLinkClaim('not connected')).toBe('');
  });

  it('leaves a subtitle that makes no claim alone', () => {
    expect(withoutLinkClaim('Business API')).toBe('Business API');
  });

  it('handles every subtitle the playbooks actually contain', () => {
    /* Read from the data rather than restated here: a new playbook
       inventing a new way to say "linked" fails this instead of
       quietly shipping the claim. */
    const src = readFileSync(resolve(process.cwd(), 'src/lib/data/playbooks.ts'), 'utf8');
    const subtitles = new Set<string>();
    for (const block of src.matchAll(/"conns":\s*\[([\s\S]*?)\n\s*\]/g)) {
      for (const m of block[1].matchAll(/"s":\s*"([^"]*)"/g)) subtitles.add(m[1]);
    }

    expect(subtitles.size).toBeGreaterThan(0);
    for (const s of subtitles) {
      expect(withoutLinkClaim(s), `"${s}" still claims a connection`).not.toMatch(
        /linked|connected/i,
      );
    }
  });
});

/* ============================================================
   The loading state, which the first fix missed.

   `real` was a boolean, so it said `false` while the request was in
   flight and the tab read that as "use the playbook's list". The badge
   showed 4 for an account with one connection and the chip row lit
   WhatsApp and Instagram — for about a second, on every visit, then it
   corrected itself. Exactly the bug that was fixed for the activity
   counters the same morning, in the one hook that did not get the
   third state.
   ============================================================ */

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { useConnections } from '@/hooks/useConnections';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { focusApp, renderWithQuery, returnToApp } from '@/test-support/query';

function held() {
  const repo = new LocalRepository();
  let release: ((c: Connection[]) => void) | null = null;
  const calls = { connections: 0 };
  repo.connections = () => {
    calls.connections += 1;
    return new Promise<Connection[]>((resolve) => {
      release = resolve;
    });
  };
  return { repo, calls, answer: (c: Connection[] = []) => release?.(c) };
}

function Probe({ id = 'mode' }: { id?: string }) {
  const c = useConnections();
  return <div>
    <span data-testid={id}>{c.mode}</span>
    <span data-testid={`${id}-rows`}>{c.rows ? c.rows.map((r) => r.connector).join(',') || 'none' : 'unknown'}</span>
    <button type="button" onClick={() => c.setRows((prev) => [row('google_calendar'), ...(prev ?? [])])}>Show a new connection</button>
  </div>;
}

/** A page as the gate builds it: signed in means a cache above it. */
function mountWith(repo: LocalRepository, signedIn = true, client?: QueryClient) {
  return renderWithQuery(<SignedInProvider value={signedIn}><Probe /></SignedInProvider>, { repository: repo, client });
}

/** Lets an answer finish landing: the cache hands updates to the screen on
    a later tick, so one tick is not always enough. */
const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });

/** Answers the test releases one at a time, in order. */
function queued() {
  const repo = new LocalRepository();
  const waiting: { resolve: (c: Connection[]) => void; reject: (e: Error) => void }[] = [];
  let calls = 0;
  repo.connections = () => { calls += 1; return new Promise<Connection[]>((resolve, reject) => { waiting.push({ resolve, reject }); }); };
  return {
    repo,
    calls: () => calls,
    /* Each waits for its request to have been made: the repository loads
       first, so an answer given too early would reach nobody. */
    answer: async (c: Connection[]) => {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      await act(async () => { waiting.shift()!.resolve(c); });
      await settle();
    },
    fail: async () => {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      await act(async () => { waiting.shift()!.reject(new Error('offline')); });
      await settle();
    },
  };
}

function hidePage() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  window.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('what mode says before the answer arrives', () => {
  it('is pending, not demo', async () => {
    /* `demo` here is what put the playbook's 4 on the badge. */
    const { repo, calls, answer } = held();
    await mountWith(repo);

    /* Wait on the request, not on `pending`. `pending` is already true
       on the first render — before the effect fires — so waiting for it
       proves nothing, and `answer()` called that early finds no
       resolver and silently does nothing. Same race as activity-mode,
       reintroduced by copying the assertion instead of the lesson. */
    await waitFor(() => expect(calls.connections).toBe(1));
    expect(screen.getByTestId('mode')).toHaveTextContent('pending');

    answer([row('telegram')]);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('real'));
  });

  it('is demo only when nobody is signed in', async () => {
    await mountWith(new LocalRepository(), false);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('demo'));
  });

  it('becomes a recoverable error when the request fails', async () => {
    /* A failed fetch is not permission to show the playbook's guesses
       as this business's connections. */
    const repo = new LocalRepository();
    repo.connections = async () => {
      throw new Error('offline');
    };
    await mountWith(repo);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('mode')).toHaveTextContent('error');
  });
});

describe('staying current', () => {
  it('reads again when the owner comes back to the app, keeping the rows meanwhile', async () => {
    const { repo, calls, answer } = queued();
    const { client } = await mountWith(repo);
    await answer([row('telegram')]);
    await waitFor(() => expect(screen.getByTestId('mode-rows')).toHaveTextContent('telegram'));
    await returnToApp(client);
    await waitFor(() => expect(calls()).toBe(2));
    expect(screen.getByTestId('mode-rows')).toHaveTextContent('telegram');
    await answer([row('telegram'), row('bukku')]);
    await waitFor(() => expect(screen.getByTestId('mode-rows')).toHaveTextContent('telegram,bukku'));
  });

  it('keeps the rows when reading them again fails', async () => {
    const { repo, calls, answer, fail } = queued();
    const { client } = await mountWith(repo);
    await answer([row('telegram')]);
    await returnToApp(client);
    await waitFor(() => expect(calls()).toBe(2));
    await fail();
    expect(screen.getByTestId('mode')).toHaveTextContent('real');
    expect(screen.getByTestId('mode-rows')).toHaveTextContent('telegram');
  });

  it('is read once for screens mounted apart, as the setup screen and the dashboard are', async () => {
    const { repo, calls, answer } = queued();
    await renderWithQuery(<SignedInProvider value><section><Probe id="setup" /></section><main><Probe id="dashboard" /></main></SignedInProvider>, { repository: repo });
    await answer([row('telegram')]);
    await waitFor(() => expect(screen.getByTestId('dashboard-rows')).toHaveTextContent('telegram'));
    expect(calls()).toBe(1);
  });

  /* A connect or disconnect is shown at once from the server's answer. A
     read that began before it must not land after it and take it back. */
  it('keeps a change shown through setRows when an older read lands after it', async () => {
    const { repo, calls, answer } = queued();
    const { client } = await mountWith(repo);
    await answer([row('telegram')]);
    await returnToApp(client);
    await waitFor(() => expect(calls()).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: 'Show a new connection' }));
    await waitFor(() => expect(screen.getByTestId('mode-rows')).toHaveTextContent('google_calendar,telegram'));
    await answer([row('telegram')]);
    expect(screen.getByTestId('mode-rows')).toHaveTextContent('google_calendar,telegram');
  });
});

describe('waiting for the Telegram owner chat to pair', () => {
  const unpaired = (): Connection => ({ ...row('telegram'), paired: false });

  it('checks every 3 s while the app is on screen, stops while it is hidden, and resumes on return', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    let calls = 0;
    const repo = new LocalRepository();
    repo.connections = async () => { calls += 1; return [unpaired()]; };
    await mountWith(repo);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(calls).toBe(2);
    await act(async () => { hidePage(); await vi.advanceTimersByTimeAsync(12_000); });
    expect(calls).toBe(2);
    await focusApp();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('stops checking once the chat is paired', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    let calls = 0;
    const repo = new LocalRepository();
    repo.connections = async () => { calls += 1; return calls < 2 ? [unpaired()] : [row('telegram')]; };
    await mountWith(repo);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(calls).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(calls).toBe(2);
  });
});
