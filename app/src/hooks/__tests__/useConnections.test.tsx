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
    /* A bot whose webhook is erroring is not a channel AISAR can
       reach anyone on, and lighting its chip green says it is. */
    expect(connectedNames([row('telegram', 'error')])).toEqual(new Set());
    expect(connectedNames([row('telegram', 'revoked')])).toEqual(new Set());
    expect(connectedNames([row('telegram', 'expired')])).toEqual(new Set());
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
