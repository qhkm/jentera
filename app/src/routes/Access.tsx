import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';
import { useTurnstile } from '@/lib/turnstile';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export default function Access() {
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const captcha = useTurnstile();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/access`, { credentials: 'include', signal: controller.signal }).then(async res => {
      if (!res.ok) throw new Error('Could not check access. Please refresh and try again.');
      const body = await res.json();
      if (body.access?.allowed) { window.location.replace('/app'); return; }
      setSignedIn(body.signedIn === true); setLoaded(true);
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, []);
  async function submit(kind: 'waitlist' | 'redeem') {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      const turnstileToken = kind === 'waitlist' ? await captcha.getToken() : undefined;
      const res = await fetch(`${API}${kind === 'waitlist' ? '/api/waitlist' : '/api/access/redeem'}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'waitlist' ? { email, turnstileToken } : { code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.err ?? 'Could not complete that request.');
      if (kind === 'redeem') { setCode(''); window.location.assign(['/app', '/onboard', '/setup', '/access'].includes(body.next) ? body.next : '/access'); }
      else setNotice('You’re on the waitlist. We’ll contact you when access is available.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); if (kind === 'waitlist') captcha.reset(); }
  }
  return <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-5 py-10">
    <Link to="/" aria-label="Jentera home"><JenteraMark size={40} /></Link>
    <div><h1 className="text-3xl font-semibold">Join the Jentera waitlist</h1><p className="mt-3 text-text-secondary">We’re opening access gradually. The platform is available to approved paid accounts and invited trial users.</p></div>
    {signedIn && <p className="text-sm text-text-secondary">Your account and business data are kept safe. Access is currently paused unless you have an active paid grant or trial.</p>}
    <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit('waitlist'); }}>
      <label className="flex flex-col gap-2">Email address<input className="input w-full text-base" type="email" autoComplete="email" maxLength={320} required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <p className="text-xs text-text-muted">By joining, you agree to receive updates about Jentera access.</p>
      {captcha.enabled && <div ref={captcha.attach} />}
      <button className="btn btn-primary min-h-11" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Join waitlist'}</button>
    </form>
    <section className="card flex flex-col gap-3 p-5"><h2 className="text-lg font-semibold">Have a trial code?</h2><p className="text-sm text-text-secondary">Invited trials last 3 days from redemption. Each code works once, and each account can use one trial.</p>
      {signedIn ? <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit('redeem'); }}>
        <label className="flex flex-col gap-2">Invite code<input className="input w-full text-base" required maxLength={100} autoComplete="off" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} /></label>
        <button className="btn btn-outline min-h-11" disabled={busy || !code.trim()}>Start my 3-day trial</button>
      </form> : <Link className="btn btn-outline min-h-11" to="/signin">Sign in to redeem your code</Link>}
    </section>
    {!signedIn && <Link to="/signin" className="text-brand">Already have paid access? Sign in →</Link>}
    {signedIn && <button type="button" className="text-brand" onClick={async () => { await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' }); window.location.assign('/signin'); }}>Use another account</button>}
    {!loaded && !notice && <p role="status">Checking access…</p>}
    {notice && <p role="status">{notice}</p>}
  </main>;
}
