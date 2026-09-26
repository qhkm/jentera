import { act, render, type RenderResult } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { useState, type ReactElement, type ReactNode } from 'react';
import { I18nProvider } from '@/i18n/I18nProvider';
import { createQueryClient } from '@/lib/query/client';
import { QueryScope } from '@/lib/query/scope';
import { RepositoryProvider } from '@/lib/repo/context';
import type { Repository } from '@/lib/repo/types';

export const TEST_BUSINESS_ID = 'biz-test';

/** Production defaults (30 s fresh, focus refetch), except that a failure
    shows at once instead of retrying, and nothing is dropped mid-test. */
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    queries: { ...defaults.queries, retry: false, gcTime: Infinity },
    mutations: { ...defaults.mutations, retry: false },
  });
  return client;
}

/** A fresh cache, as the gate gives every signed-in page, for a test that
    renders its own tree. Signed in without one, the shared reads
    (activity, goals) stay inert, which production never does. */
export function TestQueryScope({ children }: { children: ReactNode }) {
  const [client] = useState(createTestQueryClient);
  return <QueryScope client={client} businessId={TEST_BUSINESS_ID}>{children}</QueryScope>;
}

export interface RenderWithQueryOptions {
  /** Pass one to share a cache between mounts (a revisit); a fresh test client otherwise. */
  client?: QueryClient;
  /** The signed-in business; null for a session with none. */
  businessId?: string | null;
  /** Also mount RepositoryProvider and I18nProvider, as most view tests need. */
  repository?: Repository;
}

/** Renders inside a query cache (and, with `repository`, the app's
    providers), then flushes the first microtasks: LocalRepository.load()
    and the first queries settle there. The wrapper survives `rerender`. */
export async function renderWithQuery(ui: ReactElement, options: RenderWithQueryOptions = {}): Promise<RenderResult & { client: QueryClient }> {
  const client = options.client ?? createTestQueryClient();
  const businessId = options.businessId === undefined ? TEST_BUSINESS_ID : options.businessId;
  const repository = options.repository;
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryScope client={client} businessId={businessId}>
      {repository ? <RepositoryProvider repository={repository}><I18nProvider>{children}</I18nProvider></RepositoryProvider> : children}
    </QueryScope>;
  }
  const view = render(ui, { wrapper: Wrapper });
  await act(async () => {});
  return { ...view, client };
}

/* The browser shows the page again and fires visibilitychange. It bubbles
   to window, as the HTML spec says, which is where the query cache listens;
   the non-bubbling Event older tests dispatch on document never reaches it. */
function showPage(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}

/** The owner comes back to the app, and nothing else happens: only what is
    past its 30 s is read again. Pair it with a faked Date to say how long
    they were away. */
export async function focusApp(): Promise<void> {
  await act(async () => { showPage(); });
}

/** The owner comes back to the app after the 30 s window. It forces every
    cached query stale first (it invalidates them all), then shows the page,
    so everything on screen is read again whatever its age: a test using it
    cannot catch a `staleTime` regression. Use `focusApp` for that. */
export async function returnToApp(client: QueryClient): Promise<void> {
  await act(async () => {
    await client.invalidateQueries({ refetchType: 'none' });
    showPage();
  });
}
