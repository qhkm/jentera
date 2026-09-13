import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';
import { useTurnstile } from '@/lib/turnstile';
import '@/styles/access.css';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export default function Access() {
  const [searchParams] = useSearchParams();
  const showTrialCode = searchParams.get('invite') === '1';
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
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
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const res = await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Could not log out. Please try again.');
      setSignedIn(false); setCode('');
    } catch {
      setNotice('Could not log out. Please try again.');
    } finally { setLoggingOut(false); }
  }
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
      else { setJoined(true); setNotice('You’re on the list. We’ll email you when your invitation is ready.'); }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); if (kind === 'waitlist') captcha.reset(); }
  }
  return <main className="access-launch">
    <header className="access-launch__header"><Link to="/" aria-label="Jentera home" className="access-launch__logo"><JenteraMark size={36} /><span>Jentera</span></Link><span className="access-launch__edition">EARLY ACCESS</span></header>
    <div className="access-launch__layout">
    <section className="access-launch__story">
      <p className="access-launch__eyebrow"><span aria-hidden="true" /> A new way to get work done</p>
      <h1>Your next hire<br />could be <span>AI.</span></h1>
      <p className="access-launch__intro">Less busywork.<br /> More business.</p>
      <p className="access-launch__description">AI staff with their own computer, ready to work across the tools your business already uses.</p>
      <div className="access-launch__jobs" aria-label="Example jobs"><span>Follow up leads</span><span>Prepare reports</span><span>Handle admin</span></div>
    </section>
    <div className="access-launch__panel">
    <section className="access-launch__card" aria-labelledby="access-title">
      <div className="access-launch__card-top"><span>YOUR NEXT CHAPTER</span><span aria-hidden="true">↗</span></div>
      <h2 id="access-title">{joined ? 'You’re on the list.' : 'Get in early.'}</h2>
      <p className="access-launch__card-copy">{joined ? 'Thanks for joining the Jentera waitlist. We’ll let you know when your batch opens.' : 'We’re opening Jentera in small batches. Join the waitlist to be among the first to put AI staff to work for your business.'}</p>
    {!joined && <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit('waitlist'); }}>
      <label className="flex flex-col gap-2 text-sm">Email address<input className="input w-full text-base" placeholder="you@company.com" type="email" autoComplete="email" maxLength={320} required value={email} onChange={event => setEmail(event.target.value)} /></label>
      {captcha.enabled && <div ref={captcha.attach} />}
      <button className="btn btn-primary min-h-11 access-launch__submit" disabled={busy} type="submit">{busy ? 'Saving your place…' : 'Get early access'}<span aria-hidden="true">↗</span></button>
      <p className="access-launch__consent">We’ll email you when your invitation is ready. By joining, you agree to receive updates about Jentera access.</p>
    </form>}
    {notice && <p role="status" className="access-launch__notice">{notice}</p>}
    <div className="access-launch__card-footer"><span aria-hidden="true">✦</span> Built for the businesses building tomorrow.</div>
    </section>
    {signedIn && <p className="text-sm text-text-secondary">Your account and business data are kept safe. Access is currently paused unless you have an active paid grant or trial.</p>}
    {showTrialCode && <section className="card flex flex-col gap-3 p-5"><h2 className="text-lg font-semibold">Have a trial code?</h2><p className="text-sm text-text-secondary">Invited trials last 3 days from redemption. Each code works once, and each account can use one trial.</p>
      {signedIn ? <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit('redeem'); }}>
        <label className="flex flex-col gap-2">Invite code<input className="input w-full text-base" required maxLength={100} autoComplete="off" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} /></label>
        <button className="btn btn-outline min-h-11" disabled={busy || !code.trim()}>Start my 3-day trial</button>
      </form> : <Link className="btn btn-outline min-h-11" to="/signin">Sign in to redeem your code</Link>}
    </section>}
    {!signedIn && <Link to="/signin" className="access-launch__signin">Already have access? <span>Sign in →</span></Link>}
    {signedIn && <button type="button" className="access-launch__signin min-h-11" disabled={loggingOut || busy} onClick={() => void logout()}>{loggingOut ? 'Logging out…' : 'Log out'}</button>}
    {!loaded && !notice && <p role="status">Checking access…</p>}
    </div>
    </div>
  </main>;
}
