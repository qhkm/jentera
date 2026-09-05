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
 * False in the anonymous demo. An unreachable API cannot establish
 * whether someone is signed out, so startup offers a retry instead.
 */
export function useSignedIn(): boolean {
  return useContext(SignedInContext);
}

async function choose(): Promise<Chosen> {
  /* No backend configured: this is the anonymous demo, and it must keep
     working exactly as it does today. */
  if (!API) return { repo: new LocalRepository(), mode: 'local' };

  /* The body, not just the status. It carries the detail-level setting,
     which the hook below used to fetch from this same endpoint a moment
     later — the response was here all along and was being discarded. */
  let res: Response;
  try {
    res = await fetch(`${API}/api/me`, {
      credentials: 'include',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not check your session. Check your connection and try again.');
  }

  if (res.status === 401) return { repo: new LocalRepository(), mode: 'local' };
  if (!res.ok) throw new Error('Could not check your session. Please try again.');
  const me = (await res.json()) as MeResponse;

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
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<{ attempt: number; promise: Promise<Chosen> } | null>(null);

  useEffect(() => {
    let live = true;
    /* Strict Mode replays effects. Share this attempt so business creation
       and migration only run once, while each effect owns its subscription. */
    if (pending.current?.attempt !== attempt) {
      pending.current = { attempt, promise: choose() };
    }
    pending.current.promise.then(
      (value) => { if (live) setChosen(value); },
      (error: unknown) => {
        if (live) setFailed(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => { live = false; };
  }, [attempt]);

  if (failed) {
    return (
      <div role="alert" className="card" style={{ margin: '2rem', padding: '1.5rem' }}>
        <p>Could not start Jentera. {failed.message}</p>
        <button className="btn mt-4" type="button" onClick={() => {
          setFailed(null);
          setAttempt((value) => value + 1);
        }}>
          Try again
        </button>
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
