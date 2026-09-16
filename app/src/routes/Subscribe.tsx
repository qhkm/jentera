import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, SignOut } from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { clearTrialInvite } from '@/lib/trial-link';
import { clearAskStorage } from '@/hooks/useAsk';
import { isChatPreview } from '@/hooks/useChatPreview';
import { launchPlanBenefits } from '@/lib/launch-offer';
import '@/styles/access.css';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
type BillingStatus = {
  checkoutEnabled: boolean; portalEnabled?: boolean; mode: 'live' | 'sandbox' | null;
  activation: 'active' | 'pending' | 'inactive' | 'review';
  offer: { initialMonthlyAmount: number; introductoryMonths: number; renewalMonthlyAmount: number; currency: string };
  state: { has_customer: boolean; stripe_subscription_status: string | null } | null;
  preview?: { limit: number; used: number; remaining: number } | null;
};

/** The return URL only requests a status check. It is never payment evidence. */
export default function Subscribe() {
  const [params] = useSearchParams();
  const returning = params.get('checkout') === 'complete';
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState('');
  const [check, setCheck] = useState(0);
  const requestKey = useRef<string | null>(null);
  useEffect(() => {
    if (loggingOut) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const controller = new AbortController();
    async function refresh() {
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${API}/api/billing/status`, { credentials: 'include', signal: controller.signal });
        if (stopped) return;
        if (response.status === 401) { setSignedOut(true); setLoading(false); return; }
        if (!response.ok) throw new Error('Could not check your subscription. Please try again.');
        const body = await response.json() as BillingStatus & { ok?: boolean };
        if (!body.ok || !body.offer || !['active', 'pending', 'inactive', 'review'].includes(body.activation)) throw new Error('Could not check your subscription. Please try again.');
        if (stopped) return;
        setStatus(body); setSignedOut(false); setLoading(false); setNotice('');
        if (returning && body.activation === 'active') { window.location.replace('/app'); return; }
        if (returning && body.checkoutEnabled && ['pending', 'inactive'].includes(body.activation) && ++polls < 30) timer = setTimeout(refresh, 2000);
      } catch {
        if (!stopped) { setLoading(false); setNotice('Could not check your subscription. No access was granted by this page. Please try again.'); }
      } finally { clearTimeout(timeout); }
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [returning, check, loggingOut]);

  async function logout() {
    if (busy || loggingOut) return;
    setLoggingOut(true); setLogoutNotice('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new Error('Could not sign out.');
      clearTrialInvite(); clearAskStorage(); setSignedOut(true); setStatus(null);
      // Wait for server-side revocation, then unload all account state.
      window.location.replace('/');
    } catch {
      setLogoutNotice('Could not sign out. Please try again.');
      setLoggingOut(false);
    } finally { clearTimeout(timeout); }
  }

  async function openCheckout(portal = false) {
    if (busy || loggingOut || (portal ? !status?.portalEnabled : !status?.checkoutEnabled)) return;
    setBusy(true); setNotice('');
    requestKey.current ??= crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${API}/api/billing/${portal ? 'portal' : 'launch/checkout'}`, {
        method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey.current },
        body: JSON.stringify(portal ? {} : { plan: 'launch' }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.err ?? 'Could not open checkout. Please try again.');
      const destination = new URL(body.url);
      if (destination.protocol !== 'https:' || destination.hostname !== (portal ? 'billing.stripe.com' : 'checkout.stripe.com') || destination.username || destination.password) throw new Error('Could not open a secure Stripe checkout.');
      window.location.assign(destination.href);
    } catch (error) { setNotice(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Checkout timed out. Please retry; your request will not create a duplicate checkout.'); }
    finally { clearTimeout(timeout); setBusy(false); }
  }
  const existing = status?.state?.has_customer && status.state.stripe_subscription_status
    && !['canceled', 'incomplete_expired'].includes(status.state.stripe_subscription_status);
  const review = status?.activation === 'review';
  const preview = isChatPreview(status?.preview) && status?.activation !== 'active' ? status.preview : null;
  const canPreview = preview && preview.remaining > 0 && !returning && !review;
  return <main className="access-launch subscribe-page">
    <header className="access-launch__header"><Link to="/" aria-label="Jentera home" className="access-launch__logo"><JenteraMark size={36} /><span>Jentera</span></Link><span className="access-launch__edition">YOUR AI STAFF</span></header>
    <div className="subscribe-page__layout">
      <nav className="subscribe-page__navigation" aria-label="Subscription page navigation">
        <Link to="/" className="access-launch__signin"><ArrowLeft size={16} aria-hidden="true" />Back to website</Link>
        {!signedOut && <button type="button" className="access-launch__signin" disabled={loggingOut || busy} onClick={() => void logout()} title="Signing out does not cancel your subscription."><SignOut size={16} aria-hidden="true" />{loggingOut ? 'Signing out…' : 'Sign out'}</button>}
      </nav>
      <section className="access-launch__card" aria-labelledby="subscribe-title">
        <div className="access-launch__card-top"><span>JENTERA LAUNCH PLAN</span><span aria-hidden="true">↗</span></div>
        <h1 id="subscribe-title">{status?.activation === 'active' ? 'Your account is active.' : review ? 'Your payment needs a review.' : preview?.remaining === 0 ? 'Your free chats are complete.' : 'Put your AI staff to work.'}</h1>
        <p className="access-launch__card-copy">Just hand the work to Jentera. Your AI staff has its own computer for research, admin, reports and everyday business tasks.</p>
        {loading && <p role="status">Checking your account…</p>}
        {signedOut && <><p className="access-launch__card-copy">Create or sign in to your Jentera account first. You’ll continue to your plan when checkout is available. Payment will activate that account automatically once Stripe confirms it.</p><Link className="btn btn-primary min-h-11 access-launch__submit" to="/signin">Create account or sign in <span aria-hidden="true">→</span></Link></>}
        {status && <>
          {status.mode === 'sandbox' && <p role="status">Test checkout only — no real payment.</p>}
          {canPreview && <><Link className="btn btn-primary min-h-11 access-launch__submit" to="/app">Try Jentera — {preview.remaining} free chats left<span aria-hidden="true">→</span></Link><p className="access-launch__consent">No payment needed for your free chats. Upgrade when you’re ready for more.</p></>}
          <p className="subscribe-page__price">RM{status.offer.initialMonthlyAmount}<span>/month</span></p>
          <p className="access-launch__consent">{status.offer.introductoryMonths > 0 ? `RM99/month for your first ${status.offer.introductoryMonths} monthly billing periods, then RM199/month from month 4. The introductory offer is for first purchases only.` : 'RM199/month. Your account has already used the introductory offer.'} Cancel future renewals through your Stripe billing portal.</p>
          <ul className="subscribe-page__benefits" aria-label="Launch plan inclusions">{launchPlanBenefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
          <p className="access-launch__consent">Your private founder-group invitation appears in the platform after payment is confirmed. Ask questions, share feedback and help shape Jentera with us.</p>
          <p className="access-launch__consent">Recurring routines are currently in a limited pilot and are not enabled for every account.</p>
          <p className="access-launch__consent">Standard AI usage is subject to fair-use limits, not unlimited compute. Review our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy notice</Link> before subscribing. Stripe securely handles payment details.</p>
          {returning && status.activation !== 'active' && !review && <p role="status" className="access-launch__notice">Waiting for Stripe’s payment confirmation. Closing this page does not stop activation. You can check again or return after your payment is confirmed.</p>}
          {status.activation === 'active' && <Link className="btn btn-primary min-h-11 access-launch__submit" to="/app">Go to my workspace <span aria-hidden="true">→</span></Link>}
          {review && <p role="status" className="access-launch__notice">Access is paused while a refund or payment dispute is reviewed. Please contact support; subscribing again will not remove this hold.</p>}
          {!status.checkoutEnabled && status.activation !== 'active' && !existing && <p role="status" className="access-launch__notice">Secure checkout is being configured. No payment can be taken from this page yet.</p>}
          {status.checkoutEnabled && !existing && !review && !returning && status.activation !== 'active' && <button className={`btn ${canPreview ? 'btn-outline' : 'btn-primary'} min-h-11 access-launch__submit w-full`} disabled={busy || loggingOut} onClick={() => void openCheckout()}>{busy ? 'Opening secure checkout…' : `Subscribe — RM${status.offer.initialMonthlyAmount}/month`}<span aria-hidden="true">→</span></button>}
          {status.portalEnabled && existing && <button className="btn btn-outline min-h-11 w-full" disabled={busy || loggingOut} onClick={() => void openCheckout(true)}>{busy ? 'Opening billing…' : 'Manage subscription'}</button>}
        </>}
        {notice && <p role="alert" className="access-launch__notice">{notice}</p>}
        {logoutNotice && <p role="alert" className="access-launch__notice">{logoutNotice}</p>}
        {!loading && !signedOut && <button className="btn btn-outline min-h-11 w-full" disabled={busy || loggingOut} onClick={() => setCheck(value => value + 1)}>Check payment status</button>}
        <div className="access-launch__card-footer">Thank you for supporting us early. We’re building Jentera together and want to hear your feedback.</div>
      </section>
    </div>
  </main>;
}
