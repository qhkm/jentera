import { createContext, lazy, Suspense, useContext, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

const BusinessIdContext = createContext<string | null>(null);

/* Development only. A production build replaces import.meta.env.DEV with
   false, so this branch and its dynamic import leave the bundle; tests run
   in MODE 'test' and never render it either. */
const Devtools = import.meta.env.DEV && import.meta.env.MODE !== 'test'
  ? lazy(() => import('@tanstack/react-query-devtools').then((module) => ({ default: module.ReactQueryDevtools })))
  : null;

/** The page's query cache and the business every key starts with. Mounted
    by RepositoryGate for a signed-in page only, and by tests. */
export function QueryScope({ client, businessId, children }: {
  client: QueryClient;
  businessId: string | null;
  children: ReactNode;
}) {
  return <QueryClientProvider client={client}>
    <BusinessIdContext.Provider value={businessId}>
      {children}
      {Devtools && <Suspense fallback={null}><Devtools initialIsOpen={false} /></Suspense>}
    </BusinessIdContext.Provider>
  </QueryClientProvider>;
}

/** The signed-in business, from the session the gate already holds, or null
    (the anonymous demo, or a session /api/me reported no business for). */
export function useBusinessId(): string | null {
  return useContext(BusinessIdContext);
}

/** For screens that only exist inside a signed-in business (Apps). */
export function useRequiredBusinessId(): string {
  const businessId = useContext(BusinessIdContext);
  if (!businessId) throw new Error('This screen reads the query cache and needs a signed-in business above it (QueryScope).');
  return businessId;
}
