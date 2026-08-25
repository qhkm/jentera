import { useState } from 'react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const expired = new URLSearchParams(window.location.search).get('error') === 'expired';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      /* The server answers 204 whether or not the address has an account,
         so there is nothing here to branch on — and nothing to leak. */
      await fetch(`${API}/api/auth/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* Same screen either way, for the same reason. */
    }
    setBusy(false);
    setSent(true);
  }

  return (
    <>
      <LandingHeader />
      <main className="mx-auto max-w-md px-6 py-24">
        {sent ? (
          <div className="card p-8">
            <h1 className="text-xl">Check your inbox</h1>
            <p className="mt-3 text-sm opacity-80">
              If <strong>{email}</strong> has an AISAR account, a sign-in link is on its way.
              It works once and expires in 15 minutes.
            </p>
          </div>
        ) : (
          <form className="card p-8" onSubmit={submit}>
            <h1 className="text-xl">Sign in to AISAR</h1>
            {expired ? (
              <p role="alert" className="mt-3 text-sm opacity-80">
                That link had already been used or had expired. Here is a fresh one.
              </p>
            ) : (
              <p className="mt-3 text-sm opacity-80">
                We will email you a link. No password to remember.
              </p>
            )}
            <input
              className="input mt-6 w-full"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourbusiness.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn mt-4 w-full" type="submit" disabled={busy || !email}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
          </form>
        )}
      </main>
      <LandingFooter />
    </>
  );
}
