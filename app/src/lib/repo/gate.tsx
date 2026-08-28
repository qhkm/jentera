/* ============================================================
   Chooses which Repository the app runs on.

   Signed in  → RemoteRepository, the server is the source of truth.
   Otherwise  → LocalRepository, the no-signup demo, unchanged.

   The choice has to be made before RepositoryProvider binds its ref,
   which is why it lives here rather than inside the provider.
   ============================================================ */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LocalRepository } from './local';
import { NoBusinessError, NotSignedInError, RemoteRepository } from './remote';
import type { MeResponse } from './remote';
import { RepositoryProvider } from './context';
import { migrateLocalToRemote } from './migrate';
import { LoadingState } from '@/components/ui';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

type Chosen = { repo: LocalRepository | RemoteRepository; mode: 'local' | 'remote' };

/* `mode` was computed and then thrown away, so nothing downstream could
   tell an authenticated session from the anonymous demo — which is why
   /app was reachable by setting a localStorage flag in devtools. */
const SignedInContext = createContext(false);

/**
 * Declare a session as server-backed.
 *
 * RepositoryGate wraps this around its children once it has chosen.
 * Exported because anything composing the providers directly — App's
 * shell, and tests — needs to say which case it is arranging;
 * otherwise the default of `false` silently disables everything that
 * depends on being signed in, which reads as a component doing
 * nothing rather than a missing wrapper.
 */
export function SignedInProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <SignedInContext.Provider value={value}>{children}</SignedInContext.Provider>;
}

/**
 * True when this session is server-backed.
 *
 * False in the anonymous demo, and false when the API is unreachable —
 * `choose` falls back to LocalRepository there, and a visitor who never
 * had an account should see the demo rather than a sign-in wall.
 */
export function useSignedIn(): boolean {
  return useContext(SignedInContext);
}

async function choose(): Promise<Chosen> {
  /* No backend configured: this is the anonymous demo, and it must keep
     working exactly as it does today. */
  if (!API) return { repo: new LocalRepository(), mode: 'local' };

  let signedIn = false;
  /* The body, not just the status. It carries the detail-level setting,
     which the hook below used to fetch from this same endpoint a moment
     later — the response was here all along and was being discarded. */
  let me: MeResponse | null = null;
  try {
    const res = await fetch(`${API}/api/me`, { credentials: 'include' });
    signedIn = res.ok;
    if (res.ok) me = (await res.json().catch(() => null)) as MeResponse | null;
  } catch {
    /* Unreachable API is not the same as signed out, but the honest
       fallback is the local demo rather than an error page for a visitor
       who never had an account. */
    return { repo: new LocalRepository(), mode: 'local' };
  }

  if (!signedIn) return { repo: new LocalRepository(), mode: 'local' };

  const remote = new RemoteRepository();
  if (me) remote.prime({ me });
  try {
    /* Handed to the provider rather than dropped; it mounts and asks
       for exactly this a moment later. */
    remote.prime({ state: await remote.load() });
  } catch (e) {
    /* Signed in with no business: first sign-in. Carry the browser state
       over, once. Any other failure belongs to the provider's error
       state, not here. */
    if (e instanceof NoBusinessError) {
      await migrateLocalToRemote(new LocalRepository(), remote);
    } else if (e instanceof NotSignedInError) {
      /* Logout, expiry, and account deletion can land between /api/me and
         /api/state. That is an ordinary signed-out transition, not a broken
         workspace. Falling back keeps public onboarding usable and lets the
         /app auth guard send protected routes to sign-in. */
      return { repo: new LocalRepository(), mode: 'local' };
    } else {
      throw e;
    }
  }
  return { repo: remote, mode: 'remote' };
}

export function RepositoryGate({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [failed, setFailed] = useState<Error | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    choose().then(setChosen, (e: Error) => setFailed(e));
  }, []);

  if (failed) {
    return (
      <div role="alert" className="card" style={{ margin: '2rem', padding: '1.5rem' }}>
        <p>Could not start Jentera. {failed.message}</p>
      </div>
    );
  }
  if (!chosen) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-text">
        <div className="w-full max-w-md border border-border bg-bg-card p-6 sm:p-8">
          <div className="mb-5 font-pixel text-xl tracking-wide text-brand">Jentera</div>
          <LoadingState
            title="Opening your Jentera workspace…"
            detail="Checking your session and loading your latest business data. There is no need to refresh."
          />
        </div>
      </main>
    );
  }

  return (
    <SignedInContext.Provider value={chosen.mode === 'remote'}>
      <RepositoryProvider repository={chosen.repo}>{children}</RepositoryProvider>
    </SignedInContext.Provider>
  );
}
