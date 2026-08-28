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

import { describe, expect, it } from 'vitest';
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

import { render, screen, waitFor } from '@testing-library/react';
import { useConnections } from '@/hooks/useConnections';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';

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

function Probe() {
  const c = useConnections();
  return <span data-testid="mode">{c.mode}</span>;
}

function mountWith(repo: LocalRepository, signedIn = true) {
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={repo}>
        <Probe />
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

describe('what mode says before the answer arrives', () => {
  it('is pending, not demo', async () => {
    /* `demo` here is what put the playbook's 4 on the badge. */
    const { repo, calls, answer } = held();
    mountWith(repo);

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
    mountWith(new LocalRepository(), false);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('demo'));
  });

  it('stays out of demo when the request fails', async () => {
    /* A failed fetch is not permission to show the playbook's guesses
       as this business's connections. */
    const repo = new LocalRepository();
    repo.connections = async () => {
      throw new Error('offline');
    };
    mountWith(repo);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('mode')).toHaveTextContent('pending');
  });
});
