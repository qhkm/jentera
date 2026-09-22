import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';
import { useTurnstile } from '@/lib/turnstile';
import { pendingTrialInvite, clearTrialInvite } from '@/lib/trial-link';
import '@/styles/access.css';
import { launchOffer } from '@/lib/launch-offer';
import { LaunchAnnouncement } from '@/components/LaunchAnnouncement';
import { AccountWelcome } from '@/components/AccountWelcome';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export default function Access() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [linkCode] = useState(pendingTrialInvite);
  const showTrialCode = searchParams.get('invite') === '1' || Boolean(linkCode);
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(linkCode);
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
      if (controller.signal.aborted) return;
      if (body.access?.allowed) { clearTrialInvite(); window.location.replace('/app'); return; }
      // Every sign-in door lands here for a restricted account. Only a
      // server-confirmed identity and open checkout may continue to its plan.
      // Keep explicit waitlist and trial invitations available unchanged.
      if (pathname === '/access' && !showTrialCode && body.signedIn === true && body.billing?.checkoutEnabled === true) {
        navigate('/subscribe', { replace: true }); return;
      }
      setSignedIn(body.signedIn === true); setCheckoutEnabled(body.billing?.checkoutEnabled === true); setLoaded(true);
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [navigate, pathname, showTrialCode]);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const res = await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Could not log out. Please try again.');
      clearTrialInvite(); setSignedIn(false); setCode('');
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
      if (kind === 'redeem') { clearTrialInvite(); setCode(''); window.location.assign(['/app', '/onboard', '/setup', '/access'].includes(body.next) ? body.next : '/access'); }
      else { setJoined(true); setNotice('You’re on the list. We’ll email you when your invitation is ready.'); }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); if (kind === 'waitlist') captcha.reset(); }
  }
  return <><LaunchAnnouncement /><main className="access-launch">
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
    {loaded && signedIn && !checkoutEnabled && <AccountWelcome />}
    {!linkCode && <section className="access-launch__card" aria-labelledby="access-title">
      <div className="access-launch__card-top"><span>YOUR NEXT CHAPTER</span><span aria-hidden="true">↗</span></div>
      <h2 id="access-title">{joined ? 'You’re on the list.' : 'Your first AI staff.'}</h2>
      <p className="access-launch__card-copy">{joined ? 'Thanks for joining. We’ll let you know when you can subscribe and choose your first workflow.' : `The launch offer: RM${launchOffer.monthlyPrice}/month for ${launchOffer.introductoryMonths} months, then RM${launchOffer.renewalPrice}/month from month 4. Your AI staff, its own computer and included AI usage. Private WhatsApp support and direct founder access are available after payment is confirmed.`}</p>
      {!checkoutEnabled && <p className="access-launch__consent">New subscriptions are temporarily unavailable. Joining the waitlist is free and does not start a subscription.</p>}
      {checkoutEnabled && <><Link className="btn btn-primary min-h-11 access-launch__submit" to={signedIn ? '/subscribe' : '/signin?mode=signup'}>{signedIn ? 'Choose my launch plan' : 'Get my AI staff'}<span aria-hidden="true">→</span></Link><p className="access-launch__consent">Your account activates automatically after Stripe confirms payment. Founder support is available after verification.</p></>}
    {!joined && !checkoutEnabled && <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit('waitlist'); }}>
      <label className="flex flex-col gap-2 text-sm">Email address<input className="input w-full text-base" placeholder="you@company.com" type="email" autoComplete="email" maxLength={320} required value={email} onChange={event => setEmail(event.target.value)} /></label>
      {captcha.enabled && <div ref={captcha.attach} />}
      <button className="btn btn-primary min-h-11 access-launch__submit" disabled={busy} type="submit">{busy ? 'Saving your place…' : 'Get early access'}<span aria-hidden="true">↗</span></button>
      <p className="access-launch__consent">We’ll email you when your invitation is ready. By joining, you agree to receive updates about Jentera access.</p>
    </form>}
    {notice && <p role="status" className="access-launch__notice">{notice}</p>}
    <div className="access-launch__card-footer"><span aria-hidden="true">✦</span> Built for the businesses building tomorrow.</div>
    </section>}
    {signedIn && <p className="text-sm text-text-secondary">Your account and business data are kept safe. Access is currently paused unless you have an active paid grant or trial.</p>}
    {showTrialCode && <section className="card flex flex-col gap-3 p-5"><h2 className="text-lg font-semibold">{linkCode ? 'You’re invited to try Jentera.' : 'Have a trial code?'}</h2><p className="text-sm text-text-secondary">Invited trials last 3 days from redemption. Every account can use one trial, and invitations close when their claim limit is reached.</p>
      {linkCode && <p className="text-sm text-text-secondary">New here? Use Google on the sign-in page to create your account. Existing users can sign in normally. Then start your trial. If sign-in opens another browser, reopen this invitation there.</p>}
      {linkCode && notice && <p role="status">{notice}</p>}
      {signedIn ? <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit('redeem'); }}>
        {!linkCode && <label className="flex flex-col gap-2">Invite code<input className="input w-full text-base" required maxLength={100} autoComplete="off" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} /></label>}
        <button className="btn btn-outline min-h-11" disabled={busy || !code.trim()}>Start my 3-day trial</button>
      </form> : <Link className="btn btn-outline min-h-11" to={linkCode ? `/signin#code=${encodeURIComponent(linkCode)}` : '/signin'}>Sign in to start your trial</Link>}
    </section>}
    {!signedIn && <Link to="/signin" className="access-launch__signin">Already have access? <span>Sign in →</span></Link>}
    {signedIn && <button type="button" className="access-launch__signin min-h-11" disabled={loggingOut || busy} onClick={() => void logout()}>{loggingOut ? 'Logging out…' : 'Log out'}</button>}
    {!loaded && !notice && <p role="status">Checking access…</p>}
    </div>
    </div>
  </main></>;
}
