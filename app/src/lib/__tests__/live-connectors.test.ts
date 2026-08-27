/* ============================================================
   Which connectors may claim to be connected.

   The Connections tab lists what a business of this type typically
   uses and let any of them be toggled "Connected" — writing a name
   into a list and turning a tag green while nothing was connected.
   For the demo that is a fair illustration. For a signed-in business
   it was a false statement about their own setup, and one they had
   apparently made themselves.

   This list is the guard, and it has to stay honest about the Worker.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIVE_CONNECTORS, isLive } from '@/lib/live-connectors';

describe('the live list', () => {
  it('contains Telegram, which is implemented', () => {
    expect(isLive('Telegram')).toBe(true);
  });

  it('contains nothing that is only a stub', () => {
    for (const name of ['WhatsApp', 'Instagram', 'Google Calendar', 'Google Sheets', 'Shopee']) {
      expect(isLive(name), `${name} is not implemented`).toBe(false);
    }
  });

  it('matches the connectors the Worker actually ships', () => {
    /* Read from the Worker's own directory rather than restated here.
       A list maintained by hand drifts, and the drift is silent: the
       tab would offer a connector that does nothing, which is the bug
       this file exists to prevent. */
    /* Resolved from the working directory: `new URL(...).pathname`
       comes back with Vite's /@fs/ prefix under vitest and does not
       exist on disk. */
    const dir = resolve(process.cwd(), '../worker/src/connectors');
    const shipped = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace('.ts', '').toLowerCase());

    const claimed = [...LIVE_CONNECTORS].map((n) => n.toLowerCase());
    expect(claimed.sort()).toEqual(shipped.sort());
  });

  it('is still guarded by the Worker’s own warning', () => {
    /* If that boundary comment ever disappears, the assumption behind
       this whole file — that everything else is a stub — needs
       rechecking rather than inheriting. */
    const src = readFileSync(resolve(process.cwd(), '../worker/src/connectors.ts'), 'utf8');
    expect(src).toMatch(/stub/i);
  });
});
