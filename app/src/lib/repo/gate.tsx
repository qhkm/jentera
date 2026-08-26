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
import { NoBusinessError, RemoteRepository } from './remote';
import { RepositoryProvider } from './context';
import { migrateLocalToRemote } from './migrate';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

type Chosen = { repo: LocalRepository | RemoteRepository; mode: 'local' | 'remote' };

/* `mode` was computed and then thrown away, so nothing downstream could
   tell an authenticated session from the anonymous demo — which is why
   /app was reachable by setting a localStorage flag in devtools. */
const SignedInContext = createContext(false);

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
  try {
    const res = await fetch(`${API}/api/me`, { credentials: 'include' });
    signedIn = res.ok;
  } catch {
    /* Unreachable API is not the same as signed out, but the honest
       fallback is the local demo rather than an error page for a visitor
       who never had an account. */
    return { repo: new LocalRepository(), mode: 'local' };
  }

  if (!signedIn) return { repo: new LocalRepository(), mode: 'local' };

  const remote = new RemoteRepository();
  try {
    await remote.load();
  } catch (e) {
    /* Signed in with no business: first sign-in. Carry the browser state
       over, once. Any other failure belongs to the provider's error
       state, not here. */
    if (e instanceof NoBusinessError) {
      await migrateLocalToRemote(new LocalRepository(), remote);
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
        <p>Could not start AISAR. {failed.message}</p>
      </div>
    );
  }
  if (!chosen) return null;

  return (
    <SignedInContext.Provider value={chosen.mode === 'remote'}>
      <RepositoryProvider repository={chosen.repo}>{children}</RepositoryProvider>
    </SignedInContext.Provider>
  );
}
