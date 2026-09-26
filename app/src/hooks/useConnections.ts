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

import { useCallback, useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useRepository } from '@/lib/repo';
import type { Connection } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';
import { findConnector } from '@/lib/tools';

/**
 * The same loading/real/error/demo answers `useActivity` gives, for the same reason.
 *
 * `real` alone had to say `false` while the request was in flight, and
 * the Connections tab read `false` as "use the playbook's list" — so
 * the badge showed 4 for an account with one connection, and the chip
 * row lit WhatsApp and Instagram, until the fetch landed a moment
 * later and it all corrected itself. The fix for the value missed the
 * loading state; this is that half.
 */
export type ConnectionsMode = 'real' | 'pending' | 'error' | 'demo';

export interface ConnectionsState {
  /** Null while loading. Empty array means "asked, and there are none". */
  rows: Connection[] | null;
  mode: ConnectionsMode;
  /** True when `rows` describes this business rather than a demo. */
  real: boolean;
  error: Error | null;
  retry: () => void;
  /** Shows a connect or disconnect at once, from the server's answer to it. */
  setRows: React.Dispatch<React.SetStateAction<Connection[] | null>>;
}

/** How often a Telegram connection waiting for its owner chat is read again. */
export const PAIRING_POLL_MS = 3000;

const NONE: Connection[] = [];

/* Only tests and the dev preview are signed in without a cache (the gate
   builds one for every signed-in page). They get this client so the query
   can be declared, disabled, with nothing sent. */
const INERT = new QueryClient();

const awaitingTelegram = (rows: Connection[] | null | undefined) => (rows ?? []).some(
  (row) => row.connector === 'telegram' && row.status === 'connected' && row.paired !== true,
);

/**
 * The business's connections, read once for everything that shows them —
 * the dashboard hands them to Home, My Business, Library and the connector
 * options, and the setup screen reads the same cache entry. A return to the
 * app reads them again with the rows kept on screen, and a failed refresh
 * keeps them. While a Telegram bot waits for its owner chat they are read
 * every 3 s, only while the app is on screen: pairing happens in Telegram,
 * and coming back resumes the check.
 */
export function useConnections(): ConnectionsState {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const client = scoped ?? INERT;
  const live = signedIn && scoped !== undefined && businessId !== null;
  const query = useQuery({
    queryKey: keys.connections(businessId ?? 'none'),
    queryFn: () => repo.connections(),
    enabled: live,
    refetchInterval: (q) => (awaitingTelegram(q.state.data) ? PAIRING_POLL_MS : false),
    refetchIntervalInBackground: false,
  }, client);
  const { refetch } = query;

  const retry = useCallback(() => {
    if (live) void refetch();
  }, [live, refetch]);
  /* A read already in flight began before this change and would land after
     it, taking it back: stop it first, then write. */
  const setRows = useCallback<ConnectionsState['setRows']>((action) => {
    if (!live || businessId === null) return;
    const target = keys.connections(businessId);
    void client.cancelQueries({ queryKey: target }).then(() => {
      client.setQueryData<Connection[] | null>(target, (prev) => (
        typeof action === 'function' ? action(prev ?? null) : action
      ));
    });
  }, [live, client, businessId]);

  const rows = !signedIn ? NONE : query.data ?? null;
  const failed = rows === null && query.isError && !query.isFetching;
  const mode: ConnectionsMode = !signedIn ? 'demo' : rows !== null ? 'real' : failed ? 'error' : 'pending';

  return {
    rows,
    mode,
    real: mode === 'real',
    error: failed ? query.error : null,
    retry,
    setRows,
  };
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
    if (r.connector === 'telegram' && r.paired !== true) continue;
    names.add(findConnector(r.connector)?.n ?? r.connector);
  }
  return names;
}
