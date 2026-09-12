/* ============================================================
   Accepting an invitation.

   The email link lands here with a token. If the person is signed in,
   the token is offered to the server and, on success, the app reboots
   into the business they just joined. If they are not, the token waits
   in this browser while they sign in through any of the three doors —
   /onboard sends a membershipless person back here — and it is offered
   then. English only, like /signin: public pages sit outside the
   repository gate and its language provider.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';
import * as store from '@/lib/storage';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

type State =
  | { kind: 'checking' }
  | { kind: 'signin' }
  | { kind: 'accepted'; business: string }
  | { kind: 'refused'; message: string; canRetryLater: boolean }
  | { kind: 'missing' };

export default function Join() {
  const [params] = useSearchParams();
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    const fromLink = params.get('token');
    if (fromLink) store.set(store.KEYS.joinToken, fromLink);
    const token = fromLink ?? store.get(store.KEYS.joinToken);
    if (!token) {
      setState({ kind: 'missing' });
      return;
    }
    let live = true;
    (async () => {
      try {
        const me = await fetch(`${API}/api/me`, { credentials: 'include' });
        if (!live) return;
        if (me.status === 401) {
          setState({ kind: 'signin' });
          return;
        }
        const res = await fetch(`${API}/api/team/invitations/accept`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!live) return;
        const body = (await res.json().catch(() => ({}))) as { businessName?: string; err?: string };
        if (res.ok) {
          store.remove(store.KEYS.joinToken);
          setState({ kind: 'accepted', business: body.businessName ?? 'the business' });
          /* A full reload: the repository gate reads the session once at
             startup, and this person's business did not exist a moment ago. */
          window.location.href = '/app';
          return;
        }
        /* A different account holds the session: the token stays, so signing
           in with the invited address finishes the job. Anything else is
           final for this link. */
        const canRetryLater = res.status === 403;
        if (!canRetryLater) store.remove(store.KEYS.joinToken);
        setState({ kind: 'refused', message: body.err ?? 'This invitation could not be accepted.', canRetryLater });
      } catch {
        if (live) setState({ kind: 'refused', message: 'Could not reach Jentera. Check your connection and open the link again.', canRetryLater: true });
      }
    })();
    return () => { live = false; };
  }, [params]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <JenteraMark size={36} />
        <h1 className="m-0 font-pixel text-2xl tracking-tight">Join a business on Jentera</h1>
      </div>
      {state.kind === 'checking' && <p role="status" className="text-text-secondary">Checking your invitation…</p>}
      {state.kind === 'signin' && (
        <div className="card flex flex-col gap-3">
          <p>You have been invited to join a business on Jentera.</p>
          <p className="text-sm text-text-secondary">
            Sign in with the email address the invitation was sent to, and you will be brought back here.
          </p>
          <div><Link className="btn btn-primary" to="/signin">Sign in to accept</Link></div>
        </div>
      )}
      {state.kind === 'accepted' && (
        <p role="status">You have joined {state.business}. Opening your workspace…</p>
      )}
      {state.kind === 'refused' && (
        <div className="card flex flex-col gap-3" role="alert">
          <p>{state.message}</p>
          {state.canRetryLater
            ? <div><Link className="btn btn-outline" to="/signin">Sign in with another account</Link></div>
            : <div><Link className="btn btn-outline" to="/">Back to Jentera</Link></div>}
        </div>
      )}
      {state.kind === 'missing' && (
        <div className="card flex flex-col gap-3" role="alert">
          <p>This link is missing its invitation. Open the link from your email again.</p>
          <div><Link className="btn btn-outline" to="/">Back to Jentera</Link></div>
        </div>
      )}
    </main>
  );
}
