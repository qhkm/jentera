/* ============================================================
   The connections this business actually has.

   Previously only TelegramConnect asked the server, and it kept the
   answer in its own state. Everything else on the screen — the tab
   badge, the channel chips — went on reading the playbook's seeded
   list, so a business with one Telegram bot was told it had four
   connections, and the chip for the connector it really had was the
   one shown dark.

   One fetch, owned by the screen, handed down. Disconnecting a bot
   now moves the badge, because both read the same array.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { Connection } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { findConnector } from '@/lib/tools';

/**
 * The same three answers `useActivity` gives, for the same reason.
 *
 * `real` alone had to say `false` while the request was in flight, and
 * the Connections tab read `false` as "use the playbook's list" — so
 * the badge showed 4 for an account with one connection, and the chip
 * row lit WhatsApp and Instagram, until the fetch landed a moment
 * later and it all corrected itself. The fix for the value missed the
 * loading state; this is that half.
 */
export type ConnectionsMode = 'real' | 'pending' | 'demo';

export interface ConnectionsState {
  /** Null while loading. Empty array means "asked, and there are none". */
  rows: Connection[] | null;
  mode: ConnectionsMode;
  /** True when `rows` describes this business rather than a demo. */
  real: boolean;
  /** Optimistic updates from the connect/disconnect controls. */
  setRows: React.Dispatch<React.SetStateAction<Connection[] | null>>;
}

export function useConnections(): ConnectionsState {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const [rows, setRows] = useState<Connection[] | null>(null);
  /* Guards React 18's double-invoke in development, which would
     otherwise fire two identical requests on every mount. */
  const inflight = useRef(false);

  useEffect(() => {
    if (!signedIn) {
      setRows([]);
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    let live = true;

    void repo.connections().then(
      (c) => {
        if (live) setRows(c);
        inflight.current = false;
      },
      /* A failure must not claim there are none — that would put a
         disconnected-looking screen in front of a working bot. Null
         stays "unknown", and the callers fall back to saying nothing. */
      () => {
        if (live) setRows(null);
        inflight.current = false;
      },
    );

    return () => {
      live = false;
      inflight.current = false;
    };
  }, [repo, signedIn]);

  const mode: ConnectionsMode = !signedIn ? 'demo' : rows !== null ? 'real' : 'pending';

  return { rows, mode, real: mode === 'real', setRows };
}

/**
 * Display names of the connectors this business has actually connected.
 *
 * Keyed off the connector slug the server returns, not off anything the
 * playbook suggested. `findConnector` is what maps 'telegram' to the
 * 'Telegram' the chips and catalogue are written in — hand-capitalising
 * gets 'Whatsapp' for the connector spelled 'WhatsApp' everywhere else.
 */
export function connectedNames(rows: Connection[] | null): Set<string> {
  const names = new Set<string>();
  for (const r of rows ?? []) {
    if (r.status !== 'connected') continue;
    names.add(findConnector(r.connector)?.n ?? r.connector);
  }
  return names;
}
