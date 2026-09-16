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
import { PageLoading } from '@/components/ui';
import {
  isNative,
  nativeAuthorizationHeaders,
  resumeNativeSignIn,
} from '@/lib/native';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

type Chosen = {
  routinesVersion?: number;
  teamVersion?: number;
  repo: LocalRepository | RemoteRepository;
  mode: 'local' | 'remote';
  /** Session user id when remote; null for the demo. */
  account: string | null;
  /** The signed-in address; null for the demo. */
  email: string | null;
};

/* `mode` was computed and then thrown away, so nothing downstream could
   tell an authenticated session from the anonymous demo — which is why
   /app was reachable by setting a localStorage flag in devtools. */
const SignedInContext = createContext(false);
/* Which account this server-backed session belongs to. Per-browser state
   keyed by it (Ask history) stays private when accounts share a device. */
const AccountContext = createContext<string | null>(null);
/** The signed-in address, for the one screen that needs the owner to
    retype it: deleting the account. Per-account like AccountContext, so
    it clears on sign-out the same way. */
const EmailContext = createContext<string | null>(null);
const RoutinesContext = createContext(false);
/* Team is a plan. The flag says the Team tab may show; every team write is
   checked again by the routes. */
const TeamContext = createContext(false);

/** Discovery only. Live permissions come from /api/routines on every visit. */
export function useRoutinesEnabled(): boolean {
  return useContext(RoutinesContext);
}

/** Discovery only: whether this business is on the Team plan. */
export function useTeamEnabled(): boolean {
  return useContext(TeamContext);
}

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
  account = null,
  email = null,
  routinesVersion,
  teamVersion,
  children,
}: {
  value: boolean;
  /** The signed-in account's opaque id; omit for the demo. */
  account?: string | null;
  /** The signed-in address; omit for the demo. */
  email?: string | null;
  routinesVersion?: number;
  teamVersion?: number;
  children: ReactNode;
}) {
  return (
    <SignedInContext.Provider value={value}>
      <AccountContext.Provider value={value ? account : null}>
        <EmailContext.Provider value={value ? email : null}>
          <RoutinesContext.Provider value={value && routinesVersion === 1}>
            <TeamContext.Provider value={value && teamVersion === 1}>{children}</TeamContext.Provider>
          </RoutinesContext.Provider>
        </EmailContext.Provider>
      </AccountContext.Provider>
    </SignedInContext.Provider>
  );
}

/**
 * The signed-in account's opaque id, or null in the demo and when the
 * session did not report one. Callers that persist per-browser state must
 * key it by this and keep nothing when it is null.
 */
export function useAccountKey(): string | null {
  return useContext(AccountContext);
}

/**
 * The signed-in account's own address, or null in the demo. Used only by
 * the account-deletion screen, which asks the owner to retype it — the
 * confirmation two of the three sign-in doors can offer without a
 * password.
 */
export function useAccountEmail(): string | null {
  return useContext(EmailContext);
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
  if (!API) return { repo: new LocalRepository(), mode: 'local', account: null, email: null };

  /* A callback can launch a fresh native process. Complete that pending
     exchange before asking /api/me, or the first request would look signed
     out even though the one-time code is waiting in the launch URL. */
  if (isNative()) await resumeNativeSignIn();

  let signedIn = false;
  /* The body, not just the status. It carries the detail-level setting,
     which the hook below used to fetch from this same endpoint a moment
     later — the response was here all along and was being discarded. */
  let me: MeResponse | null = null;
  try {
    const res = await fetch(`${API}/api/me`, {
      credentials: 'include',
      headers: await nativeAuthorizationHeaders(),
    });
    if (res.status === 403) {
      const body = await res.clone().json().catch(() => null);
      if (body?.code === 'ACCESS_REQUIRED') {
        window.location.replace('/access');
        return new Promise<Chosen>(() => {});
      }
    }
    signedIn = res.ok;
    if (res.ok) me = (await res.json().catch(() => null)) as MeResponse | null;
  } catch {
    /* Unreachable API is not the same as signed out, but the honest
       fallback is the local demo rather than an error page for a visitor
       who never had an account. */
    return { repo: new LocalRepository(), mode: 'local', account: null, email: null };
  }

  if (!signedIn) return { repo: new LocalRepository(), mode: 'local', account: null, email: null };

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
      return { repo: new LocalRepository(), mode: 'local', account: null, email: null };
    } else {
      throw e;
    }
  }
  return {
    repo: remote,
    mode: 'remote',
    account: typeof me?.userId === 'string' && me.userId ? me.userId : null,
    email: typeof me?.email === 'string' && me.email ? me.email : null,
    routinesVersion: me?.features?.routines?.apiVersion,
    teamVersion: me?.features?.team?.apiVersion,
  };
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
      <PageLoading
        title="Opening your Jentera workspace…"
        detail="Checking your session and loading your latest business data. There is no need to refresh."
      />
    );
  }

  return (
    <SignedInProvider value={chosen.mode === 'remote'} account={chosen.account} email={chosen.email} routinesVersion={chosen.routinesVersion} teamVersion={chosen.teamVersion}>
      <RepositoryProvider repository={chosen.repo}>{children}</RepositoryProvider>
    </SignedInProvider>
  );
}
