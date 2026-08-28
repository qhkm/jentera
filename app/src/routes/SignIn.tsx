/* ============================================================
   Three ways into the same account.

   Google first, because it is the only one with no inbox round trip
   and no password to remember — and this audience is overwhelmingly on
   Gmail. Password second, for anyone who wants it. Magic link last, as
   the path that always works.

   The three converge: whichever is used, the server issues the same
   session cookie, so nothing downstream knows or cares which was.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { trackActivation } from '@/lib/analytics';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

type Mode = 'signin' | 'signup';
type BusyAction = 'password' | 'link' | null;

/* Errors the server can put in the query string when it bounces the
   browser back here. Mapped rather than printed, so a crafted ?error=
   cannot render arbitrary text on a sign-in page. */
const ERRORS: Record<string, string> = {
  expired: 'That link had already been used or had expired. Here is a fresh one.',
  'google-failed': 'Google sign-in did not complete. Please try again.',
  'google-unverified':
    'That Google account has an unverified email address, so we cannot use it to sign in.',
  'google-unavailable': 'Google sign-in is not available right now. Use your email instead.',
};

export default function SignIn() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(() => params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [sent, setSent] = useState<'link' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* Prevent a previous account's private owner conversation appearing if
       this tab is used to sign into a different account. */
    try {
      sessionStorage.removeItem('jentera-ask-history-v1');
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, []);

  useEffect(() => {
    if (params.get('mode') === 'signup') setMode('signup');
  }, [params]);

  const urlError = ERRORS[params.get('error') ?? ''] ?? null;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    trackActivation(mode === 'signup' ? 'signup_started' : 'signin_started');
    setBusy('password');
    setError(null);
    try {
      const res = await fetch(`${API}/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (mode === 'signup') {
        // 202 either way — the address may already be taken, and the
        // server deliberately does not say which.
        if (res.ok) setSent('verify');
        else setError((await res.json().catch(() => ({}))).err ?? 'Could not sign you up.');
        return;
      }

      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { next?: unknown };
        // Full reload, not a client-side navigate: RepositoryGate reads
        // the session once at startup, so the app has to boot again to
        // pick up the cookie that was just set.
        window.location.href = ['/onboard', '/setup', '/app'].includes(String(body.next))
          ? String(body.next)
          : '/app';
        return;
      }
      if (res.status === 429) {
        setError('Too many attempts. Wait a minute and try again.');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { err?: string };
      setError(body.err ?? 'Email or password is incorrect.');
    } catch {
      setError('Could not reach Jentera. Check your connection.');
    } finally {
      setBusy(null);
    }
  }

  async function sendLink() {
    setBusy('link');
    setError(null);
    try {
      /* Answers 204 whether or not the address has an account, so
         there is nothing to branch on — and nothing to leak. */
      await fetch(`${API}/api/auth/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent('link');
    } catch {
      setSent('link');
    } finally {
      setBusy(null);
    }
  }

  if (sent) {
    return (
      <>
        <LandingHeader />
        <main className="mx-auto max-w-md px-6 py-24">
          <div className="card p-8">
            <h1 className="text-xl">Check your inbox</h1>
            <p className="mt-3 text-sm opacity-80">
              {sent === 'verify' ? (
                <>
                  If <strong>{email}</strong> is not already registered, a link to confirm it is on
                  its way. Follow it to finish setting up your account.
                </>
              ) : (
                <>
                  If <strong>{email}</strong> has a Jentera account, a sign-in link is on its way. It
                  works once and expires in 15 minutes.
                </>
              )}
            </p>
          </div>
        </main>
        <LandingFooter />
      </>
    );
  }

  return (
    <>
      <LandingHeader />
      <main className="mx-auto max-w-md px-6 py-24">
        <div className="card p-8">
          <h1 className="text-xl">{mode === 'signup' ? 'Create your Jentera account' : 'Sign in to Jentera'}</h1>

          {urlError ? (
            <p role="alert" className="mt-3 text-sm opacity-80">
              {urlError}
            </p>
          ) : null}

          <a
            className="btn mt-6 flex w-full items-center justify-center gap-2"
            href={`${API}/api/auth/google`}
            onClick={() => trackActivation(mode === 'signup' ? 'signup_started' : 'signin_started')}
          >
            {/* Inline rather than a remote asset: the page must not
                depend on Google being reachable to render its own
                sign-in button. */}
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            Continue with Google
          </a>

          <div className="mt-6 flex items-center gap-3 text-xs opacity-60">
            <span className="h-px flex-1 bg-rail" />
            or
            <span className="h-px flex-1 bg-rail" />
          </div>

          <form onSubmit={submitPassword}>
            <input
              className="input mt-6 w-full"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourbusiness.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="input mt-3 w-full"
              type="password"
              required
              minLength={10}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error ? (
              <p role="alert" className="mt-3 text-sm opacity-80">
                {error}
              </p>
            ) : null}

            <button className="btn mt-4 w-full" type="submit" disabled={Boolean(busy) || !email || !password}>
              {busy === 'password'
                ? mode === 'signup' ? 'Creating your account…' : 'Signing you in…'
                : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {/* A login link can only be issued for an existing account. Showing
              it during signup silently sent nothing for a new address, which
              looked like broken email. Google remains the passwordless new-
              account path; the link returns once the account exists. */}
          {mode === 'signin' ? (
            <button
              type="button"
              className="nav-link mt-4 w-full text-sm normal-case tracking-normal"
              onClick={sendLink}
              disabled={Boolean(busy) || !email}
            >
              {busy === 'link' ? 'Sending your secure link…' : 'Email me a link instead'}
            </button>
          ) : null}

          <p className="mt-6 text-center text-sm opacity-70">
            {mode === 'signup' ? 'Already have an account?' : 'No account yet?'}{' '}
            <button
              type="button"
              className="nav-link normal-case tracking-normal"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup');
                setError(null);
              }}
            >
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>

          <p className="mt-6 text-center text-xs opacity-60">
            Or <Link to="/onboard" className="nav-link normal-case tracking-normal">try it without an account</Link>
          </p>
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
